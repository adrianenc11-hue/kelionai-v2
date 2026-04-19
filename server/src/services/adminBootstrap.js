'use strict';

/**
 * Admin bootstrap — ensures a first-class admin account exists at boot.
 *
 * Adrian asked for admins to be able to sign in with a real email + password
 * (not just passkey / Google). The existing /auth/local/register endpoint
 * would 409 on an email that already has a row (e.g. created via Google).
 * Rather than adding a sketchy "claim existing account" flow, we seed the
 * admin credentials directly from two env vars on each server start:
 *
 *   ADMIN_BOOTSTRAP_EMAIL     — defaults to 'adrianenc11@gmail.com'
 *   ADMIN_BOOTSTRAP_PASSWORD  — required to actually seed anything
 *
 * Behavior:
 *   - If the email row does not exist → create it with role='admin' and
 *     the given password (hashed).
 *   - If the email row exists → update password_hash + role='admin'.
 *   - Always idempotent; safe to call on every boot.
 *   - Silent no-op when ADMIN_BOOTSTRAP_PASSWORD is unset (dev / local).
 */

const crypto = require('crypto');
const {
  getUserByEmail,
  createUser,
  updateUser,
} = require('../db');

const DEFAULT_ADMIN_EMAIL = 'adrianenc11@gmail.com';

// Last bootstrap result kept in-process so the diag endpoint can report
// whether this deploy's admin seed actually ran. Never contains hashes
// or the password itself — only metadata Adrian can read on the live site.
let lastResult = { ranAt: null, result: null };

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${hash}:${salt}`;
}

async function bootstrapAdmin() {
  const email = (process.env.ADMIN_BOOTSTRAP_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
  const rawPassword = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  const password = rawPassword != null ? String(rawPassword) : undefined;

  if (!password) {
    console.log(`[adminBootstrap] skipped — ADMIN_BOOTSTRAP_PASSWORD not set (target email: ${email})`);
    const r = { seeded: false, reason: 'ADMIN_BOOTSTRAP_PASSWORD not set', email, passwordLen: 0 };
    lastResult = { ranAt: new Date().toISOString(), result: r };
    return r;
  }

  // Log env-var shape (length only; never the value) so Adrian can spot
  // accidental quoting or trailing whitespace from Railway Variables UI.
  const trimmedLen = password.trim().length;
  const hasLeadingOrTrailingWs = password.length !== trimmedLen;
  console.log(`[adminBootstrap] ADMIN_BOOTSTRAP_PASSWORD length=${password.length}${hasLeadingOrTrailingWs ? ' (WARNING: leading/trailing whitespace detected)' : ''}`);

  if (password.length < 8) {
    console.warn(`[adminBootstrap] REFUSED — password shorter than 8 chars (target email: ${email})`);
    const r = { seeded: false, reason: 'password too short', email, passwordLen: password.length };
    lastResult = { ranAt: new Date().toISOString(), result: r };
    return r;
  }

  try {
    const existing = await getUserByEmail(email);
    const password_hash = hashPassword(password);

    if (existing) {
      await updateUser(existing.id, {
        password_hash,
        role: 'admin',
      });
      console.log(`[adminBootstrap] refreshed admin password + role for ${email} (user id ${existing.id})`);
      const r = { seeded: true, updated: true, email, userId: existing.id, passwordLen: password.length };
      lastResult = { ranAt: new Date().toISOString(), result: r };
      return r;
    }

    // createUser does not take password_hash — fall back to a direct insert
    // via updateUser after creating the shell row.
    const created = await createUser({
      google_id: null,
      email,
      name: 'Adrian',
      picture: null,
    });
    await updateUser(created.id, {
      password_hash,
      role: 'admin',
    });
    console.log(`[adminBootstrap] created admin account for ${email}`);
    const r = { seeded: true, created: true, email, userId: created.id, passwordLen: password.length };
    lastResult = { ranAt: new Date().toISOString(), result: r };
    return r;
  } catch (err) {
    console.error('[adminBootstrap] failed:', err && err.message);
    const r = { seeded: false, error: err && err.message, email };
    lastResult = { ranAt: new Date().toISOString(), result: r };
    return r;
  }
}

function getLastBootstrapResult() {
  return lastResult;
}

module.exports = { bootstrapAdmin, getLastBootstrapResult };
