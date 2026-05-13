'use strict';

const path = require('path');

// Load environment-specific .env file
// In production on Railway, CWD is /app (project root)
// Load server/.env.production if NODE_ENV=production and file exists.
// In test mode we deliberately skip .env loading so that unit tests never
// make real network calls to paid APIs using developer-machine secrets.
if (process.env.NODE_ENV !== 'test') {
  const envFile = process.env.NODE_ENV === 'production'
    ? path.resolve(__dirname, '../../server/.env.production')
    : path.resolve(__dirname, '../../server/.env');

  require('dotenv').config({ path: envFile });
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), override: false });
}

const required = (name) => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const optional = (name, fallback = '') => process.env[name] || fallback;
const csv = (name, fallback = '') =>
  (process.env[name] || fallback).split(',').map(s => s.trim()).filter(Boolean);

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
    realtimeModel: optional('OPENAI_REALTIME_MODEL', 'gpt-4o-realtime-preview'),
    voiceKelion: optional('OPENAI_VOICE_KELION', 'ash'),
  },

  gemini: {
    apiKey:       optional('GEMINI_API_KEY'),
    chatModel:    optional('GEMINI_CHAT_MODEL', 'gemini-2.5-flash'),
    chatFallbacks: csv('GEMINI_CHAT_FALLBACKS', 'gemini-2.5-flash,gemini-2.0-flash'),
    liveModel:    optional('GEMINI_LIVE_MODEL', ''),
    liveFallbacks: csv('GEMINI_LIVE_FALLBACKS',
      'gemini-live-2.5-flash-preview,gemini-2.5-flash-preview-native-audio-dialog,gemini-2.0-flash-live-001'),
    ttsModel:     optional('GEMINI_TTS_MODEL', 'gemini-2.5-flash-preview-tts'),
    ttsVoiceKelion: optional('GEMINI_TTS_VOICE_KELION', 'Kore'),
    liveVoiceKelion: optional('GEMINI_LIVE_VOICE_KELION', 'Kore'),
  },

  stripe: {
    secretKey:     optional('STRIPE_SECRET_KEY'),
    publishableKey: optional('STRIPE_PUBLISHABLE_KEY'),
    webhookSecret: optional('STRIPE_WEBHOOK_SECRET'),
    currency:      optional('STRIPE_CURRENCY', 'usd').toLowerCase(),
  },

  trial: {
    // Hard cap on ephemeral voice-session tokens (both /token and
    // /trial-token). Acceptance expects ~15 minutes.
    maxSeconds: parseInt(optional('TRIAL_MAX_SECONDS', '900'), 10),
  },
};
