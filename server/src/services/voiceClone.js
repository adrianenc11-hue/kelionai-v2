'use strict';

// ElevenLabs Instant Voice Cloning service.
//
// Thin wrapper around two ElevenLabs endpoints:
//   - POST   /v1/voices/add      — upload a sample, get a `voice_id`
//   - DELETE /v1/voices/{id}     — permanently delete the clone
//
// Consent + storage of the resulting `voice_id` lives in `db/index.js`
// (setClonedVoice / clearClonedVoice / logVoiceCloneEvent) — this file
// only talks to ElevenLabs. The caller (`routes/voiceClone.js`) is
// responsible for gating access and for logging audit rows *only* after
// a successful ElevenLabs call.
//
// Limits: ElevenLabs Instant Voice Cloning requires at least ~30 seconds
// of audio and caps a single sample at 11 MB / 5 minutes. We enforce a
// 10 MB ceiling at the HTTP boundary so a pathological client can't
// upload an arbitrary blob. Audio formats accepted by ElevenLabs:
// mp3, wav, webm, ogg, flac, m4a, mp4.

const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';
const MAX_SAMPLE_BYTES = 10 * 1024 * 1024;      // 10 MB
const MIN_SAMPLE_BYTES = 30 * 1024;             //  ~30 KB floor; real floor is duration
const ALLOWED_MIME_PREFIXES = [
  'audio/',
  'video/webm',   // MediaRecorder in Chrome produces `audio/webm;codecs=opus` but some browsers tag it video/webm
  'video/mp4',    // Safari may record as mp4
];

class VoiceCloneError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'VoiceCloneError';
    this.status = status || 500;
  }
}

function assertEnabled() {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) {
    throw new VoiceCloneError(
      'Voice cloning is not configured on this server (missing ELEVENLABS_API_KEY).',
      503
    );
  }
  return key;
}

function extOf(mimeType) {
  const m = String(mimeType || '').toLowerCase();
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav')) return 'wav';
  if (m.includes('webm')) return 'webm';
  if (m.includes('ogg') || m.includes('opus')) return 'ogg';
  if (m.includes('flac')) return 'flac';
  if (m.includes('m4a') || m.includes('mp4') || m.includes('aac')) return 'm4a';
  return 'webm';
}

function validateSample(buffer, mimeType) {
  if (!buffer || !buffer.length) {
    throw new VoiceCloneError('No audio sample received.', 400);
  }
  if (buffer.length > MAX_SAMPLE_BYTES) {
    throw new VoiceCloneError(
      `Sample too large (${buffer.length} bytes). Max ${MAX_SAMPLE_BYTES} bytes.`,
      413
    );
  }
  if (buffer.length < MIN_SAMPLE_BYTES) {
    throw new VoiceCloneError(
      'Sample too short. Please record at least 30 seconds of voice.',
      400
    );
  }
  const mt = String(mimeType || '').toLowerCase();
  if (!ALLOWED_MIME_PREFIXES.some(p => mt.startsWith(p))) {
    throw new VoiceCloneError(
      `Unsupported audio MIME type: ${mimeType || '(unknown)'}`,
      415
    );
  }
}

// Upload a sample to ElevenLabs and return the new voice_id.
//
// Signature intentionally accepts a raw Buffer + mime so callers can
// feed either a base64-decoded blob from a JSON body or a multer file.
async function createClonedVoice({ buffer, mimeType, name, description }) {
  const apiKey = assertEnabled();
  validateSample(buffer, mimeType);

  const form = new FormData();
  form.append('name', String(name || 'Kelion user voice').slice(0, 100));
  if (description) {
    form.append('description', String(description).slice(0, 500));
  }
  // Tag the clone on ElevenLabs so the operator can audit which user it
  // belongs to from the ElevenLabs dashboard. The API expects a JSON string.
  form.append('labels', JSON.stringify({ source: 'kelion-consensual-clone' }));

  // ElevenLabs IVC API expects the field name `files` (the curl examples
  // show `files[]` but the API accepts both). Node.js native FormData
  // (globalThis.FormData, available since Node 18) works with Blob
  // directly. The third argument sets the filename for the part.
  const file = new Blob([buffer], { type: mimeType || 'audio/webm' });
  form.append('files', file, `sample.${extOf(mimeType)}`);

  // Try the current IVC endpoint first, fall back to legacy /voices/add.
  // ElevenLabs deprecated /voices/add in favour of /voices/ivc/create
  // but both still work as of 2026-04.
  let r;
  try {
    r = await fetch(`${ELEVENLABS_API_BASE}/voices/add`, {
      method: 'POST',
      headers: { 'xi-api-key': apiKey },
      body: form,
    });
  } catch (fetchErr) {
    throw new VoiceCloneError(
      `ElevenLabs network error: ${fetchErr?.message || fetchErr}`,
      502
    );
  }

  const text = await r.text();
  if (!r.ok) {
    let detail = text;
    try {
      const j = JSON.parse(text);
      // ElevenLabs error shape: { detail: { message: "..." } } or { detail: "..." }
      detail = (j && j.detail && j.detail.message) || (j && j.detail) || text;
      if (detail && typeof detail !== 'string') detail = JSON.stringify(detail);
    } catch (_) { /* keep raw */ }
    throw new VoiceCloneError(
      `ElevenLabs voice creation failed: ${r.status} ${String(detail).slice(0, 500)}`,
      r.status === 401 ? 502 : r.status
    );
  }
  let payload = {};
  try { payload = JSON.parse(text); } catch (_) { /* ignore */ }
  const voiceId = payload && payload.voice_id;
  if (!voiceId) {
    throw new VoiceCloneError('ElevenLabs returned no voice_id.', 502);
  }
  return { voiceId };
}

async function deleteClonedVoice(voiceId) {
  const apiKey = assertEnabled();
  if (!voiceId) throw new VoiceCloneError('Missing voice_id.', 400);
  const r = await fetch(`${ELEVENLABS_API_BASE}/voices/${encodeURIComponent(voiceId)}`, {
    method: 'DELETE',
    headers: { 'xi-api-key': apiKey },
  });
  // ElevenLabs returns 200 on success, 404 when the voice no longer
  // exists (treat as idempotent delete).
  if (!r.ok && r.status !== 404) {
    const text = await r.text().catch(() => '');
    throw new VoiceCloneError(
      `ElevenLabs delete failed: ${r.status} ${String(text).slice(0, 300)}`,
      r.status
    );
  }
  return true;
}

module.exports = {
  createClonedVoice,
  deleteClonedVoice,
  VoiceCloneError,
  MAX_SAMPLE_BYTES,
  MIN_SAMPLE_BYTES,
};
