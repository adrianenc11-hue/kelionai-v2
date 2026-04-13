'use strict';

const { Router } = require('express');
const config = require('../config');
const { generateState, generatePKCE, buildAuthUrl, exchangeCode, fetchUserInfo } = require('../utils/google');
const { upsertUser } = require('../db');
const { signAppToken, requireAuth } = require('../middleware/auth');

const router = Router();

// ---------------------------------------------------------------------------
// GET /auth/google/start
// ---------------------------------------------------------------------------
// Query params:
//   mode  – "web" (default) | "mobile"
//           Determines the post-authentication response strategy.
//
// Initiates the Google OAuth 2.0 / OpenID Connect flow with:
//   - PKCE (code_challenge / code_verifier)
//   - state parameter for CSRF protection
// ---------------------------------------------------------------------------
router.get('/google/start', (req, res) => {
  const mode = req.query.mode === 'mobile' ? 'mobile' : 'web';

  const state = generateState();
  const { codeVerifier, codeChallenge } = generatePKCE();

  const authUrl = buildAuthUrl({ state, codeChallenge, mode });

  // Store OAuth state & PKCE in secure HttpOnly cookies instead of session
  // to avoid session loss between start and callback (MemoryStore + proxies).
  const cookieOpts = {
    httpOnly: true,
    secure: config.cookie.secure,
    sameSite: 'lax',
    maxAge: 10 * 60 * 1000, // 10 minutes
    path: '/',
  };
  res.cookie('oauth_state', state, cookieOpts);
  res.cookie('oauth_verifier', codeVerifier, cookieOpts);
  res.cookie('oauth_mode', mode, cookieOpts);
  res.redirect(authUrl);
});

// ---------------------------------------------------------------------------
// GET /auth/google/callback
// ---------------------------------------------------------------------------
// Google redirects here after the user grants (or denies) consent.
// ---------------------------------------------------------------------------
router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;

  // User denied consent or an error occurred on Google's side
  if (error) {
    console.log(`[kelion-api] Google auth error: ${error}`);
    const msg = encodeURIComponent(`Google auth error: ${error}`);
    return res.redirect(`${config.appBaseUrl}/?auth_error=${msg}`);
  }

  // Read OAuth state & PKCE from cookies
  const savedState = req.cookies.oauth_state;
  const codeVerifier = req.cookies.oauth_verifier;
  const mode = req.cookies.oauth_mode || 'web';

  // Clear the OAuth cookies immediately
  res.clearCookie('oauth_state', { path: '/' });
  res.clearCookie('oauth_verifier', { path: '/' });
  res.clearCookie('oauth_mode', { path: '/' });

  // Validate state to prevent CSRF
  if (!state || state !== savedState) {
    console.error('[auth/callback] State mismatch:', { expected: savedState, got: state });
    return res.status(400).json({ error: 'Invalid OAuth state parameter' });
  }

  if (!code || !codeVerifier) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  try {
    // Exchange code for tokens
    const tokens = await exchangeCode({ code, codeVerifier });

    // Fetch verified user profile from Google
    const profile = await fetchUserInfo(tokens.access_token);

    // Create or update the user in our database
    const user = await upsertUser(profile);

    if (mode === 'mobile') {
      // Mobile: return a signed JWT so the client can store it securely
      const appToken = signAppToken(user);
      return res.json({
        token: appToken,
        user: {
          id:      user.id,
          email:   user.email,
          name:    user.name,
          picture: user.picture,
        },
      });
    }

    // Web: sign a JWT and set it as a secure HttpOnly cookie
    // (avoids MemoryStore session loss through Cloudflare/Railway proxy)
    const appToken = signAppToken(user);
    console.log(`[auth/callback] Successful login for user: ${user.email}. Setting cookie...`);
    
    res.cookie('kelion.token', appToken, {
      httpOnly: true,
      secure: true, // Always true since we have SSL
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });

    console.log(`[auth/callback] Cookie set. Redirecting to: ${config.appBaseUrl}/`);
    // Redirect the browser back to the app
    return res.redirect(`${config.appBaseUrl}/`);
  } catch (err) {
    console.error('[auth/callback] CRITICAL Error:', err);
    if (mode === 'mobile') {
      return res.status(500).json({ error: 'Authentication failed' });
    }
    const msg = encodeURIComponent('Authentication failed. Please try again.');
    return res.redirect(`${config.appBaseUrl}/?auth_error=${msg}`);
  }
});

// ---------------------------------------------------------------------------
// GET /auth/me
// ---------------------------------------------------------------------------
// Returns the currently authenticated user's profile.
// Works for both web (session cookie) and mobile (Bearer token).
// ---------------------------------------------------------------------------
router.get('/me', requireAuth, (req, res) => {
  const { id, email, name, picture, created_at } = req.user;
  res.json({ id, email, name, picture, created_at });
});

// ---------------------------------------------------------------------------
// POST /auth/logout
// ---------------------------------------------------------------------------
// Web: destroys the session and clears the session cookie.
// Mobile: JWT tokens are stateless; the client simply discards the token.
//         We still accept the request and return 200 for uniformity.
// ---------------------------------------------------------------------------
router.post('/logout', (req, res) => {
  // Clear JWT cookie
  res.clearCookie('kelion.token', { path: '/' });

  // Also destroy session if it exists
  if (req.session) {
    req.session.destroy(() => {});
  }

  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
