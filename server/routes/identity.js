// ═══════════════════════════════════════════════════════════════
// KelionAI — Identity Routes (Face Registration + Recognition)
// Feature 5: Face capture at registration, passive recognition
// ═══════════════════════════════════════════════════════════════
"use strict";

const express = require("express");
const rateLimit = require("express-rate-limit");
const logger = require("../logger");
const { MODELS } = require("../config/models");

const router = express.Router();

const identityLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Too many identity requests." },
  standardHeaders: true,
  legacyHeaders: false,
});

// ═══ POST /api/identity/register-face ═══
// Save face reference for the authenticated user at signup
router.post(
  "/identity/register-face",
  identityLimiter,
  express.json({ limit: "2mb" }),
  async (req, res) => {
    try {
      const { getUserFromToken, supabaseAdmin, brain } = req.app.locals;
      const user = await getUserFromToken(req);
      if (!user) return res.status(401).json({ error: "Unauthorized" });

      const { face } = req.body;
      if (!face) return res.status(400).json({ error: "face image required" });

      if (supabaseAdmin) {
        try {
          await supabaseAdmin.from("profiles").upsert(
            {
              id: user.id,
              face_reference: face.substring(0, 100000), // full face image base64 (320x240 JPEG ~10-30KB)
              updated_at: new Date().toISOString(),
            },
            { onConflict: "id" },
          );
        } catch (e) {
          logger.warn(
            { component: "Identity", err: e.message },
            "Face save failed",
          );
        }
      }

      // ═══ BRAIN INTEGRATION — remember face registration ═══
      if (brain) {
        brain.saveFact(user.id, "User a înregistrat referința facială", "identity", "face-register").catch(() => { });
      }

      logger.info(
        { component: "Identity", userId: user.id },
        "Face reference registered",
      );
      res.json({ success: true });
    } catch (e) {
      logger.error(
        { component: "Identity", err: e.message },
        "register-face error",
      );
      res.status(500).json({ error: "Internal error" });
    }
  },
);

// ═══ POST /api/identity/check ═══
// Compare submitted face against registered users using Claude Vision
router.post(
  "/identity/check",
  identityLimiter,
  express.json({ limit: "2mb" }),
  async (req, res) => {
    try {
      const { getUserFromToken, supabaseAdmin, brain } = req.app.locals;
      const { face } = req.body;
      if (!face) return res.status(400).json({ error: "face image required" });

      const user = await getUserFromToken(req);
      const isOwner = user?.role === "admin";

      // Check if this is the owner by comparing face with stored reference
      let ownerMatch = false;
      let matchedUser = null;

      if (supabaseAdmin && face) {
        try {
          // Get owner profile (admin role)
          const { data: ownerProfile } = await supabaseAdmin
            .from("profiles")
            .select("id, display_name, face_reference, preferred_language")
            .eq("role", "admin")
            .single();

          // Auto-update face_reference if too short (was truncated by old bug)
          if (ownerProfile && isOwner && face.length > 1000 && (!ownerProfile.face_reference || ownerProfile.face_reference.length < 1000)) {
            await supabaseAdmin.from("profiles").update({
              face_reference: face.substring(0, 100000),
              updated_at: new Date().toISOString(),
            }).eq("id", ownerProfile.id);
            logger.info({ component: "Identity" }, "Auto-updated face_reference (was truncated)");
            // Since we're the authenticated admin, grant access directly
            ownerMatch = true;
            matchedUser = { name: ownerProfile.display_name || "Owner", lang: ownerProfile.preferred_language || "en" };
          }

          if (!ownerMatch && ownerProfile?.face_reference && ownerProfile.face_reference.length > 1000 && process.env.OPENAI_API_KEY) {
            // Use OpenAI Vision to compare faces
            const r = await fetch(
              "https://api.openai.com/v1/chat/completions",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: "Bearer " + process.env.OPENAI_API_KEY,
                },
                body: JSON.stringify({
                  model: MODELS.OPENAI_VISION,
                  max_tokens: 10,
                  messages: [
                    {
                      role: "user",
                      content: [
                        {
                          type: "text",
                          text: "Do these two images show the same person? Reply only YES or NO.",
                        },
                        {
                          type: "image_url",
                          image_url: {
                            url:
                              "data:image/jpeg;base64," +
                              ownerProfile.face_reference,
                            detail: "low",
                          },
                        },
                        {
                          type: "image_url",
                          image_url: {
                            url: "data:image/jpeg;base64," + face,
                            detail: "low",
                          },
                        },
                      ],
                    },
                  ],
                }),
              },
            );
            const d = await r.json();
            const answer = d.choices?.[0]?.message?.content
              ?.trim()
              .toUpperCase();
            if (answer === "YES") {
              ownerMatch = true;
              matchedUser = {
                name: ownerProfile.display_name || "Owner",
                lang: ownerProfile.preferred_language || "en",
              };
              // Silent quality upgrade — if new photo is better, update reference quietly
              if (face.length > (ownerProfile.face_reference?.length || 0) + 500) {
                supabaseAdmin.from("profiles").update({
                  face_reference: face.substring(0, 100000),
                  updated_at: new Date().toISOString(),
                }).eq("id", ownerProfile.id).then(() => { }).catch(() => { });
              }
            }
          }
        } catch (e) {
          logger.warn(
            { component: "Identity", err: e.message },
            "Face comparison failed",
          );
        }
      }

      // ═══ BRAIN INTEGRATION — remember who was recognized ═══
      if (brain && user?.id && (ownerMatch || matchedUser)) {
        brain.saveMemory(user.id, "context", "Recunoaștere facială: " + (matchedUser?.name || "Owner") + " identificat", { type: "identity" }).catch(() => { });
      }

      const confirmed = ownerMatch || isOwner;
      const response = {
        isOwner: confirmed,
        user:
          matchedUser ||
          (user
            ? {
              name: user.name || user.email,
              lang: user.preferred_language || "en",
            }
            : null),
      };
      // If owner confirmed, include admin token for auto-auth
      if (confirmed && process.env.ADMIN_SECRET_KEY) {
        response.adminToken = process.env.ADMIN_SECRET_KEY;
      }
      res.json(response);
    } catch (e) {
      logger.error({ component: "Identity", err: e.message }, "check error");
      res.status(500).json({ error: "Internal error" });
    }
  },
);

module.exports = router;
