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

const generatedSecretNames = [];

const secret = (name) => {
  const value = process.env[name];
  if (value) return value;
  if (isTest) return 'test-only-secret';

  const generated = require('crypto').randomBytes(48).toString('hex');
  generatedSecretNames.push(name);

  if (isProd) {
    console.warn(`[config] ${name} not set - generated an ephemeral production fallback. Set ${name} in Railway to keep sessions stable across restarts.`);
  } else {
    console.warn(`[config] ${name} not set - generated a random ephemeral value (will change on restart)`);
  }
  return generated;
};

module.exports = {
  port: parseInt(optional('PORT', '3001'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),
  isProduction: optional('NODE_ENV', 'development') === 'production',

  google: {
    clientId: optional('GOOGLE_CLIENT_ID'),
    clientSecret: optional('GOOGLE_CLIENT_SECRET'),
    redirectUri: optional('GOOGLE_REDIRECT_URI', ''),
    apiKey: optional('GOOGLE_API_KEY'),
    // Adrian 2026-05-18: synced with modelRouter.js — Claude Sonnet 4 is the
    // primary brain. These defaults are legacy fallbacks only; the real model
    // selection goes through modelRouter.getModel() / smartFetch().
    chatModel: optional('GOOGLE_CHAT_MODEL', 'anthropic/claude-opus-4.7'),
    liveModel: optional('GOOGLE_LIVE_MODEL', 'anthropic/claude-opus-4.7'),
    ttsModel: optional('GOOGLE_TTS_MODEL', 'google/gemma-4-31b-it:free'),
    ttsVoiceKelion: optional('GOOGLE_TTS_VOICE_KELION', 'Kore'),
    freeMode: true,
  },

  session: {
    secret: secret('SESSION_SECRET'),
    name: 'kelion.sid',
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  },

  jwt: {
    secret: secret('JWT_SECRET'),
    expiresIn: optional('JWT_EXPIRES_IN', '7d'),
  },

  runtime: {
    generatedSecrets: generatedSecretNames,
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
    domain: optional('COOKIE_DOMAIN', ''),
    secure: optional('NODE_ENV', 'development') === 'production',
    sameSite: isProd ? 'lax' : 'lax',
  },

  dbPath: optional('DB_PATH', './data/kelion.db'),



  stripe: {
    secretKey: optional('STRIPE_SECRET_KEY'),
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
