// ═══════════════════════════════════════════════════════════════
// KelionAI — Image Generation Routes
// ═══════════════════════════════════════════════════════════════
"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const logger = require("../logger");
const { validate, imagineSchema } = require("../validation");
const { checkUsage, incrementUsage } = require("../payments");
const { MODELS } = require("../config/models");

const router = express.Router();

// ═══ TIMEOUT HELPER — prevents hanging on slow/dead APIs ═══
function withTimeout(promise, ms = 10000, label = "operation") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

const imageLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  message: { error: "Too many image requests. Please wait a minute." },
  standardHeaders: true,
  legacyHeaders: false,
});

// POST /api/imagine — Together FLUX image generation
router.post("/", imageLimiter, validate(imagineSchema), async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin, brain } = req.app.locals;
    const { prompt } = req.body;
    if (!prompt || !process.env.TOGETHER_API_KEY)
      return res.status(503).json({ error: "Image generation unavailable" });

    const user = await getUserFromToken(req);
    const usage = await checkUsage(user?.id, "image", supabaseAdmin);
    if (!usage.allowed)
      return res.status(429).json({
        error: "Image limit reached. Upgrade to Pro for more images.",
        plan: usage.plan,
        limit: usage.limit,
        upgrade: true,
      });

    const r = await withTimeout(fetch("https://api.together.xyz/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + process.env.TOGETHER_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODELS.FLUX,
        prompt,
        width: 1024,
        height: 1024,
        steps: 4,
        n: 1,
        response_format: "b64_json",
      }),
    }), 30000, "generateImage:FLUX");
    if (!r.ok)
      return res.status(503).json({ error: "Image generation failed" });
    const d = await r.json();
    const b64 = d.data?.[0]?.b64_json;
    if (!b64) return res.status(500).json({ error: "No data" });
    incrementUsage(user?.id, "image", supabaseAdmin).catch((e) =>
      logger.warn(
        { component: "Images", err: e.message },
        "incrementUsage failed",
      ),
    );
    // ═══ BRAIN INTEGRATION — save what we generated ═══
    if (brain && user?.id) {
      brain.saveMemory(user.id, "visual", "Am generat imagine: " + prompt.substring(0, 400), { engine: "FLUX" }).catch(() => { });
    }
    res.json({ image: "data:image/png;base64," + b64, prompt, engine: "FLUX" });
  } catch {
    res.status(500).json({ error: "Image error" });
  }
});

module.exports = router;
