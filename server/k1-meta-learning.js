"use strict";

/**
 * K1 META-LEARNING ENGINE — Evoluție continuă
 *
 * - Ajustează automat parametri pe baza performanței
 * - Prompt template optimization
 * - Tool preference learning
 * - Risk parameter auto-tuning
 * - Scheduled forgetting engine (compresie memorii vechi)
 * - Adversarial self-test periodic
 */

const logger = require("pino")({ name: "k1-meta" });
const k1Cognitive = require("./k1-cognitive");

// ═══════════════════════════════════════════════════════════════
// STRATEGY EVOLUTION — Ajustează pe baza rezultatelor
// ═══════════════════════════════════════════════════════════════

const strategies = {
  // Prompt templates cu scor de performanță
  promptTemplates: {
    trading_analysis: {
      template:
        "Analizează {asset} folosind RSI, MACD, Bollinger. Dă semnal BUY/SELL/HOLD cu confidence.",
      uses: 0,
      successes: 0,
      lastUsed: null,
    },
    research_query: {
      template:
        "Cercetează {topic}. Dă 3 surse, fapte concrete, și o concluzie cu confidence.",
      uses: 0,
      successes: 0,
      lastUsed: null,
    },
    code_review: {
      template:
        "Verifică codul pentru: erori, vulnerabilități, optimizări. Raportează fiecare cu severitate.",
      uses: 0,
      successes: 0,
      lastUsed: null,
    },
  },

  // Tool preferences — ce funcționează mai bine
  toolPreferences: {
    price_source: {
      preferred: "yahoo",
      alternatives: ["coingecko", "binance"],
      scores: { yahoo: 80, coingecko: 70, binance: 75 },
    },
    news_source: {
      preferred: "gnews",
      alternatives: ["newsapi", "guardian"],
      scores: { gnews: 75, newsapi: 60, guardian: 80 },
    },
  },

  // Risk parameters — se ajustează automat
  riskParams: {
    trailing_stop_pct: { current: 3, min: 1, max: 10, adjustStep: 0.5 },
    stop_loss_pct: { current: 5, min: 1, max: 15, adjustStep: 1 },
    take_profit_pct: { current: 8, min: 2, max: 25, adjustStep: 1 },
    min_confidence: { current: 60, min: 30, max: 90, adjustStep: 5 },
    max_hold_hours: { current: 24, min: 4, max: 72, adjustStep: 4 },
  },
};

// ═══════════════════════════════════════════════════════════════
// LEARN — Ajustează parametri pe baza feedback-ului
// ═══════════════════════════════════════════════════════════════

/**
 * Înregistrează folosirea unui prompt template
 */
function useTemplate(name, wasSuccessful) {
  const t = strategies.promptTemplates[name];
  if (!t) return;
  t.uses++;
  if (wasSuccessful) t.successes++;
  t.lastUsed = new Date().toISOString();

  // Dacă accuracy < 50% după 10+ utilizări → marchează ca slab
  if (t.uses >= 10 && t.successes / t.uses < 0.5) {
    k1Cognitive.think(
      `Template "${name}" are accuracy ${Math.round((t.successes / t.uses) * 100)}% — necesită rescriere`,
      { phase: "LEARN" },
    );
  }
}

/**
 * Înregistrează performanța unui tool
 */
function scoreTools(toolName, category, score) {
  const pref = strategies.toolPreferences[category];
  if (!pref) return;
  pref.scores[toolName] = score;

  // Auto-switch la tool-ul cu scor mai mare
  const best = Object.entries(pref.scores).sort(([, a], [, b]) => b - a)[0];
  if (best && best[0] !== pref.preferred) {
    const old = pref.preferred;
    pref.preferred = best[0];
    k1Cognitive.think(
      `Tool switch: ${category} ${old} → ${best[0]} (scor ${best[1]} vs ${pref.scores[old]})`,
      { phase: "LEARN" },
    );
  }
}

/**
 * Auto-adjust risk parameters pe baza trade results
 */
function adjustRisk(tradeResult) {
  if (!tradeResult) return;

  const { pnlPct, reason, holdHours } = tradeResult;

  // Ajustare stop-loss: dacă se declanșează prea des, mărește-l
  if (reason && reason.includes("STOP-LOSS")) {
    const sl = strategies.riskParams.stop_loss_pct;
    if (sl.current < sl.max) {
      sl.current = Math.min(sl.max, sl.current + sl.adjustStep);
      k1Cognitive.think(
        `Stop-loss ajustat: ${sl.current - sl.adjustStep}% → ${sl.current}% (prea multe stop-loss-uri)`,
        { phase: "LEARN" },
      );
    }
  }

  // Ajustare take-profit: dacă pierdem profit nerealizat, scade-l
  if (reason && reason.includes("TRAILING-STOP") && pnlPct > 0 && pnlPct < 3) {
    const tp = strategies.riskParams.take_profit_pct;
    if (tp.current > tp.min + tp.adjustStep) {
      tp.current = Math.max(tp.min, tp.current - tp.adjustStep);
      k1Cognitive.think(
        `Take-profit ajustat: ${tp.current + tp.adjustStep}% → ${tp.current}% (trailing stop la profit mic)`,
        { phase: "LEARN" },
      );
    }
  }

  // Ajustare hold time: dacă expiră prea des, mărește-l
  if (reason && reason.includes("TIME-LIMIT") && pnlPct > 0) {
    const mh = strategies.riskParams.max_hold_hours;
    if (mh.current < mh.max) {
      mh.current = Math.min(mh.max, mh.current + mh.adjustStep);
      k1Cognitive.think(
        `Hold time ajustat: ${mh.current - mh.adjustStep}h → ${mh.current}h (closing profitable trades too early)`,
        { phase: "LEARN" },
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// USER MODEL — Profil comportamental auto-construit
// ═══════════════════════════════════════════════════════════════

const userModel = {
  // Preferințe comunicare
  communication: {
    preferredStyle: "concis", // concis / detaliat
    preferredLanguage: "ro",
    technicalLevel: "avansat", // începător / intermediar / avansat
    corrections: [], // ultimele corecții de stil
  },

  // Pattern-uri temporale
  temporal: {
    activeDays: {}, // { "Monday": 5, "Tuesday": 3, ... }
    activeHours: {}, // { "9": 10, "10": 8, ... }
    avgSessionMin: 0,
    totalSessions: 0,
  },

  // Domenii de interes (ponderat)
  interests: {
    trading: 0,
    coding: 0,
    news: 0,
    research: 0,
    general: 0,
  },

  // Prag de risc
  riskProfile: "moderate", // conservative / moderate / aggressive

  // Frecvența corecțiilor
  correctionRate: 0, // % din răspunsuri corectate
  totalInteractions: 0,
  totalCorrections: 0,
};

function recordUserInteraction(data) {
  userModel.totalInteractions++;

  // Domeniu
  if (data.domain) {
    userModel.interests[data.domain] =
      (userModel.interests[data.domain] || 0) + 1;
  }

  // Temporal
  const now = new Date();
  const day = [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ][now.getUTCDay()];
  const hour = now.getUTCHours().toString();
  userModel.temporal.activeDays[day] =
    (userModel.temporal.activeDays[day] || 0) + 1;
  userModel.temporal.activeHours[hour] =
    (userModel.temporal.activeHours[hour] || 0) + 1;

  // Corecție?
  if (data.wasCorrection) {
    userModel.totalCorrections++;
    userModel.communication.corrections.push({
      domain: data.domain,
      what: data.correctionNote || "unknown",
      at: now.toISOString(),
    });
    if (userModel.communication.corrections.length > 20) {
      userModel.communication.corrections.shift();
    }
  }

  userModel.correctionRate =
    userModel.totalInteractions > 0
      ? Math.round(
          (userModel.totalCorrections / userModel.totalInteractions) * 100,
        )
      : 0;

  // Detectează domeniul preferat
  const topDomain = Object.entries(userModel.interests).sort(
    ([, a], [, b]) => b - a,
  )[0];
  if (topDomain) {
    userModel.preferredDomain = topDomain[0];
  }

  // Detectează programul activ
  const topHour = Object.entries(userModel.temporal.activeHours).sort(
    ([, a], [, b]) => b - a,
  )[0];
  if (topHour) {
    userModel.peakHour = parseInt(topHour[0]);
  }
}

function getUserModel() {
  return { ...userModel };
}

// ═══════════════════════════════════════════════════════════════
// SCHEDULED JOBS — Forgetting + Self-Test periodic
// ═══════════════════════════════════════════════════════════════

let forgettingInterval = null;
let selfTestInterval = null;

function startScheduledJobs(supabaseGetter) {
  // Forgetting Engine — rulează la fiecare 6 ore
  forgettingInterval = setInterval(
    async () => {
      try {
        const sb =
          typeof supabaseGetter === "function"
            ? supabaseGetter()
            : supabaseGetter;
        if (!sb) return;
        const k1Memory = require("./k1-memory");
        const result = await k1Memory.forget(sb, {
          maxAge: 90,
          minImportance: 3,
        });
        k1Cognitive.think(
          `🧹 Forgetting: ${result.deleted} șterse, ${result.compressed} comprimate`,
          { phase: "LEARN" },
        );
        logger.info(result, "[K1-Meta] Forgetting engine cycle");
      } catch (e) {
        logger.debug({ err: e.message }, "[K1-Meta] Forgetting cycle skip");
      }
    },
    6 * 60 * 60 * 1000,
  ); // 6 ore

  // Adversarial Self-Test — rulează la fiecare 12 ore
  selfTestInterval = setInterval(
    () => {
      try {
        const k1Truth = require("./k1-truth");
        const result = k1Truth.runSelfTest("trading");
        k1Cognitive.think(
          `🧪 Self-test trading: ${result.score}% (${result.tests.filter((t) => t.passed).length}/${result.tests.length})`,
          { phase: "LEARN" },
        );
        logger.info({ score: result.score }, "[K1-Meta] Self-test cycle");
      } catch (e) {
        logger.debug({ err: e.message }, "[K1-Meta] Self-test cycle skip");
      }
    },
    12 * 60 * 60 * 1000,
  ); // 12 ore

  // Prima execuție la 2 minute de boot
  setTimeout(
    () => {
      try {
        const k1Truth = require("./k1-truth");
        k1Truth.runSelfTest("trading");
      } catch {}
    },
    2 * 60 * 1000,
  );

  logger.info("[K1-Meta] Scheduled jobs started: Forgetting@6h, SelfTest@12h");
}

function stopScheduledJobs() {
  if (forgettingInterval) clearInterval(forgettingInterval);
  if (selfTestInterval) clearInterval(selfTestInterval);
}

// ═══════════════════════════════════════════════════════════════
// GETTERS
// ═══════════════════════════════════════════════════════════════

function getStrategies() {
  return {
    promptTemplates: Object.entries(strategies.promptTemplates).map(
      ([name, t]) => ({
        name,
        uses: t.uses,
        accuracy: t.uses > 0 ? Math.round((t.successes / t.uses) * 100) : null,
        lastUsed: t.lastUsed,
      }),
    ),
    toolPreferences: strategies.toolPreferences,
    riskParams: Object.entries(strategies.riskParams).map(([name, p]) => ({
      name,
      current: p.current,
      range: `${p.min}-${p.max}`,
    })),
  };
}

function getEvolutionReport() {
  return {
    strategies: getStrategies(),
    userModel: getUserModel(),
    learningLog: k1Cognitive
      .getMonologue(10)
      .filter((m) => m.phase === "LEARN"),
  };
}

/**
 * NEWBORN RESET — Resetează tot ce a învățat
 */
function resetAll() {
  // Reset prompt templates
  for (const t of Object.values(strategies.promptTemplates)) {
    t.uses = 0;
    t.successes = 0;
    t.lastUsed = null;
  }
  // Reset tool preferences to neutral
  for (const pref of Object.values(strategies.toolPreferences)) {
    for (const key of Object.keys(pref.scores)) {
      pref.scores[key] = 50;
    }
    pref.preferred = Object.keys(pref.scores)[0];
  }
  // Reset risk params to mid-range
  for (const p of Object.values(strategies.riskParams)) {
    p.current = Math.round((p.min + p.max) / 2);
  }
  // Reset user model
  userModel.communication.preferredStyle = "concis";
  userModel.communication.preferredLanguage = "ro";
  userModel.communication.technicalLevel = "avansat";
  userModel.communication.corrections = [];
  userModel.temporal.activeDays = {};
  userModel.temporal.activeHours = {};
  userModel.temporal.avgSessionMin = 0;
  userModel.temporal.totalSessions = 0;
  for (const key of Object.keys(userModel.interests)) {
    userModel.interests[key] = 0;
  }
  userModel.riskProfile = "moderate";
  userModel.correctionRate = 0;
  userModel.totalInteractions = 0;
  userModel.totalCorrections = 0;

  logger.info("[K1-Meta] 🧒 Meta-learning reset — newborn mode");
}

module.exports = {
  useTemplate,
  scoreTools,
  adjustRisk,
  recordUserInteraction,
  getUserModel,
  startScheduledJobs,
  stopScheduledJobs,
  getStrategies,
  getEvolutionReport,
  resetAll,
};
