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

// ip -> { firstStampAt: number }
const trialUsage = new Map();

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
  trialUsage.set(ip, { firstStampAt: Date.now() });
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
