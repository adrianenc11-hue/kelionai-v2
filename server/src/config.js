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

// In production, critical secrets MUST be set via env vars — no fallback allowed.
const isProd = (process.env.NODE_ENV || 'development') === 'production';
const secret = (name, devFallback) => {
  const value = process.env[name];
  if (!value && isProd) throw new Error(`Missing required secret in production: ${name}`);
  return value || devFallback;
};

module.exports = {
  port: parseInt(optional('PORT', '3001'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),
  isProduction: optional('NODE_ENV', 'development') === 'production',

  google: {
    clientId:     optional('GOOGLE_CLIENT_ID'),
    clientSecret: optional('GOOGLE_CLIENT_SECRET'),
    redirectUri:  optional('GOOGLE_REDIRECT_URI',
      optional('NODE_ENV') === 'production'
        ? 'https://kelionai.app/auth/google/callback'
        : 'http://localhost:3001/auth/google/callback'
    ),
    authEndpoint:     'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint:    'https://oauth2.googleapis.com/token',
    userInfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
    scope: 'openid email profile',
  },

  session: {
    secret:   secret('SESSION_SECRET', 'dev-only-session-secret-do-not-use-in-prod'),
    name:     'kelion.sid',
    maxAgeMs: 7 * 24 * 60 * 60 * 1000,
  },

  jwt: {
    secret:    secret('JWT_SECRET', 'dev-only-jwt-secret-do-not-use-in-prod'),
    expiresIn: optional('JWT_EXPIRES_IN', '7d'),
  },

  appBaseUrl: optional('APP_BASE_URL',
    optional('NODE_ENV') === 'production' ? 'https://kelionai.app' : 'http://localhost:5173'
  ),
  apiBaseUrl: optional('API_BASE_URL',
    optional('NODE_ENV') === 'production' ? 'https://kelionai.app' : 'http://localhost:3001'
  ),

  corsOrigins: optional('CORS_ORIGINS', 'https://kelionai.app,https://kelionai-v2-production.up.railway.app,http://localhost:5173')
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

  stripe: {
    secretKey:     optional('STRIPE_SECRET_KEY'),
    publishableKey: optional('STRIPE_PUBLISHABLE_KEY'),
    webhookSecret: optional('STRIPE_WEBHOOK_SECRET'),
  },
};
