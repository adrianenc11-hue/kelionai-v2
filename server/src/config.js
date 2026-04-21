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
    // read GEMINI_LIVE_MODEL directly, so the fallbacks must match. See
    // that file for the current list of valid Google Live model names.
    //
    // Default is the GA stable model `gemini-2.0-flash-live-001` — the
    // preview `gemini-3.1-flash-live-preview` kept emitting 1007
    // "setup must be the first message and only the first" about two
    // minutes into a session (Adrian 2026-04-21: "Crapa dupa 2 min de
    // funtionare 1007"). Preview models can change protocol without
    // warning; the GA model has a locked wire format. Override via
    // Railway env GEMINI_LIVE_MODEL when a newer stable model ships.
    liveModel:    optional('GEMINI_LIVE_MODEL', 'gemini-2.0-flash-live-001'),
    ttsModel:     optional('GEMINI_TTS_MODEL', 'gemini-3.1-flash-tts-preview'),
    ttsVoiceKelion: optional('GEMINI_TTS_VOICE_KELION', 'Kore'),
  },

  stripe: {
    secretKey:     optional('STRIPE_SECRET_KEY'),
    publishableKey: optional('STRIPE_PUBLISHABLE_KEY'),
    webhookSecret: optional('STRIPE_WEBHOOK_SECRET'),
  },
};
