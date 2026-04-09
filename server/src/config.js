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
    clientId: required('GOOGLE_CLIENT_ID'),
    clientSecret: required('GOOGLE_CLIENT_SECRET'),
    redirectUri: optional(
      'GOOGLE_REDIRECT_URI',
      'http://localhost:3001/auth/google/callback'
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
    secret: required('SESSION_SECRET'),
    name: 'kelion.sid',
    maxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  },

  // JWT (mobile clients – Bearer token)
  jwt: {
    secret: required('JWT_SECRET'),
    expiresIn: optional('JWT_EXPIRES_IN', '7d'),
  },

  // URLs
  appBaseUrl: optional('APP_BASE_URL', 'http://localhost:5173'),
  apiBaseUrl: optional('API_BASE_URL', 'http://localhost:3001'),

  // CORS – comma-separated list of allowed origins
  corsOrigins: optional('CORS_ORIGINS', 'http://localhost:5173').split(',').map((o) => o.trim()),

  // Cookie settings
  cookie: {
    domain: optional('COOKIE_DOMAIN', ''),
    secure: optional('NODE_ENV', 'development') === 'production',
    sameSite: optional('NODE_ENV', 'development') === 'production' ? 'lax' : 'lax',
  },

  // SQLite database file path
  dbPath: optional('DB_PATH', './data/kelion.db'),
};
