'use strict';

/**
 * Credits — monetization routes.
 *
 * Adrian's approved model: 1 credit = 1 minute of Kelion Live (voice +
 * tools). User tops up via Stripe Checkout at £0.30/min. Standard
 * packages are defined below; any of them can be overridden via env
 * vars without a code change.
 *
 * Endpoints:
 *   GET  /api/credits/balance     → current user's balance + recent tx
 *   GET  /api/credits/packages    → list of buyable credit bundles
 *   POST /api/credits/checkout    → create a Stripe Checkout session
 *   POST /api/credits/webhook     → Stripe webhook → fulfill top-up
 *
 * Design choices:
 *   - All balance mutations go through db.addCreditsTransaction which
 *     runs BEGIN IMMEDIATE + writes an immutable ledger row. Stripe
 *     session ID has a UNIQUE index → idempotent fulfillment on
 *     webhook replays.
 *   - Signature verification uses Stripe's recommended HMAC SHA-256
 *     comparison against the raw body. We mount this route with
 *     express.raw({type: 'application/json'}) BEFORE the global JSON
 *     parser so the raw bytes survive.
 *   - When STRIPE_SECRET_KEY is not set, POST /checkout returns
 *     503 — the UI can show "coming soon" without crashing.
 */

const { Router } = require('express');
const crypto = require('crypto');
const express = require('express');
const config = require('../config');
const { requireAuth } = require('../middleware/auth');
const {
  getCreditsBalance,
  addCreditsTransaction,
  getCreditTopupByPaymentIntent,
  listCreditTransactions,
  // Audit M7 — DB-backed consume state. Optional on the mock DB used
  // by some legacy tests; fall back gracefully if any of these are
  // missing (`_dbGet/_dbSave/_dbGc` helpers below handle that).
  getConsumeState: _dbGetConsumeState,
  saveConsumeState: _dbSaveConsumeState,
  gcConsumeStateRows: _dbGcConsumeStateRows,
} = require('../db');

const router = Router();

/** Standard credit packages (GBP pence + whole minutes). Calibrated to
 *  a £0.30/min retail rate with a volume discount for larger bundles. */
function getPackages() {
  const fromEnv = process.env.CREDIT_PACKAGES_JSON;
  if (fromEnv) {
    try {
      const parsed = JSON.parse(fromEnv);
      if (Array.isArray(parsed) && parsed.every((p) => p.id && p.priceCents && p.minutes)) {
        return parsed;
      }
    } catch (_) { /* fall through to defaults */ }
  }
  return [
    {
      id: 'starter',
      name: 'Starter',
      priceCents: 1000,           // £10
      minutes: 33,                // ~£0.30/min
      highlight: false,
      description: 'About 33 minutes of conversation.',
    },
    {
      id: 'standard',
      name: 'Standard',
      priceCents: 2500,           // £25
      minutes: 100,               // £0.25/min
      highlight: true,
      description: 'About 100 minutes. Best for most.',
    },
    {
      id: 'pro',
      name: 'Pro',
      priceCents: 10000,          // £100
      minutes: 400,               // £0.25/min
      highlight: false,
      description: 'About 400 minutes. Power users.',
    },
  ];
}

router.get('/packages', (_req, res) => {
  res.json({ packages: getPackages() });
});

router.get('/balance', requireAuth, async (req, res) => {
  try {
    const [balance, transactions] = await Promise.all([
      getCreditsBalance(req.user.id),
      listCreditTransactions(req.user.id, 20),
    ]);
    res.json({ balance_minutes: balance, transactions });
  } catch (err) {
    console.error('[credits/balance] error:', err && err.message);
    res.status(500).json({ error: 'Failed to fetch balance' });
  }
});

/**
 * POST /api/credits/consume
 *
 * Deduct live-session minutes from a signed-in user's balance. Called
 * by the client as a 60s heartbeat while a Gemini Live voice session
 * is running (useGeminiLive.js). Admins are auto-exempt (`exempt: true`
 * in the response so the client doesn't need to know who's admin).
 *
 * Body: { minutes?: number, silent?: boolean }
 *   - `minutes` — 1..5, default 1. Only honoured on billable ticks.
 *   - `silent`  — client-provided hint that VAD hasn't seen activity
 *                 for >30 s. We grant it at most `MAX_SILENT_STREAK`
 *                 consecutive times (and never more than
 *                 `MAX_SILENT_WINDOW_MS` total) before forcing a 1-min
 *                 charge on the next heartbeat regardless of the flag.
 *                 This is the anti-bypass backstop for H1 — before
 *                 this, a tampered client that always sent
 *                 `silent:true` kept voice running without ever
 *                 burning a credit.
 *
 * Returns:
 *   { balance_minutes, deducted, exempt: true|false }   on success
 *   { balance_minutes, deducted: 0, silent: true }      idle/silent OK
 *   { balance_minutes: 0, deducted: 0, exhausted: true } balance hit 0
 *   { throttled: true, balance_minutes, retryAfterMs }   spam repeat
 *
 * Anti-drain guard: we enforce a 50-second server-side cooldown per
 * user. This is a defence in depth against the fraud path Adrian
 * hit 2026-04-20: a buggy client (or someone tampering via devtools)
 * could rapid-fire this endpoint and burn through a £10 top-up in
 * seconds with zero service delivered. Real voice sessions only tick
 * every 60 s, so a 50 s floor is a safe margin that never rejects a
 * legitimate heartbeat. We reject fast repeats with 200 + throttled
 * so the client's heartbeat doesn't escalate to a retry storm, and
 * never touch the ledger.
 *
 * H1 hardening: client-provided `silent:true` is now capped. Allowed
 * for up to 3 consecutive heartbeats (≈3 min of VAD silence — an
 * extremely long reflective pause for a live voice chat), and for at
 * most 5 min between billable ticks. After either cap, the next
 * heartbeat charges 1 min even if the flag is still set. Legitimate
 * users (who speak every few seconds) never hit these caps; tampered
 * clients that always send `silent:true` now pay at most once per
 * 5 minutes instead of never.
 *
 * Adrian: "la logare se respecta credit cumparat". + "sa nu se mai
 * repete ca dau de dracu".
 */
const CONSUME_COOLDOWN_MS = 50 * 1000;
// Max consecutive `silent:true` heartbeats we grant for free before
// forcing a real debit on the next one. Real client sends ≈1 heartbeat
// / 60 s, so 3 ≈ 3 min of continuous VAD silence.
const MAX_SILENT_STREAK = 3;
// Wall-clock cap between billable ticks. Even if the streak counter
// hasn't filled (e.g. client pings every 3 min so it never gets to 3
// in 60 s of real time), a 5-min idle window forces a debit.
const MAX_SILENT_WINDOW_MS = 5 * 60 * 1000;
// Entries older than this are evicted by the periodic GC. 15 min is
// generous: the client heartbeats at ≤60 s, so any user mid-session
// will always have touched the map recently. A user this quiet for
// 15 min is either disconnected or their tab was closed — in both
// cases the next `/consume` will rebuild state fresh.
const CONSUME_STATE_TTL_MS = 15 * 60 * 1000;
const CONSUME_STATE_GC_INTERVAL_MS = 5 * 60 * 1000;
const consumeStateByUser = new Map();
// userId → { lastBillableAt, silentStreak, silentSince }

/**
 * Pure decision helper — exposed for unit tests. Given the current
 * per-user state + the incoming request shape, returns what the route
 * should do. The route is responsible for the DB/network side-effects
 * and for persisting the next state; this function owns the policy.
 *
 * @param {{ lastBillableAt?: number, silentStreak?: number, silentSince?: number }} state
 * @param {number} now   — epoch ms of the current request
 * @param {boolean} silent — client-provided silent flag
 * @returns {{ action: 'silent' | 'throttle' | 'charge' | 'charge_forced',
 *            retryAfterMs?: number,
 *            nextState: { lastBillableAt, silentStreak, silentSince } }}
 */
function evaluateConsumeDecision(state, now, silent) {
  const prev = state || {};
  const lastBillableAt = Number(prev.lastBillableAt) || 0;
  const silentStreak   = Number(prev.silentStreak)   || 0;
  const silentSince    = Number(prev.silentSince)    || 0;
  const elapsedSinceBill = lastBillableAt === 0 ? Infinity : now - lastBillableAt;

  if (silent) {
    // Bypass backstop: past the streak cap OR past the wall-clock cap
    // ⇒ upgrade this silent tick to a forced debit. We still respect
    // the cooldown so a tampered client can't flood the endpoint at
    // 1 Hz and burn through a pack in seconds.
    // The cap fires on two signals: the streak counter (3 consecutive
    // silent heartbeats) or the wall-clock window since the first
    // silent tick in the current streak (5 min). We do NOT key off
    // `elapsedSinceBill` directly — a fresh session opens with
    // lastBillableAt=0, and forcing a debit on the very first tick
    // would punish users who happen to start a session during a
    // reflective pause (VAD silence before they begin speaking).
    const silentTooLong =
      silentStreak >= MAX_SILENT_STREAK ||
      (silentSince > 0 && now - silentSince >= MAX_SILENT_WINDOW_MS);
    if (silentTooLong) {
      if (elapsedSinceBill < CONSUME_COOLDOWN_MS) {
        return {
          action: 'throttle',
          retryAfterMs: CONSUME_COOLDOWN_MS - elapsedSinceBill,
          nextState: { lastBillableAt, silentStreak, silentSince },
        };
      }
      return {
        action: 'charge_forced',
        nextState: { lastBillableAt: now, silentStreak: 0, silentSince: 0 },
      };
    }
    // Under the cap — grant free silent pass, bump the counters.
    return {
      action: 'silent',
      nextState: {
        lastBillableAt,
        silentStreak: silentStreak + 1,
        silentSince: silentSince || now,
      },
    };
  }

  // Non-silent (real speech) heartbeat — cooldown + normal debit.
  if (elapsedSinceBill < CONSUME_COOLDOWN_MS) {
    return {
      action: 'throttle',
      retryAfterMs: CONSUME_COOLDOWN_MS - elapsedSinceBill,
      nextState: { lastBillableAt, silentStreak, silentSince },
    };
  }
  return {
    action: 'charge',
    nextState: { lastBillableAt: now, silentStreak: 0, silentSince: 0 },
  };
}

/**
 * H2 fix: periodic GC for `consumeStateByUser`. Without this the Map
 * grows one entry per user-who-ever-called-/consume for the lifetime
 * of the process — Railway restarts every deploy mask the leak in
 * production, but a long-running instance with steady signups still
 * drifts upward. A user is considered stale when the newest timestamp
 * in their state (`lastBillableAt` or `silentSince`) is older than
 * `ttl`. The route rebuilds state from scratch on the next `/consume`
 * call (any missing fields default to 0), so eviction is safe.
 *
 * Pure over inputs — takes the Map explicitly so tests can pass their
 * own without touching module state.
 *
 * @returns {number} number of entries evicted
 */
function gcConsumeState(map, now, ttl = CONSUME_STATE_TTL_MS) {
  let removed = 0;
  const cutoff = now - ttl;
  for (const [userId, state] of map) {
    const newest = Math.max(
      Number(state && state.lastBillableAt) || 0,
      Number(state && state.silentSince) || 0,
    );
    if (newest < cutoff) {
      map.delete(userId);
      removed += 1;
    }
  }
  return removed;
}

let consumeStateGcHandle = null;

/**
 * Starts the periodic GC. Idempotent — safe to call multiple times,
 * extra calls are no-ops. Skipped automatically under Jest so tests
 * that never tear down the process don't inherit a hanging interval.
 */
function startConsumeStateGc() {
  if (consumeStateGcHandle) return consumeStateGcHandle;
  if (process.env.NODE_ENV === 'test') return null;
  consumeStateGcHandle = setInterval(() => {
    try {
      const now = Date.now();
      const n = gcConsumeState(consumeStateByUser, now);
      if (n > 0) {
        console.log('[credits/consume] gc evicted stale cache', { entries: n, remaining: consumeStateByUser.size });
      }
      // Audit M7 — also sweep the DB. Same TTL: a row is stale when
      // its `updated_at` hasn't moved in > TTL, which matches the
      // in-memory policy byte-for-byte.
      if (typeof _dbGcConsumeStateRows === 'function') {
        Promise.resolve(_dbGcConsumeStateRows(now - CONSUME_STATE_TTL_MS))
          .then((rows) => {
            if (typeof rows === 'number' && rows > 0) {
              console.log('[credits/consume] gc evicted stale DB rows', { rows });
            }
          })
          .catch((e) => {
            console.warn('[credits/consume] gc db error', e && e.message);
          });
      }
    } catch (e) {
      console.warn('[credits/consume] gc error', e && e.message);
    }
  }, CONSUME_STATE_GC_INTERVAL_MS);
  // Never let the GC keep the event loop alive on its own.
  if (consumeStateGcHandle && typeof consumeStateGcHandle.unref === 'function') {
    consumeStateGcHandle.unref();
  }
  return consumeStateGcHandle;
}

function stopConsumeStateGc() {
  if (consumeStateGcHandle) {
    clearInterval(consumeStateGcHandle);
    consumeStateGcHandle = null;
  }
}

// Boot the GC on module load so long-running Railway instances don't
// leak. No-op under NODE_ENV=test.
startConsumeStateGc();

/**
 * Audit M7 — resolve the per-user consume state across the DB (the
 * authoritative source of truth across instances) and the in-memory
 * L1 cache. Always read DB-first; on DB failure we fall back to the
 * cache so /consume still works through transient DB hiccups. The
 * cache never short-circuits a successful DB read — see the
 * Copilot P2 note on #186 for why cache-first breaks the cross-
 * instance bypass cap.
 *
 * Returns the resolved state object (fields default to 0).
 */
async function loadConsumeState(userId) {
  if (userId === null || userId === undefined) return {};
  // M7 follow-up (Copilot P2 on #186): the DB is authoritative across
  // instances, so a cache hit alone is NOT sufficient — another
  // instance may have advanced the streak or bumped lastBillableAt,
  // and if we trusted a stale L1 we would (a) make the policy decision
  // on old counters and (b) overwrite the fresh DB row on the next
  // persist, reopening the cross-instance bypass M7 was written to
  // close. We therefore always try the DB first and only fall back to
  // the cache when the DB is unreachable. The cache still exists — it
  // just now serves as a warm fallback for transient DB outages
  // rather than an authoritative read path.
  if (typeof _dbGetConsumeState === 'function') {
    try {
      const row = await _dbGetConsumeState(userId);
      if (row) {
        const state = {
          lastBillableAt: Number(row.lastBillableAt) || 0,
          silentStreak:   Number(row.silentStreak)   || 0,
          silentSince:    Number(row.silentSince)    || 0,
        };
        consumeStateByUser.set(userId, state);
        return state;
      }
      // Row missing in DB — treat as fresh state but keep the cache
      // clear so the next persist writes a canonical row.
      consumeStateByUser.delete(userId);
      return {};
    } catch (e) {
      console.warn('[credits/consume] db load error', e && e.message);
      // Fall through to the cache fallback below.
    }
  }
  // DB unreachable or not wired (legacy mock DB): best-effort cache.
  // Better than crashing, and on the same instance the cache is
  // still useful for the streak cap within the request stream.
  const cached = consumeStateByUser.get(userId);
  return cached || {};
}

/**
 * Audit M7 — persist the post-decision state to both the in-memory
 * cache (L1, zero-cost read on the next heartbeat from the same
 * process) AND the DB (authoritative, visible to other instances).
 * DB write is awaited so a caller that explicitly wants the "every
 * instance sees this" guarantee gets it, but errors are swallowed +
 * logged: a transient DB error must not take down /consume.
 */
async function persistConsumeState(userId, nextState, nowMs) {
  if (userId === null || userId === undefined) return;
  consumeStateByUser.set(userId, nextState);
  if (typeof _dbSaveConsumeState !== 'function') return;
  try {
    await _dbSaveConsumeState(userId, nextState, nowMs);
  } catch (e) {
    console.warn('[credits/consume] db save error', e && e.message);
  }
}

router.post('/consume', requireAuth, async (req, res) => {
  try {
    const { isAdminEmail } = require('../middleware/subscription');
    const { findById } = require('../db');
    const user = await findById(req.user.id).catch(() => null);
    const isAdmin = (req.user && req.user.role === 'admin')
      || isAdminEmail((user && user.email) || req.user.email)
      || (user && (user.role === 'admin' || isAdminEmail(user.email)));
    if (isAdmin) {
      // Admins never burn credits. Short-circuit so the client loop keeps
      // running without any DB writes.
      return res.json({ balance_minutes: null, deducted: 0, exempt: true });
    }

    const silent = !!(req.body && req.body.silent === true);
    const now = Date.now();
    // Audit M7 — read-through: load from DB on cache miss so the silent
    // streak is honoured even when the heartbeat hits a different
    // instance than the one that saw the previous tick.
    const prevState = await loadConsumeState(req.user.id);
    const decision = evaluateConsumeDecision(prevState, now, silent);

    if (decision.action === 'silent') {
      await persistConsumeState(req.user.id, decision.nextState, now);
      const bal = await getCreditsBalance(req.user.id).catch(() => null);
      return res.json({
        balance_minutes: typeof bal === 'number' ? bal : null,
        deducted: 0,
        silent: true,
      });
    }

    if (decision.action === 'throttle') {
      // Throttle intentionally leaves `nextState` equal to the previous
      // state (see evaluateConsumeDecision) — no need to persist.
      const bal = await getCreditsBalance(req.user.id).catch(() => null);
      return res.json({
        balance_minutes: typeof bal === 'number' ? bal : null,
        deducted: 0,
        throttled: true,
        retryAfterMs: decision.retryAfterMs,
      });
    }

    // charge | charge_forced — both actually debit the ledger. The
    // only difference is that `charge_forced` came from a silent-flag
    // request that we upgraded; we log it loudly so the admin can
    // spot tampered clients in production logs.
    if (decision.action === 'charge_forced') {
      console.warn('[credits/consume] forced debit on silent streak', {
        userId: req.user.id,
        silentStreak: prevState.silentStreak || 0,
        silentWindowMs: prevState.silentSince ? now - prevState.silentSince : 0,
      });
    }

    const raw = Number(req.body && req.body.minutes);
    let minutes = Number.isFinite(raw) && raw > 0 ? Math.min(Math.ceil(raw), 5) : 1;
    // Forced debits always charge exactly 1 min — ignore the
    // client-requested `minutes` so a tampered payload can't inflate
    // the charge (e.g. `{ minutes: 5, silent: true }` after the
    // streak cap would otherwise debit 5).
    if (decision.action === 'charge_forced') minutes = 1;

    const current = await getCreditsBalance(req.user.id);
    if (current <= 0) {
      return res.status(402).json({
        balance_minutes: 0,
        deducted: 0,
        exhausted: true,
        error: 'Insufficient credits',
      });
    }
    const take = Math.min(minutes, current);
    const result = await addCreditsTransaction({
      userId: req.user.id,
      deltaMinutes: -take,
      kind: 'consumption',
      note: decision.action === 'charge_forced'
        ? 'Gemini Live session (forced — silent streak capped)'
        : 'Gemini Live session',
    });
    await persistConsumeState(req.user.id, decision.nextState, now);
    return res.json({
      balance_minutes: result.balance,
      deducted: take,
      exempt: false,
      exhausted: result.balance <= 0,
      ...(decision.action === 'charge_forced' ? { forced: true } : {}),
    });
  } catch (err) {
    console.error('[credits/consume] error:', err && err.message);
    res.status(500).json({ error: 'Failed to consume credits' });
  }
});

/**
 * POST /api/credits/checkout
 * Body: { packageId: string }
 * Returns: { url: string }  — redirect the user here
 */
router.post('/checkout', requireAuth, async (req, res) => {
  const { packageId } = req.body || {};
  const pkg = getPackages().find((p) => p.id === packageId);
  if (!pkg) return res.status(400).json({ error: 'Invalid packageId' });

  const secretKey = config.stripe && config.stripe.secretKey;
  if (!secretKey) {
    return res.status(503).json({
      error: 'Payments not configured',
      hint: 'STRIPE_SECRET_KEY missing on server. Contact admin.',
    });
  }

  const successUrl = `${config.appBaseUrl}/?credits=ok&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = `${config.appBaseUrl}/?credits=cancelled`;

  // Form-encoded body per Stripe's HTTP API (no stripe-node dependency
  // required). `line_items[0]` becomes price_data → product_data so we
  // can create the line item dynamically without pre-configured prices.
  const body = new URLSearchParams();
  body.append('mode', 'payment');
  body.append('success_url', successUrl);
  body.append('cancel_url', cancelUrl);
  body.append('client_reference_id', String(req.user.id));
  if (req.user.email) body.append('customer_email', req.user.email);
  body.append('line_items[0][price_data][currency]', 'gbp');
  body.append('line_items[0][price_data][product_data][name]', `Kelion credits — ${pkg.name}`);
  body.append('line_items[0][price_data][product_data][description]', `${pkg.minutes} minutes of Kelion Live`);
  body.append('line_items[0][price_data][unit_amount]', String(pkg.priceCents));
  body.append('line_items[0][quantity]', '1');
  body.append('metadata[user_id]', String(req.user.id));
  body.append('metadata[package_id]', pkg.id);
  body.append('metadata[minutes]', String(pkg.minutes));

  // Billing address is REQUIRED for EU cards (Romania, most EU issuers).
  // Without it, banks often decline at SCA / 3D Secure because the issuer
  // cannot match AVS. Stripe will surface the address form on the hosted
  // checkout page; user cannot skip it.
  body.append('billing_address_collection', 'required');

  // NOTE: `automatic_payment_methods` is ONLY valid on PaymentIntents,
  // NOT on Checkout Sessions. Passing it here makes Stripe reject the
  // whole request with 400 "Received unknown parameter:
  // automatic_payment_methods" and the user sees "HTTP 502" in the UI.
  // For Checkout Sessions, payment methods are configured per-account
  // under Stripe Dashboard → Settings → Payment methods (card + Link
  // are enabled by default on new accounts). If you need to pin an
  // explicit list, use `payment_method_types[]=card` instead.

  // Stripe Tax is OPT-IN. It requires the account to have registered tax
  // locations + origin address configured under Settings → Tax. If it is
  // not configured and we pass automatic_tax=true, Stripe rejects the
  // checkout creation with 400. We default to false and let the operator
  // opt in via STRIPE_AUTOMATIC_TAX=1 once Stripe Tax is live on the
  // account.
  if (process.env.STRIPE_AUTOMATIC_TAX === '1' || process.env.STRIPE_AUTOMATIC_TAX === 'true') {
    body.append('automatic_tax[enabled]', 'true');
  }

  try {
    const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });
    if (!r.ok) {
      const text = await r.text().catch(() => '');
      console.error('[credits/checkout] Stripe error:', r.status, text.slice(0, 400));
      // Surface Stripe's own error message/code to the client so debugging
      // the first live-mode attempt doesn't require SSHing into logs.
      // Common cases we want to see in the UI:
      //   - account not activated for live payments
      //   - automatic_tax requested but Stripe Tax not configured
      //   - invalid currency for the account's country
      let stripeMessage = '';
      let stripeCode = '';
      try {
        const parsed = JSON.parse(text);
        stripeMessage = (parsed && parsed.error && parsed.error.message) || '';
        stripeCode = (parsed && parsed.error && parsed.error.code) || '';
      } catch (_) { /* not JSON */ }
      return res.status(502).json({
        error: stripeMessage || 'Stripe rejected the request',
        code: stripeCode || undefined,
      });
    }
    const session = await r.json();
    res.json({ url: session.url, sessionId: session.id });
  } catch (err) {
    console.error('[credits/checkout] error:', err && err.message);
    res.status(500).json({ error: 'Checkout creation failed' });
  }
});

/**
 * POST /api/credits/webhook
 * Stripe calls this when payment succeeds. We verify the signature
 * against STRIPE_WEBHOOK_SECRET, then credit the user atomically.
 *
 * Mounted from index.js with express.raw(); do NOT apply the JSON
 * parser before this route or the signature check will fail.
 */
function verifyStripeSignature(rawBody, header, secret, toleranceSeconds = 300) {
  if (!header || !secret) return false;
  // Collect ALL v1 signatures — during webhook secret rotation Stripe
  // may send multiple v1 entries, one per active secret. Reducing into
  // an object would clobber all but the last. See stripe-node's
  // parseEventDetails for the canonical approach.
  let timestamp = null;
  const signatures = [];
  for (const kv of header.split(',')) {
    const idx = kv.indexOf('=');
    if (idx < 0) continue;
    const k = kv.slice(0, idx).trim();
    const v = kv.slice(idx + 1).trim();
    if (k === 't') timestamp = v;
    else if (k === 'v1' || k === 'v0') signatures.push(v);
  }
  if (!timestamp || signatures.length === 0) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) return false;
  const signed = `${timestamp}.${rawBody.toString('utf8')}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  return signatures.some((sig) => {
    try {
      return crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'));
    } catch (_) { return false; }
  });
}

/**
 * Audit M3 — invert a Stripe `charge.refunded` event against our ledger.
 * Factored out of `webhookHandler` so tests can drive the pure event
 * path without going through Express. Exported on module.exports for
 * unit coverage.
 *
 * Behaviour:
 *   - No original top-up row → log + no-op (refund is for a charge we
 *     never fulfilled, or for a non-credits product).
 *   - amount_refunded == amount_total on the original → invert full
 *     minutes. amount_refunded < amount_total → invert proportionally,
 *     rounded down so we never refund "extra" minutes.
 *   - Multiple partial refunds on the same charge arrive as separate
 *     events, each carrying a new entry in `charge.refunds.data[]`.
 *     We pick the most recent refund by `created` and use its ID as
 *     the idempotency key. A replay of the same event collapses into
 *     a no-op via the UNIQUE(idempotency_key) index.
 */
async function handleChargeRefunded(event) {
  const charge = event && event.data && event.data.object;
  if (!charge || typeof charge !== 'object') {
    console.warn('[credits/webhook] charge.refunded missing object', event?.id);
    return;
  }
  const paymentIntent = typeof charge.payment_intent === 'string'
    ? charge.payment_intent : null;
  if (!paymentIntent) {
    console.warn('[credits/webhook] charge.refunded missing payment_intent', charge.id);
    return;
  }
  const topup = await getCreditTopupByPaymentIntent(paymentIntent);
  if (!topup) {
    console.warn('[credits/webhook] charge.refunded has no matching top-up', {
      charge: charge.id, pi: paymentIntent,
    });
    return;
  }
  const originalCents = Number(topup.amount_cents || 0);
  const originalMinutes = Number(topup.delta_minutes || 0);
  if (!(originalCents > 0) || !(originalMinutes > 0)) {
    console.warn('[credits/webhook] charge.refunded top-up has zero base', {
      charge: charge.id, topupId: topup.id,
    });
    return;
  }
  // Pick the most recent refund so retries on the same event still
  // settle against a stable idempotency key. Stripe orders
  // refunds.data newest-first in practice, but we sort explicitly.
  const refunds = (charge.refunds && Array.isArray(charge.refunds.data))
    ? charge.refunds.data.slice().sort((a, b) => (b.created || 0) - (a.created || 0))
    : [];
  const latest = refunds[0];
  if (!latest || !latest.id) {
    console.warn('[credits/webhook] charge.refunded missing refunds.data[0]', charge.id);
    return;
  }
  const refundCents = Number(latest.amount || 0);
  if (!(refundCents > 0)) {
    console.warn('[credits/webhook] charge.refunded has zero amount', {
      charge: charge.id, refund: latest.id,
    });
    return;
  }
  // Proportional minutes to invert. Clamp to the original so a Stripe
  // rounding quirk on partial refunds can't back out more than what
  // was granted.
  const rawMinutes = Math.floor((originalMinutes * refundCents) / originalCents);
  const minutesToRevert = Math.max(1, Math.min(originalMinutes, rawMinutes));
  const result = await addCreditsTransaction({
    userId: topup.user_id,
    deltaMinutes: -minutesToRevert,
    amountCents: -refundCents,
    currency: (latest.currency || topup.currency || 'gbp').toLowerCase(),
    kind: 'refund',
    stripePaymentIntent: paymentIntent,
    idempotencyKey: latest.id,
    note: `refund of topup:${topup.id} (${refundCents}/${originalCents})`,
    allowNegative: true,
  });
  console.log('[credits/webhook] refunded', {
    charge: charge.id,
    refund: latest.id,
    userId: topup.user_id,
    topupId: topup.id,
    minutesReverted: minutesToRevert,
    duplicate: Boolean(result.duplicate),
  });
}

const webhookHandler = async (req, res) => {
  const secret = config.stripe && config.stripe.webhookSecret;
  if (!secret) {
    // Without a configured webhook secret we refuse to process — this is
    // the single piece of credit flow that touches user balances and
    // must be authenticated cryptographically.
    return res.status(503).send('webhook not configured');
  }
  const sig = req.headers['stripe-signature'];
  const raw = req.body; // Buffer, because of express.raw()
  if (!Buffer.isBuffer(raw)) {
    return res.status(400).send('raw body expected');
  }
  if (!verifyStripeSignature(raw, sig, secret)) {
    return res.status(400).send('invalid signature');
  }
  let event;
  try {
    event = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).send('invalid JSON');
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data && event.data.object;
      if (!session) return res.status(200).send('ignored');
      const paymentStatus = session.payment_status;
      if (paymentStatus !== 'paid') return res.status(200).send('ignored');
      const userId = Number(
        (session.metadata && session.metadata.user_id) || session.client_reference_id,
      );
      const minutes = Number(session.metadata && session.metadata.minutes);
      const packageId = session.metadata && session.metadata.package_id;
      if (!userId || !Number.isFinite(minutes) || minutes <= 0) {
        console.warn('[credits/webhook] session missing user_id/minutes', session.id);
        return res.status(200).send('ignored');
      }
      const result = await addCreditsTransaction({
        userId,
        deltaMinutes: minutes,
        amountCents: Number(session.amount_total || 0),
        currency: (session.currency || 'gbp').toLowerCase(),
        kind: 'topup',
        stripeSessionId: session.id,
        stripePaymentIntent: session.payment_intent || null,
        note: packageId ? `package:${packageId}` : null,
      });
      console.log('[credits/webhook] fulfilled', {
        session: session.id, userId, minutes, duplicate: Boolean(result.duplicate),
      });
    } else if (event.type === 'charge.refunded') {
      // Audit M3 — Stripe fires `charge.refunded` when the merchant
      // (or chargeback flow) refunds part or all of a charge. Previously
      // we silently ACK'd this event, which meant Kelion's ledger kept
      // the user's top-up intact even though the money had flowed
      // back to them. The revenue dashboard, /api/credits/balance, and
      // the admin ledger all drifted from Stripe's source of truth.
      //
      // We handle both full and partial refunds:
      //   - Look up the original top-up row by PaymentIntent.
      //   - Compute the minutes to subtract, prorated on cents refunded
      //     vs cents originally charged (so a 50% refund backs out 50%
      //     of the minutes, rounded down to avoid over-crediting).
      //   - Pass allowNegative:true so an already-spent balance can
      //     still be inverted correctly. The next top-up pulls it back
      //     above zero.
      //   - Use the Stripe Refund ID as idempotency_key so Stripe's
      //     retry-at-least-once semantics + multiple partial refunds
      //     each settle to their own ledger row exactly once.
      await handleChargeRefunded(event);
    }
    // Other events (payment_intent.succeeded etc) are harmless to ack.
    res.status(200).send('ok');
  } catch (err) {
    const msg = err && err.message;
    // If the user row is gone (deleted after payment), Stripe would
    // retry this webhook ~30 times over several days for a 5xx. Since
    // retries will never succeed, ACK with 200 + a loud log so the
    // admin can refund manually via Stripe dashboard.
    if (msg === 'user not found') {
      console.error('[credits/webhook] user missing; payment orphaned — manual refund needed:', event?.id);
      return res.status(200).send('ok (user missing)');
    }
    console.error('[credits/webhook] handler error:', msg);
    res.status(500).send('handler failed');
  }
};

router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  webhookHandler,
);

module.exports = router;
module.exports.verifyStripeSignature = verifyStripeSignature;
module.exports.handleChargeRefunded = handleChargeRefunded;
module.exports.getPackages = getPackages;
module.exports.evaluateConsumeDecision = evaluateConsumeDecision;
module.exports.CONSUME_COOLDOWN_MS = CONSUME_COOLDOWN_MS;
module.exports.MAX_SILENT_STREAK = MAX_SILENT_STREAK;
module.exports.MAX_SILENT_WINDOW_MS = MAX_SILENT_WINDOW_MS;
module.exports.gcConsumeState = gcConsumeState;
module.exports.startConsumeStateGc = startConsumeStateGc;
module.exports.stopConsumeStateGc = stopConsumeStateGc;
module.exports.CONSUME_STATE_TTL_MS = CONSUME_STATE_TTL_MS;
module.exports.CONSUME_STATE_GC_INTERVAL_MS = CONSUME_STATE_GC_INTERVAL_MS;
// Audit M7 — exported for direct unit coverage of the DB-backed layer.
module.exports.loadConsumeState = loadConsumeState;
module.exports.persistConsumeState = persistConsumeState;
module.exports._consumeStateByUser = consumeStateByUser;
