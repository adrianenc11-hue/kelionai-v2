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

  const { pnlPct, reason, _holdHours } = tradeResult;

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

  // Analizează stilul de comunicare din mesaj
  if (data.userMessage) {
    analyzeUserStyle(data.userMessage);
  }
}

// ═══════════════════════════════════════════════════════════════
// STYLE ANALYSIS — Learns communication preferences from messages
// ═══════════════════════════════════════════════════════════════

// Counters for style detection (not hardcoded rules)
const styleCounters = {
  messageLengths: [],     // track message lengths
  technicalWords: 0,      // count of technical terms used
  simpleWords: 0,         // count of simple/casual terms
  formalPhrases: 0,       // formal language indicators
  informalPhrases: 0,     // informal language indicators
  emojiCount: 0,          // emoji usage
  totalAnalyzed: 0,       // total messages analyzed
};

/**
 * Analyze a user message to learn communication style.
 * Only updates preferences after 10+ messages (real data).
 */
function analyzeUserStyle(message) {
  if (!message || typeof message !== "string") return;
  const m = message.trim();
  if (m.length < 2) return;

  styleCounters.totalAnalyzed++;
  styleCounters.messageLengths.push(m.length);
  if (styleCounters.messageLengths.length > 50) styleCounters.messageLengths.shift();

  // Technical vocabulary detection (RO + EN)
  const techTerms = /\b(API|backend|frontend|deploy|server|database|function|variabil[aă]|algoritm|framework|debug|commit|merge|branch|endpoint|token|hash|crypto|blockchain|RSI|MACD|fibonacci|bollinger|volatilitat|portofoliu|hedging|leverage|margin)\b/gi;
  const techMatches = m.match(techTerms);
  if (techMatches) styleCounters.technicalWords += techMatches.length;

  // Simple/casual vocabulary
  const simpleTerms = /\b(ok|da|nu|bine|mersi|ms|hai|super|tare|misto|fain|wow|cool|nice|perfect|bravo|salut|hey|yo)\b/gi;
  const simpleMatches = m.match(simpleTerms);
  if (simpleMatches) styleCounters.simpleWords += simpleMatches.length;

  // Formal indicators
  const formalPattern = /\b(vă rog|mulțumesc|dumneavoastră|domnul|doamna|aș dori|permiteți|referitor la|conform|please|thank you|regards|kindly)\b/gi;
  if (formalPattern.test(m)) styleCounters.formalPhrases++;

  // Informal indicators
  const informalPattern = /\b(yo|hey|bro|frate|boss|sefu|nush|stii|zic|zici|mna|bre|ba|:D|:P|XD|lol|haha)\b/gi;
  if (informalPattern.test(m)) styleCounters.informalPhrases++;

  // Emoji detection
  const emojiPattern = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2702}-\u{27B0}\u{24C2}-\u{1F251}]/gu;
  const emojis = m.match(emojiPattern);
  if (emojis) styleCounters.emojiCount += emojis.length;

  // ── Update userModel only after 10+ messages (real observed data) ──
  if (styleCounters.totalAnalyzed >= 10) {
    const avgLen = styleCounters.messageLengths.reduce((a, b) => a + b, 0) / styleCounters.messageLengths.length;

    // Message length → style preference
    if (avgLen < 30) {
      userModel.communication.preferredStyle = "foarte_concis";
    } else if (avgLen < 80) {
      userModel.communication.preferredStyle = "concis";
    } else if (avgLen < 200) {
      userModel.communication.preferredStyle = "normal";
    } else {
      userModel.communication.preferredStyle = "detaliat";
    }

    // Technical level from vocabulary
    const techRatio = styleCounters.technicalWords / Math.max(1, styleCounters.technicalWords + styleCounters.simpleWords);
    if (techRatio > 0.6) {
      userModel.communication.technicalLevel = "avansat";
    } else if (techRatio > 0.3) {
      userModel.communication.technicalLevel = "intermediar";
    } else {
      userModel.communication.technicalLevel = "începător";
    }

    // Formality level
    if (styleCounters.formalPhrases > styleCounters.informalPhrases * 2) {
      userModel.communication.formality = "formal";
    } else if (styleCounters.informalPhrases > styleCounters.formalPhrases * 2) {
      userModel.communication.formality = "informal";
    } else {
      userModel.communication.formality = "normal";
    }

    // Emoji preference
    userModel.communication.usesEmoji = styleCounters.emojiCount > styleCounters.totalAnalyzed * 0.3;

    // Mark as observed (not default)
    userModel.communication._observed = true;
    userModel.communication._analyzedMessages = styleCounters.totalAnalyzed;
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
      } catch { /* ignored */ }
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

// ═══════════════════════════════════════════════════════════════
// PATTERN SYNTHESIS — Converts raw data into actionable rules
// ═══════════════════════════════════════════════════════════════

function synthesizePatterns() {
  const rules = [];
  const m = userModel;

  // MINIMUM THRESHOLDS — no patterns until enough real data
  if (m.totalInteractions < 5) return rules; // prea puține date

  // 1. Preferred domain — doar dacă ≥10 interacțiuni reale
  const sortedInterests = Object.entries(m.interests)
    .filter(([, v]) => v >= 3) // minim 3 interacțiuni pe domeniu
    .sort(([, a], [, b]) => b - a);
  if (sortedInterests.length > 0 && m.totalInteractions >= 10) {
    const top = sortedInterests[0];
    const topPct = Math.round((top[1] / m.totalInteractions) * 100);
    if (topPct > 40) {
      rules.push(`Userul e interesat în principal de ${top[0]} (${topPct}% din ${m.totalInteractions} conversații).`);
    }
    if (sortedInterests.length > 1) {
      const secondary = sortedInterests.slice(1, 3).map(([k]) => k).join(", ");
      rules.push(`Interese secundare: ${secondary}.`);
    }
  }

  // 2. Temporal patterns — doar dacă ≥5 ore distincte înregistrate
  const hourEntries = Object.entries(m.temporal.activeHours).filter(([, v]) => v >= 2);
  if (hourEntries.length >= 3) {
    const topHours = hourEntries
      .sort(([, a], [, b]) => b - a)
      .slice(0, 3)
      .map(([h]) => h + ":00");
    rules.push(`Userul e cel mai activ la: ${topHours.join(", ")}.`);
  }
  const dayEntries = Object.entries(m.temporal.activeDays).filter(([, v]) => v >= 2);
  if (dayEntries.length >= 2) {
    const topDays = dayEntries
      .sort(([, a], [, b]) => b - a)
      .slice(0, 2)
      .map(([d]) => d);
    rules.push(`Zilele cele mai active: ${topDays.join(", ")}.`);
  }

  // 3. Correction rate — doar din date reale (≥5 interacțiuni)
  if (m.totalCorrections > 0) {
    if (m.correctionRate > 30) {
      rules.push("Atenție: rată mare de corecții (" + m.correctionRate + "%). Verifică de două ori înainte de a răspunde.");
    } else if (m.correctionRate > 15) {
      rules.push("Userul corectează ocazional (" + m.correctionRate + "%). Reconfirmă când nu ești sigur.");
    }
  }

  // 4. Corecții concrete — DOAR cele reale observate
  if (m.communication.corrections.length > 0) {
    const correctionNotes = m.communication.corrections
      .slice(-5)
      .filter(c => c.what && c.what !== "unknown")
      .map(c => c.what);
    if (correctionNotes.length > 0) {
      rules.push("Corecții de reținut: " + correctionNotes.join("; ") + ".");
    }
  }

  // 5. Communication style — DOAR dacă a fost observat din date reale
  if (m.communication._observed) {
    const styleMap = {
      foarte_concis: "Userul preferă mesaje foarte scurte. Răspunde concis, fără explicații inutile.",
      concis: "Userul preferă răspunsuri scurte și la obiect.",
      normal: "Userul preferă răspunsuri de lungime medie.",
      detaliat: "Userul preferă răspunsuri detaliate cu explicații complete.",
    };
    if (styleMap[m.communication.preferredStyle]) {
      rules.push(styleMap[m.communication.preferredStyle]);
    }
    if (m.communication.technicalLevel) {
      rules.push(`Nivel tehnic observat: ${m.communication.technicalLevel}.`);
    }
    if (m.communication.formality === "informal") {
      rules.push("Userul comunică informal. Folosește ton casual, prietenesc.");
    } else if (m.communication.formality === "formal") {
      rules.push("Userul comunică formal. Menține un ton profesional.");
    }
    if (m.communication.usesEmoji) {
      rules.push("Userul folosește emoji frecvent. Poți răspunde cu emoji.");
    }
  }

  return rules;
}

/**
 * Get patterns as a text block for system prompt injection
 */
function getPatternsText() {
  const rules = synthesizePatterns();
  if (rules.length === 0) return "";
  return "\n[LEARNED PATTERNS]\n" + rules.join("\n") + "\n[/LEARNED PATTERNS]";
}

// ═══════════════════════════════════════════════════════════════
// PROACTIVE SUGGESTIONS — Pattern-based contextual hints
// ═══════════════════════════════════════════════════════════════

/**
 * Generate proactive suggestion based on observed patterns.
 * Returns a hint string or "" if no suggestion.
 * Only activates after 20+ interactions (sufficient data).
 */
function getProactiveSuggestion() {
  const m = userModel;
  if (m.totalInteractions < 20) return ""; // need enough data

  const now = new Date();
  const currentHour = now.getUTCHours().toString();
  const currentDay = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][now.getUTCDay()];

  const suggestions = [];

  // 1. Peak hour + preferred domain → contextual suggestion
  if (m.peakHour !== undefined && Math.abs(parseInt(currentHour) - m.peakHour) <= 1) {
    const topDomain = m.preferredDomain;
    const domainSuggestions = {
      trading: "E ora ta de trading — vrei o analiză rapidă a pieței?",
      coding: "E ora ta de coding — ai ceva la care lucrezi?",
      research: "E momentul tău obișnuit de research — ce investigăm azi?",
      news: "E ora ta de știri — vrei un rezumat al zilei?",
    };
    if (topDomain && domainSuggestions[topDomain]) {
      suggestions.push(domainSuggestions[topDomain]);
    }
  }

  // 2. Active day pattern — weekend vs weekday behavior
  const topDays = Object.entries(m.temporal.activeDays)
    .filter(([, v]) => v >= 3)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 2)
    .map(([d]) => d);
  const _isWeekend = currentDay === "Saturday" || currentDay === "Sunday";
  if (topDays.length > 0 && !topDays.includes(currentDay) && m.totalInteractions > 30) {
    // User is active on an unusual day
    suggestions.push(`De obicei ești mai activ ${topDays.join(" și ")} — astăzi e o zi bonus! 😊`);
  }

  // 3. High correction rate warning (proactive self-improvement)
  if (m.correctionRate > 20 && m.totalInteractions > 15) {
    suggestions.push("Atenție sporită la acuratețe — rata de corecții e ridicată recent.");
  }

  // Return first suggestion (keep it subtle, one at a time)
  return suggestions.length > 0
    ? "\n[PROACTIVE] " + suggestions[0] + " [/PROACTIVE]"
    : "";
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
  synthesizePatterns,
  getPatternsText,
  getProactiveSuggestion,
};
