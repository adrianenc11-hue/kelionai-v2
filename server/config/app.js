// ═══════════════════════════════════════════════════════════════
// App — Centralized App Configuration
// ZERO hardcode — toate valorile vin din process.env
// Importă acest fișier în loc să scrii valori direct în cod
// ═══════════════════════════════════════════════════════════════
'use strict';

function envInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envFloat(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

// ── Versiune citită din package.json (o singură sursă de adevăr) ──
let _packageVersion = '0.0.0';
try {
  _packageVersion = require('../../package.json').version;
} catch (_e) {
  _packageVersion = process.env.npm_package_version || '0.0.0';
}

// ═══ IDENTITATE APLICAȚIE ═══
const APP = {
  NAME:          process.env.APP_NAME          || 'KelionAI',
  VERSION:       process.env.APP_VERSION       || _packageVersion,
  URL:           process.env.APP_URL           || 'http://localhost:3000',
  STUDIO_NAME:   process.env.APP_STUDIO_NAME   || 'EA Studio',
  FOUNDER_NAME:  process.env.APP_FOUNDER_NAME  || 'Adrian',
  CONTACT_EMAIL: process.env.CONTACT_EMAIL     || '',
  PRIVACY_EMAIL: process.env.PRIVACY_EMAIL     || process.env.CONTACT_EMAIL || '',
  SUPPORT_EMAIL: process.env.SUPPORT_EMAIL     || process.env.CONTACT_EMAIL || '',
  USER_AGENT:    null, // calculat mai jos
};
// User-Agent compus dinamic — folosit în HTTP requests externe
APP.USER_AGENT = `${APP.NAME}/${APP.VERSION} (${APP.CONTACT_EMAIL || APP.URL})`;

// ═══ PERSONAS AI ═══
const PERSONAS = {
  kelion:
    process.env.PERSONA_KELION ||
    `You are Kelion, a smart AI assistant created by ${APP.STUDIO_NAME} (founder: ${APP.FOUNDER_NAME}). NEVER say you are Google, OpenAI or any other company's AI. You are Kelion by ${APP.STUDIO_NAME}.`,
  kira:
    process.env.PERSONA_KIRA ||
    `You are Kira, a creative AI assistant created by ${APP.STUDIO_NAME} (founder: ${APP.FOUNDER_NAME}). NEVER say you are Google, OpenAI or any other company's AI. You are Kira by ${APP.STUDIO_NAME}.`,
};

// ═══ PLANURI DE ABONAMENT ═══
// Prețuri, limite și features — 100% din .env, 0 hardcode
const PLAN_CONFIG = {
  // ── GUEST (nevăzători, fără cont) ──
  guest: {
    id:       'guest',
    name:     process.env.PLAN_GUEST_NAME     || 'Guest',
    price:    0,
    currency: process.env.PLAN_CURRENCY       || 'EUR',
    limits: {
      chat:   envInt('PLAN_GUEST_CHAT',   3),
      search: envInt('PLAN_GUEST_SEARCH', 1),
      image:  envInt('PLAN_GUEST_IMAGE',  0),
      vision: envInt('PLAN_GUEST_VISION', 1),
      tts:    envInt('PLAN_GUEST_TTS',    3),
    },
    features: (process.env.PLAN_GUEST_FEATURES || '').split('|').map(f => f.trim()).filter(Boolean),
    stripe_monthly_price_id: null,
    stripe_annual_price_id:  null,
  },

  // ── FREE ──
  free: {
    id:       'free',
    name:     process.env.PLAN_FREE_NAME     || 'Free',
    price:    0,
    currency: process.env.PLAN_CURRENCY      || 'EUR',
    limits: {
      chat:   envInt('PLAN_FREE_CHAT',   10),
      search: envInt('PLAN_FREE_SEARCH',  3),
      image:  envInt('PLAN_FREE_IMAGE',   1),
      vision: envInt('PLAN_FREE_VISION',  3),
      tts:    envInt('PLAN_FREE_TTS',    10),
    },
    features: (process.env.PLAN_FREE_FEATURES || '').split('|').map(f => f.trim()).filter(Boolean),
    stripe_monthly_price_id: null,
    stripe_annual_price_id:  null,
  },

  // ── PRO ──
  pro: {
    id:              'pro',
    name:            process.env.PLAN_PRO_NAME            || 'Pro',
    price_monthly:   envFloat('PLAN_PRO_PRICE_MONTHLY',   29),
    price_annual:    envFloat('PLAN_PRO_PRICE_ANNUAL',    250),
    currency:        process.env.PLAN_CURRENCY            || 'EUR',
    limits: {
      chat:   envInt('PLAN_PRO_CHAT',   100),
      search: envInt('PLAN_PRO_SEARCH',  30),
      image:  envInt('PLAN_PRO_IMAGE',   10),
      vision: envInt('PLAN_PRO_VISION',  20),
      tts:    envInt('PLAN_PRO_TTS',    100),
    },
    features: (process.env.PLAN_PRO_FEATURES || '').split('|').map(f => f.trim()).filter(Boolean),
    stripe_monthly_price_id: process.env.STRIPE_PRO_PRICE_ID        || null,
    stripe_annual_price_id:  process.env.STRIPE_PRO_ANNUAL_PRICE_ID || null,
  },

  // ── PREMIUM ──
  premium: {
    id:              'premium',
    name:            process.env.PLAN_PREMIUM_NAME            || 'Premium',
    price_monthly:   envFloat('PLAN_PREMIUM_PRICE_MONTHLY',   0),
    price_annual:    envFloat('PLAN_PREMIUM_PRICE_ANNUAL',    0),
    currency:        process.env.PLAN_CURRENCY                || 'EUR',
    limits: {
      chat:   envInt('PLAN_PREMIUM_CHAT',   -1),
      search: envInt('PLAN_PREMIUM_SEARCH', -1),
      image:  envInt('PLAN_PREMIUM_IMAGE',  -1),
      vision: envInt('PLAN_PREMIUM_VISION', -1),
      tts:    envInt('PLAN_PREMIUM_TTS',    -1),
    },
    features: (process.env.PLAN_PREMIUM_FEATURES || '').split('|').map(f => f.trim()).filter(Boolean),
    stripe_monthly_price_id: process.env.STRIPE_PREMIUM_PRICE_ID        || null,
    stripe_annual_price_id:  process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID || null,
  },
};

// Planuri valide — folosit pentru validare în routes
const VALID_PLANS = Object.keys(PLAN_CONFIG).filter(p => p !== 'guest');
const PAID_PLANS  = VALID_PLANS.filter(p => p !== 'free');

// ═══ ORIGINI PERMISE (CORS) ═══
function getAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGINS || APP.URL;
  const origins = raw.split(',').map(o => o.trim()).filter(Boolean);
  if (process.env.NODE_ENV !== 'production') {
    origins.push('http://localhost:3000', 'http://localhost:5173');
  }
  return origins;
}

// ═══ FEATURE FLAGS ═══
const FEATURES = {
  PAYMENTS_ENABLED:         envBool('FEATURE_PAYMENTS',         !!process.env.STRIPE_SECRET_KEY),
  VOICE_CLONE_ENABLED:      envBool('FEATURE_VOICE_CLONE',      !!process.env.ELEVENLABS_API_KEY),
  VISION_ENABLED:           envBool('FEATURE_VISION',           !!(process.env.OPENAI_API_KEY || process.env.GOOGLE_AI_KEY)),
  REALTIME_VOICE_ENABLED:   envBool('FEATURE_REALTIME_VOICE',   !!process.env.OPENAI_API_KEY),
  REFERRAL_ENABLED:         envBool('FEATURE_REFERRAL',         true),
  IDENTITY_ENABLED:         envBool('FEATURE_IDENTITY',         true),
  TRANSLATE_ENABLED:        envBool('FEATURE_TRANSLATE',        !!(process.env.GOOGLE_AI_KEY || process.env.OPENAI_API_KEY)),
  USAGE_ENFORCEMENT:        !envBool('DISABLE_USAGE_ENFORCEMENT', false),
};

// ═══ ADMIN ═══
const ADMIN = {
  EMAILS: (process.env.ADMIN_EMAIL || '').toLowerCase().split(',').map(e => e.trim()).filter(Boolean),
  SECRET_KEY: process.env.ADMIN_SECRET_KEY || '',
};

module.exports = {
  APP,
  PERSONAS,
  PLAN_CONFIG,
  VALID_PLANS,
  PAID_PLANS,
  FEATURES,
  ADMIN,
  getAllowedOrigins,
  // helpers
  envInt,
  envFloat,
  envBool,
};