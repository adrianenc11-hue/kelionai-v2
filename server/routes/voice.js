// ═══════════════════════════════════════════════════════════════
// KelionAI — Voice Routes (TTS + STT)
// ═══════════════════════════════════════════════════════════════
"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const FormData = require("form-data");
const logger = require("../logger");
const { getVoiceId, VOICES } = require("../config/voices");
const { validate, speakSchema, listenSchema } = require("../validation");
const { checkUsage, incrementUsage } = require("../payments");
const { MODELS, VOICE_EMOTIONS } = require("../config/models");

const router = express.Router();

const ttsLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Too many TTS requests. Please wait a minute." },
  standardHeaders: true,
  legacyHeaders: false,
});
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many API requests. Please wait 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// GET /api/voices — list all available TTS voices
router.get("/voices", (req, res) => {
  const LANG_NAMES = {
    ro: "Romanian",
    en: "English",
    es: "Spanish",
    fr: "French",
    de: "German",
    it: "Italian",
    pt: "Portuguese",
    ru: "Russian",
    ja: "Japanese",
    zh: "Chinese",
    ko: "Korean",
    ar: "Arabic",
    hi: "Hindi",
    tr: "Turkish",
    pl: "Polish",
    nl: "Dutch",
    sv: "Swedish",
    no: "Norwegian",
    da: "Danish",
    fi: "Finnish",
    cs: "Czech",
    sk: "Slovak",
    hu: "Hungarian",
    hr: "Croatian",
    bg: "Bulgarian",
    el: "Greek",
    he: "Hebrew",
    uk: "Ukrainian",
    vi: "Vietnamese",
    th: "Thai",
    id: "Indonesian",
    ms: "Malay",
    sw: "Swahili",
  };
  const voices = [];
  for (const [lang, avatars] of Object.entries(VOICES)) {
    for (const [avatar, voiceId] of Object.entries(avatars)) {
      voices.push({
        language: lang,
        languageName: LANG_NAMES[lang] || lang,
        avatar,
        voiceId,
        engine: "ElevenLabs",
      });
    }
  }
  res.json({
    count: voices.length,
    engines: ["ElevenLabs", "OpenAI"],
    voices,
  });
});

// POST /api/speak — TTS via ElevenLabs
router.post("/speak", ttsLimiter, validate(speakSchema), async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const { text, avatar = "kelion", mood = "neutral" } = req.body;
    const language = req.body.language || "ro";
    if (!text || !process.env.ELEVENLABS_API_KEY)
      return res.status(503).json({ error: "TTS unavailable" });

    const user = await getUserFromToken(req);
    const usage = await checkUsage(user?.id, "tts", supabaseAdmin);
    if (!usage.allowed)
      return res.status(429).json({
        error: "TTS limit reached. Upgrade to Pro for more.",
        plan: usage.plan,
        limit: usage.limit,
        upgrade: true,
      });

    const selectedVoiceSettings =
      VOICE_EMOTIONS[mood] || VOICE_EMOTIONS.neutral;

    // Check if user has a cloned voice — overrides default
    let vid = null;
    if (user && supabaseAdmin) {
      try {
        const { data } = await supabaseAdmin
          .from("user_preferences")
          .select("value")
          .eq("user_id", user.id)
          .eq("key", "cloned_voice_id")
          .single();
        if (data?.value?.voice_id) {
          vid = data.value.voice_id;
          logger.info(
            { component: "Speak", clonedVoice: true, voiceId: vid },
            "Using cloned voice",
          );
        }
      } catch (e) {
        logger.warn(
          { component: "Voice", err: e.message },
          "no cloned voice, use default",
        );
      }
    }
    // Fallback to language-based native voice
    if (!vid) vid = getVoiceId(avatar, language);

    let buf = null;
    let alignment = null;
    let ttsEngine = "ElevenLabs";

    // ── TRY 1: ElevenLabs with timestamps (timeout 10s → fallback to OpenAI) ──
    if (process.env.ELEVENLABS_API_KEY) {
      try {
        const el11Ctrl = new AbortController();
        const el11Timer = setTimeout(() => el11Ctrl.abort(), 10000);
        const r = await fetch(
          "https://api.elevenlabs.io/v1/text-to-speech/" +
            vid +
            "/with-timestamps",
          {
            method: "POST",
            signal: el11Ctrl.signal,
            headers: {
              "Content-Type": "application/json",
              "xi-api-key": process.env.ELEVENLABS_API_KEY,
            },
            body: JSON.stringify({
              text,
              model_id: MODELS.ELEVENLABS_MODEL,
              voice_settings: selectedVoiceSettings,
            }),
          },
        );
        clearTimeout(el11Timer);
        if (r.ok) {
          const data = await r.json();
          if (data.audio_base64) {
            buf = Buffer.from(data.audio_base64, "base64");
            alignment = data.alignment || null;
            logger.info(
              { component: "Speak", alignmentChars: alignment?.characters?.length || 0 },
              "ElevenLabs OK: " + (alignment?.characters?.length || 0) + " chars",
            );
          }
        } else {
          const errBody = await r.text().catch(() => "");
          logger.warn(
            { component: "Speak", status: r.status, error: errBody.substring(0, 200) },
            "ElevenLabs TTS failed: " + r.status + " — trying OpenAI fallback",
          );
        }
      } catch (e) {
        logger.warn(
          { component: "Speak", err: e.message },
          "ElevenLabs TTS error (timeout?) — trying OpenAI fallback",
        );
      }
    }

    // ── TRY 2: OpenAI TTS fallback (timeout 12s) ──
    let openaiErr = "no OPENAI_API_KEY";
    if (!buf && process.env.OPENAI_API_KEY) {
      try {
        const oaiCtrl = new AbortController();
        const oaiTimer = setTimeout(() => oaiCtrl.abort(), 12000);
        const openaiVoice = avatar === "kira" ? "nova" : "onyx";
        const r2 = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
          signal: oaiCtrl.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + process.env.OPENAI_API_KEY,
          },
          body: JSON.stringify({
            model: MODELS.OPENAI_TTS,
            input: text,
            voice: openaiVoice,
            response_format: "mp3",
          }),
        });
        clearTimeout(oaiTimer);
        if (r2.ok) {
          buf = Buffer.from(await r2.arrayBuffer());
          ttsEngine = "OpenAI";
          alignment = null;
        } else {
          openaiErr = r2.status + ": " + (await r2.text().catch(() => "")).substring(0, 200);
          logger.error({ component: "Speak", status: r2.status, error: openaiErr }, "OpenAI TTS failed: " + r2.status);
        }
      } catch (e) {
        openaiErr = e.message;
        logger.error({ component: "Speak", err: e.message }, "OpenAI TTS error");
      }
    }

    if (!buf)
      return res
        .status(503)
        .json({ error: "TTS unavailable", openai: openaiErr });

    logger.info(
      {
        component: "Speak",
        bytes: buf.length,
        avatar,
        mood,
        engine: ttsEngine,
        hasAlignment: !!alignment,
      },
      ttsEngine +
        " | " +
        buf.length +
        " bytes | " +
        avatar +
        (alignment ? " | ALIGNED" : ""),
    );
    incrementUsage(user?.id, "tts", supabaseAdmin).catch((e) =>
      logger.warn(
        { component: "Voice", err: e.message },
        "incrementUsage failed",
      ),
    );
    // Return binary audio with proper Content-Type for test compatibility
    res.set('Content-Type', 'audio/mpeg');
    res.set('X-Engine', ttsEngine);
    if (alignment) {
      res.set('X-Alignment', Buffer.from(JSON.stringify(alignment)).toString('base64'));
    }
    res.send(buf);
  } catch {
    res.status(500).json({ error: "TTS error" });
  }
});

// POST /api/listen — STT via Groq Whisper
router.post("/listen", apiLimiter, validate(listenSchema), async (req, res) => {
  try {
    if (req.body.text)
      return res.json({ text: req.body.text, engine: "WebSpeech" });
    const { audio } = req.body;
    if (!audio) return res.status(400).json({ error: "Audio is required" });

    const { getUserFromToken, supabaseAdmin, brain } = req.app.locals;
    const user = await getUserFromToken(req);
    const usage = await checkUsage(user?.id, "stt", supabaseAdmin);
    if (!usage.allowed)
      return res.status(429).json({
        error: "STT limit reached. Upgrade to Pro for more.",
        plan: usage.plan,
        limit: usage.limit,
        upgrade: true,
      });

    if (process.env.GROQ_API_KEY) {
      const form = new FormData();
      form.append("file", Buffer.from(audio, "base64"), {
        filename: "a.webm",
        contentType: "audio/webm",
      });
      form.append("model", MODELS.WHISPER);
      form.append("language", "ro");
      form.append(
        "prompt",
        "Aceasta este o conversație în limba română cu KelionAI.",
      );
      const r = await fetch(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        {
          method: "POST",
          headers: { Authorization: "Bearer " + process.env.GROQ_API_KEY },
          body: form,
        },
      );
      const d = await r.json();
      const transcript = d.text || "";

      // ═══ BRAIN INTEGRATION — save what we heard ═══
      if (brain && user?.id && transcript.length > 2) {
        brain
          .saveMemory(
            user.id,
            "audio",
            "User a spus prin voce: " + transcript.substring(0, 500),
            {
              engine: "Groq-Whisper",
            },
          )
          .catch(() => {});
      }

      incrementUsage(user?.id, "stt", supabaseAdmin).catch((e) =>
        logger.warn(
          { component: "Voice", err: e.message },
          "incrementUsage failed",
        ),
      );
      return res.json({ text: transcript, engine: "Groq" });
    }
    res.status(503).json({ error: "Use Web Speech API" });
  } catch {
    res.status(500).json({ error: "STT error" });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/lipsync — Generate viseme data from audio
// Supports: Rhubarb (lip-sync-engine) + NVIDIA Audio2Face API
// Returns: { visemes: [{time, duration, viseme, weight}], engine }
// ═══════════════════════════════════════════════════════════════

router.post("/lipsync", ttsLimiter, async (req, res) => {
  try {
    const { audioBase64, text, engine = "auto" } = req.body;

    if (!audioBase64 && !text) {
      return res.status(400).json({ error: "audioBase64 or text required" });
    }

    // ── Strategy 1: NVIDIA Audio2Face API (if configured) ──
    if (
      (engine === "nvidia" || engine === "auto") &&
      process.env.NVIDIA_A2F_API_KEY
    ) {
      try {
        const a2fResult = await _nvidiaAudio2Face(audioBase64);
        if (a2fResult.success) {
          return res.json({
            visemes: a2fResult.visemes,
            blendshapes: a2fResult.blendshapes,
            engine: "nvidia-audio2face",
          });
        }
      } catch (e) {
        logger.warn(
          { component: "LipSync", err: e.message },
          "NVIDIA A2F failed, falling back",
        );
      }
    }

    // ── Strategy 2: Rhubarb lip-sync-engine (WASM, runs on server) ──
    if (audioBase64) {
      try {
        const lipSyncEngine = require("lip-sync-engine");
        const audioBuffer = Buffer.from(audioBase64, "base64");
        const result = await lipSyncEngine.analyze(audioBuffer);
        if (result && result.mouthCues) {
          const visemes = result.mouthCues.map((cue) => ({
            time: cue.start,
            duration: cue.end - cue.start,
            viseme: _rhubarbToOculus(cue.value),
            weight: 0.8,
            raw: cue.value,
          }));
          return res.json({ visemes, engine: "rhubarb" });
        }
      } catch (e) {
        logger.warn(
          { component: "LipSync", err: e.message },
          "Rhubarb engine failed, using text fallback",
        );
      }
    }

    // ── Strategy 3: Text-based phoneme estimation (fallback) ──
    if (text) {
      const visemes = _textToVisemes(text);
      return res.json({ visemes, engine: "text-estimate" });
    }

    res.status(500).json({ error: "No lip sync engine available" });
  } catch (e) {
    logger.error({ component: "LipSync", err: e.message }, "Lip sync error");
    res.status(500).json({ error: "Lip sync failed" });
  }
});

// ── NVIDIA Audio2Face API integration ──
async function _nvidiaAudio2Face(audioBase64) {
  const apiKey = process.env.NVIDIA_A2F_API_KEY;
  const endpoint =
    process.env.NVIDIA_A2F_ENDPOINT ||
    "https://grpc.nvcf.nvidia.com/nvidia/audio2face";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      audio: audioBase64,
      config: {
        face_params: { face_model: "default" },
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
    A: "viseme_PP", // MBP
    B: "viseme_kk", // ETC
    C: "viseme_I", // E
    D: "viseme_aa", // AI
    E: "viseme_O", // O
    F: "viseme_U", // WQ
    G: "viseme_FF", // FV
    H: "viseme_TH", // L
    X: "viseme_sil", // Silence
  };
  return map[shape] || "viseme_sil";
}

// ── Text → phoneme estimation (simple fallback) ──
function _textToVisemes(text) {
  const VOWEL_MAP = {
    a: "viseme_aa",
    e: "viseme_E",
    i: "viseme_I",
    o: "viseme_O",
    u: "viseme_U",
    ă: "viseme_E",
    â: "viseme_I",
    î: "viseme_I",
  };
  const CONSONANT_MAP = {
    m: "viseme_PP",
    b: "viseme_PP",
    p: "viseme_PP",
    f: "viseme_FF",
    v: "viseme_FF",
    t: "viseme_TH",
    d: "viseme_DD",
    n: "viseme_nn",
    s: "viseme_SS",
    z: "viseme_SS",
    ș: "viseme_SS",
    c: "viseme_kk",
    k: "viseme_kk",
    g: "viseme_kk",
    r: "viseme_RR",
    l: "viseme_TH",
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
    } else if (ch === " " || ch === "," || ch === ".") {
      visemes.push({
        time: parseFloat(time.toFixed(3)),
        duration: ch === "." ? 0.3 : 0.1,
        viseme: "viseme_sil",
        weight: 0.1,
      });
    }
    time += AVG_CHAR_DURATION;
  }
  return visemes;
}

module.exports = router;
