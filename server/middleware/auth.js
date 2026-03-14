// ═══════════════════════════════════════════════════════════════
// KelionAI — Admin Auth Middleware
// Validates the x-admin-secret header using timing-safe comparison
// ═══════════════════════════════════════════════════════════════
"use strict";

const crypto = require("crypto");

/**
 * Express middleware that requires admin access via:
 * 1. x-admin-secret header (legacy, timing-safe comparison)
 * 2. OR Supabase JWT Bearer token for admin-email user
 */
function adminAuth(req, res, next) {
  // Method 1: x-admin-secret header
  const secret = req.headers["x-admin-secret"];
  const expected = process.env.ADMIN_SECRET_KEY;
  if (secret && expected) {
    try {
      const secretBuf = Buffer.from(secret);
      const expectedBuf = Buffer.from(expected);
      if (
        secretBuf.length === expectedBuf.length &&
        crypto.timingSafeEqual(secretBuf, expectedBuf)
      ) {
        return next(); // Secret matches — allow
      }
    } catch {
      /* fall through to JWT check */
    }
  }

  // Method 2: Supabase JWT — verify admin email
  const authHeader = req.headers["authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const _token = authHeader.slice(7);
    try {
      const { getUserFromToken } = req.app.locals;
      if (getUserFromToken) {
        getUserFromToken(req)
          .then((user) => {
            const adminEmail = (
              process.env.ADMIN_EMAIL || "adrianenc11@gmail.com"
            ).toLowerCase();
            if (user && user.email && user.email.toLowerCase() === adminEmail) {
              return next(); // Admin user authenticated via JWT
            }
            res.status(401).json({ error: "Unauthorized" });
          })
          .catch(() => res.status(401).json({ error: "Unauthorized" }));
        return; // async — don't fall through
      }
    } catch {
      /* fall through */
    }
  }

  res.status(401).json({ error: "Unauthorized" });
}

module.exports = { adminAuth };
