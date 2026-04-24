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
  getCreditsBalance,
  addCreditsTransaction,
} = require('../db');

const DEFAULT_ADMIN_EMAIL = 'adrianenc11@gmail.com';

// Admin credit auto-heal floor. If the admin's credit balance is below
// this on boot, we top him up with a 'bonus' ledger entry so the dashboard
// always shows a working balance — even after a SQLite wipe on a Railway
// redeploy (which is the root cause of "iar au disparut creditele lui kelion").
// Tune via ADMIN_MIN_CREDIT_MINUTES env var. Default 600 minutes = 10 hours
// of voice, which is plenty for ops work without being wildly large.
const DEFAULT_ADMIN_MIN_CREDITS = 600;

let lastCreditHealResult = { ranAt: null, result: null };

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
    // via updateUser after creating the shell row. Derive the default
    // display name from the email local-part (capitalised) rather than
    // hard-coding "Adrian" — otherwise *every* Postgres fresh-start
    // writes Adrian's real name into whatever bootstrap email is
    // configured, which leaks the operator's identity to guest/test
    // accounts that happen to land on that email.
    const localPart = String(email).split('@')[0] || 'Admin';
    const derivedName = localPart.charAt(0).toUpperCase() + localPart.slice(1);
    const created = await createUser({
      google_id: null,
      email,
      name: derivedName,
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

/**
 * Ensure the admin account has at least ADMIN_MIN_CREDIT_MINUTES worth of
 * credits. If not, insert a 'bonus' ledger entry that brings it back up to
 * that floor. Idempotent-enough: on a healthy deploy the balance is already
 * at/above the floor so this is a no-op. On a wiped deploy (SQLite lost on
 * Railway redeploy) the balance reads zero and we restore it automatically.
 *
 * This does NOT restore other users' balances — only the admin. For a full
 * multi-user persistence fix the DB itself must sit on a Railway Volume
 * or move to Postgres via DATABASE_URL (both already supported by the app).
 */
async function healAdminCredits() {
  const email = (process.env.ADMIN_BOOTSTRAP_EMAIL || DEFAULT_ADMIN_EMAIL).trim().toLowerCase();
  const envFloor = Number(process.env.ADMIN_MIN_CREDIT_MINUTES);
  const floor = Number.isFinite(envFloor) && envFloor >= 0 ? Math.floor(envFloor) : DEFAULT_ADMIN_MIN_CREDITS;

  try {
    const user = await getUserByEmail(email);
    if (!user) {
      const r = { healed: false, reason: 'admin user missing', email, floor };
      lastCreditHealResult = { ranAt: new Date().toISOString(), result: r };
      console.warn(`[adminBootstrap] credit heal skipped — admin user not found (${email})`);
      return r;
    }
    const current = await getCreditsBalance(user.id);
    if (current >= floor) {
      const r = { healed: false, reason: 'already above floor', email, userId: user.id, current, floor };
      lastCreditHealResult = { ranAt: new Date().toISOString(), result: r };
      return r;
    }
    const delta = floor - current;
    const res = await addCreditsTransaction({
      userId: user.id,
      deltaMinutes: delta,
      kind: 'bonus',
      note: `admin auto-heal @boot (floor=${floor}, was=${current})`,
    });
    console.log(`[adminBootstrap] credit auto-heal: granted ${delta} min to ${email} (new balance=${res.balance})`);
    const r = { healed: true, email, userId: user.id, previous: current, floor, granted: delta, balance: res.balance };
    lastCreditHealResult = { ranAt: new Date().toISOString(), result: r };
    return r;
  } catch (err) {
    console.error('[adminBootstrap] credit heal failed:', err && err.message);
    const r = { healed: false, error: err && err.message, email, floor };
    lastCreditHealResult = { ranAt: new Date().toISOString(), result: r };
    return r;
  }
}

function getLastCreditHealResult() {
  return lastCreditHealResult;
}

module.exports = {
  bootstrapAdmin,
  getLastBootstrapResult,
  healAdminCredits,
  getLastCreditHealResult,
};
