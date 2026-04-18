#!/usr/bin/env node
'use strict';

/**
 * ACCEPTANCE: language-switch — OUT OF SCOPE as an explicit UI flow.
 *
 * In the old product, this tested a language-switch button + state
 * transition. The Kelion rebuild removed the button; the switch now
 * happens naturally inside Gemini 3.1 Flash Live — the persona
 * explicitly instructs the model to switch languages on the next turn
 * whenever the user switches mid-conversation (server/src/routes/
 * realtime.js buildKelionPersona § "Language (strict)" rule 2).
 *
 * Like language-mirror, this behavior cannot be asserted from a static
 * HTTP probe and is not a UI any more. Stub kept to satisfy required
 * branch-protection status report. See DELIVERY_CONTRACT.md.
 */

console.log('[acceptance:language-switch] OUT OF SCOPE — switch happens inside Gemini Live, no UI to assert.');
console.log('[acceptance:language-switch] See DELIVERY_CONTRACT.md § Capabilities deliberately out of scope.');
process.exit(0);
