// ═══════════════════════════════════════════════════════════════
// KelionAI — Service Health Monitor v1
// Probes external APIs → Alerts on degradation → Auto-repair
// Runs every 10 minutes, sends alerts via Telegram + admin panel
// ═══════════════════════════════════════════════════════════════
"use strict";

const logger = require("./logger");

const PROBE_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const ALERT_COOLDOWN_MS = 30 * 60 * 1000; // 30 min between same alerts
const CONSECUTIVE_FAILURES_ALERT = 2;     // alert after 2 consecutive fails

// Service status tracking
const _serviceStatus = {};
let _probeInterval = null;
let _isProbing = false;

// ── Error Classification ──
function _classifyError(errMsg) {
  const msg = (errMsg || "").toLowerCase();
  if (msg.includes("unauthorized") || msg.includes("invalid_api_key") || msg.includes("incorrect api key") || msg.includes("invalid api key") || msg.includes("authentication")) {
    return { type: "auth_invalid", needsHumanAction: true, action: "API key is invalid/revoked — generate a new one" };
  }
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("abort")) {
    return { type: "timeout", needsHumanAction: false, action: "Service is slow — will auto-retry" };
  }
  if (msg.includes("enotfound") || msg.includes("econnrefused") || msg.includes("network")) {
    return { type: "network", needsHumanAction: false, action: "Network issue — will auto-retry" };
  }
  if (msg.includes("rate limit") || msg.includes("429") || msg.includes("too many")) {
    return { type: "rate_limit", needsHumanAction: false, action: "Rate limited — will auto-retry later" };
  }
  if (msg.includes("insufficient_quota") || msg.includes("billing") || msg.includes("payment")) {
    return { type: "billing", needsHumanAction: true, action: "Account billing issue — check payment method" };
  }
  return { type: "unknown", needsHumanAction: false, action: "Investigating — will auto-retry" };
}

// ── Safe error message extraction ──
function _safeErrorMsg(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  if (typeof err.message === "string") return err.message;
  try { return JSON.stringify(err); } catch { return String(err); }
}

// ── Service Definitions ──
function _getServiceProbes() {
  return [
    {
      name: "openai",
      label: "OpenAI (GPT-5.4)",
      envKey: "OPENAI_API_KEY",
      probe: async (key) => {
        const r = await fetch("https://api.openai.com/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(8000),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error.message);
        return { models: d.data?.length || 0 };
      },
      critical: true,
      repairHint: "Generate new key at platform.openai.com/api-keys",
    },
    {
      name: "groq",
      label: "Groq (Whisper STT)",
      envKey: "GROQ_API_KEY",
      probe: async (key) => {
        const r = await fetch("https://api.groq.com/openai/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(8000),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error.message);
        return { models: d.data?.length || 0 };
      },
      critical: true,
      repairHint: "Generate new key at console.groq.com/keys",
    },
    {
      name: "google_ai",
      label: "Google AI (Gemini)",
      envKey: "GOOGLE_AI_KEY",
      probe: async (key) => {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1/models?key=${key}`,
          { signal: AbortSignal.timeout(8000) }
        );
        const d = await r.json();
        if (d.error) throw new Error(d.error.message);
        return { models: d.models?.length || 0 };
      },
      critical: false,
      repairHint: "Generate new key at aistudio.google.com/apikey",
    },
    {
      name: "deepseek",
      label: "DeepSeek",
      envKey: "DEEPSEEK_API_KEY",
      probe: async (key) => {
        const r = await fetch("https://api.deepseek.com/v1/models", {
          headers: { Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(8000),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error.message);
        return { ok: true };
      },
      critical: false,
      repairHint: "Generate new key at platform.deepseek.com/api_keys",
    },
    {
      name: "elevenlabs",
      label: "ElevenLabs (TTS)",
      envKey: "ELEVENLABS_API_KEY",
      probe: async (key) => {
        const r = await fetch("https://api.elevenlabs.io/v1/user", {
          headers: { "xi-api-key": key },
          signal: AbortSignal.timeout(8000),
        });
        const d = await r.json();
        if (d.detail || r.status >= 400) throw new Error(d.detail || `HTTP ${r.status}`);
        return { tier: d.subscription?.tier || "unknown" };
      },
      critical: true,
      repairHint: "Generate new key at elevenlabs.io/app/settings/api-keys",
    },
    {
      name: "perplexity",
      label: "Perplexity (Search)",
      envKey: "PERPLEXITY_API_KEY",
      probe: async (key) => {
        const r = await fetch("https://api.perplexity.ai/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "sonar",
            messages: [{ role: "user", content: "ping" }],
            max_tokens: 1,
          }),
          signal: AbortSignal.timeout(10000),
        });
        const d = await r.json();
        if (d.error) throw new Error(d.error.message || JSON.stringify(d.error));
        return { ok: true };
      },
      critical: false,
      repairHint: "Generate new key at perplexity.ai/settings/api",
    },
    {
      name: "tavily",
      label: "Tavily (Search)",
      envKey: "TAVILY_API_KEY",
      probe: async (key) => {
        const r = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ api_key: key, query: "ping", max_results: 1 }),
          signal: AbortSignal.timeout(8000),
        });
        const d = await r.json();
        if (d.error) throw new Error(typeof d.error === "string" ? d.error : JSON.stringify(d.error));
        return { ok: true };
      },
      critical: false,
      repairHint: "Generate new key at app.tavily.com/home",
    },
    {
      name: "telegram",
      label: "Telegram Bot",
      envKey: "TELEGRAM_BOT_TOKEN",
      probe: async (key) => {
        const r = await fetch(`https://api.telegram.org/bot${key}/getMe`, {
          signal: AbortSignal.timeout(8000),
        });
        const d = await r.json();
        if (!d.ok) throw new Error(d.description || "Bot unavailable");
        return { bot: d.result?.username || "unknown" };
      },
      critical: false,
      repairHint: "Regenerate token via @BotFather on Telegram",
    },
    {
      name: "supabase",
      label: "Supabase (Database)",
      envKey: "SUPABASE_URL",
      probe: async () => {
        const url = process.env.SUPABASE_URL;
        const key = process.env.SUPABASE_ANON_KEY;
        if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_ANON_KEY");
        const r = await fetch(`${url}/rest/v1/`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
          signal: AbortSignal.timeout(8000),
        });
        if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
        return { ok: true };
      },
      critical: true,
      repairHint: "Check Supabase dashboard at supabase.com/dashboard",
    },
  ];
}

// ── Start Monitor ──
function start() {
  if (_probeInterval) return;

  // Initialize all services as unknown
  _getServiceProbes().forEach((s) => {
    _serviceStatus[s.name] = {
      label: s.label,
      status: "unknown",
      lastCheck: null,
      lastOk: null,
      lastError: null,
      consecutiveFails: 0,
      critical: s.critical,
      repairHint: s.repairHint,
      alertSentAt: null,
      details: null,
    };
  });

  logger.info(
    { component: "HealthMonitor", services: Object.keys(_serviceStatus).length },
    "🏥 Service Health Monitor started"
  );

  // First probe after 30s
  setTimeout(() => probeAll(), 30 * 1000);

  // Then every 10 minutes
  _probeInterval = setInterval(() => probeAll(), PROBE_INTERVAL_MS);
}

function stop() {
  if (_probeInterval) {
    clearInterval(_probeInterval);
    _probeInterval = null;
    logger.info({ component: "HealthMonitor" }, "🏥 Health Monitor stopped");
  }
}

// ── Probe All Services ──
async function probeAll() {
  if (_isProbing) return;
  _isProbing = true;

  const probes = _getServiceProbes();
  const results = [];

  for (const service of probes) {
    const key = process.env[service.envKey];
    const status = _serviceStatus[service.name];

    if (!key && service.envKey !== "SUPABASE_URL") {
      status.status = "missing";
      status.lastCheck = new Date().toISOString();
      status.lastError = `Environment variable ${service.envKey} not set`;
      status.consecutiveFails++;
      results.push({ name: service.name, status: "missing" });
      continue;
    }

    try {
      const details = await service.probe(key);
      status.status = "healthy";
      status.lastCheck = new Date().toISOString();
      status.lastOk = new Date().toISOString();
      status.lastError = null;
      status.consecutiveFails = 0;
      status.details = details;
      results.push({ name: service.name, status: "healthy" });
    } catch (err) {
      const errMsg = _safeErrorMsg(err);
      const classification = _classifyError(errMsg);

      status.status = classification.needsHumanAction ? "needs_action" : "down";
      status.lastCheck = new Date().toISOString();
      status.lastError = errMsg;
      status.errorType = classification.type;
      status.needsHumanAction = classification.needsHumanAction;
      status.suggestedAction = classification.action;
      status.consecutiveFails++;
      status.details = null;
      results.push({ name: service.name, status: status.status, error: errMsg, errorType: classification.type });

      logger.warn(
        { component: "HealthMonitor", service: service.name, errorType: classification.type, error: errMsg },
        `⚠️ ${service.label} ${classification.needsHumanAction ? "NEEDS HUMAN ACTION" : "is DOWN"}: ${errMsg}`
      );

      // Alert if consecutive failures >= threshold
      if (status.consecutiveFails >= CONSECUTIVE_FAILURES_ALERT) {
        await _sendAlert(service, status);
      }
    }
  }

  const healthy = results.filter((r) => r.status === "healthy").length;
  const down = results.filter((r) => r.status === "down").length;
  const missing = results.filter((r) => r.status === "missing").length;

  logger.info(
    { component: "HealthMonitor", healthy, down, missing },
    `🏥 Probe complete: ${healthy} healthy, ${down} down, ${missing} missing`
  );

  _isProbing = false;
  return results;
}

// ── Send Alert ──
async function _sendAlert(service, status) {
  // Check cooldown
  if (
    status.alertSentAt &&
    Date.now() - new Date(status.alertSentAt).getTime() < ALERT_COOLDOWN_MS
  ) {
    return; // Still in cooldown
  }

  const severity = service.critical ? "🔴 CRITICAL" : "🟡 WARNING";
  const humanTag = status.needsHumanAction ? "\n⚠️ REQUIRES HUMAN ACTION — cannot auto-repair!\n" : "";
  const message =
    `${severity}: ${service.label} is DOWN!\n${humanTag}\n` +
    `Error: ${status.lastError}\n` +
    `Type: ${status.errorType || "unknown"}\n` +
    `Consecutive fails: ${status.consecutiveFails}\n` +
    `Last OK: ${status.lastOk || "never"}\n\n` +
    `🔧 Action: ${status.suggestedAction || service.repairHint}\n` +
    `📋 Repair: ${service.repairHint}`;

  // 1. Telegram alert
  await _sendTelegramAlert(message);

  // 2. Admin event (for admin panel)
  if (typeof global._adminAlerts === "undefined") {
    global._adminAlerts = [];
  }
  global._adminAlerts.push({
    type: "service-down",
    service: service.name,
    label: service.label,
    severity: service.critical ? "critical" : "warning",
    error: status.lastError,
    repairHint: service.repairHint,
    timestamp: new Date().toISOString(),
  });
  // Cap at 100 alerts
  if (global._adminAlerts.length > 100) {
    global._adminAlerts = global._adminAlerts.slice(-50);
  }

  status.alertSentAt = new Date().toISOString();

  logger.info(
    { component: "HealthMonitor", service: service.name },
    `📢 Alert sent for ${service.label}`
  );
}

// ── Telegram Alert ──
async function _sendTelegramAlert(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  // Send to admin chat (first user who messages the bot)
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!token || !adminChatId) {
    logger.debug(
      { component: "HealthMonitor" },
      "Telegram alert skipped (no token or admin chat ID)"
    );
    return;
  }

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: adminChatId,
        text: `🏥 KelionAI Health Alert\n\n${text}`,
        parse_mode: "HTML",
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    logger.warn(
      { component: "HealthMonitor", err: e.message },
      "Failed to send Telegram alert"
    );
  }
}

// ── Get Status (for admin panel / health endpoint) ──
function getStatus() {
  const services = {};
  let overallStatus = "healthy";

  for (const [name, s] of Object.entries(_serviceStatus)) {
    services[name] = { ...s };
    if (s.status === "down" && s.critical) overallStatus = "degraded";
    if (s.status === "missing" && s.critical) overallStatus = "degraded";
  }

  const downCount = Object.values(_serviceStatus).filter(
    (s) => s.status === "down"
  ).length;
  const healthyCount = Object.values(_serviceStatus).filter(
    (s) => s.status === "healthy"
  ).length;

  return {
    overallStatus,
    probeIntervalMs: PROBE_INTERVAL_MS,
    totalServices: Object.keys(_serviceStatus).length,
    healthy: healthyCount,
    down: downCount,
    services,
    alerts: (global._adminAlerts || []).slice(-20),
  };
}

// ── Force probe a single service (for admin action) ──
async function probeSingle(serviceName) {
  const probes = _getServiceProbes();
  const service = probes.find((s) => s.name === serviceName);
  if (!service) return { error: `Unknown service: ${serviceName}` };

  const key = process.env[service.envKey];
  const status = _serviceStatus[service.name];

  try {
    const details = await service.probe(key);
    status.status = "healthy";
    status.lastCheck = new Date().toISOString();
    status.lastOk = new Date().toISOString();
    status.lastError = null;
    status.consecutiveFails = 0;
    status.details = details;
    return { status: "healthy", details };
  } catch (err) {
    status.status = "down";
    status.lastCheck = new Date().toISOString();
    status.lastError = err.message;
    status.consecutiveFails++;
    return { status: "down", error: err.message };
  }
}

module.exports = { start, stop, probeAll, probeSingle, getStatus };
