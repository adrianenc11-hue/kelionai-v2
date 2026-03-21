// ═══════════════════════════════════════════════════════════════
// KelionAI — Health Routes
// ═══════════════════════════════════════════════════════════════
"use strict";

const express = require("express");
const router = express.Router();
const { version } = require("../../package.json");

// GET /api/health
router.get("/", (req, res) => {
  const { brain, supabase, supabaseAdmin } = req.app.locals;
  const diag = brain
    ? brain.getDiagnostics()
    : { status: "no-brain", conversations: 0 };
  res.json({
    status: "ok",
    version,
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    brain: diag.status,
    conversations: diag.conversations,
    services: {
      ai_gemini: !!(process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY),
      ai_gpt4o: !!process.env.OPENAI_API_KEY,
      ai_deepseek: !!process.env.DEEPSEEK_API_KEY,
      tts: !!process.env.ELEVENLABS_API_KEY,
      stt_groq: !!process.env.GROQ_API_KEY,
      stt_openai: !!process.env.OPENAI_API_KEY,
      vision: !!(process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY),
      search_perplexity: !!process.env.PERPLEXITY_API_KEY,
      search_tavily: !!process.env.TAVILY_API_KEY,
      search_serper: !!process.env.SERPER_API_KEY,
      search_ddg: true,
      weather: true,
      images: !!process.env.TOGETHER_API_KEY,
      maps: !!process.env.GOOGLE_MAPS_KEY,
      payments: !!process.env.STRIPE_SECRET_KEY,
      stripe_webhook: !!process.env.STRIPE_WEBHOOK_SECRET,
      session_secret: !!process.env.SESSION_SECRET,
      referral_secret: !!process.env.REFERRAL_SECRET,
      sentry: !!process.env.SENTRY_DSN,
      auth: !!supabase,
      database: !!supabaseAdmin,
      telegram: !!process.env.TELEGRAM_BOT_TOKEN,
    },
  });
});

// GET /api/health/brain-debug — Raw brain error state (temporary diagnostic)
router.get("/brain-debug", (req, res) => {
  const { brain } = req.app.locals;
  if (!brain) return res.json({ error: "no brain" });
  const diag = brain.getDiagnostics();
  res.json({
    uptime: process.uptime(),
    conversations: brain.conversationCount,
    toolErrors: brain.toolErrors,
    errorLog: brain.errorLog.slice(-10),
    status: diag.status,
    degradedTools: diag.degradedTools || diag.failedTools,
    recentErrorCount: diag.recentErrors,
  });
});

// GET /api/health/test-tables — Test all 28 Supabase tables (read-only)
router.get("/test-tables", async (req, res) => {
  const { supabaseAdmin } = req.app.locals;
  if (!supabaseAdmin)
    return res.status(503).json({ error: "No Supabase connection" });

  const TABLES = [
    "conversations",
    "messages",
    "user_preferences",
    "api_keys",
    "admin_logs",

    "profiles",
    "media_history",
    "telegram_users",

    "cookie_consents",
    "metrics_snapshots",
    "ai_costs",
    "page_views",
    "subscriptions",
    "referrals",
    "admin_codes",
    "brain_memory",
    "learned_facts",
    "telegram_messages",

  ];

  const results = [];
  let passed = 0;
  let failed = 0;

  for (const table of TABLES) {
    try {
      const { error, count } = await supabaseAdmin
        .from(table)
        .select("*", { count: "exact", head: true });

      if (error) {
        failed++;
        results.push({
          table,
          status: "ERROR",
          error: error.message,
          code: error.code,
          hint: error.hint || null,
        });
      } else {
        passed++;
        results.push({ table, status: "OK", rowCount: count || 0 });
      }
    } catch (e) {
      failed++;
      results.push({ table, status: "CRASH", error: e.message });
    }
  }

  res.json({
    summary: {
      total: TABLES.length,
      passed,
      failed,
      allOk: failed === 0,
      testedAt: new Date().toISOString(),
    },
    results,
    errors: results.filter((r) => r.status !== "OK"),
  });
});

module.exports = router;
