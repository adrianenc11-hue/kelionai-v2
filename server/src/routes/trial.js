'use strict';

// GET /api/trial/status — client polls this to drive the "Free trial · MM:SS
// left" HUD in the top-right. Read-only (never stamps). Returns:
//   {
//     applicable: boolean   // false for signed-in / admin users; true for guests
//     allowed:    boolean   // false only when quota exhausted
//     reason?:    string    // 'window_expired' | 'lifetime_expired' when !allowed
//     remainingMs: number   // 0..TRIAL_WINDOW_MS (this-day allowance)
//     windowMs:    number   // TRIAL_WINDOW_MS (for % progress bars)
//     stamped:     boolean  // whether the 15-min countdown has started yet
//     nextWindowMs?: number // time until the 24h cooldown resets the IP
//     lifetimeRemainingMs?: number  // 0..7d — how much of the 7-day free
//                                   //          access still available
//     lifetimeMs:  number   // total lifetime window (7 days) for % UI
//   }
//
// The countdown is kicked off only by a real interaction (first text
// message or Tap-to-talk). Until then the HUD shows the full allowance
// but does not tick — `stamped: false` tells the client that.
//
// `lifetime_expired` is the signal for the client to swap the HUD for a
// "Create account to continue" CTA — Adrian: "free fara credit 15 min/zi,
// maxim 1 saptamina. Dupa ce iti faci user [...] da mesaj ca trebuie
// cumparat credit".

const { Router } = require('express');
const ipGeo = require('../services/ipGeo');
const { peekSignedInUser } = require('../middleware/optionalAuth');
const {
  TRIAL_WINDOW_MS,
  TRIAL_LIFETIME_MS,
  trialStatus,
} = require('../services/trialQuota');

const router = Router();

router.get('/status', (req, res) => {
  // Anyone with a valid JWT — admin OR regular — is not subject to the
  // guest trial, so we don't need the admin DB lookup here (Copilot
  // review pr-74): `applicable: false` is identical for both.
  const user = peekSignedInUser(req);
  if (user) {
    return res.json({
      applicable:          false,
      allowed:             true,
      remainingMs:         TRIAL_WINDOW_MS,
      windowMs:            TRIAL_WINDOW_MS,
      lifetimeMs:          TRIAL_LIFETIME_MS,
      lifetimeRemainingMs: TRIAL_LIFETIME_MS,
      stamped:             false,
    });
  }
  const ip = ipGeo.clientIp(req) || req.ip || '';
  const status = trialStatus(ip);
  return res.json({
    applicable:   true,
    allowed:      status.allowed,
    remainingMs:  status.remainingMs,
    windowMs:     TRIAL_WINDOW_MS,
    lifetimeMs:   TRIAL_LIFETIME_MS,
    lifetimeRemainingMs: status.lifetimeRemainingMs,
    stamped:      !status.fresh && status.allowed, // already ticking
    ...(status.reason      ? { reason: status.reason } : {}),
    ...(status.nextWindowMs != null ? { nextWindowMs: status.nextWindowMs } : {}),
  });
});

module.exports = router;
