'use strict';

const path = require('path');

// Load environment-specific .env file
// In production on Railway, CWD is /app (project root)
// Load server/.env.production if NODE_ENV=production and file exists
const envFile = process.env.NODE_ENV === 'production'
  ? path.resolve(__dirname, '../../server/.env.production')
  : path.resolve(__dirname, '../../server/.env');

require('dotenv').config({ path: envFile });
// Also load root .env as fallback
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), override: false });

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const optional = (name, fallback = '') => process.env[name] || fallback;

const isProd = (process.env.NODE_ENV || 'development') === 'production';
const isTest = process.env.NODE_ENV === 'test';

const secret = (name) => {
  const value = process.env[name];
  if (!value && isProd) throw new Error(`Missing required secret in production: ${name}`);
  if (!value && !isTest) {
    const generated = require('crypto').randomBytes(48).toString('hex');
    console.warn(`[config] ${name} not set — generated a random ephemeral value (will change on restart)`);
    return generated;
  }
  return value || 'test-only-secret';
};

module.exports = {
  port: parseInt(optional('PORT', '3001'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),
  isProduction: optional('NODE_ENV', 'development') === 'production',

  google: {
    clientId:     optional('GOOGLE_CLIENT_ID'),
    clientSecret: optional('GOOGLE_CLIENT_SECRET'),
    redirectUri:  optional('GOOGLE_REDIRECT_URI', ''),
  },

  session: {
    secret:   secret('SESSION_SECRET'),
    name:     'kelion.sid',
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  },

  jwt: {
    secret:    secret('JWT_SECRET'),
    expiresIn: optional('JWT_EXPIRES_IN', '7d'),
  },

  appBaseUrl: optional('APP_BASE_URL',
    optional('NODE_ENV') === 'production' ? 'https://kelionai.app' : 'http://localhost:5173'
  ),
  apiBaseUrl: optional('API_BASE_URL',
    optional('NODE_ENV') === 'production' ? 'https://kelionai.app' : 'http://localhost:3001'
  ),

  corsOrigins: optional('CORS_ORIGINS', 'https://kelionai.app,https://www.kelionai.app,http://localhost:5173,http://localhost:3001')
    .split(',').map(o => o.trim()).filter(Boolean),

  cookie: {
    domain:   optional('COOKIE_DOMAIN', ''),
    secure:   optional('NODE_ENV', 'development') === 'production',
    sameSite: isProd ? 'lax' : 'lax',
  },

  dbPath: optional('DB_PATH', './data/kelion.db'),

  openai: {
    apiKey:   optional('OPENAI_API_KEY'),
    baseUrl:  optional('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
    model:    optional('OPENAI_MODEL', 'gpt-4o-mini'),
  },

  gemini: {
    apiKey:       optional('GEMINI_API_KEY'),
    chatModel:    optional('GEMINI_CHAT_MODEL', 'gemini-3-flash-preview'),
    // Keep this default in sync with server/src/routes/realtime.js — both
    // read GEMINI_LIVE_MODEL directly, so the fallbacks must match.
    //
    // We tried `gemini-2.0-flash-live-001` in #112 to escape the preview
    // protocol drift, but Google's v1main bidiGenerateContent rejected it
    // with 1008 "models/gemini-2.0-flash-live-001 is not found for API
    // version v1main, or is not supported for bidiGenerateContent" — that
    // exact model id does not exist on v1main Live. Reverting to the
    // preview that at least opens the session (`gemini-3.1-flash-live-
    // preview`) so admin can talk to Kelion again while we swap the
    // transport to OpenAI Realtime (plan C) for real stability.
    // Override via Railway env GEMINI_LIVE_MODEL.
    liveModel:    optional('GEMINI_LIVE_MODEL', 'gemini-3.1-flash-live-preview'),
    ttsModel:     optional('GEMINI_TTS_MODEL', 'gemini-3.1-flash-tts-preview'),
    ttsVoiceKelion: optional('GEMINI_TTS_VOICE_KELION', 'Kore'),
  },

  stripe: {
    secretKey:     optional('STRIPE_SECRET_KEY'),
    publishableKey: optional('STRIPE_PUBLISHABLE_KEY'),
    webhookSecret: optional('STRIPE_WEBHOOK_SECRET'),
  },
};

// ───── Centralized admin email list ─────
// Previously this was hardcoded as `['adrianenc11@gmail.com']` in 6+ files.
// Now every file should `require('./config').getAdminEmails()` instead.
const DEFAULT_ADMIN_EMAIL = 'adrianenc11@gmail.com';

/**
 * Returns the list of admin emails. Reads ADMIN_EMAILS env var
 * (comma-separated) with a single-email default fallback.
 */
module.exports.getAdminEmails = function getAdminEmails() {
  const raw = process.env.ADMIN_EMAILS;
  if (raw) return raw.split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return [DEFAULT_ADMIN_EMAIL];
};

module.exports.DEFAULT_ADMIN_EMAIL = DEFAULT_ADMIN_EMAIL;
