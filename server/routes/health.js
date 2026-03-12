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
      whatsapp: !!(
        process.env.WA_ACCESS_TOKEN ||
        process.env.WHATSAPP_TOKEN ||
        process.env.WHATSAPP_ACCESS_TOKEN
      ),
      whatsapp_phone: !!(
        process.env.WA_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID
      ),
      telegram: !!process.env.TELEGRAM_BOT_TOKEN,
      messenger: !!process.env.MESSENGER_PAGE_TOKEN,
      facebook_page: !!process.env.FACEBOOK_PAGE_TOKEN,
      instagram: !!process.env.INSTAGRAM_TOKEN,
      trading_binance: !!process.env.BINANCE_API_KEY,
      trading_mode: process.env.BINANCE_API_KEY
        ? process.env.BINANCE_TESTNET === "true"
          ? "TESTNET"
          : "LIVE"
        : "PAPER",
    },
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
    "trades",
    "profiles",
    "media_history",
    "telegram_users",
    "whatsapp_users",
    "whatsapp_messages",
    "trade_intelligence",
    "cookie_consents",
    "metrics_snapshots",
    "ai_costs",
    "page_views",
    "subscriptions",
    "referrals",
    "admin_codes",
    "brain_memory",
    "learned_facts",
    "messenger_users",
    "messenger_messages",
    "messenger_subscribers",
    "telegram_messages",
    "market_candles",
    "market_learnings",
    "market_patterns",
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
