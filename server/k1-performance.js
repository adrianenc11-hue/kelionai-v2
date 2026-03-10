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
    trading: { tasks: 0, correct: 0, corrections: 0, responseTimes: [], errors: {} },
    general: { tasks: 0, correct: 0, corrections: 0, responseTimes: [], errors: {} },
    coding: { tasks: 0, correct: 0, corrections: 0, responseTimes: [], errors: {} },
    research: { tasks: 0, correct: 0, corrections: 0, responseTimes: [], errors: {} },
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
    logger.warn({ domain, errorType, totalCorrections: m.corrections }, "[K1-Perf] Corectat!");
}

function addHistory(domain, type, detail = null) {
    history.push({
        domain, type, detail,
        timestamp: new Date().toISOString(),
    });
    if (history.length > MAX_HISTORY) history.shift();
}

// ═══════════════════════════════════════════════════════════════
// ANALYZE — Raport complet
// ═══════════════════════════════════════════════════════════════

function getReport() {
    const domains = Object.entries(metrics).map(([domain, m]) => {
        const accuracy = m.tasks > 0 ? Math.round(m.correct / m.tasks * 100) : null;
        const avgTime = m.responseTimes.length > 0
            ? Math.round(m.responseTimes.reduce((a, b) => a + b, 0) / m.responseTimes.length)
            : null;

        // Trend: compară ultimele 10 vs anterioarele 10
        const recentHistory = history.filter(h => h.domain === domain).slice(-20);
        const recent10 = recentHistory.slice(-10);
        const prev10 = recentHistory.slice(0, 10);
        const recentCorrect = recent10.filter(h => h.type === "correct").length;
        const prevCorrect = prev10.filter(h => h.type === "correct").length;
        let trend = "stable";
        if (recent10.length >= 5 && prev10.length >= 5) {
            trend = recentCorrect > prevCorrect ? "improving" : recentCorrect < prevCorrect ? "declining" : "stable";
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
            trendEmoji: trend === "improving" ? "📈" : trend === "declining" ? "📉" : "➡️",
            topErrors,
            status: accuracy === null ? "no_data"
                : accuracy >= 80 ? "strong"
                    : accuracy >= 60 ? "moderate"
                        : "weak",
        };
    });

    const totalTasks = domains.reduce((s, d) => s + d.tasks, 0);
    const totalCorrect = domains.reduce((s, d) => s + d.correct, 0);
    const overallAccuracy = totalTasks > 0 ? Math.round(totalCorrect / totalTasks * 100) : null;

    return {
        overall: {
            totalTasks,
            totalCorrect,
            totalCorrections: domains.reduce((s, d) => s + d.corrections, 0),
            accuracy: overallAccuracy,
            status: overallAccuracy === null ? "no_data"
                : overallAccuracy >= 80 ? "🟢 Solid"
                    : overallAccuracy >= 60 ? "🟡 Moderate"
                        : "🔴 Slab — necesită îmbunătățire",
        },
        domains,
        weakAreas: domains.filter(d => d.status === "weak").map(d => d.domain),
        strongAreas: domains.filter(d => d.status === "strong").map(d => d.domain),
        recentHistory: history.slice(-20),
    };
}

/**
 * Ce trebuie îmbunătățit? 
 */
function getRecommendations() {
    const report = getReport();
    const recs = [];

    report.domains.forEach(d => {
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

    return recs.sort((a, b) => { const p = { high: 3, medium: 2, low: 1 }; return p[b.priority] - p[a.priority]; });
}

module.exports = {
    recordTask,
    recordCorrect,
    recordCorrection,
    getReport,
    getRecommendations,
};
