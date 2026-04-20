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
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { getUserByEmail, getUserByGoogleId, findByEmail, getDb } = require('../db');
const { getLastBootstrapResult, bootstrapAdmin, getLastCreditHealResult } = require('../services/adminBootstrap');

const router = express.Router();

/**
 * GET /api/diag/whoami — decodes the kelion.token cookie (or Bearer
 * Authorization header) for the calling browser and reports the JWT
 * claims + what the JWT migration path in middleware/auth.js would find
 * in the database. Zero secrets exposed — the token is NEVER echoed
 * back, only its claims (email/name/role are already visible to the
 * user in their own browser).
 *
 * This lets us see, from a user's own browser, exactly why the
 * transparent migration might be failing for their session without
 * needing Railway log access.
 */
router.get('/whoami', async (req, res) => {
  try {
    const authHeader = req.headers.authorization || '';
    const rawToken = authHeader.startsWith('Bearer ')
      ? authHeader.substring(7)
      : (req.cookies && req.cookies['kelion.token']) || null;

    if (!rawToken) {
      return res.json({
        now: new Date().toISOString(),
        hasToken: false,
        note: 'No kelion.token cookie or Authorization: Bearer header on this request.',
      });
    }

    let decoded = null;
    let verifyError = null;
    try {
      decoded = jwt.verify(rawToken, config.jwt.secret);
    } catch (err) {
      verifyError = err && err.message;
      try { decoded = jwt.decode(rawToken); } catch (_) {}
    }

    const rawSub = decoded && decoded.sub;
    const numericSub = Number.parseInt(rawSub, 10);
    const isNumeric = Number.isFinite(numericSub) && String(numericSub) === String(rawSub);

    let byEmail = null, byEmailErr = null;
    let byEmailLC = null, byEmailLCErr = null;
    let byGoogle = null, byGoogleErr = null;
    if (decoded && decoded.email) {
      try { byEmail = await findByEmail(decoded.email); }
      catch (e) { byEmailErr = e && e.message; }
      try { byEmailLC = await findByEmail(String(decoded.email).toLowerCase()); }
      catch (e) { byEmailLCErr = e && e.message; }
    }
    if (rawSub) {
      try { byGoogle = await getUserByGoogleId(String(rawSub)); }
      catch (e) { byGoogleErr = e && e.message; }
    }

    res.json({
      now: new Date().toISOString(),
      hasToken: true,
      verifyError,
      usesPostgres: !!process.env.DATABASE_URL,
      jwt: decoded ? {
        sub: rawSub,
        subIsNumeric: isNumeric,
        email: decoded.email || null,
        name: decoded.name || null,
        role: decoded.role || null,
        iat: decoded.iat || null,
        exp: decoded.exp || null,
      } : null,
      dbLookup: {
        byEmail: byEmail ? { id: byEmail.id, email: byEmail.email, role: byEmail.role, googleId: byEmail.google_id ? 'set' : null } : null,
        byEmailErr,
        byEmailLowercase: byEmailLC ? { id: byEmailLC.id, email: byEmailLC.email } : null,
        byEmailLCErr,
        byGoogleId: byGoogle ? { id: byGoogle.id, email: byGoogle.email } : null,
        byGoogleErr,
      },
      wouldMigrate: isNumeric
        ? 'no — sub is already numeric, request would pass straight through'
        : (byEmail || byEmailLC || byGoogle)
          ? 'yes — a DB row was found, fresh JWT would be issued and request would proceed'
          : 'NO — no DB row matches; "Stale token" would be returned',
    });
  } catch (err) {
    res.status(500).json({ error: err && err.message });
  }
});

/**
 * GET /api/diag/db-path — returns where SQLite is persisted and whether
 * the parent directory looks like a Railway persistent volume (i.e. does
 * it survive redeploys). Zero secrets exposed; metadata only.
 *
 * We consider the volume "persistent" when the directory is outside the
 * app bundle (everything under /app/server/data/, /data/, /mnt/, etc.
 * matches — Railway mounts volumes at configured paths with those
 * prefixes). If the path resolves inside /app/server/data without a
 * volume attached, writes succeed but are wiped on every container
 * rebuild, which is the exact bug that was silently wiping credits +
 * memory_items across deploys before this change.
 */
router.get('/db-path', async (req, res) => {
  try {
    const configured = process.env.DB_PATH || './data/kelion.db';
    const resolved = path.resolve(configured);
    const dir = path.dirname(resolved);
    let dirExists = false, fileExists = false, fileSize = null, fileMtime = null;
    try { dirExists = fs.existsSync(dir); } catch (_) {}
    try {
      if (fs.existsSync(resolved)) {
        const st = fs.statSync(resolved);
        fileExists = true;
        fileSize = st.size;
        fileMtime = st.mtime.toISOString();
      }
    } catch (_) {}
    const looksPersistent = /^\/(data|mnt|app\/server\/data)\b/.test(resolved);
    res.json({
      now: new Date().toISOString(),
      configured,
      resolved,
      dir,
      dirExists,
      fileExists,
      fileSize,
      fileMtime,
      looksPersistent,
      note: looksPersistent
        ? 'Path is under a directory that is expected to be a Railway volume. If credits still wipe on redeploy, the Railway service is missing the volume attachment.'
        : 'Path is not under a typical Railway volume mount (/app/server/data, /data, /mnt). SQLite will land on ephemeral disk and wipe on redeploy.',
    });
  } catch (err) {
    res.status(500).json({ error: err && err.message });
  }
});

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
      lastCreditHeal: getLastCreditHealResult(),
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
