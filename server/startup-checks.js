// ═══════════════════════════════════════════════════════════════
// KelionAI — Startup Safety Checks
// 1. Env validation — warns about missing critical vars
// 2. Graceful shutdown — handles SIGTERM cleanly
// 3. Smoke test — pings internal routes after server starts
// ═══════════════════════════════════════════════════════════════
"use strict";

const logger = require("./logger");

// ── 1. ENV VALIDATION ──
// Groups: CRITICAL = server won't work, WARN = features degraded
const ENV_GROUPS = {
  critical: [
    { key: "SUPABASE_URL", label: "Database" },
    { key: "SUPABASE_ANON_KEY", label: "Database auth" },
    { key: "SUPABASE_SERVICE_KEY", label: "Database admin" },
  ],
  ai: [
    { key: "OPENAI_API_KEY", label: "GPT (chat, TTS, STT, vision)" },
    { key: "GOOGLE_AI_KEY", label: "Gemini (chat, vision, tools)" },
    { key: "GROQ_API_KEY", label: "Groq (fast reasoning)" },
  ],
  search: [
    { key: "TAVILY_API_KEY", label: "Tavily search" },
    { key: "SERPER_API_KEY", label: "Serper search" },
    { key: "PERPLEXITY_API_KEY", label: "Perplexity search" },
  ],
  voice: [{ key: "ELEVENLABS_API_KEY", label: "ElevenLabs TTS" }],
  payments: [
    { key: "STRIPE_SECRET_KEY", label: "Stripe payments" },
    { key: "STRIPE_WEBHOOK_SECRET", label: "Stripe webhooks" },
  ],
  social: [
    { key: "TELEGRAM_BOT_TOKEN", label: "Telegram bot" },
    { key: "FB_PAGE_ACCESS_TOKEN", label: "Facebook/Messenger" },
  ],
  security: [
    { key: "ADMIN_SECRET_KEY", label: "Admin access" },
    { key: "APP_URL", label: "Application URL" },
  ],
};

function validateEnv() {
  const results = { ok: [], missing: [], groups: {} };

  for (const [group, vars] of Object.entries(ENV_GROUPS)) {
    const groupMissing = [];
    for (const v of vars) {
      if (process.env[v.key]) {
        results.ok.push(v.key);
      } else {
        results.missing.push({ key: v.key, label: v.label, group });
        groupMissing.push(v.label);
      }
    }
    results.groups[group] =
      groupMissing.length === 0 ? "OK" : `MISSING: ${groupMissing.join(", ")}`;
  }

  // Critical check
  const criticalMissing = results.missing.filter((m) => m.group === "critical");
  if (criticalMissing.length > 0) {
    logger.error(
      { component: "EnvCheck", missing: criticalMissing.map((m) => m.key) },
      `❌ CRITICAL: ${criticalMissing.map((m) => m.label).join(", ")} — server may not function`,
    );
  }

  // Warn about missing optional
  const optionalMissing = results.missing.filter((m) => m.group !== "critical");
  if (optionalMissing.length > 0) {
    logger.warn(
      { component: "EnvCheck", missing: optionalMissing.map((m) => m.key) },
      `⚠️ Missing optional: ${optionalMissing.map((m) => m.label).join(", ")}`,
    );
  }

  // AI check — at least one AI key required
  const hasAI = ENV_GROUPS.ai.some((v) => process.env[v.key]);
  if (!hasAI) {
    logger.error(
      { component: "EnvCheck" },
      "❌ CRITICAL: No AI provider key configured (OPENAI/GOOGLE_AI/GROQ) — chat will not work",
    );
  }

  logger.info(
    {
      component: "EnvCheck",
      ok: results.ok.length,
      missing: results.missing.length,
    },
    `🔑 Env check: ${results.ok.length} OK, ${results.missing.length} missing`,
  );

  return results;
}

// ── 2. GRACEFUL SHUTDOWN ──
function setupGracefulShutdown(server) {
  let shuttingDown = false;

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(
      { component: "Shutdown", signal },
      `🛑 ${signal} received — shutting down gracefully`,
    );

    // Stop K1 scheduled jobs (forgetting, self-test)
    try {
      const k1Meta = require("./k1-meta-learning");
      k1Meta.stopScheduledJobs();
      logger.info({ component: "Shutdown" }, "✅ K1 scheduled jobs stopped");
    } catch { /* ignored */ }

    // Save K1 state before exit
    try {
      const k1Persist = require("./k1-persistence");
      const { supabaseAdmin: sb } = require("./supabase");
      await k1Persist.saveState(sb);
      logger.info({ component: "Shutdown" }, "✅ K1 state saved to Supabase");
    } catch { /* ignored */ }

    // Stop accepting new connections
    server.close(() => {
      logger.info({ component: "Shutdown" }, "✅ HTTP server closed");
      process.exit(0);
    });

    // Force exit after 10s if graceful shutdown hangs
    setTimeout(() => {
      logger.warn(
        { component: "Shutdown" },
        "⚠️ Forced exit after 10s timeout",
      );
      process.exit(1);
    }, 10000).unref();
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  logger.info(
    { component: "Shutdown" },
    "🛡️ Graceful shutdown handlers registered",
  );
}

// ── 3. INTERNAL SMOKE TEST ──
async function smokeTest(port) {
  const routes = [
    { path: "/health", expect: 200 },
    { path: "/api/health", expect: 200 },
  ];

  const results = [];
  for (const route of routes) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}${route.path}`, {
        signal: AbortSignal.timeout(5000),
      });
      const ok = r.status === route.expect;
      results.push({ path: route.path, status: r.status, ok });
      if (!ok) {
        logger.warn(
          { component: "SmokeTest", path: route.path, status: r.status },
          `⚠️ ${route.path} returned ${r.status} (expected ${route.expect})`,
        );
      }
    } catch (e) {
      results.push({
        path: route.path,
        status: "ERROR",
        ok: false,
        error: e.message,
      });
      logger.warn(
        { component: "SmokeTest", path: route.path, err: e.message },
        `⚠️ ${route.path} failed: ${e.message}`,
      );
    }
  }

  const passed = results.filter((r) => r.ok).length;
  logger.info(
    { component: "SmokeTest", passed, total: results.length },
    `🧪 Smoke test: ${passed}/${results.length} routes OK`,
  );

  return results;
}

module.exports = { validateEnv, setupGracefulShutdown, smokeTest };
