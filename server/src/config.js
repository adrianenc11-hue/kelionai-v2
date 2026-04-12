'use strict';

require('dotenv').config();

/**
 * Centralised configuration loaded from environment variables.
 * All required variables are validated at startup.
 */

const required = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const optional = (name, fallback = '') => process.env[name] || fallback;

module.exports = {
  // Server
  port: parseInt(optional('PORT', '3001'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),
  isProduction: optional('NODE_ENV', 'development') === 'production',

  // Google OAuth 2.0 / OpenID Connect
  google: {
    clientId: optional('GOOGLE_CLIENT_ID'),
    clientSecret: optional('GOOGLE_CLIENT_SECRET'),
    redirectUri: optional(
      'GOOGLE_REDIRECT_URI',
      optional('NODE_ENV') === 'production' 
        ? 'https://kelionai.app/auth/google/callback'
        : 'http://localhost:3001/auth/google/callback'
    ),
    // Google's OIDC endpoints
    authEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    userInfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
    // Space-separated scopes to request
    scope: 'openid email profile',
  },

  // Session (web clients – HttpOnly cookie)
  session: {
    secret:    optional('SESSION_SECRET', 'a_default_session_secret'),
    name: 'kelion.sid',
    maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  },

  // JWT (mobile clients – Bearer token)
  jwt: {
    secret:    optional('JWT_SECRET', 'a_default_jwt_secret'),
    expiresIn: optional('JWT_EXPIRES_IN', '7d'),
  },

  // URLs
  appBaseUrl: optional('APP_BASE_URL', optional('NODE_ENV') === 'production' ? 'https://kelionai.app' : 'http://localhost:5173'),
  apiBaseUrl: optional('API_BASE_URL', optional('NODE_ENV') === 'production' ? 'https://kelionai.app' : 'http://localhost:3001'),

  // CORS – comma-separated list of allowed origins
  corsOrigins: optional('CORS_ORIGINS', 'https://kelionai.app, http://localhost:5173, https://kelionai-v2.onrender.com').split(',').map((o) => o.trim()),

  // Cookie settings
  cookie: {
    domain: optional('COOKIE_DOMAIN', optional('NODE_ENV', 'development') === 'production' ? 'kelionai.app' : ''),
    secure: optional('NODE_ENV', 'development') === 'production',
    sameSite: optional('NODE_ENV', 'development') === 'production' ? 'lax' : 'lax',
  },

  // SQLite database file path
  // Use relative path to ensure it's writable in containerized environments
  dbPath: optional('DB_PATH', './data/kelion.db'),

  // OpenAI / AI
  openai: {
    apiKey: optional('OPENAI_API_KEY'),
    baseUrl: optional('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
    model: optional('OPENAI_MODEL', 'gpt-4.1-mini'),
  },

  // Stripe API Keys
  stripe: {
    secretKey: optional('STRIPE_SECRET_KEY'),
    publishableKey: optional('STRIPE_PUBLISHABLE_KEY'),
    webhookSecret: optional('STRIPE_WEBHOOK_SECRET'),
  },
};
