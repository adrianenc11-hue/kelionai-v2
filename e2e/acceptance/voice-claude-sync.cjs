#!/usr/bin/env node
'use strict';

/**
 * ACCEPTANCE: voice-claude-sync
 *
 * This is the production truth gate for Adrian's "voice Claude 4.7" rule.
 * It verifies the public site, not an internal Railway URL:
 *
 *   1. /health is live and reports the deployed commit.
 *   2. /api/realtime/voice-token resolves to REST Voice Mode.
 *   3. The voice brain is OpenRouter Claude Opus 4.7.
 *   4. The response exposes a real voice name for playback/TTS.
 *
 * This does not synthesize audio in CI. It proves the server gives the
 * browser the exact model/backend contract required before a microphone
 * roundtrip can work.
 */

const BASE = process.env.ACCEPTANCE_BASE || 'https://kelionai.app';
const EXPECTED_MODEL = process.env.EXPECTED_VOICE_MODEL || 'anthropic/claude-opus-4.7';

function fail(reason, detail) {
  process.stderr.write('ACCEPTANCE FAIL: voice-claude-sync\n');
  process.stderr.write('  reason: ' + reason + '\n');
  if (detail) process.stderr.write('  detail: ' + detail + '\n');
  process.exit(1);
}

async function getJson(path) {
  const headers = {};
  if (process.env.ACCEPTANCE_TOKEN) {
    headers.Authorization = 'Bearer ' + process.env.ACCEPTANCE_TOKEN;
  }
  const r = await fetch(BASE + path, { headers });
  const text = await r.text();
  let body = null;
  try { body = JSON.parse(text); } catch (_) {}
  return { status: r.status, body, text };
}

(async () => {
  const health = await getJson('/health');
  if (health.status !== 200) {
    return fail('/health not 200', 'status=' + health.status + ' body=' + health.text.slice(0, 400));
  }
  if (!health.body?.deploy_sha || health.body.deploy_sha === 'unknown') {
    return fail('/health missing deploy_sha', JSON.stringify(health.body));
  }
  if (health.body?.services?.ai !== 'configured') {
    return fail('/health reports AI not configured', JSON.stringify(health.body?.services || null));
  }

  const token = await getJson('/api/realtime/voice-token?lang=ro-RO&backend=aistudio');
  if (token.status !== 200) {
    return fail('voice-token did not return 200', 'status=' + token.status + ' body=' + token.text.slice(0, 400));
  }

  const body = token.body || {};
  if (body.backend !== 'openrouter') {
    return fail('voice backend is not openrouter REST Voice Mode', 'got=' + body.backend);
  }
  if (body.provider !== 'openrouter') {
    return fail('voice provider is not openrouter', 'got=' + body.provider);
  }
  if (body.model !== EXPECTED_MODEL) {
    return fail('voice model is not Claude Opus 4.7', 'got=' + body.model + ' expected=' + EXPECTED_MODEL);
  }
  if (body.modelFamily !== 'Claude (Anthropic)') {
    return fail('voice modelFamily is not Claude (Anthropic)', 'got=' + body.modelFamily);
  }
  if (body.token !== null || body.setup !== null) {
    return fail('openrouter voice-token must be REST shaped with token:null and setup:null', JSON.stringify(body));
  }
  if (!body.voice || typeof body.voice !== 'string') {
    return fail('voice-token missing voice name', JSON.stringify(body));
  }
  if (!body.expiresAt || Number.isNaN(Date.parse(body.expiresAt)) || Date.parse(body.expiresAt) <= Date.now()) {
    return fail('voice-token expiresAt is not a future ISO timestamp', 'got=' + body.expiresAt);
  }

  process.stdout.write('ACCEPTANCE PASS: voice-claude-sync\n');
  process.stdout.write('  base:    ' + BASE + '\n');
  process.stdout.write('  sha:     ' + health.body.deploy_sha + '\n');
  process.stdout.write('  backend: ' + body.backend + '\n');
  process.stdout.write('  model:   ' + body.model + '\n');
  process.stdout.write('  voice:   ' + body.voice + '\n');
  process.exit(0);
})().catch(err => {
  process.stderr.write('ACCEPTANCE FAIL: voice-claude-sync (script error)\n');
  process.stderr.write('  ' + (err && err.stack ? err.stack : String(err)) + '\n');
  process.exit(2);
});
