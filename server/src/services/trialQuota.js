'use strict';

// Guest trial quota — 15 minutes of Kelion per IP per 24 hours,
// shared across voice chat (Gemini Live) AND text chat (/api/chat).
//
// Adrian: "timer pleaca pe buton microfon = gresit, timer este doar
// pentru user free, pina la logare. La chat scris […] aplica si la
// chat scris aceleasi reguli". The timer must not be gated on the
// mic button; it must apply to every guest interaction and tick down
// as soon as the user starts using the app.
//
// State: in-memory Map<ip, { firstStampAt }>. We stamp on the first
// gated request (voice OR text). The next 15 min return remaining
// allowance; after that we deny with 429 until the 24-hour cooldown
// elapses and the IP is reset.
//
// Single-instance assumption: Railway currently runs one process so
// the map is sufficient. When we scale to N instances this must move
// to Redis / a database table keyed on IP.
//
// Signed-in users (admin or paying) are not subject to this helper
// at all; callers check isGuest first and only invoke us for
// unauthenticated IPs.

const TRIAL_WINDOW_MS   = 15 * 60 * 1000;       // 15 min per day
const TRIAL_COOLDOWN_MS = 24 * 60 * 60 * 1000;  // 24 h between windows
// Hard cap to prevent unbounded growth (Copilot review pr-74). Entries
// past the 24-hour cooldown are normally evicted by trialStatus() on
// read, but a stream of unique IPs that never re-visit would never hit
// that path. When we exceed MAX_ENTRIES we drop the oldest firstStampAt
// (naturally it's also the one closest to / past its cooldown).
const MAX_ENTRIES = 50_000;

// ip -> { firstStampAt: number }
const trialUsage = new Map();

function evictExpired(now) {
  for (const [ip, rec] of trialUsage) {
    if (now - rec.firstStampAt >= TRIAL_COOLDOWN_MS) {
      trialUsage.delete(ip);
    }
  }
}

function enforceCap() {
  if (trialUsage.size <= MAX_ENTRIES) return;
  // Maps preserve insertion order. Drop the oldest entries until we're
  // back under the cap. Safe because we only insert on stamp and never
  // rewrite — so oldest == most-expired.
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
function trialStatus(ip) {
  if (!ip) {
    // Defensive: no IP means we can't track reliably → allow.
    return { allowed: true, remainingMs: TRIAL_WINDOW_MS, fresh: false };
  }
  const now = Date.now();
  const rec = trialUsage.get(ip);
  if (!rec) {
    return { allowed: true, remainingMs: TRIAL_WINDOW_MS, fresh: true };
  }
  const sinceFirst = now - rec.firstStampAt;
  if (sinceFirst >= TRIAL_COOLDOWN_MS) {
    trialUsage.delete(ip);
    return { allowed: true, remainingMs: TRIAL_WINDOW_MS, fresh: true };
  }
  if (sinceFirst < TRIAL_WINDOW_MS) {
    return {
      allowed:     true,
      remainingMs: TRIAL_WINDOW_MS - sinceFirst,
      fresh:       false,
    };
  }
  return {
    allowed:       false,
    remainingMs:   0,
    nextWindowMs:  TRIAL_COOLDOWN_MS - sinceFirst,
    fresh:         false,
  };
}

// stampTrialIfFresh(ip, status) — call this AFTER trialStatus() when
// we've decided to let the request through and it's the first time we
// see this IP. No-op if the IP is already stamped within the current
// window. This is what starts the 15-minute countdown.
function stampTrialIfFresh(ip, status) {
  if (!ip || !status.fresh) return;
  const now = Date.now();
  trialUsage.set(ip, { firstStampAt: now });
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
  trialStatus,
  stampTrialIfFresh,
  _resetForTest,
};
