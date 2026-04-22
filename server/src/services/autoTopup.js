'use strict';

/**
 * AI-provider auto-topup — fires a Stripe off-session charge on the
 * owner's saved payment method when a paid AI provider's balance
 * drops below a configurable threshold.
 *
 * Adrian 2026-04-20:
 *   "procedura de a se alimenta cu credit automata ... reîncărcare
 *    automată din cardul meu (Stripe saved card)". Threshold 20%.
 *
 * Design:
 *   - Only providers with a *real* numeric balance ratio can trigger
 *     auto-topup. Today only ElevenLabs exposes that (characters left
 *     / character_limit). Gemini/OpenAI/Groq have no machine-readable
 *     balance, so we never auto-charge for them — admin tops those up
 *     manually via the top-up link on each card.
 *   - Config is pure env (no DB schema change for this PR). When the
 *     owner hasn't wired their Stripe Customer + PaymentMethod, the
 *     service is a quiet no-op and the admin UI shows "not configured
 *     — open Stripe Dashboard to set up".
 *   - Idempotency is best-effort: each trigger is keyed by provider id
 *     and kept in-memory for AUTO_TOPUP_COOLDOWN_MS (default 24h) so a
 *     refresh storm cannot double-charge. Stripe PaymentIntents also
 *     carry an explicit idempotency_key derived from provider+day so a
 *     process restart cannot duplicate a same-day charge.
 *   - Success AND failure always email the admin via the existing
 *     sendEmailAlert transport. The admin never has to hunt Stripe
 *     Dashboard to know a charge happened.
 *
 * Required env (all three must be set for auto-topup to be live):
 *   STRIPE_SECRET_KEY                  — already used for checkout
 *   OWNER_STRIPE_CUSTOMER_ID           — cus_... (owner's Stripe Customer)
 *   OWNER_STRIPE_PAYMENT_METHOD_ID     — pm_... (saved card to charge)
 *
 * Optional env:
 *   AUTO_TOPUP_THRESHOLD   — 0..1, default 0.2  (20%)
 *   AUTO_TOPUP_AMOUNT_EUR  — integer EUR, default 20
 *   AUTO_TOPUP_CURRENCY    — default "eur"
 *   AUTO_TOPUP_COOLDOWN_MS — default 86_400_000 (24h)
 *   AUTO_TOPUP_ENABLED     — "false" to disable even when configured
 */

const { sendEmailAlert } = require('./emailAlerts');
const config = require('../config');

const DEFAULT_THRESHOLD = 0.2;
const DEFAULT_AMOUNT_EUR = 20;
const DEFAULT_CURRENCY = 'eur';
const DEFAULT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

function readConfig() {
  const thresholdRaw = Number(process.env.AUTO_TOPUP_THRESHOLD);
  const threshold = Number.isFinite(thresholdRaw) && thresholdRaw > 0 && thresholdRaw < 1
    ? thresholdRaw : DEFAULT_THRESHOLD;
  const amountEurRaw = Number(process.env.AUTO_TOPUP_AMOUNT_EUR);
  const amountEur = Number.isFinite(amountEurRaw) && amountEurRaw > 0
    ? Math.round(amountEurRaw) : DEFAULT_AMOUNT_EUR;
  const currency = String(process.env.AUTO_TOPUP_CURRENCY || DEFAULT_CURRENCY).toLowerCase();
  const cooldownRaw = Number(process.env.AUTO_TOPUP_COOLDOWN_MS);
  const cooldownMs = Number.isFinite(cooldownRaw) && cooldownRaw > 0
    ? cooldownRaw : DEFAULT_COOLDOWN_MS;
  const enabled = String(process.env.AUTO_TOPUP_ENABLED || 'true').toLowerCase() !== 'false';

  const stripeKey = (config.stripe && config.stripe.secretKey) || '';
  const customerId = String(process.env.OWNER_STRIPE_CUSTOMER_ID || '').trim();
  const paymentMethodId = String(process.env.OWNER_STRIPE_PAYMENT_METHOD_ID || '').trim();

  const configured = Boolean(stripeKey && customerId && paymentMethodId);

  return {
    enabled,
    configured,
    threshold,
    amountEur,
    amountCents: amountEur * 100,
    currency,
    cooldownMs,
    stripeKey,
    customerId,
    paymentMethodId,
  };
}

// provider id -> { ts, result }
const _lastRun = new Map();

function getHistory() {
  const out = {};
  for (const [id, entry] of _lastRun.entries()) out[id] = entry;
  return out;
}

/**
 * Pick the providers eligible for auto-topup from the card list. Today
 * only ElevenLabs exposes a numeric balance/limit we can compare.
 */
function selectEligible(cards) {
  if (!Array.isArray(cards)) return [];
  const out = [];
  for (const c of cards) {
    if (!c || c.kind === 'revenue' || c.status === 'unconfigured') continue;
    if (c.id !== 'elevenlabs') continue;
    if (typeof c.balance !== 'number') continue;
    // Card sets `balance` = chars remaining. We need the original limit
    // from balanceDisplay ("X,XXX / Y,YYY chars"). Parse best-effort.
    const m = typeof c.balanceDisplay === 'string'
      ? c.balanceDisplay.replace(/,/g, '').match(/(\d+)\s*\/\s*(\d+)/)
      : null;
    if (!m) continue;
    const remaining = Number(m[1]);
    const limit = Number(m[2]);
    if (!Number.isFinite(limit) || limit <= 0) continue;
    const ratio = remaining / limit;
    out.push({ card: c, remaining, limit, ratio });
  }
  return out;
}

async function chargeStripe({ stripeKey, customerId, paymentMethodId, amountCents, currency, idempotencyKey, description }) {
  // Stripe expects application/x-www-form-urlencoded for REST endpoints.
  const form = new URLSearchParams();
  form.set('amount', String(amountCents));
  form.set('currency', currency);
  form.set('customer', customerId);
  form.set('payment_method', paymentMethodId);
  form.set('confirm', 'true');
  form.set('off_session', 'true');
  form.set('description', description || 'Kelion AI auto-topup');
  // Minimal payment method types — card only for off-session MIT.
  form.set('payment_method_types[]', 'card');

  const headers = {
    'Authorization': `Bearer ${stripeKey}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const r = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers,
    body: form.toString(),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (body && body.error && body.error.message) || `HTTP ${r.status}`;
    const err = new Error(msg);
    err.stripe = body && body.error;
    err.status = r.status;
    throw err;
  }
  return body;
}

/**
 * Scan the provider cards, charge the saved card for any provider
 * below threshold, and email the admin. Safe to call fire-and-forget
 * from any admin endpoint — never throws.
 */
async function checkAndTrigger(cards) {
  const cfg = readConfig();
  const summary = {
    configured: cfg.configured,
    enabled: cfg.enabled,
    threshold: cfg.threshold,
    amountEur: cfg.amountEur,
    currency: cfg.currency,
    cooldownMs: cfg.cooldownMs,
    triggered: [],
    skipped: [],
    errors: [],
    ts: new Date().toISOString(),
  };
  if (!cfg.enabled) {
    summary.skipped.push({ reason: 'disabled' });
    return summary;
  }
  if (!cfg.configured) {
    summary.skipped.push({ reason: 'not-configured' });
    return summary;
  }

  const now = Date.now();
  const eligible = selectEligible(cards);
  for (const { card, remaining, limit, ratio } of eligible) {
    if (ratio >= cfg.threshold) {
      summary.skipped.push({ id: card.id, reason: 'above-threshold', ratio });
      continue;
    }
    const last = _lastRun.get(card.id);
    if (last && (now - last.ts) < cfg.cooldownMs) {
      summary.skipped.push({ id: card.id, reason: 'cooldown', lastRunTs: last.ts });
      continue;
    }
    // Idempotency key includes the UTC day so a same-day restart still
    // dedupes on Stripe's side even though our in-memory map is gone.
    const dayKey = new Date(now).toISOString().slice(0, 10);
    const idempotencyKey = `kelion-autotopup-${card.id}-${dayKey}`;
    try {
      const pi = await chargeStripe({
        stripeKey: cfg.stripeKey,
        customerId: cfg.customerId,
        paymentMethodId: cfg.paymentMethodId,
        amountCents: cfg.amountCents,
        currency: cfg.currency,
        idempotencyKey,
        description: `Kelion AI auto-topup — ${card.name} at ${(ratio * 100).toFixed(1)}% of ${limit}`,
      });
      const entry = {
        ts: now,
        status: 'ok',
        amountEur: cfg.amountEur,
        currency: cfg.currency,
        ratio,
        limit,
        remaining,
        paymentIntentId: pi && pi.id,
        stripeStatus: pi && pi.status,
      };
      _lastRun.set(card.id, entry);
      summary.triggered.push({ id: card.id, ...entry });
      sendEmailAlert({
        subject: `[Kelion] Auto-topup triggered for ${card.name} (${cfg.amountEur} ${cfg.currency.toUpperCase()})`,
        text: [
          `${card.name} dropped to ${(ratio * 100).toFixed(1)}% of its ${limit} quota.`,
          `Charged ${cfg.amountEur} ${cfg.currency.toUpperCase()} on the saved card.`,
          `Stripe PaymentIntent: ${pi && pi.id} (status: ${pi && pi.status}).`,
          `Threshold: ${(cfg.threshold * 100).toFixed(0)}% · Cooldown: ${Math.round(cfg.cooldownMs / 3_600_000)}h.`,
          'Manage saved card: https://dashboard.stripe.com/customers',
        ].join('\n'),
      }).catch((err) => console.warn('[autoTopup] alert failed:', err && err.message));
    } catch (err) {
      const entry = {
        ts: now,
        status: 'error',
        ratio,
        limit,
        remaining,
        error: (err && err.message) || 'unknown',
        stripe: err && err.stripe,
      };
      // Keep the error in history so UI can show "last attempt failed
      // — check Stripe Dashboard", and still respect cooldown so we
      // don't retry-spam the card on every admin refresh.
      _lastRun.set(card.id, entry);
      summary.errors.push({ id: card.id, ...entry });
      sendEmailAlert({
        subject: `[Kelion] Auto-topup FAILED for ${card.name}`,
        text: [
          `${card.name} dropped to ${(ratio * 100).toFixed(1)}% of its ${limit} quota.`,
          `Auto-topup of ${cfg.amountEur} ${cfg.currency.toUpperCase()} failed:`,
          (err && err.message) || 'unknown error',
          '',
          'Open https://dashboard.stripe.com/payments to investigate, or',
          'https://dashboard.stripe.com/customers to rotate the saved payment method.',
        ].join('\n'),
      }).catch((e) => console.warn('[autoTopup] alert failed:', e && e.message));
    }
  }
  return summary;
}

function getStatus() {
  const cfg = readConfig();
  return {
    configured: cfg.configured,
    enabled: cfg.enabled,
    threshold: cfg.threshold,
    amountEur: cfg.amountEur,
    currency: cfg.currency,
    cooldownHours: Math.round(cfg.cooldownMs / 3_600_000),
    customerSet: Boolean(cfg.customerId),
    paymentMethodSet: Boolean(cfg.paymentMethodId),
    stripeKeySet: Boolean(cfg.stripeKey),
    history: getHistory(),
    setupUrl: 'https://dashboard.stripe.com/customers',
  };
}

// Test-only reset hook. Not exported in production usage.
function _resetForTests() {
  _lastRun.clear();
}

module.exports = {
  checkAndTrigger,
  getStatus,
  selectEligible,
  readConfig,
  _resetForTests,
};
