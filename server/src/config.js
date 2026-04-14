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
    clientId:     isProd ? required('GOOGLE_CLIENT_ID') : optional('GOOGLE_CLIENT_ID'),
    clientSecret: isProd ? required('GOOGLE_CLIENT_SECRET') : optional('GOOGLE_CLIENT_SECRET'),
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
