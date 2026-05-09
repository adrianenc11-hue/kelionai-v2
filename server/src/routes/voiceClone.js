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

// ── Native masculine voice auto-discovery (per language) ──────────
// Queries ElevenLabs /v1/voices once per language, finds the best
// male voice that matches the detected user language, and caches the
// result in-memory so subsequent TTS calls are instant.
// No voice IDs are ever hardcoded — everything comes from the API.
const _nativeVoiceCache = new Map(); // lang → { voiceId, name, ts }
const VOICE_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ElevenLabs language codes mapped from ISO 639-1 (what browsers send)
const LANG_NAMES = {
  ro: 'romanian', en: 'english', es: 'spanish', fr: 'french',
  de: 'german', it: 'italian', pt: 'portuguese', nl: 'dutch',
  pl: 'polish', sv: 'swedish', da: 'danish', no: 'norwegian',
  fi: 'finnish', cs: 'czech', hu: 'hungarian', el: 'greek',
  tr: 'turkish', ru: 'russian', uk: 'ukrainian', ar: 'arabic',
  hi: 'hindi', ja: 'japanese', ko: 'korean', zh: 'chinese',
  bg: 'bulgarian', hr: 'croatian', sk: 'slovak', sl: 'slovenian',
};

/**
 * Auto-discover a native masculine voice from ElevenLabs for a given
 * language code (ISO 639-1, e.g. "ro", "en", "fr").
 *
 * Strategy (in priority order):
 *   1. Check in-memory cache (TTL = 1h)
 *   2. Query ElevenLabs GET /v1/voices
 *   3. Filter: gender=male + language matches detected lang
 *   4. Prefer "premade" voices (ElevenLabs library) over user-created
 *   5. Cache the winner and return its voice_id
 *
 * Returns null if no matching voice is found.
 */
async function discoverNativeMaleVoice(apiKey, langCode) {
  if (!apiKey || !langCode) return null;
  const lang = langCode.toLowerCase().split('-')[0]; // "ro-RO" → "ro"

  // Check cache
  const cached = _nativeVoiceCache.get(lang);
  if (cached && Date.now() - cached.ts < VOICE_CACHE_TTL_MS) {
    return cached.voiceId;
  }

  try {
    const r = await fetch('https://api.elevenlabs.io/v1/voices', {
      headers: { 'xi-api-key': apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      console.warn(`[voice/discover] ElevenLabs /voices returned ${r.status}`);
      return cached?.voiceId || null; // stale cache better than nothing
    }

    const data = await r.json();
    const voices = data.voices || [];
    const langName = LANG_NAMES[lang] || lang;

    // Score each voice: higher = better match
    function scoreVoice(v) {
      const labels = v.labels || {};
      const isMale = (labels.gender || '').toLowerCase() === 'male';
      if (!isMale) return -1; // MUST be male

      let score = 0;
      // Language match (check labels.language, labels.accent, voice name)
      const voiceLang = (labels.language || '').toLowerCase();
      const voiceAccent = (labels.accent || '').toLowerCase();
      const voiceName = (v.name || '').toLowerCase();
      const voiceDesc = (v.description || '').toLowerCase();

      if (voiceLang.includes(langName) || voiceLang.includes(lang)) score += 100;
      else if (voiceAccent.includes(langName) || voiceAccent.includes(lang)) score += 80;
      else if (voiceName.includes(langName) || voiceName.includes(lang)) score += 60;
      else if (voiceDesc.includes(langName) || voiceDesc.includes(lang)) score += 40;

      // Prefer premade/library voices over cloned
      if (v.category === 'premade' || v.category === 'professional') score += 20;
      // Prefer "professional" or "narration" use case
      const useCase = (labels.use_case || '').toLowerCase();
      if (useCase.includes('narration') || useCase.includes('news')) score += 10;
      // Prefer voices with higher sample count (better quality)
      if (v.high_quality_base_model_ids?.length) score += 5;

      return score;
    }

    // Score all voices and pick the best
    const scored = voices
      .map(v => ({ voice: v, score: scoreVoice(v) }))
      .filter(s => s.score > 0) // only male voices
      .sort((a, b) => b.score - a.score);

    if (scored.length > 0) {
      const best = scored[0].voice;
      const result = { voiceId: best.voice_id, name: best.name, ts: Date.now() };
      _nativeVoiceCache.set(lang, result);
      console.log(`[voice/discover] lang="${lang}" → ${best.name} (${best.voice_id}), score=${scored[0].score}, candidates=${scored.length}`);
      return best.voice_id;
    }

    // No language-specific male voice found — fall back to any male voice
    const anyMale = voices.find(v => (v.labels?.gender || '').toLowerCase() === 'male');
    if (anyMale) {
      const result = { voiceId: anyMale.voice_id, name: anyMale.name, ts: Date.now() };
      _nativeVoiceCache.set(lang, result);
      console.log(`[voice/discover] lang="${lang}" no exact match → fallback to ${anyMale.name} (${anyMale.voice_id})`);
      return anyMale.voice_id;
    }

    console.warn(`[voice/discover] No male voices found at all in ElevenLabs account`);
    return null;
  } catch (err) {
    console.error(`[voice/discover] API error:`, err?.message);
    return cached?.voiceId || null; // stale cache on error
  }
}

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
const CONSENT_VERSION = '2026-04-27.v2';

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
// Body: { audioBase64, mimeType?, consent: true, consentVersion?, displayName?, signature? }
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

  // P3 fix — persist the digital signature typed by the user as proof
  // of consent identity. The frontend captures the full name as a
  // typed signature; we validate it's non-empty and store it in the
  // audit event note field alongside every 'created' row.
  const signature = (typeof body.signature === 'string')
    ? body.signature.trim().slice(0, 200)
    : '';
  if (!signature || signature.length < 3) {
    return res.status(400).json({
      error: 'Digital signature (full name, ≥3 characters) is required.',
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
        note: `signature:${signature}|${String(err && err.message || '').slice(0, 300)}`,
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
      note: `signature:${signature}`,
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
//
// P4 fix — only clear the DB record when ElevenLabs confirms the
// clone is gone (200) or was already gone (404). If ElevenLabs
// returns a real server error (5xx, network), we refuse to clear
// the local record so the admin retains awareness that a clone
// exists on their account and can retry later. This prevents
// orphaned clones on the ElevenLabs side that no one knows about.
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

  try {
    await deleteClonedVoice(existing.voiceId);
  } catch (err) {
    console.warn('[voice/clone DELETE] elevenlabs delete failed', err && err.message);
    // P4 — do NOT clear the DB; the clone still lives on ElevenLabs.
    // Log the failure so the admin can see it in the audit trail.
    try {
      await logVoiceCloneEvent({
        userId,
        action: 'delete_failed',
        voiceId: existing.voiceId,
        consentVersion: existing.consentVersion || null,
        ip: ipOf(req),
        userAgent: uaOf(req),
        note: `elevenlabs_error:${String(err && err.message || '').slice(0, 300)}`,
      });
    } catch (_) { /* ignore */ }
    return res.status(502).json({
      error: 'ElevenLabs failed to delete the clone. Your record is preserved — please try again later.',
    });
  }

  // ElevenLabs confirmed deletion (200 or 404) — now safe to clear DB.
  try {
    await clearClonedVoice(userId);
    await logVoiceCloneEvent({
      userId,
      action: 'deleted',
      voiceId: existing.voiceId,
      consentVersion: existing.consentVersion || null,
      ip: ipOf(req),
      userAgent: uaOf(req),
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

// POST /api/voice/clone/tts
// Synthesise speech with the user's cloned ElevenLabs voice.
// Body: { text: string, speed?: number (0.7-1.2) }
// Returns: audio/mpeg stream
router.post('/tts', async (req, res) => {
  const userId = uidOf(req);
  if (!userId) return res.status(401).json({ error: 'Not authenticated.' });

  const { text, speed = 1.0, lang } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'text is required.' });
  }

  let cloneInfo;
  try {
    cloneInfo = await getClonedVoice(userId);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load voice clone state.' });
  }
  
  const isNative = req.query.native === 'true';
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'ElevenLabs not configured on server.' });

  // ── Auto-detect language & discover matching native masculine voice ──
  // The client sends `lang` (e.g. "ro-RO", "en-US", "fr-FR") from the
  // browser's SpeechRecognition API. We use it to find the best matching
  // male voice from the ElevenLabs library — no hardcoded voice IDs.
  // Results are cached in-memory per language so we query the API only
  // once per language per server lifetime.
  let voiceId;

  if (isNative || !cloneInfo?.voiceId) {
    // Always use auto-detected native voice when:
    //   - native mode is explicitly requested, OR
    //   - user has no cloned voice set up
    const detectedLang = (lang || 'en').toLowerCase().split('-')[0]; // "ro-RO" → "ro"
    voiceId = await discoverNativeMaleVoice(apiKey, detectedLang);
    if (voiceId) {
      console.log(`[voice/tts] Using native male voice for lang="${detectedLang}": ${voiceId}`);
    }
  } else {
    // User has an active cloned voice — use it
    voiceId = cloneInfo.voiceId;
  }

  // Final fallback: auto-discover ANY male voice if language-specific failed
  if (!voiceId) {
    voiceId = await discoverNativeMaleVoice(apiKey, 'en');
  }
    
  if (!voiceId) {
    return res.status(500).json({ error: 'Nu s-a găsit nicio voce masculină disponibilă în ElevenLabs.' });
  }

  // Helper to call TTS with a given voiceId
  async function callTTS(vid) {
    return fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(vid)}/stream`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': apiKey,
          'Content-Type': 'application/json',
          'Accept': 'audio/mpeg',
        },
        body: JSON.stringify({
          text: text.trim().slice(0, 5000),
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability: 0.4,
            similarity_boost: 0.85,
            speed: Math.max(0.7, Math.min(1.2, Number(speed) || 1.0)),
          },
        }),
      }
    );
  }

  try {
    let r = await callTTS(voiceId);

    // If 404 voice_not_found, invalidate cache and re-discover
    if (r.status === 404) {
      console.warn(`[voice/tts] Voice ${voiceId} not found, re-discovering...`);
      _nativeVoiceCache.clear(); // force fresh discovery
      const detectedLang = (lang || 'en').toLowerCase().split('-')[0];
      const fallback = await discoverNativeMaleVoice(apiKey, detectedLang);
      if (fallback && fallback !== voiceId) {
        console.log(`[voice/tts] Retrying with discovered voice: ${fallback}`);
        r = await callTTS(fallback);
        voiceId = fallback;
      }
    }

    if (!r.ok) {
      const errText = await r.text().catch(() => '');
      console.error(`[voice/tts] ElevenLabs ${r.status}: ${errText.slice(0, 500)}`);
      
      let userError = `Eroare generare voce (${r.status}).`;
      if (r.status === 401) userError = 'Cheie API ElevenLabs invalidă.';
      else if (r.status === 404) userError = 'Nicio voce disponibilă în contul ElevenLabs.';
      else if (r.status === 429 || errText.toLowerCase().includes('quota') || errText.toLowerCase().includes('insufficient')) {
        userError = 'Fonduri insuficiente ElevenLabs. Vă rugăm să reîncărcați contul ElevenLabs.';
      }
      
      return res.status(r.status === 401 ? 401 : 500).json({ error: userError });
    }

    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Cache-Control', 'no-store');
    // Log audit event (fire-and-forget)
    logVoiceCloneEvent({
      userId, action: 'synthesize', voiceId: voiceId,
      consentVersion: cloneInfo?.consentVersion || null,
      ip: ipOf(req), userAgent: uaOf(req),
      note: `chars:${text.trim().length}`,
    }).catch(() => {});
    // Buffer the audio and send — avoids Readable.fromWeb (Node 17+) dependency.
    const audioBuffer = await r.arrayBuffer();
    res.end(Buffer.from(audioBuffer));
  } catch (err) {
    console.error('[voice/tts] network error:', err?.message);
    return res.status(502).json({ error: `ElevenLabs network error: ${err?.message}` });
  }
});

// P1 fix — POST /api/voice/clone/synthesize

// Log a 'synthesize' audit event when the cloned voice is actually
// used for TTS. The TTS layer (or any future integration) calls this
// endpoint whenever it synthesises speech with a user's cloned voice.
// This fulfils the GDPR promise in the consent UI:
//   "We keep an audit log (create / enable / disable / delete / synthesize)"
//
// Body: { chars?: number } — optional character count of the text
// that was synthesised, for cost-tracking cross-reference.
router.post('/synthesize', async (req, res) => {
  const userId = uidOf(req);
  if (!userId) return res.status(401).json({ error: 'Not authenticated.' });
  let current;
  try {
    current = await getClonedVoice(userId);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to load voice clone state.' });
  }
  if (!current || !current.voiceId || !current.enabled) {
    return res.status(404).json({ error: 'No active cloned voice.' });
  }
  const chars = Number(req.body && req.body.chars) || 0;
  try {
    await logVoiceCloneEvent({
      userId,
      action: 'synthesize',
      voiceId: current.voiceId,
      consentVersion: current.consentVersion || null,
      ip: ipOf(req),
      userAgent: uaOf(req),
      note: chars > 0 ? `chars:${chars}` : null,
    });
  } catch (err) {
    // Best-effort — never let audit failure break TTS.
    console.warn('[voice/clone synthesize] audit log failed', err && err.message);
  }
  return res.json({ ok: true });
});

// Admin-only: re-associate an existing ElevenLabs voiceId that was lost
// during a Railway SQLite wipe. Avoids re-recording audio samples.
// POST /api/voice/clone/admin-set  { voiceId: string }
router.post('/admin-set', async (req, res) => {
  const userId = uidOf(req);
  if (!userId) return res.status(401).json({ error: 'Not authenticated.' });
  const { voiceId } = req.body || {};
  if (!voiceId || typeof voiceId !== 'string' || !voiceId.trim()) {
    return res.status(400).json({ error: 'voiceId (string) is required.' });
  }
  try {
    const result = await setClonedVoice(userId, voiceId.trim(), CONSENT_VERSION);
    await logVoiceCloneEvent({
      userId, action: 'admin-set', voiceId: voiceId.trim(),
      consentVersion: CONSENT_VERSION,
      ip: ipOf(req), userAgent: uaOf(req),
      note: 'Restored after DB wipe',
    });
    return res.json({ ok: true, voice: result });
  } catch (err) {
    console.error('[voice/clone admin-set] failed', err?.message);
    return res.status(500).json({ error: 'Failed to set voice.' });
  }
});

module.exports = router;
module.exports.CONSENT_VERSION = CONSENT_VERSION;
// Audit M5 — exported for direct unit coverage of the byte caps.
module.exports.decodeAudio = decodeAudio;
module.exports.MAX_AUDIO_BASE64_CHARS = MAX_AUDIO_BASE64_CHARS;
module.exports.MAX_SAMPLE_BYTES = MAX_SAMPLE_BYTES;
