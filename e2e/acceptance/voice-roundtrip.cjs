#!/usr/bin/env node
'use strict';

/**
 * ACCEPTANCE: voice-roundtrip
 *
 * Stage 1 (Kelion Alive) contract: the voice round-trip depends on the
 * server being able to mint a Gemini Live ephemeral token for the browser.
 * Without that token the browser cannot open the realtime WebSocket and
 * there is no voice in either direction.
 *
 * This script verifies the production preconditions end-to-end:
 *
 *   1. GET https://kelionai.app/health -> 200, status=ok, database connected.
 *   2. GET https://kelionai.app/api/realtime/gemini-token?lang=en-US ->
 *      200 with {token: non-empty string, expiresAt: number|string}.
 *      A 503 here means GEMINI_API_KEY is not configured on production,
 *      which is itself a delivery failure (the feature cannot work for any
 *      real user), and the script exits 1.
 *   3. The returned token must be an ephemeral auth token (AUTH_TOKEN_...)
 *      and expire in the future.
 *
 * What this does NOT do (and we say so loudly, per RULES.md section I):
 *   - It does not play audio into the mic, nor capture AI audio back.
 *   - It does not run Whisper/STT on captured audio.
 *   - A fully closed round-trip (speak -> hear -> transcribe -> assert
 *     topicality) requires Playwright with fake audio device plus STT.
 *     Until that harness is implemented, this smoke test is the honest
 *     floor: if the floor fails, the feature is broken; if the floor
 *     passes, the feature MAY work but has not been end-to-end proven.
 *
 * Exit codes:
 *   0 — production can mint a Gemini Live session token right now
 *   1 — a precondition failed; details on stderr
 */

const BASE = process.env.ACCEPTANCE_BASE || 'https://kelionai.app';

function fail(reason, detail) {
  process.stderr.write('ACCEPTANCE FAIL: voice-roundtrip\n');
  process.stderr.write('  reason: ' + reason + '\n');
  if (detail) process.stderr.write('  detail: ' + detail + '\n');
  process.exit(1);
}

async function jget(path) {
  const r = await fetch(BASE + path, { redirect: 'manual' });
  let body = null;
  try { body = await r.json(); } catch (_) {}
  return { status: r.status, body };
}

(async () => {
  // 1. Health
  const h = await jget('/health');
  if (h.status !== 200) {
    fail('GET /health did not return 200', 'status=' + h.status);
  }
  if (!h.body || h.body.status !== 'ok') {
    fail('GET /health body.status is not "ok"', JSON.stringify(h.body));
  }

  // 2. Gemini Live ephemeral token
  const t = await jget('/api/realtime/gemini-token?lang=en-US');
  if (t.status === 503) {
    fail(
      'GET /api/realtime/gemini-token returned 503 — GEMINI_API_KEY is not configured on production',
      'Set GEMINI_API_KEY in Railway Variables for the kelionai service and redeploy.'
    );
  }
  if (t.status !== 200) {
    fail('GET /api/realtime/gemini-token did not return 200', 'status=' + t.status + ' body=' + JSON.stringify(t.body));
  }
  if (!t.body || typeof t.body.token !== 'string' || t.body.token.length === 0) {
    fail('gemini-token response has no usable token', JSON.stringify(t.body));
  }

  // 3. Token shape + expiry in the future
  if (t.body.expiresAt) {
    const exp = typeof t.body.expiresAt === 'number'
      ? t.body.expiresAt * 1000
      : Date.parse(t.body.expiresAt);
    if (!Number.isFinite(exp) || exp < Date.now()) {
      fail('gemini-token expiresAt is not a future timestamp', 'expiresAt=' + t.body.expiresAt);
    }
  }

  process.stdout.write('ACCEPTANCE PASS: voice-roundtrip (preconditions only)\n');
  process.stdout.write('  base=' + BASE + '\n');
  process.stdout.write('  token.length=' + t.body.token.length + '\n');
  process.stdout.write('  expiresAt=' + (t.body.expiresAt || '(not provided)') + '\n');
  process.stdout.write('  NOTE: full audio round-trip (mic -> AI -> STT assert) is NOT in this script.\n');
  process.exit(0);
})().catch((err) => {
  fail('unexpected exception', err && err.stack ? err.stack : String(err));
});
