#!/usr/bin/env node
'use strict';

/**
 * ACCEPTANCE: language-mirror — OUT OF SCOPE as an explicit UI flow.
 *
 * In the old product, the "language mirror" capability validated a
 * language picker + locale-sync UI. The Kelion rebuild removed the
 * picker — Gemini 3.1 Flash Live natively detects the user's spoken
 * language on every utterance and replies in it, per the persona rules
 * baked into the ephemeral token (server/src/routes/realtime.js
 * buildKelionPersona § "Language (strict)").
 *
 * There is no dedicated UI to assert against any more. The behavior
 * now lives inside Gemini's response to live audio, which this static
 * HTTP script cannot exercise. Stub kept to report status to GitHub
 * branch protection; DELIVERY_CONTRACT.md lists this capability as
 * out of scope for static acceptance.
 */

console.log('[acceptance:language-mirror] OUT OF SCOPE — language picker UI removed; Gemini Live detects language at audio time.');
console.log('[acceptance:language-mirror] See DELIVERY_CONTRACT.md § Capabilities deliberately out of scope.');
process.exit(0);
