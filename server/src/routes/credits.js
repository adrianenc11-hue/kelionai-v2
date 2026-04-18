'use strict';

/**
 * Credits — monetization routes.
 *
 * Adrian's approved model: 1 credit = 1 minute of Kelion Live (voice +
 * tools). User tops up via Stripe Checkout at 0.30 €/min. Standard
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

/** Standard credit packages (EUR cents + whole minutes). Calibrated to
 *  a 0.30 €/min retail rate with a volume discount for larger bundles. */
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
      priceCents: 1000,           // 10 €
      minutes: 33,                // ~0.30 €/min
      highlight: false,
      description: 'About 33 minutes of conversation.',
    },
    {
      id: 'standard',
      name: 'Standard',
      priceCents: 2500,           // 25 €
      minutes: 100,               // 0.25 €/min
      highlight: true,
      description: 'About 100 minutes. Best for most.',
    },
    {
      id: 'pro',
      name: 'Pro',
      priceCents: 10000,          // 100 €
      minutes: 400,               // 0.25 €/min
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
  body.append('line_items[0][price_data][currency]', 'eur');
  body.append('line_items[0][price_data][product_data][name]', `Kelion credits — ${pkg.name}`);
  body.append('line_items[0][price_data][product_data][description]', `${pkg.minutes} minutes of Kelion Live`);
  body.append('line_items[0][price_data][unit_amount]', String(pkg.priceCents));
  body.append('line_items[0][quantity]', '1');
  body.append('metadata[user_id]', String(req.user.id));
  body.append('metadata[package_id]', pkg.id);
  body.append('metadata[minutes]', String(pkg.minutes));
  // Stripe automatically collects/remits EU VAT when Stripe Tax is enabled
  // on the account. We pass automatic_tax so the math happens server-side.
  body.append('automatic_tax[enabled]', 'true');

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
      return res.status(502).json({ error: 'Stripe rejected the request' });
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
        currency: (session.currency || 'eur').toLowerCase(),
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
