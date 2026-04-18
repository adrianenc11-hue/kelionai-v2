'use strict';

/**
 * AI credits service — admin-only.
 *
 * Fetches real balance/quota for each AI provider we spend money on, and
 * surfaces a normalized payload the admin dashboard can render as a grid
 * of per-provider cards (name + remaining + top-up link).
 *
 * Providers vary a lot:
 *
 *  - Gemini (Google AI Studio): no public balance endpoint. We test the key
 *    with a cheap models.list call and return a "configured" signal + link
 *    to the aistudio console where Adrian can rotate/check billing.
 *
 *  - OpenAI: the legacy /dashboard/billing/credit_grants endpoint is no
 *    longer usable with regular API keys. We return "configured" +
 *    top-up link to platform.openai.com.
 *
 *  - ElevenLabs: /v1/user/subscription returns character_count /
 *    character_limit — exact remaining quota, translated to a fraction.
 *
 *  - Stripe (revenue, not spend): /v1/balance returns available +
 *    pending funds in our connected account.
 *
 * For each provider we also expose a `topUpUrl` the dashboard can open
 * when the admin taps the card.
 */

const config = require('../config');

const DEFAULT_TIMEOUT_MS = 8000;

async function fetchWithTimeout(url, opts = {}, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

function maskKey(key) {
  if (!key || typeof key !== 'string') return null;
  if (key.length <= 8) return `${key[0] || ''}***`;
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

async function probeGemini() {
  const apiKey = config.gemini && config.gemini.apiKey;
  const card = {
    id: 'gemini',
    name: 'Google Gemini',
    subtitle: 'Live voice + chat',
    configured: Boolean(apiKey),
    keyFingerprint: maskKey(apiKey),
    balance: null,          // Google does not expose remaining quota for AI Studio keys
    balanceDisplay: 'Check in AI Studio',
    unit: null,
    status: 'unknown',      // ok | low | error | unknown
    message: null,
    topUpUrl: 'https://aistudio.google.com/apikey',
    billingUrl: 'https://console.cloud.google.com/billing',
  };
  if (!apiKey) {
    card.status = 'error';
    card.message = 'GEMINI_API_KEY not set';
    return card;
  }
  try {
    const r = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1alpha/models?key=${apiKey}&pageSize=1`,
      { method: 'GET' },
    );
    if (r.ok) {
      card.status = 'ok';
      card.message = 'API key valid';
    } else {
      const body = await r.text().catch(() => '');
      card.status = 'error';
      card.message = `HTTP ${r.status}: ${body.slice(0, 200)}`;
    }
  } catch (err) {
    card.status = 'error';
    card.message = err && err.message ? err.message : 'network error';
  }
  return card;
}

async function probeOpenAI() {
  const apiKey = config.openai && config.openai.apiKey;
  const card = {
    id: 'openai',
    name: 'OpenAI',
    subtitle: 'Realtime voice fallback',
    configured: Boolean(apiKey),
    keyFingerprint: maskKey(apiKey),
    balance: null,
    balanceDisplay: 'Check in billing',
    unit: null,
    status: 'unknown',
    message: null,
    topUpUrl: 'https://platform.openai.com/settings/organization/billing/overview',
    billingUrl: 'https://platform.openai.com/usage',
  };
  if (!apiKey) {
    card.status = 'error';
    card.message = 'OPENAI_API_KEY not set';
    return card;
  }
  try {
    const r = await fetchWithTimeout('https://api.openai.com/v1/models?limit=1', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (r.ok) {
      card.status = 'ok';
      card.message = 'API key valid';
    } else {
      const body = await r.text().catch(() => '');
      card.status = 'error';
      card.message = `HTTP ${r.status}: ${body.slice(0, 200)}`;
    }
  } catch (err) {
    card.status = 'error';
    card.message = err && err.message ? err.message : 'network error';
  }
  return card;
}

async function probeElevenLabs() {
  const apiKey = process.env.ELEVENLABS_API_KEY || '';
  const card = {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    subtitle: 'Neural TTS',
    configured: Boolean(apiKey),
    keyFingerprint: maskKey(apiKey),
    balance: null,
    balanceDisplay: '—',
    unit: 'chars',
    status: 'unknown',
    message: null,
    topUpUrl: 'https://elevenlabs.io/app/subscription',
    billingUrl: 'https://elevenlabs.io/app/usage',
  };
  if (!apiKey) {
    card.status = 'error';
    card.message = 'ELEVENLABS_API_KEY not set';
    return card;
  }
  try {
    const r = await fetchWithTimeout('https://api.elevenlabs.io/v1/user/subscription', {
      method: 'GET',
      headers: { 'xi-api-key': apiKey },
    });
    if (r.ok) {
      const j = await r.json();
      const used = Number(j.character_count || 0);
      const limit = Number(j.character_limit || 0);
      const remaining = Math.max(0, limit - used);
      card.balance = remaining;
      card.balanceDisplay = limit > 0
        ? `${remaining.toLocaleString()} / ${limit.toLocaleString()} chars`
        : 'unlimited';
      const tier = typeof j.tier === 'string' ? j.tier : null;
      card.message = tier ? `Tier: ${tier}` : null;
      card.subtitle = tier ? `Neural TTS (${tier})` : card.subtitle;
      // Alert threshold: 10% of limit remaining
      if (limit > 0 && remaining < limit * 0.10) {
        card.status = 'low';
      } else {
        card.status = 'ok';
      }
    } else {
      const body = await r.text().catch(() => '');
      card.status = 'error';
      card.message = `HTTP ${r.status}: ${body.slice(0, 200)}`;
    }
  } catch (err) {
    card.status = 'error';
    card.message = err && err.message ? err.message : 'network error';
  }
  return card;
}

async function probeStripe() {
  const apiKey = config.stripe && config.stripe.secretKey;
  const card = {
    id: 'stripe',
    name: 'Stripe',
    subtitle: 'Revenue (earned, not spent)',
    configured: Boolean(apiKey),
    keyFingerprint: maskKey(apiKey),
    balance: null,
    balanceDisplay: '—',
    unit: 'EUR',
    status: 'unknown',
    message: null,
    topUpUrl: 'https://dashboard.stripe.com/balance',
    billingUrl: 'https://dashboard.stripe.com/balance',
    kind: 'revenue',
  };
  if (!apiKey) {
    card.status = 'error';
    card.message = 'STRIPE_SECRET_KEY not set';
    return card;
  }
  try {
    const r = await fetchWithTimeout('https://api.stripe.com/v1/balance', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (r.ok) {
      const j = await r.json();
      const pickEur = (arr) => {
        if (!Array.isArray(arr)) return 0;
        const eur = arr.find((b) => (b.currency || '').toLowerCase() === 'eur');
        const first = eur || arr[0];
        return first ? Number(first.amount || 0) : 0;
      };
      const available = pickEur(j.available) / 100;
      const pending = pickEur(j.pending) / 100;
      card.balance = available;
      card.balanceDisplay = `${available.toFixed(2)} € available / ${pending.toFixed(2)} € pending`;
      card.status = 'ok';
      card.message = null;
    } else {
      const body = await r.text().catch(() => '');
      card.status = 'error';
      card.message = `HTTP ${r.status}: ${body.slice(0, 200)}`;
    }
  } catch (err) {
    card.status = 'error';
    card.message = err && err.message ? err.message : 'network error';
  }
  return card;
}

async function probeRailway() {
  // Railway exposes usage via GraphQL. We don't call it here (requires a
  // dedicated API token with project scope) — instead we show a link. If
  // RAILWAY_API_TOKEN is set in the future we can light it up.
  const token = process.env.RAILWAY_API_TOKEN || '';
  const card = {
    id: 'railway',
    name: 'Railway',
    subtitle: 'Hosting',
    configured: Boolean(token),
    keyFingerprint: maskKey(token),
    balance: null,
    balanceDisplay: 'Open dashboard',
    unit: null,
    status: 'unknown',
    message: null,
    topUpUrl: 'https://railway.com/account/billing',
    billingUrl: 'https://railway.com/account/billing',
  };
  return card;
}

/**
 * Returns an array of normalized cards for the admin dashboard, in display
 * order. Safe to call in parallel — each probe handles its own errors.
 */
async function getAllCredits() {
  const [gemini, openai, elevenlabs, stripe, railway] = await Promise.all([
    probeGemini(),
    probeOpenAI(),
    probeElevenLabs(),
    probeStripe(),
    probeRailway(),
  ]);
  return [gemini, openai, elevenlabs, stripe, railway];
}

module.exports = {
  getAllCredits,
  probeGemini,
  probeOpenAI,
  probeElevenLabs,
  probeStripe,
  probeRailway,
};
