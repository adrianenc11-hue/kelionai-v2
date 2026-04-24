'use strict';

// Voice clone — consensual opt-in.
//
// The user records ~30-120 s of audio in the browser, explicitly ticks a
// consent checkbox, and POSTs the sample here. We validate consent,
// forward to ElevenLabs, save the returned voice_id on their user row,
// and write an audit row. A separate DELETE drops the clone from
// ElevenLabs + the DB; PATCH toggles whether TTS should use it.
//
// We refuse absolutely to ever create a clone without `consent: true`
// in the request body + a fresh audio sample. That is non-negotiable —
// see the Kelion AGENTS.md / session notes for the legal rationale
// (GDPR Art. 9, BIPA, CCPA/CPRA, ElevenLabs ToS §4.3).

const { Router } = require('express');
const {
  getClonedVoice,
  setClonedVoice,
  clearClonedVoice,
  setClonedVoiceEnabled,
  logVoiceCloneEvent,
  listVoiceCloneEvents,
} = require('../db');
const {
  createClonedVoice,
  deleteClonedVoice,
  VoiceCloneError,
  MAX_SAMPLE_BYTES,
} = require('../services/voiceClone');
const ipGeo = require('../services/ipGeo');

const router = Router();

// Audit M5 — hard cap on the base64 payload BEFORE we allocate a
// Buffer. ElevenLabs Instant Voice Cloning caps at ~10 MB of decoded
// audio; 4 base64 chars encode 3 bytes, so the decoded length is at
// most ceil(len/4) * 3. We floor the allowed base64 length at the
// value that maps to 10 MB of audio, plus a small slack for `data:`
// URI prefix overhead. Without this check a tampered client could
// ship ~15 MB of base64 (allowed by the express JSON body limit) and
// we would decode it into a Buffer before ever validating the size,
// briefly doubling peak memory for no reason. Refusing the string
// here keeps peak RSS flat for pathological callers.
const MAX_AUDIO_BASE64_CHARS = Math.ceil(MAX_SAMPLE_BYTES / 3) * 4 + 64;

// Bump this string any time the consent copy in the UI materially
// changes (adds a new use, changes retention, etc). Stored on every
// accepted clone so we can prove which exact version of the text the
// user agreed to.
const CONSENT_VERSION = '2026-04-20.v1';

function ipOf(req)      { return ipGeo.clientIp(req) || req.ip || null; }
function uaOf(req)      { return (req.get && req.get('user-agent')) || null; }
function uidOf(req)     { return req.user && req.user.id; }

function decodeAudio(body) {
  if (!body || typeof body !== 'object') {
    throw new VoiceCloneError('Missing request body.', 400);
  }
  const { audioBase64, mimeType } = body;
  if (!audioBase64 || typeof audioBase64 !== 'string') {
    throw new VoiceCloneError(
      'audioBase64 is required (base64-encoded audio sample).',
      400
    );
  }
  // Audit M5 — refuse oversized payloads BEFORE decoding. This
  // short-circuits the expensive Buffer.from call and prevents a
  // transient allocation spike on tampered clients.
  if (audioBase64.length > MAX_AUDIO_BASE64_CHARS) {
    throw new VoiceCloneError(
      `Audio payload too large (${audioBase64.length} base64 chars). Max ${MAX_AUDIO_BASE64_CHARS}.`,
      413
    );
  }
  // Accept both raw base64 and `data:audio/webm;base64,...` URIs.
  let b64 = audioBase64;
  let mt = mimeType || null;
  const dataUri = /^data:([^;,]+);base64,(.*)$/i.exec(audioBase64);
  if (dataUri) {
    mt = mt || dataUri[1];
    b64 = dataUri[2];
  }
  let buffer;
  try {
    buffer = Buffer.from(b64, 'base64');
  } catch (_) {
    throw new VoiceCloneError('Invalid base64 audio payload.', 400);
  }
  // Audit M5 — second line of defence: even if the base64 was short
  // enough to pass the char cap, the decoded buffer MUST respect the
  // service-level MAX_SAMPLE_BYTES (the ElevenLabs ceiling). Without
  // this the subsequent `validateSample` in services/voiceClone.js
  // only runs once the buffer is already live in memory.
  if (buffer.length > MAX_SAMPLE_BYTES) {
    throw new VoiceCloneError(
      `Audio sample too large (${buffer.length} bytes). Max ${MAX_SAMPLE_BYTES}.`,
      413
    );
  }
  return { buffer, mimeType: mt || 'audio/webm' };
}

// GET /api/voice/clone — inspect current clone state.
router.get('/', async (req, res) => {
  try {
    const info = await getClonedVoice(uidOf(req));
    res.json({
      ok: true,
      voice: info || { voiceId: null, consentAt: null, consentVersion: null, enabled: false },
      consentVersion: CONSENT_VERSION,
    });
  } catch (err) {
    console.warn('[voice/clone GET] failed', err && err.message);
    res.status(500).json({ error: 'Failed to load voice clone state.' });
  }
});

// GET /api/voice/clone/events — return the audit trail for THIS user.
router.get('/events', async (req, res) => {
  try {
    const rows = await listVoiceCloneEvents(uidOf(req), 100);
    res.json({ ok: true, events: rows });
  } catch (err) {
    console.warn('[voice/clone events] failed', err && err.message);
    res.status(500).json({ error: 'Failed to load voice clone events.' });
  }
});

// POST /api/voice/clone
// Body: { audioBase64, mimeType?, consent: true, consentVersion?, displayName? }
router.post('/', async (req, res) => {
  const userId = uidOf(req);
  const body = req.body || {};
  if (body.consent !== true) {
    return res.status(400).json({
      error: 'Consent is required. Set `consent: true` in the request body.',
    });
  }
  const clientConsentVersion = String(body.consentVersion || '');
  if (clientConsentVersion && clientConsentVersion !== CONSENT_VERSION) {
    return res.status(409).json({
      error: 'Consent text has been updated. Please re-read and re-confirm.',
      consentVersion: CONSENT_VERSION,
    });
  }

  let buffer, mimeType;
  try {
    ({ buffer, mimeType } = decodeAudio(body));
  } catch (err) {
    return res.status(err.status || 400).json({ error: err.message });
  }

  // Guard: if the user already has a clone, make them delete the old
  // one first rather than leaking voice_ids in ElevenLabs.
  try {
    const existing = await getClonedVoice(userId);
    if (existing && existing.voiceId) {
      return res.status(409).json({
        error: 'A cloned voice already exists. Delete it first before creating a new one.',
        existing,
      });
    }
  } catch (_) { /* best effort */ }

  let voiceId;
  try {
    const result = await createClonedVoice({
      buffer,
      mimeType,
      name: String(body.displayName || `Kelion user ${userId}`).slice(0, 100),
      description: 'Consensual clone created via Kelion app.',
    });
    voiceId = result.voiceId;
  } catch (err) {
    const status = (err && err.status) || 500;
    console.warn('[voice/clone POST] elevenlabs failed', status, err && err.message);
    try {
      await logVoiceCloneEvent({
        userId,
        action: 'create_failed',
        consentVersion: CONSENT_VERSION,
        ip: ipOf(req),
        userAgent: uaOf(req),
        note: String(err && err.message || '').slice(0, 400),
      });
    } catch (_) { /* ignore */ }
    return res.status(status).json({ error: err.message || 'Voice clone creation failed.' });
  }

  try {
    await setClonedVoice(userId, voiceId, CONSENT_VERSION);
    await logVoiceCloneEvent({
      userId,
      action: 'created',
      voiceId,
      consentVersion: CONSENT_VERSION,
      ip: ipOf(req),
      userAgent: uaOf(req),
    });
  } catch (err) {
    // If the DB write failed after ElevenLabs succeeded we still have a
    // clone on their side — try to delete it so we don't orphan it.
    console.error('[voice/clone POST] db save failed, rolling back ElevenLabs', err && err.message);
    try { await deleteClonedVoice(voiceId); } catch (_) { /* best effort */ }
    return res.status(500).json({ error: 'Failed to persist voice clone. Rolled back ElevenLabs side.' });
  }

  return res.json({
    ok: true,
    voice: {
      voiceId,
      consentAt: new Date().toISOString(),
      consentVersion: CONSENT_VERSION,
      enabled: true,
    },
  });
});

// DELETE /api/voice/clone — remove the clone from ElevenLabs + the DB.
router.delete('/', async (req, res) => {
  const userId = uidOf(req);
  let existing;
  try {
    existing = await getClonedVoice(userId);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load voice clone state.' });
  }
  if (!existing || !existing.voiceId) {
    return res.json({ ok: true, voice: null, note: 'No clone to delete.' });
  }

  let elevenErr = null;
  try {
    await deleteClonedVoice(existing.voiceId);
  } catch (err) {
    elevenErr = err;
    console.warn('[voice/clone DELETE] elevenlabs delete failed', err && err.message);
  }

  try {
    await clearClonedVoice(userId);
    await logVoiceCloneEvent({
      userId,
      action: 'deleted',
      voiceId: existing.voiceId,
      consentVersion: existing.consentVersion || null,
      ip: ipOf(req),
      userAgent: uaOf(req),
      note: elevenErr ? `elevenlabs_error:${String(elevenErr.message).slice(0, 200)}` : null,
    });
  } catch (err) {
    console.error('[voice/clone DELETE] db update failed', err && err.message);
    return res.status(500).json({ error: 'Failed to clear voice clone record.' });
  }
  return res.json({ ok: true, voice: null });
});

// PATCH /api/voice/clone — toggle `enabled`. Body: { enabled: boolean }
router.patch('/', async (req, res) => {
  const userId = uidOf(req);
  const body = req.body || {};
  if (typeof body.enabled !== 'boolean') {
    return res.status(400).json({ error: '`enabled` (boolean) is required.' });
  }
  let current;
  try {
    current = await getClonedVoice(userId);
  } catch (err) {
    console.error('[voice/clone PATCH] failed to load state', err && err.message);
    return res.status(500).json({ error: 'Failed to load voice clone state.' });
  }
  if (!current || !current.voiceId) {
    return res.status(404).json({ error: 'No cloned voice to toggle. Create one first.' });
  }
  try {
    const next = await setClonedVoiceEnabled(userId, body.enabled);
    await logVoiceCloneEvent({
      userId,
      action: body.enabled ? 'enabled' : 'disabled',
      voiceId: current.voiceId,
      consentVersion: current.consentVersion || null,
      ip: ipOf(req),
      userAgent: uaOf(req),
    });
    return res.json({ ok: true, voice: next });
  } catch (err) {
    console.error('[voice/clone PATCH] failed', err && err.message);
    return res.status(500).json({ error: 'Failed to update voice clone toggle.' });
  }
});

module.exports = router;
module.exports.CONSENT_VERSION = CONSENT_VERSION;
// Audit M5 — exported for direct unit coverage of the byte caps.
module.exports.decodeAudio = decodeAudio;
module.exports.MAX_AUDIO_BASE64_CHARS = MAX_AUDIO_BASE64_CHARS;
module.exports.MAX_SAMPLE_BYTES = MAX_SAMPLE_BYTES;
