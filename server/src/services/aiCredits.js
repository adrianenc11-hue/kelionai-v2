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
 *
 *  - Claude Opus (Google AI Studio / OpenRouter): no public balance endpoint. We test the key
 *    with a cheap models.list call and return a "configured" signal + link
 *    to the aistudio console where the admin can rotate/check billing.
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

async function probeGoogleAI() {
  const apiKey = config.google && config.google.apiKey;
  const card = {
    id: 'google',
    name: 'Claude Opus (Google)',
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
    card.message = 'GOOGLE_API_KEY not set';
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




async function probeElevenLabs() {
  const apiKey = process.env.ELEVENLABS_API_KEY || '';
  const card = {
    id: 'elevenlabs',
    name: 'ElevenLabs',
    subtitle: 'Neural TTS',
    configured: Boolean(apiKey),
    keyFingerprint: maskKey(apiKey),
    balance: null,
    balanceLimit: null,
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

      // ElevenLabs usage-based billing: when enabled, the user can exceed
      // their included character_limit and pay per-character overage.
      // The API signals this via `can_extend_character_limit` or simply
      // by character_count > character_limit (already consuming overage).
      const hasUsageBilling = Boolean(j.can_extend_character_limit)
        || Boolean(j.can_extend_voice_limit)
        || used > limit;

      card.balance = hasUsageBilling ? null : remaining; // null = unlimited/pay-as-you-go
      card.balanceLimit = limit > 0 ? limit : null;

      if (hasUsageBilling) {
        card.balanceDisplay = `${used.toLocaleString()} / ${limit.toLocaleString()} chars (usage billing ON)`;
      } else {
        card.balanceDisplay = limit > 0
          ? `${remaining.toLocaleString()} / ${limit.toLocaleString()} chars`
          : 'unlimited';
      }

      const tier = typeof j.tier === 'string' ? j.tier : null;
      card.message = tier ? `Tier: ${tier}` : null;
      card.subtitle = tier ? `Neural TTS (${tier})` : card.subtitle;

      // Status: if usage-based billing is ON, never report 'low' — the
      // user pays overage automatically. Only flag 'low' when on a
      // fixed-quota plan and < 10% remains.
      if (hasUsageBilling) {
        card.status = 'ok';
      } else if (limit > 0 && remaining < limit * 0.10) {
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

async function probeOpenRouter() {
  const apiKey = process.env.OPENROUTER_API_KEY || '';
  const card = {
    id: 'openrouter',
    name: 'OpenRouter',
    subtitle: 'LLM routing (Gemini 2.0 Flash - Free, Gemini Pro)',
    configured: Boolean(apiKey),
    keyFingerprint: maskKey(apiKey),
    balance: null,
    balanceDisplay: '—',
    unit: 'USD',
    status: 'unknown',
    message: null,
    topUpUrl: 'https://openrouter.ai/settings/credits',
    billingUrl: 'https://openrouter.ai/settings/credits',
  };
  if (!apiKey) {
    card.status = 'error';
    card.message = 'OPENROUTER_API_KEY not set';
    return card;
  }
  try {
    const r = await fetchWithTimeout('https://openrouter.ai/api/v1/auth/key', {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` },
    });
    if (r.ok) {
      const j = await r.json();
      const data = j.data || j;
      const limit = typeof data.limit === 'number' ? data.limit : null;
      const usage = typeof data.usage === 'number' ? data.usage : 0;
      const remaining = limit != null ? Math.max(0, limit - usage) : null;
      card.balance = remaining;
      if (limit != null) {
        card.balanceDisplay = `$${remaining.toFixed(2)} / $${limit.toFixed(2)}`;
        card.status = remaining < 1 ? 'low' : 'ok';
      } else {
        // Unlimited key
        card.balanceDisplay = `$${usage.toFixed(2)} used (no limit)`;
        card.status = 'ok';
      }
      card.message = data.label ? `Key: ${data.label}` : null;
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
  // Order is display order in the admin grid.
  const [googleAI, openrouter, elevenlabs, stripe, railway] = await Promise.all([
    probeGoogleAI(),
    probeOpenRouter(),
    probeElevenLabs(),
    probeStripe(),
    probeRailway(),
  ]);
  return [googleAI, openrouter, elevenlabs, stripe, railway];
}

/**
 * Revenue-split contract: for every credit top-up the user pays, a
 * fixed fraction (default 50%) is earmarked for AI provider spend
 * (Claude Opus, ElevenLabs). The remainder is the owner's
 * net. We do NOT transfer money automatically — Stripe cannot pay GCP
 * directly. Instead we compute the allocation off the existing credit
 * ledger and surface it next to the raw provider cards so the admin
 * can cross-check against GCP billing and top up manually before the
 * allocation dips below actual spend.
 *
 * Input sources:
 *   - Ledger (credit_transactions): authoritative revenue in window.
 *   - ElevenLabs API (/v1/user/subscription): exact characters spent.
 *     Converted to USD using ElevenLabs Creator tier pricing (≈ $0.30
 *     per 1k chars, which is the effective rate for pay-as-you-go
 *     overage; real tier pricing varies, but this is a conservative
 *     upper bound suitable for budget tracking).
 *   - Claude Opus: Google does NOT expose per-project spend via any public
 *     API that works with AI Studio keys. The only option is the
 *     Google Cloud Billing API with a service-account + billing
 *     account ID (most users don't bother). We report "unknown" and
 *     link to the Cloud Billing console so the admin can enter /
 *     cross-check manually.
 *
 * Output shape is deliberately flat so the UI can show one row per
 * line item.
 */
const DEFAULT_AI_ALLOCATION_FRACTION = Number(
  process.env.AI_ALLOCATION_FRACTION || 0.5,
);

function formatMinorCurrency(cents, currency = 'gbp') {
  if (typeof cents !== 'number' || !Number.isFinite(cents)) return '—';
  const sym = String(currency || '').toUpperCase();
  const value = (cents / 100).toFixed(2);
  return `${value} ${sym}`;
}

async function probeElevenLabsSpend() {
  const apiKey = process.env.ELEVENLABS_API_KEY || '';
  const out = {
    configured: Boolean(apiKey),
    charsUsed: null,
    charsLimit: null,
    tier: null,
    // Conservative overage rate for Creator/pay-as-you-go. Real tier
    // pricing varies; we pick a rate that slightly over-estimates spend
    // so the budget alert fires a little early (safer).
    estSpendCents: null,
    currency: 'usd',
    status: 'unknown',
    message: null,
  };
  if (!apiKey) {
    out.status = 'error';
    out.message = 'ELEVENLABS_API_KEY not set';
    return out;
  }
  try {
    const r = await fetchWithTimeout('https://api.elevenlabs.io/v1/user/subscription', {
      method: 'GET',
      headers: { 'xi-api-key': apiKey },
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      out.status = 'error';
      out.message = `HTTP ${r.status}: ${body.slice(0, 160)}`;
      return out;
    }
    const j = await r.json();
    const used = Number(j.character_count || 0);
    const limit = Number(j.character_limit || 0);
    out.charsUsed = used;
    out.charsLimit = limit;
    out.tier = typeof j.tier === 'string' ? j.tier : null;
    // $0.30 per 1k chars = 30 cents per 1k = 3 cents per 100 chars.
    // 1 char => 0.03 cents = 0.0003 dollars.
    out.estSpendCents = Math.round(used * 0.03);
    out.status = 'ok';
    return out;
  } catch (err) {
    out.status = 'error';
    out.message = err && err.message ? err.message : 'network error';
    return out;
  }
}

/**
 * Build the revenue-split snapshot. `revenueSummary` is the object
 * returned by db.getCreditRevenueSummary(days) so the route can reuse
 * the same query it already uses for /api/admin/business.
 */
async function buildRevenueSplit(revenueSummary, { days = 30, currency = 'gbp' } = {}) {
  const topupsCount = Number(revenueSummary?.topups || 0);
  // db.getCreditRevenueSummary returns `revenueCents` (camelCase); the
  // raw SQL alias is `revenue_cents` but the helper normalises it.
  const revenueCents = Number(
    revenueSummary?.revenueCents ?? revenueSummary?.revenue_cents ?? 0,
  );
  const fraction = DEFAULT_AI_ALLOCATION_FRACTION;
  const allocatedCents = Math.round(revenueCents * fraction);
  const ownerCents = revenueCents - allocatedCents;

  const elevenlabs = await probeElevenLabsSpend();

  // ElevenLabs tier is priced in USD. We don't do FX conversion here —
  // the admin dashboard shows both values side-by-side with their
  // currencies explicit so the admin can eyeball the buffer.
  const knownSpendCents = Number(elevenlabs.estSpendCents || 0);

  // Claude Opus cost is unknown from our side. Honest "null" so UI can
  // render a manual-entry placeholder instead of pretending $0.
  const googleAI = {
    source: 'manual',
    note: 'Claude Opus spend is not exposed via AI Studio keys. Use GCP Billing dashboard to cross-check.',
    billingUrl: 'https://console.cloud.google.com/billing',
  };

  // Delta compares allocated revenue against *known* spend only. When
  // Claude Opus cost is added manually we'll subtract it from this delta.
  // Status is conservative: if known spend already eats > 80% of
  // allocation, we flag warn; over 100%, over.
  let status = 'ok';
  if (allocatedCents > 0) {
    const ratio = knownSpendCents / allocatedCents;
    if (ratio >= 1) status = 'over';
    else if (ratio >= 0.8) status = 'warn';
  } else if (knownSpendCents > 0) {
    status = 'over';
  }

  return {
    window: { days, since: new Date(Date.now() - days * 86400000).toISOString() },
    fraction,
    revenue: {
      topups: topupsCount,
      grossCents: revenueCents,
      grossDisplay: formatMinorCurrency(revenueCents, currency),
      currency,
    },
    allocation: {
      fraction,
      cents: allocatedCents,
      display: formatMinorCurrency(allocatedCents, currency),
      ownerCents,
      ownerDisplay: formatMinorCurrency(ownerCents, currency),
    },
    spend: {
      googleAI,
      elevenlabs: {
        configured: elevenlabs.configured,
        status: elevenlabs.status,
        message: elevenlabs.message,
        charsUsed: elevenlabs.charsUsed,
        charsLimit: elevenlabs.charsLimit,
        tier: elevenlabs.tier,
        estSpendCents: elevenlabs.estSpendCents,
        estSpendDisplay: formatMinorCurrency(elevenlabs.estSpendCents, elevenlabs.currency),
        currency: elevenlabs.currency,
      },
      knownTotalCents: knownSpendCents,
      knownTotalDisplay: formatMinorCurrency(knownSpendCents, 'usd'),
    },
    delta: {
      // Positive = budget remaining (allocation > known spend).
      // Negative = over budget.
      cents: allocatedCents - knownSpendCents,
      display: formatMinorCurrency(allocatedCents - knownSpendCents, currency),
      status, // 'ok' | 'warn' | 'over'
    },
  };
}

module.exports = {
  getAllCredits,
  probeGoogleAI,
  probeOpenRouter,
  probeElevenLabs,
  probeStripe,
  probeRailway,
  probeElevenLabsSpend,
  buildRevenueSplit,
};
