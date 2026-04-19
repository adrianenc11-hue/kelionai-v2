'use strict';

const { Router } = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { upsertUser, getUserById, insertUser, findByEmail, sanitizeUser } = require('../db');
const { signAppToken } = require('../middleware/auth');
const google = require('../utils/google');

const router = Router();

// In-memory state storage (use Redis in production)
const oauthStates = new Map();

/**
 * GET /auth/google/start
 * Starts Google OAuth flow
 */
router.get('/google/start', (req, res) => {
  const mode = req.query.mode || 'web';
  const state = google.generateState();
  const { codeVerifier, codeChallenge } = google.generatePKCE();

  oauthStates.set(state, {
    codeVerifier,
    mode,
    expiresAt: Date.now() + 10 * 60 * 1000,
  });

  // Store state and verifier in cookies for verification
  const cookieOpts = { httpOnly: true, sameSite: 'lax', maxAge: 10 * 60 * 1000, path: '/' };
  res.cookie('oauth_state', state, cookieOpts);
  res.cookie('oauth_verifier', codeVerifier, cookieOpts);

  const authUrl = google.buildAuthUrl({ state, codeChallenge, mode });
  res.redirect(authUrl);
});

/**
 * GET /auth/google/callback
 * Google redirects here after user authentication
 */
router.get('/google/callback', async (req, res) => {
  let mode = 'web';
  try {
    // Handle Google error response
    if (req.query.error) {
      const errorUrl = new URL(config.appBaseUrl);
      errorUrl.searchParams.set('auth_error', req.query.error);
      return res.redirect(errorUrl.toString());
    }

    const { code, state } = req.query;

    if (!code || !state) {
      return res.status(400).json({ error: 'Missing code or state' });
    }

    const storedState = oauthStates.get(state);
    if (!storedState) {
      return res.status(400).json({ error: 'Invalid or expired state' });
    }

    if (Date.now() > storedState.expiresAt) {
      oauthStates.delete(state);
      return res.status(400).json({ error: 'State expired' });
    }

    mode = storedState.mode || 'web';
    oauthStates.delete(state);

    const tokens = await google.exchangeCode(code, storedState.codeVerifier);
    const googleUser = await google.fetchUserInfo(tokens.access_token);

    const user = await upsertUser({
      google_id: googleUser.googleId,
      email: googleUser.email,
      name: googleUser.name,
      picture: googleUser.picture,
    });

    if (mode === 'mobile') {
      const token = signAppToken(user);
      return res.json({
        token,
        user: { id: user.id, email: user.email, name: user.name },
      });
    }

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
    if (mode === 'mobile') {
      return res.status(500).json({ error: 'Authentication failed' });
    }
    // Web: redirect with error
    const errorUrl = new URL(config.appBaseUrl);
    errorUrl.searchParams.set('auth_error', err.message || 'Authentication failed');
    return res.redirect(errorUrl.toString());
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

    // Determine effective role (check admin emails list)
    const defaultAdmins = ['adrianenc11@gmail.com'];
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    const allAdmins = [...new Set([...defaultAdmins, ...adminEmails])];
    const effectiveRole = (user.role === 'admin' || allAdmins.includes((user.email || '').toLowerCase())) ? 'admin' : user.role;

    // Return sanitized user info
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      picture: user.picture,
      role: effectiveRole,
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
 * POST /auth/local/register
 * Register with email + password
 */
router.post('/local/register', async (req, res) => {
  try {
    const { email, password, name } = req.body || {};

    if (!email) return res.status(400).json({ error: 'Email is required' });
    if (!password) return res.status(400).json({ error: 'Password is required' });
    if (!name || (typeof name === 'string' && name.trim().length < 2)) {
      return res.status(400).json({ error: 'Name must be at least 2 characters' });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    // Validate password strength
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Hash password (shared by both branches below)
    const salt = crypto.randomBytes(16).toString('hex');
    const password_hash = crypto.scryptSync(password, salt, 64).toString('hex') + ':' + salt;

    // Admin whitelist — emails that become admin on any successful
    // registration. Adrian's spec: "daca intilneste adresa mea de email
    // si parola mea, ala devine admin". We reuse the same list the rest
    // of the app trusts: a hardcoded default + ADMIN_EMAILS env override.
    const defaultAdmins = ['adrianenc11@gmail.com'];
    const adminEmailsEnv = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    const allAdmins = [...new Set([...defaultAdmins, ...adminEmailsEnv])];
    const emailLc = String(email).toLowerCase();
    const isAdminEmail = allAdmins.includes(emailLc);

    // Check if email already exists.
    //
    // Normal flow: 409 so two people can't race on the same address.
    //
    // Exception: when the caller is registering *an admin email* we let
    // them overwrite the existing row with the new password and force
    // role='admin'. This is the "claim my admin account from the Create
    // account modal" flow Adrian asked for — without it, the bootstrap
    // row (seeded at server boot from ADMIN_BOOTSTRAP_PASSWORD) would
    // permanently reject any Create-account attempt for adrianenc11@...
    // Non-admin emails still 409 as before.
    const existing = await findByEmail(email);
    let user;
    if (existing) {
      if (!isAdminEmail) {
        return res.status(409).json({ error: 'Email already registered' });
      }
      // Admin email: overwrite password + name + role. We use upsertUser
      // via the direct DB update helpers rather than a dedicated endpoint
      // so the rest of the insert/validation path is reused.
      const { updateUser } = require('../db');
      await updateUser(existing.id, {
        password_hash,
        name: String(name).trim(),
        role: 'admin',
      });
      user = { ...existing, password_hash, name: String(name).trim(), role: 'admin' };
    } else {
      user = await insertUser({
        email,
        password_hash,
        name,
        // Fresh row for an admin email → seed role directly so the very
        // first /me call after register already reports isAdmin=true.
        ...(isAdminEmail ? { role: 'admin' } : {}),
      });
    }

    const token = signAppToken(user);

    res.cookie('kelion.token', token, {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    const safeUser = sanitizeUser ? sanitizeUser(user) : user;
    const isAdmin = Boolean(
      (user.role === 'admin') ||
      (user.email && allAdmins.includes(String(user.email).toLowerCase()))
    );
    return res.status(201).json({ token, user: { ...safeUser, isAdmin } });
  } catch (err) {
    console.error('[auth] Register error:', err.message);
    return res.status(500).json({ error: 'Registration failed' });
  }
});

/**
 * POST /auth/local/login
 * Login with email + password
 */
router.post('/local/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};

    if (!email) return res.status(400).json({ error: 'Email is required' });
    if (!password) return res.status(400).json({ error: 'Password is required' });

    const user = await findByEmail(email);
    if (!user || !user.password_hash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Verify password
    const [hash, salt] = user.password_hash.split(':');
    const checkHash = crypto.scryptSync(password, salt, 64).toString('hex');
    if (hash !== checkHash) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = signAppToken(user);

    res.cookie('kelion.token', token, {
      httpOnly: true,
      secure: config.isProduction,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    const safeUser = sanitizeUser ? sanitizeUser(user) : user;
    const defaultAdmins = ['adrianenc11@gmail.com'];
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    const allAdmins = [...new Set([...defaultAdmins, ...adminEmails])];
    const isAdmin = Boolean(
      (user.role === 'admin') ||
      (user.email && allAdmins.includes(String(user.email).toLowerCase()))
    );
    return res.status(200).json({ token, user: { ...safeUser, isAdmin } });
  } catch (err) {
    console.error('[auth] Login error:', err.message);
    return res.status(500).json({ error: 'Login failed' });
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
