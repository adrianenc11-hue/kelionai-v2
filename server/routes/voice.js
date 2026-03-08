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
    ro: "Romanian", en: "English", es: "Spanish", fr: "French",
    de: "German", it: "Italian", pt: "Portuguese", ru: "Russian",
    ja: "Japanese", zh: "Chinese", ko: "Korean", ar: "Arabic",
    hi: "Hindi", tr: "Turkish", pl: "Polish", nl: "Dutch",
    sv: "Swedish", no: "Norwegian", da: "Danish", fi: "Finnish",
    cs: "Czech", sk: "Slovak", hu: "Hungarian", hr: "Croatian",
    bg: "Bulgarian", el: "Greek", he: "Hebrew", uk: "Ukrainian",
    vi: "Vietnamese", th: "Thai", id: "Indonesian", ms: "Malay",
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

    const selectedVoiceSettings = VOICE_EMOTIONS[mood] || VOICE_EMOTIONS.neutral;

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

    // ── TRY 1: ElevenLabs with timestamps (premium quality + lip sync alignment) ──
    if (process.env.ELEVENLABS_API_KEY) {
      try {
        const r = await fetch(
          "https://api.elevenlabs.io/v1/text-to-speech/" + vid + "/with-timestamps",
          {
            method: "POST",
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
        if (r.ok) {
          const data = await r.json();
          // data = { audio_base64, alignment, normalized_alignment }
          if (data.audio_base64) {
            buf = Buffer.from(data.audio_base64, "base64");
            alignment = data.alignment || null;
            logger.info(
              { component: "Speak", alignmentChars: alignment?.characters?.length || 0 },
              "ElevenLabs alignment received: " + (alignment?.characters?.length || 0) + " chars",
            );
          }
        } else {
          const errBody = await r.text().catch(() => "");
          logger.warn(
            { component: "Speak", status: r.status, voiceId: vid, error: errBody.substring(0, 200) },
            "ElevenLabs TTS failed: " + r.status + " — trying OpenAI fallback",
          );
        }
      } catch (e) {
        logger.warn({ component: "Speak", err: e.message }, "ElevenLabs TTS error — trying OpenAI fallback");
      }
    }

    // ── TRY 2: OpenAI TTS (fallback — no alignment available) ──
    let openaiErr = "no OPENAI_API_KEY";
    if (!buf && process.env.OPENAI_API_KEY) {
      try {
        const openaiVoice = avatar === "kira" ? "nova" : "onyx";
        const r2 = await fetch("https://api.openai.com/v1/audio/speech", {
          method: "POST",
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
        if (r2.ok) {
          buf = Buffer.from(await r2.arrayBuffer());
          ttsEngine = "OpenAI";
          alignment = null; // OpenAI has no alignment data
        } else {
          openaiErr = r2.status + ": " + (await r2.text().catch(() => "")).substring(0, 200);
          logger.error(
            { component: "Speak", status: r2.status, error: openaiErr },
            "OpenAI TTS also failed: " + r2.status,
          );
        }
      } catch (e) {
        openaiErr = e.message;
        logger.error({ component: "Speak", err: e.message }, "OpenAI TTS error");
      }
    }

    if (!buf) return res.status(503).json({ error: "TTS unavailable", openai: openaiErr });

    logger.info(
      { component: "Speak", bytes: buf.length, avatar, mood, engine: ttsEngine, hasAlignment: !!alignment },
      ttsEngine + " | " + buf.length + " bytes | " + avatar + (alignment ? " | ALIGNED" : ""),
    );
    incrementUsage(user?.id, "tts", supabaseAdmin).catch((e) =>
      logger.warn(
        { component: "Voice", err: e.message },
        "incrementUsage failed",
      ),
    );
    // Return JSON with base64 audio + alignment data for professional lip sync
    res.json({
      audio: buf.toString("base64"),
      alignment: alignment,
      engine: ttsEngine,
    });
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
        brain.saveMemory(user.id, "audio", "User a spus prin voce: " + transcript.substring(0, 500), {
          engine: "Groq-Whisper",
        }).catch(() => { });
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

module.exports = router;
