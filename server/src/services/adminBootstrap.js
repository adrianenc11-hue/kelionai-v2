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

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${hash}:${salt}`;
}

async function bootstrapAdmin() {
  const email = (process.env.ADMIN_BOOTSTRAP_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;

  if (!password) {
    // No-op without a configured password. This is the default in dev.
    return { seeded: false, reason: 'ADMIN_BOOTSTRAP_PASSWORD not set' };
  }

  if (password.length < 8) {
    console.warn('[adminBootstrap] refusing to seed: password shorter than 8 chars');
    return { seeded: false, reason: 'password too short' };
  }

  try {
    const existing = await getUserByEmail(email);
    const password_hash = hashPassword(password);

    if (existing) {
      await updateUser(existing.id, {
        password_hash,
        role: 'admin',
      });
      console.log(`[adminBootstrap] refreshed admin password for ${email}`);
      return { seeded: true, updated: true, email };
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
    return { seeded: true, created: true, email };
  } catch (err) {
    console.error('[adminBootstrap] failed:', err && err.message);
    return { seeded: false, error: err && err.message };
  }
}

module.exports = { bootstrapAdmin };
