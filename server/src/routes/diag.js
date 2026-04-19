'use strict';

/**
 * /api/diag/* — read-only diagnostics exposed on the live site.
 *
 * These endpoints are deliberately public and never reveal secrets or
 * password hashes. They exist so Adrian (and Devin) can see what
 * actually happened at boot on Railway without needing to dig through
 * deploy logs. Every value returned is metadata only.
 */

const express = require('express');
const { getUserByEmail } = require('../db');
const { getLastBootstrapResult } = require('../services/adminBootstrap');

const router = express.Router();

const DEFAULT_ADMIN_EMAIL = 'adrianenc11@gmail.com';

router.get('/admin-bootstrap', async (req, res) => {
  try {
    const email = (process.env.ADMIN_BOOTSTRAP_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
    const envPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    const envLen = envPassword ? String(envPassword).length : 0;
    const envTrimmedLen = envPassword ? String(envPassword).trim().length : 0;

    let userRow = null;
    try { userRow = await getUserByEmail(email); } catch (_) { userRow = null; }

    res.json({
      now: new Date().toISOString(),
      env: {
        adminEmail: email,
        passwordConfigured: envLen > 0,
        passwordLength: envLen,
        passwordHasLeadingOrTrailingWhitespace: envLen !== envTrimmedLen,
      },
      lastBootstrap: getLastBootstrapResult(),
      dbUser: userRow ? {
        exists: true,
        id: userRow.id,
        email: userRow.email,
        role: userRow.role,
        hasPasswordHash: !!userRow.password_hash,
        passwordHashLooksCorrect: !!(userRow.password_hash && String(userRow.password_hash).includes(':')),
        googleId: userRow.google_id ? 'set' : null,
        createdAt: userRow.created_at,
        updatedAt: userRow.updated_at,
      } : { exists: false },
    });
  } catch (err) {
    res.status(500).json({ error: err && err.message });
  }
});

module.exports = router;
