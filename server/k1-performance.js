"use strict";

/**
 * K1 PERFORMANCE TRACKER — Scor accuracy per domeniu + evoluție
 *
 * Tracks:
 * - Response accuracy per domain
 * - User corrections
 * - Response times
 * - Common error patterns
 * - Trends (improving/declining)
 */

const logger = require("pino")({ name: "k1-performance" });

// ═══════════════════════════════════════════════════════════════
// PERFORMANCE DATA
// ═══════════════════════════════════════════════════════════════

const metrics = {
  trading: {
    tasks: 0,
    correct: 0,
    corrections: 0,
    responseTimes: [],
    errors: {},
  },
  general: {
    tasks: 0,
    correct: 0,
    corrections: 0,
    responseTimes: [],
    errors: {},
  },
  coding: {
    tasks: 0,
    correct: 0,
    corrections: 0,
    responseTimes: [],
    errors: {},
  },
  research: {
    tasks: 0,
    correct: 0,
    corrections: 0,
    responseTimes: [],
    errors: {},
  },
  news: { tasks: 0, correct: 0, corrections: 0, responseTimes: [], errors: {} },
};

const history = []; // Ultimele 100 evaluări
const MAX_HISTORY = 100;
const MAX_RESPONSE_TIMES = 50;

// ═══════════════════════════════════════════════════════════════
// RECORD — Înregistrează fiecare task
// ═══════════════════════════════════════════════════════════════

function recordTask(domain, responseTimeMs) {
  const m = metrics[domain] || metrics.general;
  m.tasks++;
  if (responseTimeMs) {
    m.responseTimes.push(responseTimeMs);
    if (m.responseTimes.length > MAX_RESPONSE_TIMES) m.responseTimes.shift();
  }
}

function recordCorrect(domain) {
  const m = metrics[domain] || metrics.general;
  m.correct++;
  addHistory(domain, "correct");
}

function recordCorrection(domain, errorType = "unknown") {
  const m = metrics[domain] || metrics.general;
  m.corrections++;
  m.errors[errorType] = (m.errors[errorType] || 0) + 1;
  addHistory(domain, "correction", errorType);
  logger.warn(
    { domain, errorType, totalCorrections: m.corrections },
    "[K1-Perf] Corectat!",
  );
}

function addHistory(domain, type, detail = null) {
  history.push({
    domain,
    type,
    detail,
    timestamp: new Date().toISOString(),
  });
  if (history.length > MAX_HISTORY) history.shift();
}

// ═══════════════════════════════════════════════════════════════
// ANALYZE — Raport complet
// ═══════════════════════════════════════════════════════════════

function getReport() {
  const domains = Object.entries(metrics).map(([domain, m]) => {
    const accuracy =
      m.tasks > 0 ? Math.round((m.correct / m.tasks) * 100) : null;
    const avgTime =
      m.responseTimes.length > 0
        ? Math.round(
            m.responseTimes.reduce((a, b) => a + b, 0) / m.responseTimes.length,
          )
        : null;

    // Trend: compară ultimele 10 vs anterioarele 10
    const recentHistory = history.filter((h) => h.domain === domain).slice(-20);
    const recent10 = recentHistory.slice(-10);
    const prev10 = recentHistory.slice(0, 10);
    const recentCorrect = recent10.filter((h) => h.type === "correct").length;
    const prevCorrect = prev10.filter((h) => h.type === "correct").length;
    let trend = "stable";
    if (recent10.length >= 5 && prev10.length >= 5) {
      trend =
        recentCorrect > prevCorrect
          ? "improving"
          : recentCorrect < prevCorrect
            ? "declining"
            : "stable";
    }

    // Top erori
    const topErrors = Object.entries(m.errors)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([type, count]) => ({ type, count }));

    return {
      domain,
      tasks: m.tasks,
      correct: m.correct,
      corrections: m.corrections,
      accuracy,
      avgResponseTimeMs: avgTime,
      trend,
      trendEmoji:
        trend === "improving" ? "📈" : trend === "declining" ? "📉" : "➡️",
      topErrors,
      status:
        accuracy === null
          ? "no_data"
          : accuracy >= 80
            ? "strong"
            : accuracy >= 60
              ? "moderate"
              : "weak",
    };
  });

  const totalTasks = domains.reduce((s, d) => s + d.tasks, 0);
  const totalCorrect = domains.reduce((s, d) => s + d.correct, 0);
  const overallAccuracy =
    totalTasks > 0 ? Math.round((totalCorrect / totalTasks) * 100) : null;

  return {
    overall: {
      totalTasks,
      totalCorrect,
      totalCorrections: domains.reduce((s, d) => s + d.corrections, 0),
      accuracy: overallAccuracy,
      status:
        overallAccuracy === null
          ? "no_data"
          : overallAccuracy >= 80
            ? "🟢 Solid"
            : overallAccuracy >= 60
              ? "🟡 Moderate"
              : "🔴 Slab — necesită îmbunătățire",
    },
    domains,
    weakAreas: domains.filter((d) => d.status === "weak").map((d) => d.domain),
    strongAreas: domains
      .filter((d) => d.status === "strong")
      .map((d) => d.domain),
    recentHistory: history.slice(-20),
  };
}

/**
 * Ce trebuie îmbunătățit?
 */
function getRecommendations() {
  const report = getReport();
  const recs = [];

  report.domains.forEach((d) => {
    if (d.status === "weak" && d.tasks > 5) {
      recs.push({
        priority: "high",
        domain: d.domain,
        message: `Accuracy pe ${d.domain} e ${d.accuracy}% — sub 60%. Top eroare: ${d.topErrors[0]?.type || "necunoscut"}`,
        action: `Revizuiește prompt templates și logica pentru ${d.domain}`,
      });
    }
    if (d.trend === "declining" && d.tasks > 10) {
      recs.push({
        priority: "medium",
        domain: d.domain,
        message: `Trend descendent pe ${d.domain} — performanța scade`,
        action: `Analizează ultimele 10 corecții pe ${d.domain}`,
      });
    }
    if (d.avgResponseTimeMs && d.avgResponseTimeMs > 5000) {
      recs.push({
        priority: "low",
        domain: d.domain,
        message: `Răspuns lent pe ${d.domain}: ${d.avgResponseTimeMs}ms mediu`,
        action: "Optimizează prompt-ul sau reduce context-ul",
      });
    }
  });

  return recs.sort((a, b) => {
    const p = { high: 3, medium: 2, low: 1 };
    return p[b.priority] - p[a.priority];
  });
}

// ═══════════════════════════════════════════════════════════════
// SELF-EVALUATION — AI evaluates its own responses
// ═══════════════════════════════════════════════════════════════

const recentEvals = []; // Last 20 self-evaluations
const MAX_EVALS = 20;

/**
 * Self-evaluate AI response quality using heuristics.
 * Called after each response in brain-v4.js.
 * Returns quality score 0-100.
 */
function selfEvaluate(userMessage, aiResponse, domain = "general") {
  if (!userMessage || !aiResponse) return null;

  const uMsg = userMessage.toLowerCase().trim();
  const aResp = aiResponse.trim();
  let score = 70; // base score
  const issues = [];

  // 1. LENGTH CHECK — too short or too long
  if (aResp.length < 20) {
    score -= 25;
    issues.push("too_short");
  } else if (aResp.length < 50 && uMsg.length > 30) {
    score -= 15;
    issues.push("brief_for_complex_q");
  }
  if (aResp.length > 3000 && uMsg.length < 50) {
    score -= 10;
    issues.push("verbose");
  }

  // 2. LANGUAGE MATCH — response should match user's language
  const userRo = /[ăîâșțĂÎÂȘȚ]/.test(userMessage);
  const respRo = /[ăîâșțĂÎÂȘȚ]/.test(aResp);
  if (userRo && !respRo && aResp.length > 100) {
    score -= 15;
    issues.push("language_mismatch");
  }

  // 3. GENERIC RESPONSE DETECTION — penalize filler phrases
  const genericPatterns = [
    "as an ai", "i cannot", "i don't have access",
    "nu am acces", "ca model de limbaj", "nu pot să",
    "sigur, pot", "desigur!", "bineînțeles!",
  ];
  const genericCount = genericPatterns.filter(p => aResp.toLowerCase().includes(p)).length;
  if (genericCount >= 2) {
    score -= 20;
    issues.push("generic_filler");
  }

  // 4. REPETITION — response repeating user's question verbatim
  if (uMsg.length > 20 && aResp.toLowerCase().includes(uMsg.slice(0, Math.min(50, uMsg.length)))) {
    score -= 5;
    issues.push("echoes_question");
  }

  // 5. QUESTION ANSWERING — if user asks a question, response should have substance
  const isQuestion = uMsg.includes("?") || /^(ce|cine|când|cum|unde|de ce|cât|care|what|who|when|how|where|why)/i.test(uMsg);
  if (isQuestion && aResp.length < 80) {
    score -= 10;
    issues.push("shallow_answer");
  }

  // 6. ERROR INDICATORS — response contains error messages
  if (/error|eroare|failed|eșuat|undefined|null|NaN/i.test(aResp) && !/```/.test(aResp)) {
    score -= 15;
    issues.push("error_in_response");
  }

  // 7. POSITIVE SIGNALS — boost score  
  if (aResp.includes("```")) score += 5; // code blocks = structured
  if (/\d+/.test(aResp) && domain === "trading") score += 5; // numbers in trading = good
  if (aResp.split("\n").length > 3) score += 3; // multi-line = structured

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  const evaluation = {
    score,
    quality: score >= 80 ? "good" : score >= 60 ? "ok" : score >= 40 ? "weak" : "poor",
    issues,
    domain,
    timestamp: new Date().toISOString(),
  };

  // Record in metrics
  recordTask(domain);
  if (score >= 60) {
    recordCorrect(domain);
  }

  // Save to recent evaluations
  recentEvals.push(evaluation);
  if (recentEvals.length > MAX_EVALS) recentEvals.shift();

  // Log warnings for poor quality
  if (score < 50) {
    logger.warn({ score, issues, domain }, "[K1-Perf] ⚠️ Low quality response detected");
  }

  return evaluation;
}

/**
 * Get quality hints for the system prompt.
 * Based on recent self-evaluations, returns improvement suggestions.
 */
function getQualityHints() {
  if (recentEvals.length < 3) return ""; // not enough data

  const recent = recentEvals.slice(-10);
  const avgScore = Math.round(recent.reduce((s, e) => s + e.score, 0) / recent.length);
  const hints = [];

  // Count issues across recent evaluations
  const issueCounts = {};
  recent.forEach(e => e.issues.forEach(i => { issueCounts[i] = (issueCounts[i] || 0) + 1; }));

  // Only emit hints for recurring issues (2+ occurrences)
  if (issueCounts.too_short >= 2) hints.push("Răspunsurile recente sunt prea scurte. Oferă mai mult detaliu.");
  if (issueCounts.verbose >= 2) hints.push("Răspunsurile recente sunt prea lungi. Fii mai concis.");
  if (issueCounts.generic_filler >= 2) hints.push("Evită frazele generice ('ca model AI', 'nu pot'). Răspunde direct.");
  if (issueCounts.language_mismatch >= 2) hints.push("Răspunde în aceeași limbă ca userul.");
  if (issueCounts.shallow_answer >= 2) hints.push("La întrebări, oferă răspunsuri mai substanțiale.");
  if (issueCounts.error_in_response >= 2) hints.push("Verifică răspunsurile pentru erori înainte de a le trimite.");

  if (hints.length === 0) return "";
  return "\n[SELF-EVAL HINTS] Avg quality: " + avgScore + "%. " + hints.join(" ") + " [/SELF-EVAL HINTS]";
}

module.exports = {
  recordTask,
  recordCorrect,
  recordCorrection,
  getReport,
  getRecommendations,
  selfEvaluate,
  getQualityHints,
};
