"use strict";

/**
 * K1 MESSENGER BRIDGE — Conectează K1 Cognitive la Telegram/WhatsApp/Messenger
 *
 * Ce face:
 * - Procesează fiecare mesaj prin reasoning loop K1
 * - Salvează în memory (Hot + Warm)
 * - Trackează user interactions pentru User Model
 * - Adaugă confidence score la răspunsuri
 * - Verifică claims prin Truth Guard (opțional)
 * - World State awareness (piețe, alerts)
 */

const k1Cognitive = require("./k1-cognitive");
const k1Memory = require("./k1-memory");
const k1World = require("./k1-world-state");
const k1Meta = require("./k1-meta-learning");
const k1Perf = require("./k1-performance");
const logger = require("pino")({ name: "k1-bridge" });

// ═══════════════════════════════════════════════════════════════
// PRE-PROCESS — Înainte de a trimite la LLM
// ═══════════════════════════════════════════════════════════════

/**
 * Procesează mesajul prin K1 înainte de LLM
 * Adaugă context cognitiv, memorii relevante, world state
 */
async function preProcess(message, options = {}) {
  const {
    platform = "unknown", // telegram, whatsapp, messenger
    userId = "unknown",
    userName = "User",
    supabase = null,
  } = options;

  const startTime = Date.now();

  // 1. Reasoning loop — analizează ce vrea userul
  const reasoning = k1Cognitive.reason(message, { domain: options.domain });

  // 2. Retrieve din memory — ce știm relevant
  let memories = [];
  try {
    memories = await k1Memory.retrieve(supabase, message, {
      domain: reasoning.reasoning.domain,
      limit: 3,
    });
  } catch {
    /* ignored */
  }

  // 3. World state awareness
  const world = k1World.getMarketSummary();
  const alerts = k1World.getAlerts(true); // unread doar

  // 4. User model update
  k1Meta.recordUserInteraction({
    domain: reasoning.reasoning.domain,
    wasCorrection: false,
  });

  // 5. Save input to memory
  k1Memory.addToHot({
    content: `[${platform}/${userName}] ${message.slice(0, 300)}`,
    type: "message",
    domain: reasoning.reasoning.domain,
    importance: 5,
    source: platform,
    tags: [platform, userId],
  });

  // 6. Performance tracking
  k1Perf.recordTask(reasoning.reasoning.domain, Date.now() - startTime);

  // Build enhanced context for LLM
  const context = {
    k1: {
      domain: reasoning.reasoning.domain,
      complexity: reasoning.reasoning.complexity,
      confidence: reasoning.confidence,
      plan: reasoning.reasoning.plan,
      needsTools: reasoning.reasoning.needsTools,
    },
    memories: memories
      .slice(0, 3)
      .map((m) => m.content)
      .filter(Boolean),
    world: {
      btc: world.markets?.btc?.price || null,
      eth: world.markets?.eth?.price || null,
      fearGreed: world.fearGreed?.value || null,
      openMarkets: world.openMarkets || [],
    },
    alerts: alerts.slice(0, 2).map((a) => a.message),
    platform,
  };

  logger.debug(
    {
      platform,
      domain: reasoning.reasoning.domain,
      confidence: reasoning.confidence.score,
    },
    "[K1-Bridge] Pre-processed",
  );

  return context;
}

// ═══════════════════════════════════════════════════════════════
// POST-PROCESS — După ce LLM a generat răspuns
// ═══════════════════════════════════════════════════════════════

/**
 * Procesează răspunsul LLM prin K1 după generare
 * Adaugă confidence badge, salvează în memory, notifică
 */
async function postProcess(response, options = {}) {
  const {
    platform = "unknown",
    _userId = "unknown",
    domain = "general",
    supabase = null,
    addBadge = false, // Adaugă emoji de confidence la răspuns
  } = options;

  // 1. Observe result
  k1Cognitive.observe(response);

  // 2. Save response to memory
  k1Memory.addToHot({
    content: `[K1→${platform}] ${(typeof response === "string" ? response : "").slice(0, 300)}`,
    type: "response",
    domain,
    importance: 4,
    source: "k1",
  });

  // Save to warm (persistent)
  if (supabase) {
    try {
      await k1Memory.saveToWarm(supabase, {
        content: `[${platform}] ${(typeof response === "string" ? response : "").slice(0, 500)}`,
        type: "response",
        domain,
        importance: 4,
        tags: [platform],
      });
    } catch {
      /* ignored */
    }
  }

  // 3. Calculate confidence on response
  const confidence = k1Cognitive.calculateConfidence({
    domain,
    hasSources: /sursa|link|conform|potrivit/i.test(response || ""),
    isFactual: /\$[\d,]+|[\d.]+%|RSI|MACD/i.test(response || ""),
  });

  // 4. Meta-learning: score template + tool usage
  try {
    k1Meta.useTemplate(`${domain}_analysis`, confidence.score > 70);
    k1Meta.scoreTools("llm_response", domain, confidence.score);
  } catch {
    /* ignored */
  }

  // 5. Optional: add confidence badge
  let enhancedResponse = response;
  if (addBadge && typeof response === "string" && confidence.score < 60) {
    enhancedResponse = `${response}\n\n${confidence.emoji} _Confidence: ${confidence.score}%_`;
  }

  return {
    response: enhancedResponse,
    confidence,
    domain,
  };
}

// ═══════════════════════════════════════════════════════════════
// CONTEXT ENRICHMENT — Generează system prompt K1-aware
// ═══════════════════════════════════════════════════════════════

/**
 * Generează contextul K1 care se adaugă la system prompt
 */
function getK1SystemContext(context) {
  if (!context || !context.k1) return "";

  const parts = [];

  // World awareness
  if (context.world?.btc) {
    parts.push(
      `[Market] BTC: $${context.world.btc}, ETH: $${context.world.eth || "?"}, Fear&Greed: ${context.world.fearGreed || "?"}`,
    );
  }

  // Relevant memories
  if (context.memories && context.memories.length > 0) {
    parts.push(`[Memory] ${context.memories.join(" | ").slice(0, 200)}`);
  }

  // Active alerts
  if (context.alerts && context.alerts.length > 0) {
    parts.push(`[Alerts] ${context.alerts.join("; ").slice(0, 150)}`);
  }

  // Cognitive state
  parts.push(
    `[K1] Domain: ${context.k1.domain}, Confidence: ${context.k1.confidence?.score || "?"}%`,
  );

  return parts.length > 0
    ? `\n--- K1 Context ---\n${parts.join("\n")}\n---\n`
    : "";
}

// ═══════════════════════════════════════════════════════════════
// PROACTIVE MESSAGES — K1 inițiază conversații
// ═══════════════════════════════════════════════════════════════

/**
 * Generează mesaje proactive pe baza world state
 * Returnează array de mesaje de trimis (sau [] dacă nimic)
 */
function getProactiveMessages() {
  const alerts = k1World.getAlerts(true); // Unread alerts
  if (alerts.length === 0) return [];

  const messages = alerts
    .filter((a) => a.type === "warning" || a.type === "opportunity")
    .slice(0, 2)
    .map((a) => ({
      text: `🔔 *K1 Alert*\n${a.message}`,
      type: a.type,
      alertId: a.id,
    }));

  // Mark as read
  if (messages.length > 0) {
    k1World.markAlertsRead();
  }

  return messages;
}

module.exports = {
  preProcess,
  postProcess,
  getK1SystemContext,
  getProactiveMessages,
};
