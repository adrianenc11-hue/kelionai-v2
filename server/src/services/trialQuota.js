'use strict';

// Guest trial quota — two-layer IP-based gating.
//
// Layer 1 (daily):     15 minutes of Kelion per IP per 24 hours,
//                      shared across voice chat and
//                      text chat (/api/chat) AND TTS (/api/tts).
//
// Layer 2 (lifetime):  after 7 calendar days from the FIRST EVER stamp
//                      the IP is hard-blocked. Adrian: "free fara credit
//                      15 min/zi, maxim 1 saptamina". After the week is
//                      up the user MUST create an account + buy credits.
//
// State: PostgreSQL `trial_usage` table with in-memory LRU cache.
// The DB is the source of truth — the cache avoids a DB round-trip on
// every WebSocket frame / TTS call. Cache entries are refreshed from DB
// on first access per IP, then kept in sync by stampTrialIfFresh().
//
// Signed-in users (admin or paying) are not subject to this helper
// at all; callers check isGuest first and only invoke us for
// unauthenticated IPs.

const { getDb } = require('../db');

const TRIAL_WINDOW_MS   = parseInt(process.env.TRIAL_WINDOW_MINUTES, 10) * 60 * 1000 || 15 * 60 * 1000;
const TRIAL_COOLDOWN_MS = parseInt(process.env.TRIAL_COOLDOWN_HOURS, 10) * 60 * 60 * 1000 || 24 * 60 * 60 * 1000;
const TRIAL_LIFETIME_MS = parseInt(process.env.TRIAL_LIFETIME_DAYS, 10) * 24 * 60 * 60 * 1000 || 7 * 24 * 60 * 60 * 1000;
const TRIAL_UNLIMITED   = process.env.TRIAL_UNLIMITED === '1';
const MAX_CACHE = 10_000;

// In-memory LRU cache: ip -> { firstEverStampAt, firstStampAt }
const cache = new Map();

function enforceCache() {
  if (cache.size <= MAX_CACHE) return;
  const excess = cache.size - MAX_CACHE;
  const it = cache.keys();
  for (let i = 0; i < excess; i++) {
    const k = it.next().value;
    if (k !== undefined) cache.delete(k);
  }
}

// Load from DB into cache if not already cached.
async function loadFromDb(ip) {
  if (cache.has(ip)) return cache.get(ip);
  const db = getDb();
  if (!db) return null;
  try {
    const row = await db.get(
      'SELECT first_ever_stamp_at, first_stamp_at FROM trial_usage WHERE ip = ?',
      ip,
    );
    if (row) {
      const rec = {
        firstEverStampAt: Number(row.first_ever_stamp_at),
        firstStampAt: Number(row.first_stamp_at),
      };
      cache.set(ip, rec);
      enforceCache();
      return rec;
    }
  } catch (e) {
    console.error('[trialQuota] DB read failed, falling back to fresh:', e.message);
  }
  return null;
}

// Save to DB + cache.
async function saveToDb(ip, rec) {
  cache.set(ip, rec);
  enforceCache();
  const db = getDb();
  if (!db) return;
  try {
    // Upsert: ON CONFLICT works on both SQLite 3.24+ and Postgres.
    await db.run(
      `INSERT INTO trial_usage (ip, first_ever_stamp_at, first_stamp_at)
       VALUES (?, ?, ?)
       ON CONFLICT (ip) DO UPDATE SET
         first_ever_stamp_at = EXCLUDED.first_ever_stamp_at,
         first_stamp_at = EXCLUDED.first_stamp_at`,
      [ip, rec.firstEverStampAt, rec.firstStampAt]
    );
  } catch (e) {
    console.error('[trialQuota] DB write failed:', e.message);
    // Cache still has the record — next deploy will lose it but that's
    // better than crashing the request.
  }
}

// trialStatus(ip) — returns the current state for an IP WITHOUT
// mutating the store. Callers render a countdown from this and then
// optionally call stampTrialIfFresh() to mark the start of the
// 15-minute window on the first real interaction.
async function trialStatus(ip) {
  if (TRIAL_UNLIMITED) {
    return { allowed: true, remainingMs: TRIAL_WINDOW_MS, lifetimeRemainingMs: TRIAL_LIFETIME_MS, fresh: false };
  }
  if (!ip) {
    return {
      allowed: true,
      remainingMs: TRIAL_WINDOW_MS,
      lifetimeRemainingMs: TRIAL_LIFETIME_MS,
      fresh: false,
    };
  }
  const now = Date.now();
  const rec = await loadFromDb(ip);
  if (!rec) {
    return {
      allowed: true,
      remainingMs: TRIAL_WINDOW_MS,
      lifetimeRemainingMs: TRIAL_LIFETIME_MS,
      fresh: true,
    };
  }

  // Lifetime check: 7-day cap.
  const sinceEver = now - rec.firstEverStampAt;
  if (sinceEver >= TRIAL_LIFETIME_MS) {
    return {
      allowed: false,
      reason: 'lifetime_expired',
      remainingMs: 0,
      lifetimeRemainingMs: 0,
      fresh: false,
    };
  }
  const lifetimeRemainingMs = TRIAL_LIFETIME_MS - sinceEver;

  const sinceFirst = now - rec.firstStampAt;
  if (sinceFirst >= TRIAL_COOLDOWN_MS) {
    // Daily cooldown elapsed, still within 7-day lifetime.
    return {
      allowed: true,
      remainingMs: TRIAL_WINDOW_MS,
      lifetimeRemainingMs,
      fresh: true,
    };
  }
  if (sinceFirst < TRIAL_WINDOW_MS) {
    return {
      allowed: true,
      remainingMs: TRIAL_WINDOW_MS - sinceFirst,
      lifetimeRemainingMs,
      fresh: false,
    };
  }
  return {
    allowed: false,
    reason: 'window_expired',
    remainingMs: 0,
    nextWindowMs: TRIAL_COOLDOWN_MS - sinceFirst,
    lifetimeRemainingMs,
    fresh: false,
  };
}

// stampTrialIfFresh(ip, status) — persist the trial start.
async function stampTrialIfFresh(ip, status) {
  if (!ip || !status.fresh) return;
  const now = Date.now();
  const existing = cache.get(ip) || (await loadFromDb(ip));
  if (existing) {
    // Daily refresh — keep firstEverStampAt, reset firstStampAt.
    existing.firstStampAt = now;
    await saveToDb(ip, existing);
  } else {
    await saveToDb(ip, { firstEverStampAt: now, firstStampAt: now });
  }
}

// Test helper.
function _resetForTest() {
  cache.clear();
}

module.exports = {
  TRIAL_WINDOW_MS,
  TRIAL_COOLDOWN_MS,
  TRIAL_LIFETIME_MS,
  trialStatus,
  stampTrialIfFresh,
  _resetForTest,
};
