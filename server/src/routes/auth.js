'use strict';

const { Router } = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { upsertUser, getUserById } = require('../db');
const { signAppToken } = require('../middleware/auth');

// Google OAuth utils (mock for now - will be implemented with real Google API)
const generateState = () => crypto.randomBytes(16).toString('hex');
const generatePKCE = () => {
  const codeVerifier = crypto.randomBytes(32).toString('base64url');
  const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
  return { codeVerifier, codeChallenge };
};

const router = Router();

// In-memory state storage (use Redis in production)
const oauthStates = new Map();

/**
 * GET /auth/google/start
 * Starts Google OAuth flow
 */
router.get('/google/start', (req, res) => {
  const mode = req.query.mode || 'web'; // 'web' or 'mobile'
  const state = generateState();
  const { codeVerifier, codeChallenge } = generatePKCE();

  // Store state with PKCE verifier
  oauthStates.set(state, {
    codeVerifier,
    mode,
    expiresAt: Date.now() + 10 * 60 * 1000, // 10 minutes
  });

  // Build Google OAuth URL
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

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  
  if (mode === 'mobile') {
    // For mobile, return URL to open in browser
    return res.json({ authUrl, state });
  }

  // For web, redirect
  res.redirect(authUrl);
});

/**
 * GET /auth/google/callback
 * Google redirects here after user authentication
 */
router.get('/google/callback', async (req, res) => {
  try {
    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).json({ error: 'Missing code or state' });
    }

    // Verify state
    const storedState = oauthStates.get(state);
    if (!storedState) {
      return res.status(400).json({ error: 'Invalid or expired state' });
    }

    // Check expiration
    if (Date.now() > storedState.expiresAt) {
      oauthStates.delete(state);
      return res.status(400).json({ error: 'State expired' });
    }

    oauthStates.delete(state);

    // Exchange code for tokens (mock - implement with real Google API)
    // In production: POST to https://oauth2.googleapis.com/token
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: config.google.clientId,
        client_secret: config.google.clientSecret,
        redirect_uri: config.google.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: storedState.codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      console.error('[auth] Token exchange failed:', error);
      return res.status(400).json({ error: 'Failed to exchange code' });
    }

    const tokens = await tokenResponse.json();

    // Get user info from Google
    const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });

    if (!userInfoResponse.ok) {
      return res.status(400).json({ error: 'Failed to fetch user info' });
    }

    const googleUser = await userInfoResponse.json();

    // Verify email
    if (!googleUser.email_verified) {
      return res.status(400).json({ error: 'Email not verified' });
    }

    // Upsert user in database
    const user = await upsertUser({
      google_id: googleUser.id,
      email: googleUser.email,
      name: googleUser.name,
      picture: googleUser.picture,
    });

    if (storedState.mode === 'mobile') {
      // Mobile: return JWT token
      const token = signAppToken(user);
      return res.json({ 
        token,
        user: { id: user.id, email: user.email, name: user.name },
      });
    }

    // Web: Set session cookie and redirect to frontend
    // Note: express-session is not configured, so we'll use JWT in cookie
    const sessionToken = signAppToken(user);
    
    res.cookie('kelion.token', sessionToken, {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/',
    });

    // Redirect to frontend
    res.redirect(config.appBaseUrl);
  } catch (err) {
    console.error('[auth] Callback error:', err.message);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

/**
 * GET /auth/me
 * Returns current user profile
 */
router.get('/me', async (req, res) => {
  try {
    // Check for JWT in Authorization header or cookie
    const authHeader = req.headers.authorization || '';
    let token = null;

    if (authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    } else if (req.cookies && req.cookies['kelion.token']) {
      token = req.cookies['kelion.token'];
    }

    if (!token) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const decoded = jwt.verify(token, config.jwt.secret);
    const user = await getUserById(decoded.sub);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Return sanitized user info
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      role: user.role,
      subscription_tier: user.subscription_tier,
      usage_today: user.usage_today,
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    console.error('[auth] /me error:', err.message);
    res.status(500).json({ error: 'Failed to get user info' });
  }
});

/**
 * POST /auth/logout
 * Destroys session
 */
router.post('/logout', (req, res) => {
  res.clearCookie('kelion.token');
  res.json({ message: 'Logged out successfully' });
});

module.exports = router;
