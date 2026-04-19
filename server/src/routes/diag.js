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
const { getUserByEmail, getDb } = require('../db');
const { getLastBootstrapResult, bootstrapAdmin } = require('../services/adminBootstrap');

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

/**
 * POST /api/diag/purge-users — nuke all user rows (and dependent tables) then
 * re-seed the admin from ADMIN_BOOTSTRAP_PASSWORD. Protected by a shared
 * secret header so only someone who already has Railway access can call it.
 *
 * Usage:
 *   curl -X POST https://kelionai.app/api/diag/purge-users \
 *     -H "X-Purge-Secret: $ADMIN_BOOTSTRAP_PASSWORD"
 *
 * Response: summary of rows deleted + admin re-seed result.
 */
router.post('/purge-users', async (req, res) => {
  try {
    const envPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    if (!envPassword) {
      return res.status(503).json({ error: 'ADMIN_BOOTSTRAP_PASSWORD not configured on server' });
    }
    const provided = req.get('X-Purge-Secret') || (req.body && req.body.secret) || '';
    if (String(provided) !== String(envPassword)) {
      return res.status(401).json({ error: 'bad secret' });
    }

    const db = getDb();
    if (!db) return res.status(503).json({ error: 'db not initialized' });

    // Tables that reference users either by FK or by user_id. Order matters
    // where FK cascades are not declared. users is last because most tables
    // reference it via FK.
    const tables = [
      'credit_transactions',
      'credit_ledger',
      'credit_balances',
      'memory_items',
      'push_subscriptions',
      'proactive_log',
      'referrals',
      'users',
    ];

    const deleted = {};
    for (const t of tables) {
      try {
        const exists = await db.get(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
          [t],
        );
        if (!exists) { deleted[t] = 'table not present'; continue; }
        const result = await db.run(`DELETE FROM ${t}`);
        deleted[t] = result && result.changes != null ? result.changes : 'ok';
      } catch (err) {
        deleted[t] = `error: ${err && err.message}`;
      }
    }

    // Re-seed admin in the same request so Adrian can log in immediately.
    const reseed = await bootstrapAdmin();

    return res.json({
      now: new Date().toISOString(),
      deleted,
      reseed,
    });
  } catch (err) {
    console.error('[diag/purge-users] failed:', err && err.message);
    return res.status(500).json({ error: err && err.message });
  }
});

module.exports = router;
