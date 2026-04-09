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

  // Store OAuth state & PKCE in the server-side session so the callback can
  // verify them. The session is created here even before the user logs in.
  req.session.oauthState = state;
  req.session.oauthCodeVerifier = codeVerifier;
  req.session.oauthMode = mode;

  const authUrl = buildAuthUrl({ state, codeChallenge, mode });
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
    const msg = encodeURIComponent(`Google auth error: ${error}`);
    return res.redirect(`${config.appBaseUrl}/?auth_error=${msg}`);
  }

  // Validate state to prevent CSRF
  if (!state || state !== req.session.oauthState) {
    return res.status(400).json({ error: 'Invalid OAuth state parameter' });
  }

  const { oauthCodeVerifier: codeVerifier, oauthMode: mode } = req.session;

  // Clear the temporary OAuth session keys
  delete req.session.oauthState;
  delete req.session.oauthCodeVerifier;
  delete req.session.oauthMode;

  if (!code || !codeVerifier) {
    return res.status(400).json({ error: 'Missing authorization code' });
  }

  try {
    // Exchange code for tokens
    const tokens = await exchangeCode({ code, codeVerifier });

    // Fetch verified user profile from Google
    const profile = await fetchUserInfo(tokens.access_token);

    // Create or update the user in our database
    const user = upsertUser(profile);

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

    // Web: establish a server-side session and set a secure HttpOnly cookie
    req.session.userId = user.id;

    // Redirect the browser back to the app
    return res.redirect(`${config.appBaseUrl}/`);
  } catch (err) {
    console.error('[auth/callback] Error:', err.message);
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
  if (req.session) {
    req.session.destroy((err) => {
      if (err) {
        console.error('[auth/logout] session destroy error:', err.message);
      }
    });
  }

  // Clear the session cookie on the client
  res.clearCookie(config.session.name, {
    httpOnly: true,
    secure:   config.cookie.secure,
    sameSite: config.cookie.sameSite,
    domain:   config.cookie.domain || undefined,
  });

  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
