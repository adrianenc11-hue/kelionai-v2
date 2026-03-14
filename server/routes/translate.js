// ═══════════════════════════════════════════════════════════
// KelionAI — Translate API (lightweight, no brain)
// Uses Gemini flash for fast translation
// ═══════════════════════════════════════════════════════════
const express = require("express");
const router = express.Router();
const logger = require("../logger");
const rateLimit = require("express-rate-limit");

const translateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60, // 60 translations per minute
  message: { error: "Too many translation requests" },
});

// POST /api/translate
// Body: { text, targetLang, sourceLang? }
// Returns: { translated, detectedLang, targetLang }
router.post("/translate", translateLimiter, async (req, res) => {
  try {
    const { text, targetLang = "ro", sourceLang } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ error: "Text is required" });
    }

    const geminiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      return res.status(503).json({ error: "Translation service unavailable" });
    }

    const MODELS = require("../config/models");
    const model = MODELS.GEMINI_CHAT;

    const prompt = sourceLang
      ? `Translate the following text from ${sourceLang} to ${targetLang}. Return ONLY the translated text, nothing else. No explanations, no quotes, no formatting.\n\nText: ${text}`
      : `Detect the language of the following text and translate it to ${targetLang}. Return ONLY a JSON object like {"translated":"...","detectedLang":"xx"} where xx is the ISO 639-1 language code. No markdown, no code blocks, just raw JSON.\n\nText: ${text}`;

    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            maxOutputTokens: 1024,
            temperature: 0.1, // Low temp for accurate translation
          },
        }),
        signal: AbortSignal.timeout(10000),
      },
    );

    if (!r.ok) {
      const err = await r.text();
      logger.warn({ component: "Translate", err }, "Gemini translate failed");
      return res.status(502).json({ error: "Translation failed" });
    }

    const data = await r.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";

    if (!raw) {
      return res.status(502).json({ error: "Empty translation result" });
    }

    // If we asked for JSON (auto-detect), parse it
    if (!sourceLang) {
      try {
        // Clean markdown code block if present
        const cleaned = raw
          .replace(/^```json\s*/i, "")
          .replace(/```\s*$/, "")
          .trim();
        const parsed = JSON.parse(cleaned);
        return res.json({
          translated: parsed.translated || raw,
          detectedLang: parsed.detectedLang || "unknown",
          targetLang,
        });
      } catch (_e) {
        // Gemini didn't return JSON — use raw text
        return res.json({
          translated: raw,
          detectedLang: "unknown",
          targetLang,
        });
      }
    }

    // Direct translation (sourceLang provided)
    res.json({
      translated: raw,
      detectedLang: sourceLang,
      targetLang,
    });
  } catch (e) {
    logger.error(
      { component: "Translate", err: e.message },
      "Translation error",
    );
    res.status(500).json({ error: "Translation error" });
  }
});

module.exports = router;
