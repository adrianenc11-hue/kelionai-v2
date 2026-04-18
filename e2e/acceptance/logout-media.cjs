#!/usr/bin/env node
'use strict';

/**
 * ACCEPTANCE: logout-media — OUT OF SCOPE in Kelion (Stages 1–6).
 *
 * The old flow tested that hitting "Log out" terminated any active
 * mic/camera streams. The Kelion rebuild has no visible logout button
 * for anonymous guests (there is no login for them), and signed-in
 * users do have a "Sign out" item in the ⋯ menu but the audio/video
 * teardown happens in the existing `endSession()` path of
 * src/lib/geminiLive.js — which is automatic when the page state
 * changes, not conditioned on an explicit logout UI.
 *
 * There is no longer a separate "logout terminates media" contract
 * to assert against; it is folded into session-end teardown, which
 * is covered by the component tests on VoiceChat.jsx. Stub kept to
 * satisfy required branch-protection status; DELIVERY_CONTRACT.md
 * lists this as out of scope for static acceptance.
 */

console.log('[acceptance:logout-media] OUT OF SCOPE — no dedicated logout UI in Kelion; media teardown folded into endSession().');
console.log('[acceptance:logout-media] See DELIVERY_CONTRACT.md § Capabilities deliberately out of scope.');
process.exit(0);
