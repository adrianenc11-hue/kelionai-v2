#!/usr/bin/env node
'use strict';

/**
 * ACCEPTANCE: voice-roundtrip
 *
 * Kelion is "Alive" (Stage 1) only if a real user — with no account —
 * can open https://kelionai.app, tap-to-talk, and receive Gemini Live
 * audio back. This acceptance script validates the server-side
 * precondition for that flow: the ephemeral-token endpoint must mint
 * a valid token that the browser can use to open a WebSocket to
 * Google's Live API.
 *
 * What this script asserts:
 *
 *   1. /health is reachable on https://kelionai.app and reports
 *      services.gemini === "configured". This is necessary because
 *      without GEMINI_API_KEY the ephemeral-token endpoint correctly
 *      short-circuits with HTTP 503.
 *
 *   2. GET /api/realtime/gemini-token returns HTTP 200 with a
 *      response body that matches the shape the browser needs:
 *
 *        { token: string (non-empty, starts with "auth_tokens/"),
 *          expiresAt: ISO-8601 string that is in the future,
 *          model: string (non-empty),
 *          provider: "gemini",
 *          voice: string (non-empty),
 *          voiceStyle: string (non-empty) }
 *
 *      A token minted by Google is a handle of the form
 *      "auth_tokens/<id>" that the browser swaps for a live WebSocket.
 *      If this call returns 500, tap-to-talk is broken end-to-end for
 *      every user — fail here.
 *
 * What this script does NOT assert:
 *
 *   - Actual audio flowing in and out of the browser. That requires
 *     Playwright with --use-fake-device-for-media-stream +
 *     --use-file-for-fake-audio-capture, which is a separate test
 *     harness. Keeping this script lean lets it run in CI on every
 *     push without needing Chromium on the runner.
 *
 * A real token means: server has GEMINI_API_KEY, the model name
 * exists in Google's Live API, the request body is accepted, and
 * Google's auth_tokens endpoint is healthy. That is the operative
 * definition of "Kelion can speak" on the server side.
 */

const BASE = process.env.ACCEPTANCE_BASE || 'https://kelionai.app';

function fail(reason, detail) {
  process.stderr.write('ACCEPTANCE FAIL: voice-roundtrip\n');
  process.stderr.write('  reason: ' + reason + '\n');
  if (detail) process.stderr.write('  detail: ' + detail + '\n');
  process.exit(1);
}

async function getJson(path) {
  const r = await fetch(BASE + path);
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch (_) { /* body may be non-JSON */ }
  return { status: r.status, body, text };
}

(async () => {
  // 1. /health must be green and advertise Gemini as configured.
  const health = await getJson('/health');
  if (health.status !== 200) {
    return fail('/health not 200', 'status=' + health.status + ' body=' + health.text.slice(0, 400));
  }
  const gemini = health.body?.services?.gemini;
  if (gemini !== 'configured') {
    return fail(
      '/health reports services.gemini != "configured"',
      'services=' + JSON.stringify(health.body?.services || null),
    );
  }

  // 2. /api/realtime/gemini-token must mint a valid ephemeral token.
  const token = await getJson('/api/realtime/gemini-token');
  if (token.status !== 200) {
    return fail(
      'gemini-token did not return 200',
      'status=' + token.status + ' body=' + token.text.slice(0, 400),
    );
  }

  const body = token.body || {};
  if (!body.token || typeof body.token !== 'string') {
    return fail('gemini-token response missing string "token"', JSON.stringify(body));
  }
  if (!body.token.startsWith('auth_tokens/')) {
    return fail('gemini-token "token" does not look like a Google auth_tokens handle', 'got=' + body.token);
  }
  if (!body.expiresAt) {
    return fail('gemini-token response missing "expiresAt"', JSON.stringify(body));
  }
  const exp = Date.parse(body.expiresAt);
  if (Number.isNaN(exp) || exp <= Date.now()) {
    return fail('gemini-token "expiresAt" is not a future ISO-8601 timestamp', 'got=' + body.expiresAt);
  }
  if (body.provider !== 'gemini') {
    return fail('gemini-token "provider" is not "gemini"', 'got=' + body.provider);
  }
  if (!body.model || typeof body.model !== 'string') {
    return fail('gemini-token response missing string "model"', JSON.stringify(body));
  }
  if (!body.voice || typeof body.voice !== 'string') {
    return fail('gemini-token response missing string "voice"', JSON.stringify(body));
  }
  if (!body.voiceStyle || typeof body.voiceStyle !== 'string') {
    return fail('gemini-token response missing string "voiceStyle"', JSON.stringify(body));
  }

  // Everything the browser needs to open Gemini Live is present.
  process.stdout.write('ACCEPTANCE PASS: voice-roundtrip\n');
  process.stdout.write('  base:       ' + BASE + '\n');
  process.stdout.write('  model:      ' + body.model + '\n');
  process.stdout.write('  voice:      ' + body.voice + '\n');
  process.stdout.write('  voiceStyle: ' + body.voiceStyle + '\n');
  process.stdout.write('  expiresAt:  ' + body.expiresAt + '\n');
  process.stdout.write('  tokenType:  ' + body.token.split('/')[0] + '/…\n');
})().catch(err => {
  process.stderr.write('ACCEPTANCE FAIL: voice-roundtrip (script error)\n');
  process.stderr.write('  ' + (err && err.stack ? err.stack : String(err)) + '\n');
  process.exit(2);
});
