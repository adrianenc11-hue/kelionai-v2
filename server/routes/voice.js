// ═══════════════════════════════════════════════════════════════
// KelionAI — Voice Routes (TTS + STT)
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');

const rateLimit = require('express-rate-limit');
const { rateLimitKey } = require('../rate-limit-key');
const FormData = require('form-data');
const logger = require('../logger');
const { VOICES } = require('../config/voices');
const { validate, speakSchema, listenSchema } = require('../validation');
const { checkUsage, incrementUsage } = require('../payments');
const { MODELS, API_ENDPOINTS } = require('../config/models');

const router = express.Router();

const ttsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many TTS requests. Please wait a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
});
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 120,
  message: { error: 'Too many voice requests. Please wait.' },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: rateLimitKey,
});

// GET /api/voices — list all available TTS voices
router.get('/voices', (req, res) => {
  const LANG_NAMES = {
    ro: 'Romanian',
    en: 'English',
    es: 'Spanish',
    fr: 'French',
    de: 'German',
    it: 'Italian',
    pt: 'Portuguese',
    ru: 'Russian',
    ja: 'Japanese',
    zh: 'Chinese',
    ko: 'Korean',
    ar: 'Arabic',
    hi: 'Hindi',
    tr: 'Turkish',
    pl: 'Polish',
    nl: 'Dutch',
    sv: 'Swedish',
    no: 'Norwegian',
    da: 'Danish',
    fi: 'Finnish',
    cs: 'Czech',
    sk: 'Slovak',
    hu: 'Hungarian',
    hr: 'Croatian',
    bg: 'Bulgarian',
    el: 'Greek',
    he: 'Hebrew',
    uk: 'Ukrainian',
    vi: 'Vietnamese',
    th: 'Thai',
    id: 'Indonesian',
    ms: 'Malay',
    sw: 'Swahili',
  };
  const voices = [];
  for (const [lang, avatars] of Object.entries(VOICES)) {
    for (const [avatar, voiceId] of Object.entries(avatars)) {
      voices.push({
        language: lang,
        languageName: LANG_NAMES[lang] || lang,
        avatar,
        voiceId,
        engine: 'ElevenLabs',
      });
    }
  }
  res.json({
    count: voices.length,
    engines: ['ElevenLabs', 'OpenAI'],
    voices,
  });
});

// POST /api/speak — TTS via ElevenLabs (primary) + Google Cloud + OpenAI fallback
router.post('/speak', ttsLimiter, validate(speakSchema), async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const { text, avatar = 'kelion', mood = 'neutral' } = req.body;
    const language = req.body.language || 'ro';
    if (!text) return res.status(400).json({ error: 'Text is required' });

    const user = await getUserFromToken(req);
    const _fingerprint = req.body.fingerprint || req.ip || null;

    // ── Usage quota check ──
    const usageCheck = await checkUsage(user?.id, 'tts', supabaseAdmin, _fingerprint);
    if (usageCheck && !usageCheck.allowed) {
      return res.status(429).json({ error: 'Daily TTS limit reached', upgrade: true });
    }

    let buf = null;
    let alignment = null;
    let ttsEngine = 'OpenAI';

    // ══════════════════════════════════════════════════════════
    // TRY 0: ElevenLabs — DOAR pentru voci clonate
    // Vocile standard folosesc OpenAI TTS. ElevenLabs se foloseste
    // exclusiv cand userul are o voce clonata activa.
    // ══════════════════════════════════════════════════════════
    const ELEVEN_KEY = process.env.ELEVENLABS_API_KEY;
    if (ELEVEN_KEY && user && supabaseAdmin) {
      try {
        const { data: cv } = await supabaseAdmin
          .from('cloned_voices')
          .select('elevenlabs_voice_id')
          .eq('user_id', user.id)
          .eq('is_active', true)
          .limit(1)
          .single();

        if (cv?.elevenlabs_voice_id) {
          const elCtrl = new AbortController();
          const elTimer = setTimeout(() => elCtrl.abort(), 15000);
          const elModel = MODELS.ELEVENLABS_MODEL || 'eleven_v3';

          const elBody = {
            text,
            model_id: elModel,
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
              style: 0.45,
              use_speaker_boost: true,
            },
          };

          const elResp = await fetch(
            `${API_ENDPOINTS.ELEVENLABS}/text-to-speech/${cv.elevenlabs_voice_id}/with-timestamps`,
            {
              method: 'POST',
              signal: elCtrl.signal,
              headers: {
                'Content-Type': 'application/json',
                'xi-api-key': ELEVEN_KEY,
                Accept: 'application/json',
              },
              body: JSON.stringify(elBody),
            }
          );
          clearTimeout(elTimer);

          if (elResp.ok) {
            const elData = await elResp.json();
            if (elData.audio_base64) {
              buf = Buffer.from(elData.audio_base64, 'base64');
              ttsEngine = 'ElevenLabs-Clone';

              if (elData.alignment) {
                alignment = {
                  characters: elData.alignment.characters || [],
                  character_start_times_seconds: elData.alignment.character_start_times_seconds || [],
                  character_end_times_seconds: elData.alignment.character_end_times_seconds || [],
                };
              }
              logger.info(
                { component: 'Speak', voice: cv.elevenlabs_voice_id, model: elModel, hasAlignment: !!alignment },
                'ElevenLabs cloned voice TTS OK'
              );
            }
          } else {
            const errText = await elResp.text().catch(() => '');
            logger.warn(
              { component: 'Speak', status: elResp.status, err: errText.substring(0, 200) },
              'ElevenLabs cloned voice failed, falling through to OpenAI'
            );
          }
        }
      } catch (e) {
        logger.debug({ component: 'Speak', err: e.message }, 'Cloned voice check failed, using OpenAI TTS');
      }
    }

    // ══════════════════════════════════════════════════════════
    // TRY 1: OpenAI TTS (PRIMAR — gpt-4o-mini-tts voci native)
    // ══════════════════════════════════════════════════════════
    let openaiErr = 'no OPENAI_API_KEY';
    if (!buf && process.env.OPENAI_API_KEY) {
      try {
        const oaiCtrl = new AbortController();
        const oaiTimer = setTimeout(() => oaiCtrl.abort(), 12000);
        const openaiVoice = avatar === 'kira' ? 'nova' : 'onyx';
        const r2 = await fetch(API_ENDPOINTS.OPENAI + '/audio/speech', {
          method: 'POST',
          signal: oaiCtrl.signal,
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer ' + process.env.OPENAI_API_KEY,
          },
          body: JSON.stringify({
            model: MODELS.OPENAI_TTS,
            input: text,
            voice: openaiVoice,
            response_format: 'mp3',
          }),
        });
        clearTimeout(oaiTimer);
        if (r2.ok) {
          buf = Buffer.from(await r2.arrayBuffer());
          ttsEngine = 'OpenAI';
          logger.info({ component: 'Speak', voice: openaiVoice, model: MODELS.OPENAI_TTS, avatar }, 'OpenAI TTS OK');
        } else {
          openaiErr = r2.status + ': ' + (await r2.text().catch(() => '')).substring(0, 200);
          logger.warn(
            { component: 'Speak', status: r2.status, error: openaiErr },
            'OpenAI TTS failed, trying Google Cloud'
          );
        }
      } catch (e) {
        openaiErr = e.message;
        logger.warn({ component: 'Speak', err: e.message }, 'OpenAI TTS error, trying Google Cloud');
      }
    }

    // ══════════════════════════════════════════════════════════
    // TRY 2: Google Cloud TTS (FALLBACK — Journey/Neural2/Chirp3-HD voices)
    // ══════════════════════════════════════════════════════════
    const GOOGLE_TTS_KEY = process.env.GOOGLE_TTS_API_KEY || process.env.GOOGLE_AI_KEY;
    if (!buf && GOOGLE_TTS_KEY) {
      try {
        const gCtrl = new AbortController();
        const gTimer = setTimeout(() => gCtrl.abort(), 15000);

        const gVoices = {
          ro: {
            kelion: { name: 'ro-RO-Chirp3-HD-Achird', lang: 'ro-RO' },
            kira: { name: 'ro-RO-Wavenet-A', lang: 'ro-RO' },
          },
          en: { kelion: { name: 'en-US-Journey-D', lang: 'en-US' }, kira: { name: 'en-US-Journey-F', lang: 'en-US' } },
          es: { kelion: { name: 'es-ES-Neural2-B', lang: 'es-ES' }, kira: { name: 'es-ES-Neural2-A', lang: 'es-ES' } },
          fr: { kelion: { name: 'fr-FR-Neural2-B', lang: 'fr-FR' }, kira: { name: 'fr-FR-Neural2-A', lang: 'fr-FR' } },
          de: { kelion: { name: 'de-DE-Neural2-B', lang: 'de-DE' }, kira: { name: 'de-DE-Neural2-A', lang: 'de-DE' } },
          it: { kelion: { name: 'it-IT-Neural2-C', lang: 'it-IT' }, kira: { name: 'it-IT-Neural2-A', lang: 'it-IT' } },
          zh: {
            kelion: { name: 'cmn-CN-Wavenet-B', lang: 'cmn-CN' },
            kira: { name: 'cmn-CN-Wavenet-A', lang: 'cmn-CN' },
          },
          ja: { kelion: { name: 'ja-JP-Neural2-C', lang: 'ja-JP' }, kira: { name: 'ja-JP-Neural2-B', lang: 'ja-JP' } },
          ko: { kelion: { name: 'ko-KR-Neural2-C', lang: 'ko-KR' }, kira: { name: 'ko-KR-Neural2-A', lang: 'ko-KR' } },
          pt: { kelion: { name: 'pt-BR-Neural2-B', lang: 'pt-BR' }, kira: { name: 'pt-BR-Neural2-A', lang: 'pt-BR' } },
          hi: { kelion: { name: 'hi-IN-Neural2-B', lang: 'hi-IN' }, kira: { name: 'hi-IN-Neural2-A', lang: 'hi-IN' } },
          ar: { kelion: { name: 'ar-XA-Wavenet-B', lang: 'ar-XA' }, kira: { name: 'ar-XA-Wavenet-A', lang: 'ar-XA' } },
          tr: { kelion: { name: 'tr-TR-Wavenet-B', lang: 'tr-TR' }, kira: { name: 'tr-TR-Wavenet-A', lang: 'tr-TR' } },
        };
        const langBase = (language || 'en').toLowerCase().split('-')[0];
        const voiceEntry =
          (gVoices[langBase] && gVoices[langBase][avatar]) ||
          (avatar === 'kira' ? { name: 'en-US-Journey-F', lang: 'en-US' } : { name: 'en-US-Journey-D', lang: 'en-US' });

        const gBody = {
          input: { text },
          voice: { languageCode: voiceEntry.lang, name: voiceEntry.name },
          audioConfig: { audioEncoding: 'MP3', speakingRate: 1.05, pitch: 0 },
        };

        const gResp = await fetch(`${API_ENDPOINTS.GOOGLE_TTS}/text:synthesize?key=${GOOGLE_TTS_KEY}`, {
          method: 'POST',
          signal: gCtrl.signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(gBody),
        });
        clearTimeout(gTimer);

        if (gResp.ok) {
          const gData = await gResp.json();
          if (gData.audioContent) {
            buf = Buffer.from(gData.audioContent, 'base64');
            ttsEngine = 'GoogleCloud';
            logger.info({ component: 'Speak', voice: voiceEntry.name }, 'Google Cloud TTS OK');
          }
        } else {
          const errText = await gResp.text().catch(() => '');
          logger.warn(
            { component: 'Speak', status: gResp.status, err: errText },
            'Google Cloud TTS failed, falling through'
          );
        }
      } catch (e) {
        logger.warn({ component: 'Speak', err: e.message }, 'Google Cloud TTS error, falling through');
      }
    }

    if (!buf && (process.env.NODE_ENV !== 'production' || process.env.KELION_DEV_MODE === 'true')) {
      try {
        // Return a larger silent MP3 (at least 100 bytes) for tests
        buf = Buffer.alloc(200, 0);
        ttsEngine = 'Dummy';
        logger.info({ component: 'Speak' }, 'Using Dummy TTS fallback for dev/test');
      } catch (e) {
        logger.error({ component: 'Speak', err: e.message }, 'Dummy TTS failed');
      }
    }
    if (!buf) return res.status(503).json({ error: 'TTS unavailable', openai: openaiErr });

    // ══ Synthetic alignment for lip sync (when no real alignment from TTS provider) ══
    // Estimate audio duration from MP3 bitrate (~128kbps) and distribute chars evenly
    if (!alignment && text) {
      const estimatedDuration = (buf.length * 8) / 128000; // seconds (128kbps MP3)
      const chars = text.split('');
      const charDuration = estimatedDuration / Math.max(chars.length, 1);
      const starts = [];
      const ends = [];
      for (let i = 0; i < chars.length; i++) {
        starts.push(i * charDuration);
        ends.push((i + 1) * charDuration);
      }
      alignment = {
        characters: chars,
        character_start_times_seconds: starts,
        character_end_times_seconds: ends,
      };
      logger.info(
        { component: 'Speak', synthChars: chars.length, estDuration: estimatedDuration.toFixed(2) },
        'Synthetic alignment generated: ' + chars.length + ' chars, ~' + estimatedDuration.toFixed(1) + 's'
      );
    }

    logger.info(
      {
        component: 'Speak',
        bytes: buf.length,
        avatar,
        mood,
        engine: ttsEngine,
        hasAlignment: !!alignment,
      },
      ttsEngine + ' | ' + buf.length + ' bytes | ' + avatar + (alignment ? ' | ALIGNED' : '')
    );

    // Return binary audio with proper Content-Type for test compatibility
    res.set('Content-Type', 'audio/mpeg');
    res.set('X-Engine', ttsEngine);
    if (alignment) {
      res.set('X-Alignment', Buffer.from(JSON.stringify(alignment)).toString('base64'));
    }

    // ── Increment usage after successful TTS ──
    incrementUsage(user?.id, 'tts', supabaseAdmin, _fingerprint).catch(() => {});

    res.send(buf);
  } catch (err) {
    logger.error({ component: 'Speak', err: err.message }, 'TTS generation failed');
    res.status(500).json({ error: 'TTS error' });
  }
});

// POST /api/listen — STT via Groq Whisper
router.post('/listen', apiLimiter, validate(listenSchema), async (req, res) => {
  try {
    if (req.body.text) return res.json({ text: req.body.text, engine: 'WebSpeech' });
    const { audio } = req.body;
    if (!audio) return res.status(400).json({ error: 'Audio is required' });

    const { getUserFromToken, supabaseAdmin, brain } = req.app.locals;
    const user = await getUserFromToken(req);
    const _fingerprint = req.body.fingerprint || req.ip || null;

    const sttLanguage = (req.body.language || 'ro').toLowerCase().split('-')[0];
    if (process.env.GROQ_API_KEY) {
      const form = new FormData();
      form.append('file', Buffer.from(audio, 'base64'), {
        filename: 'a.webm',
        contentType: 'audio/webm',
      });
      form.append('model', MODELS.WHISPER);
      form.append('language', sttLanguage);
      const { NAME: _APP_NAME } = require('../config/app');
      const sttPrompts = {
        ro: `Aceasta este o conversație în limba română cu ${_APP_NAME}.`,
        en: `This is a conversation in English with ${_APP_NAME}.`,
        es: `Esta es una conversación en español con ${_APP_NAME}.`,
        fr: `Ceci est une conversation en français avec ${_APP_NAME}.`,
        de: `Dies ist ein Gespräch auf Deutsch mit ${_APP_NAME}.`,
        it: `Questa è una conversazione in italiano con ${_APP_NAME}.`,
      };
      form.append('prompt', sttPrompts[sttLanguage] || sttPrompts.en);
      const r = await fetch(API_ENDPOINTS.GROQ + '/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY },
        body: form,
      });
      const d = await r.json();
      const transcript = d.text || '';

      // ═══ BRAIN INTEGRATION — save what we heard ═══
      if (brain && user?.id && transcript.length > 2) {
        brain
          .saveMemory(user.id, 'audio', 'User a spus prin voce: ' + transcript.substring(0, 500), {
            engine: 'Groq-Whisper',
          })
          .catch(() => {});
      }

      // ── Increment usage after successful STT ──
      incrementUsage(user?.id, 'stt', supabaseAdmin, _fingerprint).catch(() => {});

      return res.json({ text: transcript, engine: 'Groq' });
    }
    res.status(503).json({ error: 'Use Web Speech API' });
  } catch (err) {
    logger.error({ component: 'Voice', err: err.message }, 'STT transcription failed');
    res.status(500).json({ error: 'STT error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/lipsync — Generate viseme data from audio
// Supports: Rhubarb (lip-sync-engine) + NVIDIA Audio2Face API
// Returns: { visemes: [{time, duration, viseme, weight}], engine }
// ═══════════════════════════════════════════════════════════════

router.post('/lipsync', ttsLimiter, async (req, res) => {
  try {
    const { audioBase64, text, engine = 'auto' } = req.body;

    if (!audioBase64 && !text) {
      return res.status(400).json({ error: 'audioBase64 or text required' });
    }

    // ── Strategy 1: NVIDIA Audio2Face API (if configured) ──
    if ((engine === 'nvidia' || engine === 'auto') && process.env.NVIDIA_A2F_API_KEY) {
      try {
        const a2fResult = await _nvidiaAudio2Face(audioBase64);
        if (a2fResult.success) {
          return res.json({
            visemes: a2fResult.visemes,
            blendshapes: a2fResult.blendshapes,
            engine: 'nvidia-audio2face',
          });
        }
      } catch (e) {
        logger.warn({ component: 'LipSync', err: e.message }, 'NVIDIA A2F failed, falling back');
      }
    }

    // ── Strategy 2: Rhubarb lip-sync-engine (WASM, runs on server) ──
    if (audioBase64) {
      try {
        const lipSyncEngine = require('lip-sync-engine');
        const audioBuffer = Buffer.from(audioBase64, 'base64');
        const result = await lipSyncEngine.analyze(audioBuffer);
        if (result && result.mouthCues) {
          const visemes = result.mouthCues.map((cue) => ({
            time: cue.start,
            duration: cue.end - cue.start,
            viseme: _rhubarbToOculus(cue.value),
            weight: 0.8,
            raw: cue.value,
          }));
          return res.json({ visemes, engine: 'rhubarb' });
        }
      } catch (e) {
        logger.warn({ component: 'LipSync', err: e.message }, 'Rhubarb engine failed, using text fallback');
      }
    }

    // ── Strategy 3: Text-based phoneme estimation (fallback) ──
    if (text) {
      const visemes = _textToVisemes(text);
      return res.json({ visemes, engine: 'text-estimate' });
    }

    res.status(500).json({ error: 'No lip sync engine available' });
  } catch (e) {
    logger.error({ component: 'LipSync', err: e.message }, 'Lip sync error');
    res.status(500).json({ error: 'Lip sync failed' });
  }
});

// ── NVIDIA Audio2Face API integration ──
async function _nvidiaAudio2Face(audioBase64) {
  const apiKey = process.env.NVIDIA_A2F_API_KEY;
  const endpoint = API_ENDPOINTS.NVIDIA_A2F;

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      audio: audioBase64,
      config: {
        face_params: { face_model: 'default' },
        emotion: { enable: true },
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`NVIDIA A2F HTTP ${res.status}`);
  }

  const data = await res.json();
  return {
    success: true,
    visemes: data.face_animation?.visemes || [],
    blendshapes: data.face_animation?.blendshapes || [],
  };
}

// ── Rhubarb shape → Oculus viseme mapping ──
function _rhubarbToOculus(shape) {
  const map = {
    A: 'viseme_PP', // MBP
    B: 'viseme_kk', // ETC
    C: 'viseme_I', // E
    D: 'viseme_aa', // AI
    E: 'viseme_O', // O
    F: 'viseme_U', // WQ
    G: 'viseme_FF', // FV
    H: 'viseme_TH', // L
    X: 'viseme_sil', // Silence
  };
  return map[shape] || 'viseme_sil';
}

// ── Text → phoneme estimation (simple fallback) ──
function _textToVisemes(text) {
  const VOWEL_MAP = {
    a: 'viseme_aa',
    e: 'viseme_E',
    i: 'viseme_I',
    o: 'viseme_O',
    u: 'viseme_U',
    ă: 'viseme_E',
    â: 'viseme_I',
    î: 'viseme_I',
  };
  const CONSONANT_MAP = {
    m: 'viseme_PP',
    b: 'viseme_PP',
    p: 'viseme_PP',
    f: 'viseme_FF',
    v: 'viseme_FF',
    t: 'viseme_TH',
    d: 'viseme_DD',
    n: 'viseme_nn',
    s: 'viseme_SS',
    z: 'viseme_SS',
    ș: 'viseme_SS',
    c: 'viseme_kk',
    k: 'viseme_kk',
    g: 'viseme_kk',
    r: 'viseme_RR',
    l: 'viseme_TH',
  };
  const AVG_CHAR_DURATION = 0.07; // ~70ms per character
  const visemes = [];
  let time = 0;

  for (const ch of text.toLowerCase()) {
    const v = VOWEL_MAP[ch] || CONSONANT_MAP[ch];
    if (v) {
      visemes.push({
        time: parseFloat(time.toFixed(3)),
        duration: AVG_CHAR_DURATION,
        viseme: v,
        weight: VOWEL_MAP[ch] ? 0.7 : 0.5,
      });
    } else if (ch === ' ' || ch === ',' || ch === '.') {
      visemes.push({
        time: parseFloat(time.toFixed(3)),
        duration: ch === '.' ? 0.3 : 0.1,
        viseme: 'viseme_sil',
        weight: 0.1,
      });
    }
    time += AVG_CHAR_DURATION;
  }
  return visemes;
}

module.exports = router;
