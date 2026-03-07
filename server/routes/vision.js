// ═══════════════════════════════════════════════════════════════
// KelionAI — Vision Routes (Brain-integrated)
// ═══════════════════════════════════════════════════════════════
"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const logger = require("../logger");
const { validate, visionSchema } = require("../validation");
const { checkUsage, incrementUsage } = require("../payments");
const { MODELS } = require("../config/models");

const router = express.Router();

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: "Too many API requests. Please wait 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/vision — GPT-5.4 Vision (primary) + Claude (fallback) — BRAIN-POWERED
router.post("/", apiLimiter, validate(visionSchema), async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin, brain } = req.app.locals;
    const { image, avatar = "kelion", language = "ro" } = req.body;
    if (!image)
      return res.status(503).json({ error: "Vision unavailable" });

    const user = await getUserFromToken(req);
    const usage = await checkUsage(user?.id, "vision", supabaseAdmin);
    if (!usage.allowed)
      return res.status(429).json({
        error: "Vision limit reached. Upgrade to Pro for more.",
        plan: usage.plan,
        limit: usage.limit,
        upgrade: true,
      });

    // Brain-aware prompt — includes personality + avatar context
    const LANGS = { ro: "română", en: "English" };
    const avatarName = avatar === "kira" ? "Kira" : "Kelion";
    const prompt = `You are ${avatarName}, an AI assistant with real personality.
You are looking through the user's camera — these are YOUR EYES.
Describe EXACTLY what you see with MAXIMUM PRECISION.
People: age, gender, clothing (exact colors), expression, gestures, what they hold.
Objects: each object, color, size, position.
Text: read ANY visible text.
Hazards: obstacles, steps → "CAUTION:"
At the END of your response, add an emotion tag based on what you see:
[EMOTION:happy] if pleasant scene, [EMOTION:curious] if interesting, [EMOTION:concerned] if hazards, [EMOTION:surprised] if unexpected.
Answer in ${LANGS[language] || "English"}, concise but detailed.`;

    let description = null;
    let engine = null;

    // PRIMARY: GPT-5.4 Vision
    if (process.env.OPENAI_API_KEY) {
      try {
        const r = await fetch("https://api.openai.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + process.env.OPENAI_API_KEY,
          },
          body: JSON.stringify({
            model: MODELS.OPENAI_VISION,
            max_tokens: 1024,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image_url",
                    image_url: { url: `data:image/jpeg;base64,${image}` },
                  },
                  { type: "text", text: prompt },
                ],
              },
            ],
          }),
        });
        const d = await r.json();
        description = d.choices?.[0]?.message?.content;
        if (description) engine = "GPT-5.4";
      } catch (e) {
        logger.warn({ component: "Vision", err: e.message }, "GPT-5.4 Vision failed");
      }
    }

    // FALLBACK: Claude Vision
    if (!description && process.env.ANTHROPIC_API_KEY) {
      try {
        const r = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": process.env.ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: MODELS.ANTHROPIC_CHAT,
            max_tokens: 1024,
            messages: [
              {
                role: "user",
                content: [
                  {
                    type: "image",
                    source: {
                      type: "base64",
                      media_type: "image/jpeg",
                      data: image,
                    },
                  },
                  { type: "text", text: prompt },
                ],
              },
            ],
          }),
        });
        const d = await r.json();
        description = d.content?.[0]?.text;
        if (description) engine = "Claude";
      } catch (e) {
        logger.warn({ component: "Vision", err: e.message }, "Claude Vision fallback failed");
      }
    }

    // ═══ BRAIN INTEGRATION — save visual memory + parse emotion ═══
    let emotion = "neutral";
    if (description) {
      // Parse emotion tag from vision response
      const emotionMatch = description.match(/\[EMOTION:(\w+)\]/i);
      if (emotionMatch) {
        emotion = emotionMatch[1].toLowerCase();
        description = description.replace(/\[EMOTION:\w+\]/gi, "").trim();
      }

      // Save to brain memory so brain remembers what it saw
      if (brain && user?.id) {
        brain.saveMemory(user.id, "visual", "Am văzut: " + description.substring(0, 500), {
          avatar, language, engine, emotion,
        }).catch((e) => logger.warn({ component: "Vision", err: e.message }, "brain.saveMemory failed"));
      }
    }

    incrementUsage(user?.id, "vision", supabaseAdmin).catch((e) =>
      logger.warn(
        { component: "Vision", err: e.message },
        "incrementUsage failed",
      ),
    );

    logger.info({ component: "Vision", engine, emotion, userId: user?.id }, "Vision analysis complete");

    res.json({
      description: description || "Could not analyze.",
      avatar,
      engine: engine || "none",
      emotion,
    });
  } catch (e) {
    logger.error({ component: "Vision", err: e.message }, "Vision error");
    res.status(500).json({ error: "Vision error" });
  }
});

module.exports = router;
