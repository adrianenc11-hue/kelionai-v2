'use strict';

// Shared "peek at JWT if present" helpers used by public endpoints that
// behave differently for guests vs. signed-in users vs. admins, but must
// NOT 401 a guest. Previously each route duplicated this logic; the
// duplicates drifted (PR #64 had to re-apply the numeric-sub guard in
// three places). This module is the single source of truth.
//
// 2026-04-20 — admin identity audit (F1+F2). Before this rewrite:
//   • `peekSignedInUser` returned null whenever the JWT `sub` was not a
//     numeric string in Postgres mode, which silently nuked admins who
//     signed in with a pre-Postgres UUID cookie.
//   • `isAdminUser` consulted only the DB row + email allowlist and
//     ignored the JWT's own `role: 'admin'` claim.
// Result: HUD rendered "Admin · ∞" (the permissive `/auth/passkey/me`
// path), but `/gemini-token` + `/openai-live-token` fell into the guest
// branch and 429'd after the 15-min IP trial window.
//
// New contract:
//   • peekSignedInUser → full identity every time the JWT verifies,
//     including raw `sub`, `role`, and a numeric `id` that is null when
//     the sub isn't a BIGINT. Downstream callers guard DB lookups with
//     `Number.isFinite(user.id)` and admin-gate purely on email/role.
//   • isAdminUser → accepts the richer shape or a req; OR of
//     (JWT role) ∨ (JWT email allowlist) ∨ (DB role) ∨ (DB email
//     allowlist). Matches `requireAdmin` in middleware/auth.js so the
//     voice-token endpoints and the admin API reach the same verdict
//     for every identity.

const jwt = require('jsonwebtoken');
const config = require('../config');
const { findById } = require('../db');

function getAdminEmailSet() {
  const defaultAdmins = ['adrianenc11@gmail.com'];
  const extra = (process.env.ADMIN_EMAILS || '')
    .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
  return new Set([...defaultAdmins, ...extra]);
}

function isAdminEmail(email) {
  if (!email) return false;
  return getAdminEmailSet().has(String(email).trim().toLowerCase());
}

// Read `req.cookies['kelion.token']` or an `Authorization: Bearer …`
// header. Returns `{ id, name, email, role, sub }` whenever the JWT
// verifies — `id` is a finite number when the `sub` parses as BIGINT,
// otherwise null (callers must guard DB lookups on `Number.isFinite`).
// Returns null only when no token is present or signature verification
// fails.
function peekSignedInUser(req) {
  try {
    let token = req.cookies?.['kelion.token'];
    if (!token) {
      const auth = req.headers?.authorization || '';
      if (auth.startsWith('Bearer ')) token = auth.slice(7).trim();
    }
    if (!token) return null;
    const decoded = jwt.verify(token, config.jwt.secret);
    const sub = decoded.sub;
    const USE_POSTGRES = !!process.env.DATABASE_URL;
    let id = null;
    if (USE_POSTGRES) {
      const n = Number.parseInt(sub, 10);
      if (Number.isFinite(n) && String(n) === String(sub)) id = n;
    } else {
      // SQLite path historically uses the raw sub as a string id — keep
      // that contract so existing callers that do `user.id === '...'`
      // don't regress.
      id = sub;
    }
    return {
      id,
      name:  decoded.name || null,
      email: decoded.email || null,
      role:  decoded.role || null,
      sub,
    };
  } catch {
    return null;
  }
}

// True if the supplied identity is an admin. Mirrors `requireAdmin`
// (middleware/auth.js): OR of JWT role ∨ JWT email allowlist ∨ DB role
// ∨ DB email allowlist. Tolerates `{id: null}` identities — admins with
// a stale pre-Postgres JWT (UUID sub) are still recognized by email.
// Accepts a user object, a raw express `req`, or null (→ false). Never
// throws.
async function isAdminUser(userOrReq) {
  if (!userOrReq) return false;

  // Caller passed `req`? Peek the JWT out of it first.
  let user = userOrReq;
  if (user && !Object.prototype.hasOwnProperty.call(user, 'id') &&
              !Object.prototype.hasOwnProperty.call(user, 'email')) {
    // Heuristic: no `id`/`email` props → treat as a req-like object.
    if (user.cookies || user.headers) user = peekSignedInUser(user);
  }
  if (!user) return false;

  // 1. JWT role claim (cheapest, no DB round-trip).
  if (user.role === 'admin') return true;

  // 2. JWT email against the allowlist. Handles stale-sub admins whose
  //    row was wiped from the DB but who still log in through the admin
  //    email path (Adrian's main recovery vector on 2026-04-20).
  if (isAdminEmail(user.email)) return true;

  // 3. DB lookup — only meaningful when `id` is numeric (BIGINT FK).
  if (Number.isFinite(user.id) || typeof user.id === 'string') {
    try {
      const dbUser = await findById(user.id);
      if (dbUser) {
        if (dbUser.role === 'admin') return true;
        if (isAdminEmail(dbUser.email)) return true;
      }
    } catch (_) { /* fall through — email allowlist already ran */ }
  }

  return false;
}

// Convenience combinator — one call returns both pieces the voice-token
// endpoints care about. Prefer this in new code so future admin-gating
// tweaks only touch one place.
async function resolveIdentity(req) {
  const user = peekSignedInUser(req);
  const isAdmin = await isAdminUser(user);
  return { user, isAdmin };
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
        role:  user.role,
      };
    }
  } catch (_) { /* never block guests */ }
  next();
}

module.exports = {
  peekSignedInUser,
  isAdminUser,
  resolveIdentity,
  softAuth,
  isAdminEmail,
};
