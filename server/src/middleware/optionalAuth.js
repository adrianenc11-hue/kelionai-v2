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
    // Previously in Postgres mode we returned null for any non-numeric
    // `sub` (pre-Postgres Google UUIDs, etc.), which silently demoted
    // a signed-in admin to "guest" on every public endpoint — including
    // /api/realtime/gemini-token, triggering the 429 "Free trial used
    // up" gate on an admin with unlimited credits. Adrian 2026-04-20:
    // "admin nu expira nici o data, ai inca un bag". The public-endpoint
    // surface must honour the JWT's email + role claims regardless of
    // what the DB looks like — downstream routes that need a numeric id
    // (credits ledger, etc.) can still DB-lookup themselves. Always
    // return a user object when the JWT is cryptographically valid.
    return {
      id:    decoded.sub,
      name:  decoded.name,
      email: decoded.email,
      role:  decoded.role || 'user',
    };
  } catch {
    return null;
  }
}

// True if the user doc is an admin. Mirrors requireAdmin's rules:
//   1. JWT role === 'admin' (fast path — no DB lookup)
//   2. email in process.env.ADMIN_EMAILS or the hard-coded default
//      (adrianenc11@gmail.com) — also fast path
//   3. DB role === 'admin' (authoritative, checked as a last-ditch
//      fallback when the JWT has neither the role claim nor a known
//      admin email; this covers legacy tokens issued before we added
//      the role claim)
// The first two branches deliberately DO NOT call the DB so that a
// wiped user row (ephemeral-storage regression) cannot lock the admin
// out of the admin-only code path. Accepts a user from
// peekSignedInUser() OR req.user. Returns false for null/undefined
// inputs — never throws.
async function isAdminUser(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const defaultAdmins = ['adrianenc11@gmail.com'];
  const adminEmails = (process.env.ADMIN_EMAILS || '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  const all = new Set([...defaultAdmins, ...adminEmails]);
  if (user.email && all.has(user.email.toLowerCase())) return true;
  try {
    const dbUser = await findById(user.id);
    if (dbUser && dbUser.role === 'admin') return true;
    if (dbUser && dbUser.email && all.has(String(dbUser.email).toLowerCase())) return true;
  } catch (_) { /* fall through */ }
  return false;
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
