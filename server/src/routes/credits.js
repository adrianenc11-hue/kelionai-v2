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
  listCreditTransactions,
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
 * Body: { minutes?: number }   — default 1, capped at 5 per call
 * Returns:
 *   { balance_minutes, deducted, exempt: true|false }   on success
 *   { balance_minutes: 0, deducted: 0, exhausted: true } when balance is
 *                                                        already at zero
 *   { throttled: true, balance_minutes, retryAfterMs }   when the same
 *                                                        user tried to
 *                                                        consume again
 *                                                        within the
 *                                                        cooldown window
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
 * Adrian: "la logare se respecta credit cumparat". + "sa nu se mai
 * repete ca dau de dracu".
 */
const CONSUME_COOLDOWN_MS = 50 * 1000;
const lastConsumeByUser = new Map(); // userId → epochMs of last successful deduction

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

    const now = Date.now();
    const last = lastConsumeByUser.get(req.user.id) || 0;
    if (now - last < CONSUME_COOLDOWN_MS) {
      // Return the current (un-deducted) balance so the HUD still has a
      // truthful number — we just didn't charge again this tick.
      const bal = await getCreditsBalance(req.user.id).catch(() => null);
      return res.json({
        balance_minutes: typeof bal === 'number' ? bal : null,
        deducted: 0,
        throttled: true,
        retryAfterMs: CONSUME_COOLDOWN_MS - (now - last),
      });
    }

    const raw = Number(req.body && req.body.minutes);
    const minutes = Number.isFinite(raw) && raw > 0 ? Math.min(Math.ceil(raw), 5) : 1;

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
      note: 'Gemini Live session',
    });
    lastConsumeByUser.set(req.user.id, now);
    return res.json({
      balance_minutes: result.balance,
      deducted: take,
      exempt: false,
      exhausted: result.balance <= 0,
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
module.exports.getPackages = getPackages;
