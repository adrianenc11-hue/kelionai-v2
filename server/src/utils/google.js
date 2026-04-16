'use strict';

const crypto = require('crypto');
const config = require('../config');

/**
 * Generate a random 64-char hex state string for OAuth CSRF protection.
 */
function generateState() {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Generate PKCE code_verifier and code_challenge (S256).
 */
function generatePKCE() {
  const codeVerifier = crypto.randomBytes(32)
    .toString('base64url')
    .slice(0, 128);

  const codeChallenge = crypto
    .createHash('sha256')
    .update(codeVerifier)
    .digest('base64url');

  return { codeVerifier, codeChallenge };
}

/**
 * Build the Google OAuth 2.0 authorization URL.
 */
function buildAuthUrl({ state, codeChallenge, mode }) {
  const params = new URLSearchParams({
    client_id: config.google.clientId,
    redirect_uri: config.google.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    access_type: 'offline',
    prompt: 'consent',
  });

  if (mode) {
    params.set('mode', mode);
  }

  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * Exchange an authorization code for tokens via Google's token endpoint.
 */
async function exchangeCode(code, codeVerifier) {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.google.clientId,
      client_secret: config.google.clientSecret,
      redirect_uri: config.google.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: codeVerifier,
    }).toString(),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Google token exchange failed: ${err}`);
  }

  return response.json();
}

/**
 * Fetch user profile info from Google using an access token.
 */
async function fetchUserInfo(accessToken) {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error('Failed to fetch Google user info');
  }

  const data = await response.json();

  if (!data.verified_email) {
    throw new Error('Google account email is not verified');
  }

  return {
    googleId: data.id,
    email: data.email,
    name: data.name,
    picture: data.picture || null,
  };
}

module.exports = {
  generateState,
  generatePKCE,
  buildAuthUrl,
  exchangeCode,
  fetchUserInfo,
};
