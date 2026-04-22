'use strict';

// PR E5 — ban enforcement.
//
// `requireAuth` / `optionalAuth` can't afford a DB round-trip on every
// authenticated request, so we cache the `banned` bit per-user-id with
// a short TTL. A fresh ban propagates within `TTL_MS` (60s), which is
// fast enough for moderation and slow enough to keep the hot path
// cheap. Admin-initiated ban flips also call `invalidate(userId)` so
// the ban takes effect on the very next request for that user.

const { findById } = require('../db');

const TTL_MS = 60 * 1000;
const cache = new Map(); // userId -> { banned, reason, at }

function invalidate(userId) {
  if (userId === null || userId === undefined) return;
  cache.delete(String(userId));
}

function isBanned(userOrNull) {
  // Synchronous fast-path for places that already have a ban flag in
  // hand (e.g. the admin UI just loaded the row). Not used in the
  // middleware — see `resolveBanStatus` below.
  if (!userOrNull) return false;
  return Number(userOrNull.banned) === 1;
}

async function resolveBanStatus(userId) {
  if (userId === null || userId === undefined) {
    return { banned: false, reason: null };
  }
  const key = String(userId);
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < TTL_MS) {
    return { banned: cached.banned, reason: cached.reason };
  }
  let banned = false;
  let reason = null;
  try {
    const row = await findById(userId);
    if (row) {
      banned = Number(row.banned) === 1;
      reason = row.banned_reason || null;
    }
  } catch (_) {
    // DB error — fail open. An accidental ban is worse than a missed
    // ban for one cache interval.
  }
  cache.set(key, { banned, reason, at: Date.now() });
  return { banned, reason };
}

function _clearAllForTests() {
  cache.clear();
}

module.exports = {
  invalidate,
  isBanned,
  resolveBanStatus,
  _clearAllForTests,
  _TTL_MS: TTL_MS,
};
