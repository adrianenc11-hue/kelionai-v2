'use strict';

// Guest trial quota — two-layer IP-based gating.
//
// Layer 1 (daily):     15 minutes of Kelion per IP per 24 hours,
//                      shared across voice chat (Gemini Live) AND
//                      text chat (/api/chat) AND TTS (/api/tts).
//
// Layer 2 (lifetime):  after 7 calendar days from the FIRST EVER stamp
//                      the IP is hard-blocked. Adrian: "free fara credit
//                      15 min/zi, maxim 1 saptamina". After the week is
//                      up the user MUST create an account + buy credits.
//
// Adrian's flow:
//   - First request from an IP → firstEverStampAt + firstStampAt = now.
//     15-min countdown starts.
//   - Fresh daily request (24h after firstStampAt): cooldown elapsed →
//     we reset firstStampAt ONLY if we're still within the 7-day
//     lifetime window. That gives the user another 15-min chunk today.
//   - Day 8+: trialStatus() returns { allowed:false, reason:'lifetime_expired' }
//     until the user signs in (skips this helper entirely) or 7 days
//     pass without any use (in which case the entry gets evicted by
//     evictExpired() and the IP is fresh again).
//
// State: in-memory Map<ip, { firstEverStampAt, firstStampAt }>.
// Single-instance assumption: Railway currently runs one process so
// the map is sufficient. When we scale to N instances this must move
// to Redis / a database table keyed on IP.
//
// Signed-in users (admin or paying) are not subject to this helper
// at all; callers check isGuest first and only invoke us for
// unauthenticated IPs.

const TRIAL_WINDOW_MS   = 15 * 60 * 1000;            // 15 min per day
const TRIAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;       // 24 h between windows
const TRIAL_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;   // 7 days total guest access per IP
// Hard cap to prevent unbounded growth (Copilot review pr-74). Entries
// past the lifetime window are evicted by trialStatus() on read, but a
// stream of unique IPs that never re-visit would never hit that path.
// When we exceed MAX_ENTRIES we drop the oldest firstEverStampAt.
const MAX_ENTRIES = 50_000;

// ip -> { firstEverStampAt: number, firstStampAt: number }
const trialUsage = new Map();

// Adrian wants the 7-day cap to be HARD ("maxim 1 saptamina"). After the
// lifetime window elapses the IP must stay blocked — we do NOT auto-evict
// it just because the week is up, otherwise a guest could wait 7 days and
// get a brand new 7-day trial, defeating the cap. Memory pressure is
// handled by enforceCap() (LRU at MAX_ENTRIES entries).
function evictExpired(_now) {
  // Intentional no-op. Kept as a named hook so future callers (e.g. a
  // diagnostic "reset-my-trial" admin endpoint) have a single choke point.
}

function enforceCap() {
  if (trialUsage.size <= MAX_ENTRIES) return;
  // Maps preserve insertion order. Drop the oldest entries until we're
  // back under the cap. Safe because we only insert on first stamp and
  // refresh daily chunks in-place — so oldest == most-expired.
  const excess = trialUsage.size - MAX_ENTRIES;
  const it = trialUsage.keys();
  for (let i = 0; i < excess; i += 1) {
    const k = it.next().value;
    if (k !== undefined) trialUsage.delete(k);
  }
}

// trialStatus(ip) — returns the current state for an IP WITHOUT
// mutating the store. Callers render a countdown from this and then
// optionally call stampTrialIfFresh() to mark the start of the
// 15-minute window on the first real interaction.
//
// Shape:
//   { allowed: true,  remainingMs, fresh: bool, lifetimeRemainingMs }
//   { allowed: false, reason: 'window_expired',   remainingMs: 0, nextWindowMs }
//   { allowed: false, reason: 'lifetime_expired', remainingMs: 0, lifetimeRemainingMs: 0 }
function trialStatus(ip) {
  if (!ip) {
    // Defensive: no IP means we can't track reliably → allow.
    return {
      allowed: true,
      remainingMs: TRIAL_WINDOW_MS,
      lifetimeRemainingMs: TRIAL_LIFETIME_MS,
      fresh: false,
    };
  }
  const now = Date.now();
  const rec = trialUsage.get(ip);
  if (!rec) {
    return {
      allowed: true,
      remainingMs: TRIAL_WINDOW_MS,
      lifetimeRemainingMs: TRIAL_LIFETIME_MS,
      fresh: true,
    };
  }

  // Lifetime check first: if the 7-day window since the very first stamp
  // has elapsed, the IP is permanently blocked until the MAX_ENTRIES LRU
  // eventually evicts it under memory pressure. This is Adrian's "maxim
  // 1 saptamina" cap — after a week of free access the guest MUST sign
  // in + buy credits to keep using Kelion from this IP.
  const sinceEver = now - rec.firstEverStampAt;
  if (sinceEver >= TRIAL_LIFETIME_MS) {
    return {
      allowed:             false,
      reason:              'lifetime_expired',
      remainingMs:         0,
      lifetimeRemainingMs: 0,
      fresh:               false,
    };
  }
  const lifetimeRemainingMs = TRIAL_LIFETIME_MS - sinceEver;

  const sinceFirst = now - rec.firstStampAt;
  if (sinceFirst >= TRIAL_COOLDOWN_MS) {
    // Daily cooldown is up and we're still within the 7-day lifetime —
    // start a fresh 15-min window.
    return {
      allowed: true,
      remainingMs: TRIAL_WINDOW_MS,
      lifetimeRemainingMs,
      fresh: true,
    };
  }
  if (sinceFirst < TRIAL_WINDOW_MS) {
    return {
      allowed:             true,
      remainingMs:         TRIAL_WINDOW_MS - sinceFirst,
      lifetimeRemainingMs,
      fresh:               false,
    };
  }
  return {
    allowed:             false,
    reason:              'window_expired',
    remainingMs:         0,
    nextWindowMs:        TRIAL_COOLDOWN_MS - sinceFirst,
    lifetimeRemainingMs,
    fresh:               false,
  };
}

// stampTrialIfFresh(ip, status) — call this AFTER trialStatus() when
// we've decided to let the request through and it's the first time we
// see this IP (either brand new, or the daily cooldown elapsed). No-op
// if the IP is already stamped within the current window.
function stampTrialIfFresh(ip, status) {
  if (!ip || !status.fresh) return;
  const now = Date.now();
  const existing = trialUsage.get(ip);
  if (existing) {
    // Daily refresh inside the 7-day lifetime — keep firstEverStampAt,
    // reset firstStampAt to now for a new 15-min chunk.
    existing.firstStampAt = now;
  } else {
    trialUsage.set(ip, { firstEverStampAt: now, firstStampAt: now });
  }
  // Opportunistic sweep on writes — cheap when the map is small and
  // keeps it bounded under adversarial unique-IP load (Copilot review).
  if (trialUsage.size > MAX_ENTRIES / 2) evictExpired(now);
  enforceCap();
}

// Test / diagnostic helper — wipe everything. Not wired to any route.
function _resetForTest() {
  trialUsage.clear();
}

module.exports = {
  TRIAL_WINDOW_MS,
  TRIAL_COOLDOWN_MS,
  TRIAL_LIFETIME_MS,
  trialStatus,
  stampTrialIfFresh,
  _resetForTest,
};
