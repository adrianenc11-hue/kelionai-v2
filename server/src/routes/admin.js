'use strict';

const { Router } = require('express');
const {
  getUserById,
  getAllUsers,
  updateUser,
  deleteUser,
  getCreditRevenueSummary,
  getDb,
  listRecentCreditTransactions,
  addCreditsTransaction,
  getUserByEmail,
  getCreditsBalance,
  listRecentVisitors,
  getVisitorStats,
} = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { getAllCredits, probeStripe, buildRevenueSplit } = require('../services/aiCredits');
const { sendEmailAlert } = require('../services/emailAlerts');
const { bootstrapAdmin } = require('../services/adminBootstrap');
const autoTopup = require('../services/autoTopup');
const payoutsService = require('../services/payouts');

const router = Router();

// All admin routes require authentication AND admin role
router.use(requireAuth);
router.use(requireAdmin);

/**
 * GET /api/admin/credits
 * Returns per-provider AI credit / balance status for the admin dashboard.
 *
 * Adrian's spec: one card per AI we use, showing the real remaining balance,
 * a top-up link to the provider's billing page, and an email alert sent
 * to contact@kelionai.app when a balance goes low. We also expose a
 * "kind" flag so the UI can visually separate AI spend (cost centers)
 * from Stripe revenue (income).
 */
const _alertCooldown = new Map(); // provider id -> last alert sent (ms)
const ALERT_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * GET /api/admin/business
 * Live business-health snapshot: credit top-up revenue (from ledger) and
 * Stripe available balance. Used by the admin "Business" dashboard.
 */
router.get('/business', async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const [summary, stripeCard] = await Promise.all([
      getCreditRevenueSummary(days),
      probeStripe(),
    ]);
    res.json({
      window: { days, since: new Date(Date.now() - days * 86400000).toISOString() },
      ledger: summary,
      stripe: {
        configured: stripeCard.configured,
        balanceDisplay: stripeCard.balanceDisplay,
        balance: stripeCard.balance,
        status: stripeCard.status,
        message: stripeCard.message,
      },
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[admin/business] Error:', err && err.message);
    res.status(500).json({ error: 'Failed to load business metrics' });
  }
});

/**
 * GET /api/admin/revenue-split
 * Returns the 50/50 (configurable via AI_ALLOCATION_FRACTION) split
 * snapshot: revenue collected from top-ups in the window, how much of
 * it is earmarked for AI provider spend, how much is known-spent (so
 * far only ElevenLabs can be auto-measured; Gemini is manual because
 * AI Studio keys don't expose billing), and the remaining budget.
 * This is the single source of truth the admin dashboard renders next
 * to the raw provider cards.
 */
/**
 * GET /api/admin/credits/ledger
 * Flat feed of the most recent credit-ledger entries across every
 * user. Backs the admin "Live Usage" panel, which auto-refreshes every
 * 5 seconds so Adrian can watch consumption tick in real time — and
 * catch another fraud window like 2026-04-20 the moment it opens,
 * not after the fact.
 *
 * Query:
 *   limit?  (1..500, default 50)
 *   kind?   (topup | consumption | admin_grant | ...) — optional filter
 *   sinceMs? (epoch ms) — only rows newer than this
 *
 * Response: { rows: [...], ts }
 */
router.get('/credits/ledger', async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 50));
    const kind = req.query.kind ? String(req.query.kind) : null;
    const sinceMs = req.query.sinceMs ? Number(req.query.sinceMs) : null;
    const rows = await listRecentCreditTransactions({ limit, kind, sinceMs });
    res.json({ rows, ts: new Date().toISOString() });
  } catch (err) {
    console.error('[admin/credits/ledger] Error:', err && err.message);
    res.status(500).json({ error: 'Failed to load credit ledger' });
  }
});

/**
 * POST /api/admin/credits/grant
 * Admin-issued refund / comp. Idempotency is NOT enforced (same as
 * existing admin endpoints — the caller owns the dedupe).
 *
 * Body: { email: string, minutes: number, note?: string }
 *   - minutes > 0  → grant (top-up effect)
 *   - minutes < 0  → claw back (not expected to be used often)
 *   - minutes == 0 → 400
 *
 * Primary use case: refund the 33 credits user "Kelion" lost to the
 * 1011 charge-on-open bug on 2026-04-20. Also useful for comp'ing
 * early adopters, promo credits, and anything else that doesn't flow
 * through Stripe.
 *
 * The transaction is tagged `kind='admin_grant'` and includes the
 * admin's email in `note` so the ledger has a full audit trail.
 */
router.post('/credits/grant', async (req, res) => {
  try {
    const { email, minutes, note } = req.body || {};
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'email (string) is required' });
    }
    const mins = Number(minutes);
    if (!Number.isFinite(mins) || mins === 0) {
      return res.status(400).json({ error: 'minutes must be a non-zero number' });
    }
    const user = await getUserByEmail(email.toLowerCase());
    if (!user) {
      return res.status(404).json({ error: `No user with email ${email}` });
    }
    const adminEmail = (req.user && req.user.email) || 'unknown';
    const rounded = Math.trunc(mins);
    const safeNote = [
      `admin_grant by ${adminEmail}`,
      note ? `— ${String(note).slice(0, 200)}` : '',
    ].filter(Boolean).join(' ');
    const result = await addCreditsTransaction({
      userId: user.id,
      deltaMinutes: rounded,
      kind: 'admin_grant',
      note: safeNote,
    });
    return res.json({
      userId: user.id,
      email: user.email,
      deltaMinutes: rounded,
      balanceMinutes: result.balance,
      previous: result.previous,
      note: safeNote,
    });
  } catch (err) {
    console.error('[admin/credits/grant] Error:', err && err.message);
    res.status(500).json({ error: err && err.message || 'Failed to grant credits' });
  }
});

router.get('/revenue-split', async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const summary = await getCreditRevenueSummary(days);
    const split = await buildRevenueSplit(summary, { days });
    res.json(split);
  } catch (err) {
    console.error('[admin/revenue-split] Error:', err && err.message);
    res.status(500).json({ error: 'Failed to compute revenue split' });
  }
});

/**
 * GET /api/admin/payouts
 * Payout dashboard data: Stripe balance (available / pending / instant-
 * available), the linked external account, the automatic payout
 * schedule, the last ~10 payouts, and the 50/50 split snapshot pulled
 * straight from buildRevenueSplit. The admin UI renders all of this
 * without needing the Stripe Dashboard tab open.
 */
router.get('/payouts', async (req, res) => {
  try {
    const days = Math.min(365, Math.max(1, Number(req.query.days) || 30));
    const [snapshot, summary] = await Promise.all([
      payoutsService.getPayoutSnapshot(),
      getCreditRevenueSummary(days),
    ]);
    const split = await buildRevenueSplit(summary, { days });
    res.json({
      ...snapshot,
      split, // 50/50 revenue split over the same window
    });
  } catch (err) {
    console.error('[admin/payouts] Error:', err && err.message);
    res.status(500).json({ error: 'Failed to load payouts dashboard' });
  }
});

/**
 * POST /api/admin/payouts/instant
 * Fires an on-demand Stripe instant payout. Body: { amountCents?,
 * currency?, description? }. When amount is omitted Stripe pays out
 * the full instant-available balance. Stripe's own error messages are
 * forwarded verbatim so the admin can triage (e.g. "external account
 * does not support instant payouts" when IBAN is the only destination).
 */
router.post('/payouts/instant', async (req, res) => {
  try {
    const { amountCents, currency, description } = req.body || {};
    const parsedAmount = Number(amountCents);
    const out = await payoutsService.triggerInstantPayout({
      amountCents: Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount : undefined,
      currency: typeof currency === 'string' ? currency : undefined,
      description: typeof description === 'string' ? description : undefined,
    });
    const adminEmail = (req.user && req.user.email) || 'unknown';
    sendEmailAlert({
      subject: `[Kelion] Instant payout triggered (${out.display})`,
      text: [
        `Admin ${adminEmail} fired an instant payout.`,
        `Amount: ${out.display}`,
        `Stripe payout id: ${out.id} (status: ${out.status})`,
        out.arrivalDateMs ? `Arrival: ${new Date(out.arrivalDateMs).toISOString()}` : '',
        'Dashboard: https://dashboard.stripe.com/payouts',
      ].filter(Boolean).join('\n'),
    }).catch((err) => console.warn('[admin/payouts/instant] alert failed:', err && err.message));
    res.json(out);
  } catch (err) {
    console.error('[admin/payouts/instant] Error:', err && err.message);
    const status = Number.isFinite(err && err.status) ? err.status : 500;
    res.status(status >= 400 && status < 600 ? status : 500).json({
      error: err && err.message || 'Failed to trigger instant payout',
      stripe: err && err.stripe,
    });
  }
});

router.get('/credits', async (req, res) => {
  try {
    const cards = await getAllCredits();

    // Fire-and-forget email alerts for low/error providers we care about.
    // Cooldown per provider so we don't spam the inbox on every refresh.
    const now = Date.now();
    for (const c of cards) {
      if (c.kind === 'revenue') continue; // revenue providers don't trigger low alerts
      // `unconfigured` = opt-in provider (e.g. Groq) that the admin
      // intentionally hasn't set up. Admin still sees the red card in the
      // dashboard, but we don't spam their inbox every 6h about it.
      if (c.status !== 'low' && c.status !== 'error') continue;
      const last = _alertCooldown.get(c.id) || 0;
      if (now - last < ALERT_COOLDOWN_MS) continue;
      _alertCooldown.set(c.id, now);
      sendEmailAlert({
        subject: `[Kelion] ${c.name} credit ${c.status === 'low' ? 'LOW' : 'ERROR'}`,
        text: [
          `${c.name} — ${c.status.toUpperCase()}`,
          `Balance: ${c.balanceDisplay}`,
          c.message ? `Detail: ${c.message}` : '',
          `Top up: ${c.topUpUrl}`,
        ].filter(Boolean).join('\n'),
      }).catch((err) => {
        console.warn('[admin/credits] alert dispatch failed:', err && err.message);
      });
    }

    // Fire-and-forget auto-topup pass. Only providers with a numeric
    // balance/limit ratio below the configured threshold (default 20%)
    // will actually charge the owner's saved Stripe card; everything
    // else is a no-op. Errors never bubble up to the admin response.
    autoTopup.checkAndTrigger(cards).catch((err) => {
      console.warn('[admin/credits] auto-topup check failed:', err && err.message);
    });

    res.json({
      cards,
      autoTopup: autoTopup.getStatus(),
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[admin/credits] Error:', err && err.message);
    res.status(500).json({ error: 'Failed to fetch AI credits' });
  }
});

/**
 * GET /api/admin/auto-topup
 * Surfaces the owner-facing auto-topup configuration + in-memory
 * history (last attempt per provider: timestamp, success/error,
 * PaymentIntent id). Used by the admin UI to render the "Auto-topup:
 * X% threshold · Y EUR from saved card · last run …" info strip.
 */
router.get('/auto-topup', async (req, res) => {
  try {
    res.json(autoTopup.getStatus());
  } catch (err) {
    console.error('[admin/auto-topup] Error:', err && err.message);
    res.status(500).json({ error: 'Failed to load auto-topup status' });
  }
});

/**
 * GET /api/admin/visitors
 * Recent visitor events — one row per SPA page load, captured by the
 * `visitorLog` middleware. Returns IP, country, user-agent, referer,
 * path, and the associated user email if the visitor was signed in.
 *
 * Adrian 2026-04-20: "nu vad buton vizite reale cine a vizitat situl,
 * ip tara restul datelor lor". Admin-only — IP is considered PII.
 */
router.get('/visitors', async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const windowHours = Math.min(24 * 30, Math.max(1, Number(req.query.windowHours) || 24));
    const [rows, stats] = await Promise.all([
      listRecentVisitors(limit),
      getVisitorStats({ windowHours }),
    ]);
    res.json({
      visits: rows.map((r) => ({
        id: r.id,
        ts: r.ts,
        path: r.path,
        ip: r.ip,
        country: r.country,
        userAgent: r.user_agent,
        referer: r.referer,
        userId: r.user_id,
        userEmail: r.user_email,
      })),
      stats,
      ts: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[admin/visitors] Error:', err && err.message);
    res.status(500).json({ error: 'Failed to fetch visitors' });
  }
});

/**
 * GET /api/admin/users
 * List all users
 */
router.get('/users', async (req, res) => {
  try {
    const users = await getAllUsers();
    
    // Sanitize user data
    const sanitized = users.map(u => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      subscription_tier: u.subscription_tier,
      subscription_status: u.subscription_status,
      usage_today: u.usage_today,
      referral_code: u.referral_code,
      created_at: u.created_at,
    }));

    res.json({ users: sanitized, total: sanitized.length });
  } catch (err) {
    console.error('[admin/users] Error:', err.message);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

/**
 * GET /api/admin/users/:id
 * Get specific user details
 */
router.get('/users/:id', async (req, res) => {
  try {
    const user = await getUserById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      role: user.role,
      subscription_tier: user.subscription_tier,
      subscription_status: user.subscription_status,
      usage_today: user.usage_today,
      usage_reset_date: user.usage_reset_date,
      referral_code: user.referral_code,
      referred_by: user.referred_by,
      stripe_customer_id: user.stripe_customer_id,
      created_at: user.created_at,
      updated_at: user.updated_at,
    });
  } catch (err) {
    console.error('[admin/users/:id] Error:', err.message);
    res.status(500).json({ error: 'Failed to get user' });
  }
});

/**
 * PUT /api/admin/users/:id/subscription
 * Update user subscription
 */
router.put('/users/:id/subscription', async (req, res) => {
  try {
    const { id } = req.params;
    const { subscription_tier, subscription_status } = req.body;

    const validTiers = ['free', 'basic', 'premium', 'enterprise'];
    const validStatuses = ['active', 'cancelled', 'past_due', 'trialing'];

    if (subscription_tier && !validTiers.includes(subscription_tier)) {
      return res.status(400).json({ error: 'Invalid subscription tier' });
    }

    if (subscription_status && !validStatuses.includes(subscription_status)) {
      return res.status(400).json({ error: 'Invalid subscription status' });
    }

    const updateData = {};
    if (subscription_tier) updateData.subscription_tier = subscription_tier;
    if (subscription_status) updateData.subscription_status = subscription_status;

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No valid fields to update' });
    }

    const updatedUser = await updateUser(id, updateData);

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: updatedUser.id,
      email: updatedUser.email,
      subscription_tier: updatedUser.subscription_tier,
      subscription_status: updatedUser.subscription_status,
    });
  } catch (err) {
    console.error('[admin/subscription] Error:', err.message);
    res.status(500).json({ error: 'Failed to update subscription' });
  }
});

/**
 * PUT /api/admin/users/:id/role
 * Update user role
 */
router.put('/users/:id/role', async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    if (!['user', 'admin'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const updatedUser = await updateUser(id, { role });

    if (!updatedUser) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({
      id: updatedUser.id,
      email: updatedUser.email,
      role: updatedUser.role,
    });
  } catch (err) {
    console.error('[admin/role] Error:', err.message);
    res.status(500).json({ error: 'Failed to update role' });
  }
});

/**
 * DELETE /api/admin/users/:id
 * Delete user
 */
router.delete('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await getUserById(id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    await deleteUser(id);

    res.json({ message: 'User deleted', id });
  } catch (err) {
    console.error('[admin/delete] Error:', err.message);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

/**
 * POST /api/admin/purge-users
 *
 * Adrian: "golesti toti userii". Wipes every user row (and dependent
 * tables: credits, memory, push, referrals, proactive log) then re-seeds
 * the admin from ADMIN_BOOTSTRAP_PASSWORD so the caller can still sign
 * back in. Mirrors /api/diag/purge-users but is gated by admin JWT
 * instead of the shared X-Purge-Secret — so Adrian can trigger it from
 * his signed-in admin session without needing the env var.
 */
router.post('/purge-users', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(503).json({ error: 'db not initialized' });

    const tables = [
      'credit_transactions',
      'credit_ledger',
      'credit_balances',
      'memory_items',
      'push_subscriptions',
      'proactive_log',
      'referrals',
      'users',
    ];
    const deleted = {};
    for (const t of tables) {
      try {
        const exists = await db.get(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
          [t],
        );
        if (!exists) { deleted[t] = 'table not present'; continue; }
        const result = await db.run(`DELETE FROM ${t}`);
        deleted[t] = result && result.changes != null ? result.changes : 'ok';
      } catch (err) {
        deleted[t] = `error: ${err && err.message}`;
      }
    }

    const reseed = await bootstrapAdmin();
    return res.json({ now: new Date().toISOString(), deleted, reseed });
  } catch (err) {
    console.error('[admin/purge-users] failed:', err && err.message);
    return res.status(500).json({ error: err && err.message });
  }
});

module.exports = router;
