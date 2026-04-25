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
 *      services.gemini === "configured". Kept as a gate because text
 *      chat + fact extraction still depend on GEMINI_API_KEY even
 *      though the live voice path no longer does.
 *
 *   2. GET /api/realtime/gemini-token returns HTTP 200 with one of
 *      two shapes depending on the resolved backend:
 *
 *      a) Vertex AI (GA, production default since PR #207):
 *           { backend: "vertex",
 *             token: null,                    // proxy authenticates
 *             expiresAt: ISO-8601 in future,
 *             provider: "gemini",
 *             model: string (non-empty),
 *             voice: string (non-empty),
 *             voiceStyle: string (non-empty),
 *             setup: { model: "projects/.../publishers/google/models/...",
 *                      systemInstruction: { parts: [{ text: string }] },
 *                      ... } }
 *         The `setup` frame's `model` must be a fully-qualified Vertex
 *         path (`projects/<P>/locations/<L>/publishers/google/models/<M>`)
 *         — a bare `models/<M>` path is the AI Studio format and the
 *         Vertex BidiGenerateContent endpoint rejects it on the first
 *         frame with close code 1007. If the server falls back to that
 *         format because GOOGLE_CLOUD_PROJECT is unset, live voice is
 *         broken end-to-end for every user — fail here.
 *
 *      b) AI Studio ephemeral-token path (still reachable via
 *         ?backend=aistudio as an operator escape hatch, and by older
 *         deployments that have not flipped the default):
 *           { backend: "aistudio",
 *             token: "auth_tokens/<id>",     // browser swaps for WS
 *             expiresAt, provider: "gemini", model, voice, voiceStyle }
 *
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
 *   - The Vertex WebSocket proxy's own upstream connectivity. That's
 *     covered by a manual smoke step (connecting directly to
 *     `wss://<host>/api/realtime/vertex-live-ws` and verifying a
 *     `setupComplete` frame comes back) — asserting it here would
 *     require OAuth credentials in CI and a live Google Cloud call.
 *
 * A real response means: the token handler can mint a session the
 * browser can use to open Gemini Live. That is the operative
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

  // 2. /api/realtime/gemini-token must return a valid session bootstrap.
  //    The exact shape depends on the resolved backend (see header comment):
  //      - vertex   → token:null, setup with projects/.../models/... path
  //      - aistudio → token:"auth_tokens/<id>"
  const token = await getJson('/api/realtime/gemini-token');
  if (token.status !== 200) {
    return fail(
      'gemini-token did not return 200',
      'status=' + token.status + ' body=' + token.text.slice(0, 400),
    );
  }

  const body = token.body || {};
  if (body.provider !== 'gemini') {
    return fail('gemini-token "provider" is not "gemini"', 'got=' + body.provider);
  }
  if (!body.expiresAt) {
    return fail('gemini-token response missing "expiresAt"', JSON.stringify(body));
  }
  const exp = Date.parse(body.expiresAt);
  if (Number.isNaN(exp) || exp <= Date.now()) {
    return fail('gemini-token "expiresAt" is not a future ISO-8601 timestamp', 'got=' + body.expiresAt);
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

  const backend = body.backend;
  if (backend !== 'vertex' && backend !== 'aistudio') {
    return fail('gemini-token "backend" is not "vertex" or "aistudio"', 'got=' + backend);
  }

  if (backend === 'vertex') {
    // Vertex auth is server-side via the WS proxy; no ephemeral token
    // is minted, so `token` must be explicitly `null` (not undefined —
    // that would mean the field is missing entirely, which would be a
    // client-facing shape regression).
    if (body.token !== null) {
      return fail('vertex gemini-token "token" must be null', 'got=' + JSON.stringify(body.token));
    }
    const setup = body.setup;
    if (!setup || typeof setup !== 'object') {
      return fail('vertex gemini-token response missing "setup" object', JSON.stringify(body));
    }
    if (typeof setup.model !== 'string' || !setup.model) {
      return fail('vertex gemini-token "setup.model" missing or not a string', JSON.stringify(setup));
    }
    // Vertex BidiGenerateContent rejects `models/<m>` with close code
    // 1007 — the path must be the fully-qualified
    // `projects/<P>/locations/<L>/publishers/google/models/<M>` form.
    // Catching this here turns a silent production outage into a red
    // acceptance build.
    if (!/^projects\/[^/]+\/locations\/[^/]+\/publishers\/google\/models\/.+$/.test(setup.model)) {
      return fail(
        'vertex gemini-token "setup.model" is not a fully-qualified Vertex path',
        'got=' + setup.model + ' (expected projects/<P>/locations/<L>/publishers/google/models/<M>)',
      );
    }
    const sysText = setup?.systemInstruction?.parts?.[0]?.text;
    if (typeof sysText !== 'string' || !sysText) {
      return fail('vertex gemini-token "setup.systemInstruction" missing persona text', JSON.stringify(setup));
    }
  } else {
    // AI Studio — legacy path, mints an auth_tokens/<id> handle.
    if (!body.token || typeof body.token !== 'string') {
      return fail('aistudio gemini-token response missing string "token"', JSON.stringify(body));
    }
    if (!body.token.startsWith('auth_tokens/')) {
      return fail(
        'aistudio gemini-token "token" does not look like a Google auth_tokens handle',
        'got=' + body.token,
      );
    }
  }

  // Everything the browser needs to open Gemini Live is present.
  process.stdout.write('ACCEPTANCE PASS: voice-roundtrip\n');
  process.stdout.write('  base:       ' + BASE + '\n');
  process.stdout.write('  backend:    ' + backend + '\n');
  process.stdout.write('  model:      ' + body.model + '\n');
  if (backend === 'vertex') {
    process.stdout.write('  setupModel: ' + body.setup.model + '\n');
  }
  process.stdout.write('  voice:      ' + body.voice + '\n');
  process.stdout.write('  voiceStyle: ' + body.voiceStyle + '\n');
  process.stdout.write('  expiresAt:  ' + body.expiresAt + '\n');
  if (typeof body.token === 'string' && body.token.includes('/')) {
    process.stdout.write('  tokenType:  ' + body.token.split('/')[0] + '/…\n');
  }
  // Node fetch keeps an HTTP keep-alive pool which prevents the event loop
  // from draining on success; exit explicitly so CI step finishes instead of
  // waiting for the connection to time out.
  process.exit(0);
})().catch(err => {
  process.stderr.write('ACCEPTANCE FAIL: voice-roundtrip (script error)\n');
  process.stderr.write('  ' + (err && err.stack ? err.stack : String(err)) + '\n');
  process.exit(2);
});
