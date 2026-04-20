'use strict';

// Shared "peek at JWT if present" helpers used by public endpoints that
// behave differently for guests vs. signed-in users vs. admins, but must
// NOT 401 a guest. Previously each route duplicated this logic; the
// duplicates drifted (PR #64 had to re-apply the numeric-sub guard in
// three places). This module is the single source of truth.

const jwt = require('jsonwebtoken');
const config = require('../config');
const { findById } = require('../db');

// Read `req.cookies['kelion.token']` or an `Authorization: Bearer …`
// header. Returns `{ id, name, email }` on success or null on any
// failure — including stale pre-Postgres JWTs whose `sub` is a UUID /
// credential hash that would blow up BIGINT user-id columns.
function peekSignedInUser(req) {
  try {
    let token = req.cookies?.['kelion.token'];
    if (!token) {
      const auth = req.headers?.authorization || '';
      if (auth.startsWith('Bearer ')) token = auth.slice(7).trim();
    }
    if (!token) return null;
    const decoded = jwt.verify(token, config.jwt.secret);
    const USE_POSTGRES = !!process.env.DATABASE_URL;
    if (USE_POSTGRES) {
      const sub = decoded.sub;
      const numeric = Number.parseInt(sub, 10);
      if (!Number.isFinite(numeric) || String(numeric) !== String(sub)) {
        return null;
      }
      return { id: numeric, name: decoded.name, email: decoded.email };
    }
    return { id: decoded.sub, name: decoded.name, email: decoded.email };
  } catch {
    return null;
  }
}

// True if the user doc is an admin. Mirrors requireAdmin's rules:
//   1. DB role === 'admin' (authoritative in the Postgres path)
//   2. email in process.env.ADMIN_EMAILS (comma-separated)
//   3. email is the hard-coded default owner (adrianenc11@gmail.com)
// Accepts a user from peekSignedInUser() OR req.user. Returns false
// for null/undefined / malformed inputs — never throws.
async function isAdminUser(user) {
  if (!user) return false;
  try {
    const dbUser = await findById(user.id);
    if (dbUser && dbUser.role === 'admin') return true;
  } catch (_) {
    /* fall through */
  }
  const defaultAdmins = ['adrianenc11@gmail.com'];
  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  const all = new Set([...defaultAdmins, ...adminEmails]);
  return !!(user.email && all.has(user.email.toLowerCase()));
}

// Express middleware flavour — attaches `req.user` (same shape as
// requireAuth produces) when a valid JWT is present but NEVER 401s. Use
// this on routes that serve both guests and signed-in users (e.g. the
// text chat endpoint, which now gates guests via the shared trial
// quota instead of blanket-rejecting them).
function softAuth(req, res, next) {
  try {
    const user = peekSignedInUser(req);
    if (user) {
      req.user = {
        id:    user.id,
        email: user.email,
        name:  user.name,
        // role is filled in by the caller if it cares — the peek helper
        // deliberately skips DB lookup to stay cheap.
      };
    }
  } catch (_) { /* never block guests */ }
  next();
}

module.exports = { peekSignedInUser, isAdminUser, softAuth };
