'use strict';

// Demo account request & activation system.
//
// Flow:
// 1. Visitor fills in name/surname/email on the landing page → POST /api/demo/request
// 2. Admin sees pending requests in the admin panel → GET /api/demo/requests
// 3. Admin approves a request → POST /api/demo/approve/:id
//    This generates a unique 8-char alphanumeric demo code and emails it (or admin copies it).
// 4. Visitor enters their demo code → POST /api/demo/activate
//    System creates a user account with 15 minutes free credit, one-time only.
// 5. After 15 min expire, user must purchase credits (app costs £20 one-time + pay-as-you-go credits).

const { Router } = require('express');
const crypto = require('crypto');
const { getDb } = require('../db');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { insertUser, findByEmail } = require('../db');
const { addCreditsTransaction } = require('../db');
const { signAppToken } = require('../middleware/auth');

const router = Router();

const DEMO_TRIAL_MINUTES = 15;

// ── Public: submit a demo request ──────────────────────────────────
// No auth required — this is the landing page form.
router.post('/request', async (req, res) => {
  try {
    const { firstName, lastName, email } = req.body || {};

    if (!firstName || typeof firstName !== 'string' || firstName.trim().length < 2) {
      return res.status(400).json({ error: 'First name is required (min 2 characters)' });
    }
    if (!lastName || typeof lastName !== 'string' || lastName.trim().length < 2) {
      return res.status(400).json({ error: 'Last name is required (min 2 characters)' });
    }
    if (!email || typeof email !== 'string') {
      return res.status(400).json({ error: 'Email is required' });
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: 'Invalid email format' });
    }

    const db = getDb();
    if (!db) return res.status(500).json({ error: 'Database not available' });

    // Check if this email already requested a demo
    const existing = await db.get(
      'SELECT id, status FROM demo_requests WHERE email = ?',
      [email.toLowerCase().trim()]
    );
    if (existing) {
      if (existing.status === 'approved') {
        return res.status(409).json({ error: 'A demo code has already been issued for this email. Check your inbox or contact us.' });
      }
      if (existing.status === 'pending') {
        return res.status(409).json({ error: 'A demo request for this email is already pending. We will review it shortly.' });
      }
    }

    await db.run(
      `INSERT INTO demo_requests (first_name, last_name, email, status)
       VALUES (?, ?, ?, 'pending')`,
      [firstName.trim(), lastName.trim(), email.toLowerCase().trim()]
    );

    res.status(201).json({ success: true, message: 'Demo request submitted! We will review it and send you a demo code shortly.' });
  } catch (err) {
    console.error('[demo/request] Error:', err && err.message);
    res.status(500).json({ error: 'Failed to submit demo request' });
  }
});

// ── Admin: list all demo requests ──────────────────────────────────
router.get('/requests', requireAuth, requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ error: 'Database not available' });

    const status = req.query.status || null;
    let rows;
    if (status) {
      rows = await db.all(
        'SELECT * FROM demo_requests WHERE status = ? ORDER BY created_at DESC',
        [status]
      );
    } else {
      rows = await db.all('SELECT * FROM demo_requests ORDER BY created_at DESC');
    }

    res.json({ requests: rows, total: rows.length });
  } catch (err) {
    console.error('[demo/requests] Error:', err && err.message);
    res.status(500).json({ error: 'Failed to fetch demo requests' });
  }
});

// ── Admin: approve a demo request and generate a unique code ───────
router.post('/approve/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ error: 'Database not available' });

    const request = await db.get('SELECT * FROM demo_requests WHERE id = ?', [req.params.id]);
    if (!request) {
      return res.status(404).json({ error: 'Demo request not found' });
    }
    if (request.status === 'approved') {
      return res.status(400).json({ error: 'Already approved', code: request.demo_code });
    }

    // Generate unique 8-char alphanumeric demo code
    const demoCode = crypto.randomBytes(4).toString('hex').toUpperCase();

    await db.run(
      `UPDATE demo_requests
         SET status = 'approved',
             demo_code = ?,
             approved_at = CURRENT_TIMESTAMP,
             approved_by = ?
       WHERE id = ?`,
      [demoCode, (req.user && req.user.email) || 'admin', request.id]
    );

    res.json({
      success: true,
      id: request.id,
      email: request.email,
      firstName: request.first_name,
      lastName: request.last_name,
      demoCode,
      trialMinutes: DEMO_TRIAL_MINUTES,
      message: `Demo code ${demoCode} generated for ${request.email}. Share this code with the user.`,
    });
  } catch (err) {
    console.error('[demo/approve] Error:', err && err.message);
    res.status(500).json({ error: 'Failed to approve demo request' });
  }
});

// ── Admin: reject a demo request ───────────────────────────────────
router.post('/reject/:id', requireAuth, requireAdmin, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ error: 'Database not available' });

    const request = await db.get('SELECT * FROM demo_requests WHERE id = ?', [req.params.id]);
    if (!request) {
      return res.status(404).json({ error: 'Demo request not found' });
    }

    await db.run(
      "UPDATE demo_requests SET status = 'rejected' WHERE id = ?",
      [request.id]
    );

    res.json({ success: true, id: request.id, status: 'rejected' });
  } catch (err) {
    console.error('[demo/reject] Error:', err && err.message);
    res.status(500).json({ error: 'Failed to reject demo request' });
  }
});

// ── Public: activate a demo code ───────────────────────────────────
// The visitor enters their demo code + sets a password → gets a user
// account with 15 free minutes. One-time only per code.
router.post('/activate', async (req, res) => {
  try {
    const { code, password } = req.body || {};

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Demo code is required' });
    }
    if (!password || typeof password !== 'string' || password.length < 8) {
      return res.status(400).json({ error: 'Password is required (min 8 characters)' });
    }

    const db = getDb();
    if (!db) return res.status(500).json({ error: 'Database not available' });

    const request = await db.get(
      "SELECT * FROM demo_requests WHERE demo_code = ? AND status = 'approved'",
      [code.trim().toUpperCase()]
    );
    if (!request) {
      return res.status(404).json({ error: 'Invalid or expired demo code' });
    }
    if (request.activated_at) {
      return res.status(400).json({ error: 'This demo code has already been used' });
    }

    // Check if user already exists
    const existingUser = await findByEmail(request.email);
    if (existingUser) {
      return res.status(409).json({ error: 'An account with this email already exists. Please sign in.' });
    }

    // Create user account
    const salt = crypto.randomBytes(16).toString('hex');
    const password_hash = crypto.scryptSync(password, salt, 64).toString('hex') + ':' + salt;

    const user = await insertUser({
      email: request.email,
      password_hash,
      name: `${request.first_name} ${request.last_name}`,
    });

    // Grant 15 free minutes
    await addCreditsTransaction({
      userId: user.id,
      deltaMinutes: DEMO_TRIAL_MINUTES,
      kind: 'demo_trial',
      note: `Demo trial — 15 min free (code: ${code.trim().toUpperCase()})`,
    });

    // Mark code as activated
    await db.run(
      `UPDATE demo_requests
         SET activated_at = CURRENT_TIMESTAMP,
             activated_user_id = ?
       WHERE id = ?`,
      [user.id, request.id]
    );

    // Sign the user in
    const token = signAppToken(user);

    res.cookie('kelion.token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });

    res.status(201).json({
      success: true,
      message: `Welcome ${request.first_name}! Your 15-minute free trial is active.`,
      user: { id: user.id, email: user.email, name: user.name },
      trialMinutes: DEMO_TRIAL_MINUTES,
      token,
    });
  } catch (err) {
    console.error('[demo/activate] Error:', err && err.message);
    res.status(500).json({ error: 'Failed to activate demo code' });
  }
});

// ── Public: validate a demo code (check if it exists and is usable) ─
router.get('/validate/:code', async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ error: 'Database not available' });

    const request = await db.get(
      "SELECT id, first_name, email, status, activated_at FROM demo_requests WHERE demo_code = ? AND status = 'approved'",
      [req.params.code.trim().toUpperCase()]
    );
    if (!request) {
      return res.status(404).json({ valid: false, error: 'Invalid demo code' });
    }
    if (request.activated_at) {
      return res.json({ valid: false, error: 'This demo code has already been used', used: true });
    }

    res.json({ valid: true, firstName: request.first_name, email: request.email });
  } catch (err) {
    console.error('[demo/validate] Error:', err && err.message);
    res.status(500).json({ error: 'Failed to validate code' });
  }
});

module.exports = router;
