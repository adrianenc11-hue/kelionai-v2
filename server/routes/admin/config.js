// ═══════════════════════════════════════════════════════════════
// KelionAI — Admin Config Routes (/api/admin/config/*)
// GET  /        — view all runtime config (env vars, masked)
// GET  /env     — list env var keys (values masked)
// POST /set     — set a runtime env var (non-persistent)
// GET  /urls    — view all configured URLs
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const logger  = require('../../logger');
const router  = express.Router();

// Keys that should be fully masked
const SENSITIVE = [
  'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_ANON_KEY',
  'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GROQ_API_KEY',
  'DEEPSEEK_API_KEY', 'GOOGLE_AI_KEY', 'GEMINI_API_KEY',
  'ELEVENLABS_API_KEY', 'TAVILY_API_KEY', 'DEEPGRAM_API_KEY',
  'STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET',
  'ADMIN_SECRET', 'JWT_SECRET', 'SESSION_SECRET',
  'SENDGRID_API_KEY', 'SMTP_PASS', 'DATABASE_URL',
];

function maskValue(key, value) {
  if (!value) return null;
  if (SENSITIVE.some(s => key.toUpperCase().includes(s.replace(/_/g, '').slice(0, 6)))) {
    return value.length > 8 ? value.slice(0, 4) + '****' + value.slice(-4) : '****';
  }
  return value;
}

// ─── GET / — Full config overview ───
router.get('/', (req, res) => {
  try {
    const config = {
      app: {
        NODE_ENV:    process.env.NODE_ENV    || 'development',
        PORT:        process.env.PORT        || '3000',
        APP_URL:     process.env.APP_URL     || '',
        APP_NAME:    process.env.APP_NAME    || 'KelionAI',
        APP_VERSION: process.env.APP_VERSION || '2.0.0',
      },
      database: {
        SUPABASE_URL:              process.env.SUPABASE_URL              || null,
        SUPABASE_ANON_KEY:         maskValue('SUPABASE_ANON_KEY',         process.env.SUPABASE_ANON_KEY),
        SUPABASE_SERVICE_ROLE_KEY: maskValue('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY),
      },
      ai: {
        OPENAI_API_KEY:    maskValue('OPENAI_API_KEY',    process.env.OPENAI_API_KEY),
        ANTHROPIC_API_KEY: maskValue('ANTHROPIC_API_KEY', process.env.ANTHROPIC_API_KEY),
        GROQ_API_KEY:      maskValue('GROQ_API_KEY',      process.env.GROQ_API_KEY),
        DEEPSEEK_API_KEY:  maskValue('DEEPSEEK_API_KEY',  process.env.DEEPSEEK_API_KEY),
        GOOGLE_AI_KEY:     maskValue('GOOGLE_AI_KEY',     process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY),
        ELEVENLABS_API_KEY:maskValue('ELEVENLABS_API_KEY',process.env.ELEVENLABS_API_KEY),
        TAVILY_API_KEY:    maskValue('TAVILY_API_KEY',    process.env.TAVILY_API_KEY),
        DEEPGRAM_API_KEY:  maskValue('DEEPGRAM_API_KEY',  process.env.DEEPGRAM_API_KEY),
      },
      stripe: {
        STRIPE_SECRET_KEY:         maskValue('STRIPE_SECRET_KEY',         process.env.STRIPE_SECRET_KEY),
        STRIPE_PUBLISHABLE_KEY:    process.env.STRIPE_PUBLISHABLE_KEY     || null,
        STRIPE_WEBHOOK_SECRET:     maskValue('STRIPE_WEBHOOK_SECRET',     process.env.STRIPE_WEBHOOK_SECRET),
        STRIPE_PRO_MONTHLY_PRICE_ID:     process.env.STRIPE_PRO_MONTHLY_PRICE_ID     || null,
        STRIPE_PRO_ANNUAL_PRICE_ID:      process.env.STRIPE_PRO_ANNUAL_PRICE_ID      || null,
        STRIPE_PREMIUM_MONTHLY_PRICE_ID: process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID || null,
        STRIPE_PREMIUM_ANNUAL_PRICE_ID:  process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID  || null,
        mode: process.env.STRIPE_SECRET_KEY?.startsWith('sk_live') ? 'live' : 'test',
      },
      email: {
        SENDGRID_API_KEY: maskValue('SENDGRID_API_KEY', process.env.SENDGRID_API_KEY),
        SMTP_HOST:        process.env.SMTP_HOST || null,
        SMTP_PORT:        process.env.SMTP_PORT || null,
        SMTP_USER:        process.env.SMTP_USER || null,
        FROM_EMAIL:       process.env.FROM_EMAIL || null,
        ADMIN_EMAIL:      process.env.ADMIN_EMAIL || null,
      },
      security: {
        ADMIN_SECRET:   maskValue('ADMIN_SECRET', process.env.ADMIN_SECRET),
        JWT_SECRET:     maskValue('JWT_SECRET',   process.env.JWT_SECRET),
        SESSION_SECRET: maskValue('SESSION_SECRET', process.env.SESSION_SECRET),
        ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || '',
      },
    };

    // Summary: which keys are configured vs missing
    const summary = {
      ai_keys_configured:     Object.values(config.ai).filter(Boolean).length,
      ai_keys_total:          Object.keys(config.ai).length,
      stripe_configured:      !!(process.env.STRIPE_SECRET_KEY),
      stripe_prices_set:      [
        process.env.STRIPE_PRO_MONTHLY_PRICE_ID,
        process.env.STRIPE_PRO_ANNUAL_PRICE_ID,
        process.env.STRIPE_PREMIUM_MONTHLY_PRICE_ID,
        process.env.STRIPE_PREMIUM_ANNUAL_PRICE_ID,
      ].filter(Boolean).length,
      email_configured:       !!(process.env.SENDGRID_API_KEY || process.env.SMTP_HOST),
      supabase_configured:    !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    };

    res.json({ config, summary });
  } catch (e) {
    logger.error({ component: 'AdminConfig', err: e.message }, 'GET /admin/config failed');
    res.status(500).json({ error: 'Failed to fetch config' });
  }
});

// ─── GET /env — List all env var keys (no values) ───
router.get('/env', (req, res) => {
  try {
    const keys = Object.keys(process.env).sort();
    const categorized = {
      ai:       keys.filter(k => ['OPENAI','ANTHROPIC','GROQ','DEEPSEEK','GOOGLE_AI','GEMINI','ELEVENLABS','TAVILY','DEEPGRAM'].some(p => k.includes(p))),
      stripe:   keys.filter(k => k.includes('STRIPE')),
      supabase: keys.filter(k => k.includes('SUPABASE')),
      email:    keys.filter(k => ['SENDGRID','SMTP','FROM_EMAIL','ADMIN_EMAIL'].some(p => k.includes(p))),
      app:      keys.filter(k => ['APP_','NODE_ENV','PORT','ALLOWED'].some(p => k.startsWith(p) || k.includes(p))),
      other:    keys.filter(k => !['OPENAI','ANTHROPIC','GROQ','DEEPSEEK','GOOGLE_AI','GEMINI','ELEVENLABS','TAVILY','DEEPGRAM','STRIPE','SUPABASE','SENDGRID','SMTP','FROM_EMAIL','ADMIN_EMAIL','APP_','NODE_ENV','PORT','ALLOWED'].some(p => k.includes(p))),
    };
    res.json({ total: keys.length, categorized });
  } catch (e) {
    res.status(500).json({ error: 'Failed to list env keys' });
  }
});

// ─── GET /urls — View all configured URLs ───
router.get('/urls', (req, res) => {
  try {
    const urlKeys = Object.keys(process.env).filter(k =>
      k.includes('URL') || k.includes('ENDPOINT') || k.includes('SITE') || k.includes('CDN')
    ).sort();

    const urls = {};
    for (const k of urlKeys) {
      urls[k] = process.env[k] || null;
    }

    res.json({ urls, total: urlKeys.length });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch URLs' });
  }
});

// ─── POST /set — Set a runtime env var (non-persistent) ───
router.post('/set', (req, res) => {
  try {
    const { key, value } = req.body;
    if (!key || typeof key !== 'string') {
      return res.status(400).json({ error: 'key is required' });
    }
    // Block setting sensitive keys via API
    if (SENSITIVE.includes(key.toUpperCase())) {
      return res.status(403).json({ error: 'Cannot set sensitive keys via API. Use Railway dashboard.' });
    }

    process.env[key] = value || '';
    logger.info({ component: 'AdminConfig', key }, 'Runtime env var set');
    res.json({ ok: true, key, note: 'Runtime only — update Railway env vars to persist.' });
  } catch (e) {
    logger.error({ component: 'AdminConfig', err: e.message }, 'POST /admin/config/set failed');
    res.status(500).json({ error: 'Failed to set config' });
  }
});

module.exports = router;