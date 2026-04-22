'use strict';

/**
 * Stripe payouts service for the admin "Payouts" tab.
 *
 * Adrian 2026-04-20:
 *   "procedura de a se alimenta cu credit automata, cind vin userii
 *    sa se faca procedura 50 catre reincarcare si 50 % catre mine,
 *    cum pot retrage cei % catre mine?"
 *
 * Design:
 *   - Live read-only snapshot of Stripe balance (available + pending),
 *     the linked external account (bank IBAN or debit card), the next
 *     automatic payout schedule, and the last ~10 payouts. No DB write.
 *   - `triggerInstantPayout()` creates an on-demand payout. Stripe
 *     charges a small fee (~1% + €0.25) but funds arrive in ~30 min
 *     on an eligible debit card. Fails gracefully (Stripe returns a
 *     detailed error we pass through) when the external account is a
 *     bank (IBAN) or when the available balance is below the minimum.
 *   - Admin-only — the route layer enforces auth; this module trusts
 *     its caller.
 */

const config = require('../config');

const STRIPE_BASE = 'https://api.stripe.com/v1';
const STRIPE_TIMEOUT_MS = 10_000;

function stripeKey() {
  return (config.stripe && config.stripe.secretKey) || '';
}

async function stripeRequest(path, { method = 'GET', form = null, idempotencyKey = null } = {}) {
  const key = stripeKey();
  if (!key) {
    const err = new Error('STRIPE_SECRET_KEY not set');
    err.code = 'not-configured';
    throw err;
  }
  const headers = {
    Authorization: `Bearer ${key}`,
  };
  let body;
  if (form) {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const usp = new URLSearchParams();
    for (const [k, v] of Object.entries(form)) {
      if (v === undefined || v === null) continue;
      usp.set(k, String(v));
    }
    body = usp.toString();
  }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), STRIPE_TIMEOUT_MS);
  try {
    const r = await fetch(`${STRIPE_BASE}${path}`, {
      method,
      headers,
      body,
      signal: controller.signal,
    });
    const payload = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (payload && payload.error && payload.error.message) || `HTTP ${r.status}`;
      const err = new Error(msg);
      err.stripe = payload && payload.error;
      err.status = r.status;
      throw err;
    }
    return payload;
  } finally {
    clearTimeout(t);
  }
}

// Stripe's zero-decimal currencies store amounts directly in major
// units, not in "cents". The full list is small and stable; if it ever
// changes, Stripe documents it at
// https://stripe.com/docs/currencies#zero-decimal. We include the
// current set here so a Kelion account ever paid out in JPY/KRW/etc.
// doesn't show numbers 100× too small.
const ZERO_DECIMAL_CURRENCIES = new Set([
  'bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga',
  'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf',
]);

function fmtMinor(amount, currency) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) return '—';
  const cur = String(currency || '').toLowerCase();
  const sym = cur.toUpperCase();
  if (ZERO_DECIMAL_CURRENCIES.has(cur)) {
    return `${Math.round(amount)} ${sym}`;
  }
  return `${(amount / 100).toFixed(2)} ${sym}`;
}

/**
 * Pick the "primary" currency bucket from a Stripe balance array.
 * Preference order: eur → gbp → usd → first entry.
 */
function pickBucket(arr) {
  if (!Array.isArray(arr) || !arr.length) return { amount: 0, currency: 'eur' };
  const byCur = (c) => arr.find((b) => String(b.currency || '').toLowerCase() === c);
  const chosen = byCur('eur') || byCur('gbp') || byCur('usd') || arr[0];
  return {
    amount: Number(chosen.amount || 0),
    currency: String(chosen.currency || 'eur').toLowerCase(),
  };
}

/**
 * Summarise the owner's Stripe payout state so the admin UI can render
 * it without touching Stripe from the browser.
 *
 * Returns { configured, balance, nextPayout, destination, recentPayouts, ts }
 * Every field is null-safe so the UI can render partial failures.
 */
async function getPayoutSnapshot() {
  const key = stripeKey();
  const snapshot = {
    configured: Boolean(key),
    balance: null,
    destination: null,
    recentPayouts: [],
    instantEligible: false,
    errors: [],
    ts: new Date().toISOString(),
  };
  if (!key) {
    snapshot.errors.push({ source: 'config', message: 'STRIPE_SECRET_KEY not set' });
    return snapshot;
  }

  // Balance
  try {
    const b = await stripeRequest('/balance');
    const avail = pickBucket(b.available);
    const pend = pickBucket(b.pending);
    const instant = pickBucket(b.instant_available || []);
    snapshot.balance = {
      available: {
        amount: avail.amount,
        currency: avail.currency,
        display: fmtMinor(avail.amount, avail.currency),
      },
      pending: {
        amount: pend.amount,
        currency: pend.currency,
        display: fmtMinor(pend.amount, pend.currency),
      },
      instantAvailable: {
        amount: instant.amount,
        currency: instant.currency,
        display: fmtMinor(instant.amount, instant.currency),
      },
    };
    snapshot.instantEligible = instant.amount > 0;
  } catch (err) {
    snapshot.errors.push({ source: 'balance', message: err.message });
  }

  // External accounts + payout schedule (from /v1/account)
  try {
    const acct = await stripeRequest('/account');
    const schedule = acct && acct.settings && acct.settings.payouts && acct.settings.payouts.schedule;
    const firstExternal = (acct && acct.external_accounts && Array.isArray(acct.external_accounts.data)
      && acct.external_accounts.data[0]) || null;
    snapshot.destination = {
      // Bank account: country + last4 + bank_name. Debit card: brand + last4.
      type: firstExternal ? (firstExternal.object || null) : null,
      last4: firstExternal ? (firstExternal.last4 || null) : null,
      bankName: firstExternal && firstExternal.object === 'bank_account'
        ? (firstExternal.bank_name || null) : null,
      brand: firstExternal && firstExternal.object === 'card'
        ? (firstExternal.brand || null) : null,
      country: firstExternal ? (firstExternal.country || null) : null,
      currency: firstExternal ? (firstExternal.currency || null) : null,
    };
    snapshot.schedule = schedule ? {
      interval: schedule.interval || null,
      delayDays: typeof schedule.delay_days === 'number' ? schedule.delay_days : null,
      monthlyAnchor: schedule.monthly_anchor || null,
      weeklyAnchor: schedule.weekly_anchor || null,
    } : null;
  } catch (err) {
    snapshot.errors.push({ source: 'account', message: err.message });
  }

  // Recent payouts (up to 10)
  try {
    const p = await stripeRequest('/payouts?limit=10');
    snapshot.recentPayouts = Array.isArray(p.data) ? p.data.map((po) => ({
      id: po.id,
      amount: Number(po.amount || 0),
      currency: String(po.currency || '').toLowerCase(),
      display: fmtMinor(Number(po.amount || 0), po.currency),
      status: po.status || null,            // paid | in_transit | pending | failed | canceled
      method: po.method || null,            // standard | instant
      arrivalDateMs: po.arrival_date ? po.arrival_date * 1000 : null,
      createdMs: po.created ? po.created * 1000 : null,
      failureMessage: po.failure_message || null,
    })) : [];
  } catch (err) {
    snapshot.errors.push({ source: 'payouts', message: err.message });
  }

  return snapshot;
}

/**
 * Trigger an instant payout. Amount is optional — when omitted, Stripe
 * pays out the full instant-available balance in the requested currency.
 *
 * Throws when the external account doesn't support instant (e.g. bank
 * accounts / IBAN), when the balance is insufficient, or when the
 * Stripe key isn't configured. Callers should surface err.message to
 * the admin verbatim — Stripe's error text is already human-friendly.
 */
async function triggerInstantPayout({ amountCents, currency = 'eur', description } = {}) {
  const form = {
    method: 'instant',
    currency: String(currency || 'eur').toLowerCase(),
  };
  if (Number.isFinite(amountCents) && amountCents > 0) {
    form.amount = Math.round(amountCents);
  }
  if (description) form.description = String(description).slice(0, 200);

  // Idempotency key scoped to the minute so an accidental double-click
  // doesn't fire twice but a deliberate retry a minute later does.
  const minuteKey = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');
  const idempotencyKey = `kelion-instant-payout-${form.currency}-${minuteKey}-${form.amount || 'all'}`;

  const po = await stripeRequest('/payouts', {
    method: 'POST',
    form,
    idempotencyKey,
  });
  return {
    id: po.id,
    amount: Number(po.amount || 0),
    currency: String(po.currency || '').toLowerCase(),
    display: fmtMinor(Number(po.amount || 0), po.currency),
    status: po.status,
    method: po.method,
    arrivalDateMs: po.arrival_date ? po.arrival_date * 1000 : null,
    createdMs: po.created ? po.created * 1000 : null,
  };
}

module.exports = {
  getPayoutSnapshot,
  triggerInstantPayout,
  // Exposed for tests so we can assert request shapes.
  _stripeRequest: stripeRequest,
  _pickBucket: pickBucket,
};
