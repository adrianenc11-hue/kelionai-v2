"use strict";

/**
 * K1 COGNITIVE CORE — Motorul de gândire al Kelion AGI
 *
 * Reasoning Loop: PERCEIVE → REFLECT → HYPOTHESIZE → PLAN → ACT → OBSERVE → LEARN
 * Inner Monologue: flux intern de gândire vizibil admin-ului
 * Confidence Score: scor 0-100 calibrat pe fiecare răspuns
 * Meta-Cognition: auto-evaluare performanță per domeniu
 */

const logger = require("pino")({ name: "k1-cognitive" });

// ═══════════════════════════════════════════════════════════════
// INNER MONOLOGUE — Fluxul intern de gândire
// ═══════════════════════════════════════════════════════════════

const monologueLog = []; // Ultimele 100 gânduri
const MAX_MONOLOGUE = 100;

function think(thought, context = {}) {
  const entry = {
    id: monologueLog.length + 1,
    thought,
    phase: context.phase || "REFLECT", // PERCEIVE/REFLECT/HYPOTHESIZE/PLAN/ACT/OBSERVE/LEARN
    domain: context.domain || "general",
    confidence: context.confidence || null,
    timestamp: new Date().toISOString(),
  };
  monologueLog.push(entry);
  if (monologueLog.length > MAX_MONOLOGUE) monologueLog.shift();
  logger.info(
    { phase: entry.phase, domain: entry.domain },
    `[K1] 💭 ${thought}`,
  );
  return entry;
}

function getMonologue(limit = 20) {
  return monologueLog.slice(-limit);
}

// ═══════════════════════════════════════════════════════════════
// CONFIDENCE CALIBRATION — Scor 0-100 pe fiecare răspuns
// ═══════════════════════════════════════════════════════════════

// Istoricul de accuracy per domeniu
const performanceHistory = {
  trading: { correct: 0, total: 0, corrections: 0 },
  general: { correct: 0, total: 0, corrections: 0 },
  coding: { correct: 0, total: 0, corrections: 0 },
  research: { correct: 0, total: 0, corrections: 0 },
  news: { correct: 0, total: 0, corrections: 0 },
};

/**
 * Calculează confidence score calibrat
 * Nu zice "sunt sigur" decât dacă:
 * - Accuracy-ul istoric pe acest domeniu e >80%
 * - Are surse/evidențe
 * - Nu există contradicții
 */
function calculateConfidence(params = {}) {
  const {
    domain = "general",
    hasSources = false, // Are surse/evidențe?
    sourceCount = 0, // Câte surse?
    hasContradictions = false, // Există contradicții în context?
    _isFactual = false, // E o afirmație factuală verificabilă?
    complexity = "medium", // low/medium/high
    modelAgreement = null, // Dacă 2+ modele sunt de acord (0-1)
  } = params;

  let score = 50; // Bază neutră

  // Ajustare pe baza accuracy-ului istoric
  const perf = performanceHistory[domain] || performanceHistory.general;
  if (perf.total > 10) {
    const historicalAccuracy = perf.correct / perf.total;
    score = Math.round(historicalAccuracy * 100);
  }

  // Surse cresc confidence-ul
  if (hasSources) score += 10;
  if (sourceCount >= 2) score += 10;
  if (sourceCount >= 3) score += 5;

  // Contradicții scad confidence-ul
  if (hasContradictions) score -= 25;

  // Complexitate scade confidence-ul
  if (complexity === "high") score -= 10;
  if (complexity === "low") score += 10;

  // Model agreement crește confidence-ul
  if (modelAgreement !== null) {
    score += Math.round(modelAgreement * 20);
  }

  // Clamp între 5 și 98 (niciodată 0% sau 100%)
  score = Math.max(5, Math.min(98, score));

  // Generează mesaj de confidence
  let label, emoji;
  if (score >= 85) {
    label = "Foarte sigur";
    emoji = "🟢";
  } else if (score >= 65) {
    label = "Destul de sigur";
    emoji = "🟡";
  } else if (score >= 40) {
    label = "Incert — necesită verificare";
    emoji = "🟠";
  } else {
    label = "Nu sunt sigur — tratează cu precauție";
    emoji = "🔴";
  }

  think(`Confidence ${score}% (${label}) pe domeniul ${domain}`, {
    phase: "REFLECT",
    domain,
    confidence: score,
  });

  return { score, label, emoji, domain };
}

/**
 * Înregistrează feedback — userul a corectat sau confirmat
 */
function recordFeedback(domain, wasCorrect) {
  const perf = performanceHistory[domain] || performanceHistory.general;
  perf.total++;
  if (wasCorrect) perf.correct++;
  else perf.corrections++;

  think(
    wasCorrect
      ? `Confirmat corect pe ${domain} (${perf.correct}/${perf.total})`
      : `CORECTAT pe ${domain} — acuratețe: ${((perf.correct / perf.total) * 100).toFixed(0)}%`,
    { phase: "LEARN", domain },
  );
}

// ═══════════════════════════════════════════════════════════════
// REASONING LOOP — Procesare cognitivă structurată
// ═══════════════════════════════════════════════════════════════

/**
 * Procesează o cerere prin reasoning loop complet
 * Returnează un plan structurat + confidence
 */
function reason(input, context = {}) {
  const startTime = Date.now();

  // 1. PERCEIVE — Ce am primit?
  think(`Cerere primită: "${input.slice(0, 100)}..."`, {
    phase: "PERCEIVE",
    domain: context.domain,
  });

  // 2. REFLECT — Am mai văzut asta?
  const domain = detectDomain(input);
  const perf = performanceHistory[domain];
  const pastAccuracy =
    perf.total > 0 ? ((perf.correct / perf.total) * 100).toFixed(0) : "N/A";
  think(`Domeniu detectat: ${domain}. Accuracy istoric: ${pastAccuracy}%`, {
    phase: "REFLECT",
    domain,
  });

  // 3. HYPOTHESIZE — Ce poate fi?
  const hypotheses = generateHypotheses(input, domain);
  think(`Ipoteze: ${hypotheses.map((h) => h.label).join(" | ")}`, {
    phase: "HYPOTHESIZE",
    domain,
  });

  // 4. PLAN — Ce trebuie făcut?
  const plan = {
    domain,
    complexity: estimateComplexity(input),
    steps: hypotheses[0]?.steps || ["direct_answer"],
    criteria: hypotheses[0]?.criteria || ["correct", "complete"],
    needsTools:
      domain === "trading" ||
      input.includes("verifică") ||
      input.includes("caută"),
    needsMultiAgent: estimateComplexity(input) === "high",
  };
  think(`Plan: ${plan.steps.join(" → ")} (complexitate: ${plan.complexity})`, {
    phase: "PLAN",
    domain,
  });

  // 5. Confidence pre-execuție
  const confidence = calculateConfidence({
    domain,
    complexity: plan.complexity,
    hasSources: plan.needsTools,
  });

  return {
    reasoning: {
      domain,
      complexity: plan.complexity,
      hypotheses: hypotheses.length,
      bestHypothesis: hypotheses[0]?.label || "direct",
      plan: plan.steps,
      needsTools: plan.needsTools,
      needsMultiAgent: plan.needsMultiAgent,
    },
    confidence,
    monologue: getMonologue(5), // Ultimele 5 gânduri
    processingTime: Date.now() - startTime,
  };
}

/**
 * După execuție — observă și învață
 */
function observe(result, expected = null) {
  const delta = expected ? compareDelta(result, expected) : null;
  think(
    delta
      ? `Rezultat vs așteptare: delta ${delta}%`
      : `Rezultat obținut — aștept feedback utilizator`,
    { phase: "OBSERVE" },
  );
  return { observed: true, delta };
}

// ═══════════════════════════════════════════════════════════════
// META-COGNITION — Auto-evaluare performanță
// ═══════════════════════════════════════════════════════════════

function getMetaCognition() {
  const domains = Object.entries(performanceHistory).map(([domain, perf]) => ({
    domain,
    totalTasks: perf.total,
    accuracy:
      perf.total > 0 ? Math.round((perf.correct / perf.total) * 100) : null,
    corrections: perf.corrections,
    status:
      perf.total === 0
        ? "no_data"
        : perf.correct / perf.total >= 0.8
          ? "strong"
          : perf.correct / perf.total >= 0.6
            ? "moderate"
            : "weak",
  }));

  const weakAreas = domains
    .filter((d) => d.status === "weak")
    .map((d) => d.domain);
  const strongAreas = domains
    .filter((d) => d.status === "strong")
    .map((d) => d.domain);

  if (weakAreas.length > 0) {
    think(`Zone slabe: ${weakAreas.join(", ")} — trebuie îmbunătățit`, {
      phase: "REFLECT",
    });
  }

  return {
    domains,
    weakAreas,
    strongAreas,
    totalTasks: domains.reduce((sum, d) => sum + d.totalTasks, 0),
    overallAccuracy:
      domains.reduce((sum, d) => sum + (d.accuracy || 0), 0) /
        domains.filter((d) => d.accuracy !== null).length || 0,
    monologue: getMonologue(10),
  };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function detectDomain(input) {
  const lower = input.toLowerCase();
  if (
    /btc|eth|trading|piață|market|invest|profit|buy|sell|rsi|macd/i.test(lower)
  )
    return "trading";
  if (
    /cod|functie|variabila|bug|eroare|javascript|python|html|css/i.test(lower)
  )
    return "coding";
  if (/stir|news|articol|publicare/i.test(lower)) return "news";
  if (/caut|cercete|analizeaz|research|compara/i.test(lower)) return "research";
  return "general";
}

function estimateComplexity(input) {
  const words = input.split(/\s+/).length;
  if (
    words > 100 ||
    /implementeaz|construi|creaz.*sistem|arhitectur/i.test(input)
  )
    return "high";
  if (words > 30 || /compar|analizeaz|explic/i.test(input)) return "medium";
  return "low";
}

function generateHypotheses(input, domain) {
  const hypotheses = [];

  if (domain === "trading") {
    hypotheses.push({
      label: "Analiză piață cu indicatori",
      probability: 0.6,
      steps: ["fetch_market_data", "calculate_indicators", "generate_signal"],
      criteria: ["has_evidence", "confidence>60"],
    });
  }

  hypotheses.push({
    label: "Răspuns direct din cunoștințe",
    probability: 0.3,
    steps: ["direct_answer"],
    criteria: ["correct", "complete"],
  });

  hypotheses.push({
    label: "Necesită cercetare + validare",
    probability: 0.1,
    steps: ["research", "validate", "compose"],
    criteria: ["has_sources", "verified"],
  });

  return hypotheses.sort((a, b) => b.probability - a.probability);
}

function compareDelta(result, expected) {
  if (typeof result === "number" && typeof expected === "number") {
    return Math.round((Math.abs(result - expected) / expected) * 100);
  }
  return null;
}

/**
 * NEWBORN RESET — Golește tot istoricul cognitiv
 */
function resetAll() {
  monologueLog.length = 0;
  for (const domain of Object.keys(performanceHistory)) {
    performanceHistory[domain] = { correct: 0, total: 0, corrections: 0 };
  }
  think("🧒 Cognitive reset — newborn mode activated", { phase: "LEARN" });
}

module.exports = {
  think,
  getMonologue,
  calculateConfidence,
  recordFeedback,
  reason,
  observe,
  getMetaCognition,
  detectDomain,
  performanceHistory,
  resetAll,
};
