'use strict';

const crypto = require('crypto');
const fetch = require('node-fetch');
const config = require('../config');

/**
 * Generate a cryptographically random state string.
 * Used to prevent CSRF in the OAuth flow.
 *
 * @returns {string} hex-encoded 32 bytes
 */
function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate a PKCE code_verifier and code_challenge pair.
 * code_verifier: 43-128 character URL-safe random string
 * code_challenge: BASE64URL(SHA-256(code_verifier))
 *
 * @returns {{ codeVerifier: string, codeChallenge: string }}
 */
function generatePKCE() {
  const codeVerifier = crypto.randomBytes(64).toString('base64url');
  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');
  return { codeVerifier, codeChallenge };
}

/**
 * Build the Google Authorization URL.
 *
 * @param {{ state: string, codeChallenge: string, mode?: string }} opts
 * @returns {string}
 */
function buildAuthUrl({ state, codeChallenge, mode }) {
  const params = new URLSearchParams({
    client_id:             config.google.clientId,
    redirect_uri:          config.google.redirectUri,
    response_type:         'code',
    scope:                 config.google.scope,
    state,
    access_type:           'offline',
    prompt:                'select_account',
    code_challenge:        codeChallenge,
    code_challenge_method: 'S256',
  });

  // Pass the client mode (web|mobile) through the state or a custom param so
  // the callback handler knows which session strategy to use.
  if (mode) params.set('mode', mode);

  return `${config.google.authEndpoint}?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens at Google's token endpoint.
 *
 * @param {{ code: string, codeVerifier: string }} opts
 * @returns {Promise<{ access_token: string, id_token: string, refresh_token?: string }>}
 */
async function exchangeCode({ code, codeVerifier }) {
  const body = new URLSearchParams({
    code,
    client_id:     config.google.clientId,
    client_secret: config.google.clientSecret,
    redirect_uri:  config.google.redirectUri,
    grant_type:    'authorization_code',
    code_verifier: codeVerifier,
  });

  const response = await fetch(config.google.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google token exchange failed: ${response.status} ${text}`);
  }

  return response.json();
}

/**
 * Decode and lightly verify the Google ID token (JWT).
 * For production-grade verification, use Google's tokeninfo endpoint or
 * validate the JWT signature with Google's public keys. Here we use the
 * userinfo endpoint (which is authenticated with the access_token) to keep
 * the implementation simple and dependency-light while still being secure.
 *
 * @param {string} accessToken
 * @returns {Promise<{ sub: string, email: string, name: string, picture?: string }>}
 */
async function fetchUserInfo(accessToken) {
  const response = await fetch(config.google.userInfoEndpoint, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Google userinfo request failed: ${response.status} ${text}`);
  }

  const info = await response.json();

  if (!info.sub || !info.email) {
    throw new Error('Invalid userinfo response: missing sub or email');
  }

  if (!info.email_verified) {
    throw new Error('Google account email is not verified');
  }

  return {
    googleId: info.sub,
    email:    info.email,
    name:     info.name || info.email,
    picture:  info.picture || null,
  };
}

module.exports = { generateState, generatePKCE, buildAuthUrl, exchangeCode, fetchUserInfo };
