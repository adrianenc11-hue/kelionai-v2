'use strict';

const { Router } = require('express');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { findByEmail, insertUser } = require('../db');
const { signAppToken } = require('../middleware/auth');

const router = Router();

// ---------------------------------------------------------------------------
// POST /auth/local/register
// ---------------------------------------------------------------------------
router.post('/register', async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    return res.status(400).json({ error: 'Email, password, and name are required' });
  }
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: 'Invalid email format' });
  }
  if (typeof name !== 'string' || name.trim().length < 2) {
    return res.status(400).json({ error: 'Name must be at least 2 characters' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/[0-9]/.test(password)) {
    return res.status(400).json({ error: 'Password must contain uppercase, lowercase and a number' });
  }

  try {
    const existing = findByEmail(email);
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const newUser = insertUser({ email, password_hash, name, role: 'user' });

    if (!newUser) {
      return res.status(500).json({ error: 'Failed to create user' });
    }

    const token = signAppToken(newUser);
    res.cookie('kelion.token', token, {
      httpOnly: true,
      secure:   config.cookie.secure,
      sameSite: config.cookie.sameSite,
      domain:   config.cookie.domain || undefined,
      maxAge:   config.session.maxAgeMs,
      path:     '/',
    });

    return res.status(201).json({
      message: 'User registered successfully',
      token,
      user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role },
    });
  } catch (err) {
    console.error('[localAuth/register]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /auth/local/login
// ---------------------------------------------------------------------------
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = findByEmail(email);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const storedHash = user.password_hash;
    if (!storedHash) {
      // User registered via Google OAuth — no password set
      return res.status(401).json({ error: 'This account uses Google Sign-In. Please login with Google.' });
    }

    const isMatch = await bcrypt.compare(password, storedHash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = signAppToken(user);
    res.cookie('kelion.token', token, {
      httpOnly: true,
      secure:   config.cookie.secure,
      sameSite: config.cookie.sameSite,
      domain:   config.cookie.domain || undefined,
      maxAge:   config.session.maxAgeMs,
      path:     '/',
    });

    return res.json({
      message: 'Logged in successfully',
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    });
  } catch (err) {
    console.error('[localAuth/login]', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
