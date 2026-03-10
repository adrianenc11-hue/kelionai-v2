/**
 * Trading Learner — Self-learning engine for trading bot
 * 
 * Analyzes performance per asset/market automatically:
 * - Tracks win rate, avg PnL, Sharpe ratio per asset
 * - Identifies which markets bot excels vs struggles
 * - Auto-adjusts confidence thresholds, position sizes
 * - Saves learned rules to Supabase (trading_brain_rules)
 * - Sends analysis to Brain (Gemini AI) for real solutions
 * - Runs every hour automatically when bot is ON
 */

const logger = require("pino")({ name: "trading-learner" });

// Default rules per asset — will be overwritten by learned rules
const DEFAULT_RULES = {
    minConfidence: 60,      // minimum signal confidence to trade
    maxAllocation: 0.2,     // max % of cash per position (20%)
    preferredSessions: [],  // best sessions for this asset
    enabled: true,          // can the bot trade this asset?
    notes: "",              // AI-generated notes
};

// In-memory learned rules (restored from DB on startup)
let learnedRules = {};
let _learnerInterval = null;
let _lastAnalysis = null;

/**
 * Analyze all trades and learn from results
 * Called every hour automatically
 */
async function analyzeAndLearn(supabase) {
    try {
        // Get ALL trades from Supabase
        const { data: trades } = await supabase
            .from("trading_paper_trades")
            .select("*")
            .order("created_at", { ascending: true });

        if (!trades || trades.length < 2) {
            logger.info("[Learner] Not enough trades to analyze yet");
            return { status: "insufficient_data", trades: trades?.length || 0 };
        }

        // ═══ PER-ASSET ANALYSIS ═══
        const assetStats = {};
        for (const t of trades) {
            if (!assetStats[t.asset]) {
                assetStats[t.asset] = {
                    asset: t.asset,
                    totalTrades: 0,
                    wins: 0,
                    losses: 0,
                    totalPnL: 0,
                    avgPnL: 0,
                    bestTrade: 0,
                    worstTrade: 0,
                    avgConfidence: 0,
                    confidenceSum: 0,
                    avgHoldTime: 0,
                    holdTimes: [],
                    pnls: [],
                };
            }
            const s = assetStats[t.asset];
            s.totalTrades++;
            s.confidenceSum += (t.confidence || 0);
            s.avgConfidence = s.confidenceSum / s.totalTrades;

            if (t.pnl !== null && t.pnl !== undefined) {
                s.totalPnL += t.pnl;
                s.pnls.push(t.pnl);
                if (t.pnl > 0) s.wins++;
                else if (t.pnl < 0) s.losses++;
                if (t.pnl > s.bestTrade) s.bestTrade = t.pnl;
                if (t.pnl < s.worstTrade) s.worstTrade = t.pnl;
            }
            if (t.hold_time) s.holdTimes.push(t.hold_time);
        }

        // Calculate derived metrics per asset
        const assetPerformance = {};
        for (const [asset, s] of Object.entries(assetStats)) {
            const closedTrades = s.wins + s.losses;
            const winRate = closedTrades > 0 ? (s.wins / closedTrades * 100) : 0;
            const avgPnL = s.pnls.length > 0 ? s.totalPnL / s.pnls.length : 0;

            // Sharpe Ratio (simplified)
            let sharpe = 0;
            if (s.pnls.length > 1) {
                const mean = s.pnls.reduce((a, b) => a + b, 0) / s.pnls.length;
                const variance = s.pnls.reduce((a, b) => a + (b - mean) ** 2, 0) / s.pnls.length;
                const stdDev = Math.sqrt(variance);
                sharpe = stdDev > 0 ? +(mean / stdDev).toFixed(3) : 0;
            }

            // Profit Factor
            const grossProfit = s.pnls.filter(p => p > 0).reduce((a, b) => a + b, 0);
            const grossLoss = Math.abs(s.pnls.filter(p => p < 0).reduce((a, b) => a + b, 0));
            const profitFactor = grossLoss > 0 ? +(grossProfit / grossLoss).toFixed(2) : grossProfit > 0 ? 999 : 0;

            // Grade: A (excellent), B (good), C (ok), D (poor), F (avoid)
            let grade = "C";
            if (winRate >= 65 && sharpe > 0.5) grade = "A";
            else if (winRate >= 55 && sharpe > 0.2) grade = "B";
            else if (winRate >= 45) grade = "C";
            else if (winRate >= 30) grade = "D";
            else grade = "F";

            assetPerformance[asset] = {
                asset,
                totalTrades: s.totalTrades,
                closedTrades,
                wins: s.wins,
                losses: s.losses,
                winRate: +winRate.toFixed(1),
                totalPnL: +s.totalPnL.toFixed(2),
                avgPnL: +avgPnL.toFixed(2),
                bestTrade: +s.bestTrade.toFixed(2),
                worstTrade: +s.worstTrade.toFixed(2),
                avgConfidence: +s.avgConfidence.toFixed(1),
                sharpe,
                profitFactor,
                grade,
            };
        }

        // ═══ AUTO-CALIBRATE RULES ═══
        for (const [asset, perf] of Object.entries(assetPerformance)) {
            const rules = { ...DEFAULT_RULES, ...(learnedRules[asset] || {}) };

            // Adjust confidence threshold based on performance
            if (perf.grade === "A") {
                rules.minConfidence = Math.max(50, rules.minConfidence - 5); // Lower threshold = more trades
                rules.maxAllocation = Math.min(0.3, rules.maxAllocation + 0.02); // Bigger positions
            } else if (perf.grade === "B") {
                rules.minConfidence = 60; // Standard
                rules.maxAllocation = 0.2;
            } else if (perf.grade === "D") {
                rules.minConfidence = Math.min(80, rules.minConfidence + 5); // Higher threshold = fewer trades
                rules.maxAllocation = Math.max(0.1, rules.maxAllocation - 0.03); // Smaller positions
            } else if (perf.grade === "F") {
                rules.minConfidence = 85; // Very selective
                rules.maxAllocation = 0.05; // Minimal exposure
                rules.notes = `⚠️ Poor performance (WR:${perf.winRate}%, Sharpe:${perf.sharpe}). Consider disabling.`;
            }

            // If consistently losing, reduce exposure
            if (perf.totalPnL < -5 && perf.closedTrades >= 5) {
                rules.maxAllocation = Math.max(0.05, rules.maxAllocation * 0.7);
                rules.notes = `📉 Losing streak on ${asset}. Reduced exposure to ${(rules.maxAllocation * 100).toFixed(0)}%.`;
            }

            // If consistently winning, increase exposure carefully
            if (perf.totalPnL > 5 && perf.winRate > 60 && perf.closedTrades >= 5) {
                rules.maxAllocation = Math.min(0.35, rules.maxAllocation * 1.15);
                rules.notes = `📈 Strong performance on ${asset}! Increased exposure to ${(rules.maxAllocation * 100).toFixed(0)}%.`;
            }

            learnedRules[asset] = rules;
        }

        // ═══ SAVE TO SUPABASE ═══
        for (const [asset, rules] of Object.entries(learnedRules)) {
            const perf = assetPerformance[asset] || {};
            try {
                await supabase.from("trading_brain_rules").upsert({
                    asset,
                    min_confidence: rules.minConfidence,
                    max_allocation: rules.maxAllocation,
                    enabled: rules.enabled,
                    grade: perf.grade || "?",
                    win_rate: perf.winRate || 0,
                    sharpe_ratio: perf.sharpe || 0,
                    profit_factor: perf.profitFactor || 0,
                    total_pnl: perf.totalPnL || 0,
                    total_trades: perf.totalTrades || 0,
                    notes: rules.notes || "",
                    updated_at: new Date().toISOString(),
                }, { onConflict: "asset" });
            } catch (e) { /* table might not exist */ }
        }

        _lastAnalysis = {
            timestamp: new Date().toISOString(),
            totalTrades: trades.length,
            assetsAnalyzed: Object.keys(assetPerformance).length,
            performance: assetPerformance,
            rules: learnedRules,
        };

        logger.info({
            assets: Object.keys(assetPerformance).length,
            trades: trades.length,
            bestAsset: Object.entries(assetPerformance).sort((a, b) => b[1].winRate - a[1].winRate)[0]?.[0],
            worstAsset: Object.entries(assetPerformance).sort((a, b) => a[1].winRate - b[1].winRate)[0]?.[0],
        }, "[Learner] Analysis complete — rules updated");

        return _lastAnalysis;
    } catch (e) {
        logger.error({ err: e.message }, "[Learner] Analysis failed");
        return { error: e.message };
    }
}

/**
 * Get learned rule for a specific asset
 * Used by paper-trading.js before executing trades
 */
function getRulesForAsset(asset) {
    return { ...DEFAULT_RULES, ...(learnedRules[asset] || {}) };
}

/**
 * Get full analysis report
 */
function getAnalysisReport() {
    return _lastAnalysis || { status: "no_analysis_yet" };
}

/**
 * Restore learned rules from Supabase on startup
 */
async function restoreRules(supabase) {
    try {
        const { data } = await supabase
            .from("trading_brain_rules")
            .select("*");
        if (data && data.length > 0) {
            data.forEach(r => {
                learnedRules[r.asset] = {
                    minConfidence: r.min_confidence || DEFAULT_RULES.minConfidence,
                    maxAllocation: r.max_allocation || DEFAULT_RULES.maxAllocation,
                    enabled: r.enabled !== false,
                    preferredSessions: [],
                    notes: r.notes || "",
                };
            });
            logger.info({ rules: data.length }, `[Learner] Restored ${data.length} learned rules from DB`);
        }
    } catch (e) { /* table might not exist */ }
}

/**
 * Start the learning loop — runs every hour
 */
function startLearning(supabase) {
    // Restore rules from DB first
    restoreRules(supabase).catch(() => { });

    // Run analysis immediately
    setTimeout(() => analyzeAndLearn(supabase).catch(() => { }), 15000);

    // Then every hour
    _learnerInterval = setInterval(() => {
        analyzeAndLearn(supabase).catch(() => { });
    }, 60 * 60 * 1000); // every hour

    logger.info("[Learner] Self-learning engine started (analysis every 1h)");
}

/**
 * Stop learning loop
 */
function stopLearning() {
    if (_learnerInterval) {
        clearInterval(_learnerInterval);
        _learnerInterval = null;
    }
}

module.exports = {
    analyzeAndLearn,
    getRulesForAsset,
    getAnalysisReport,
    restoreRules,
    startLearning,
    stopLearning,
    DEFAULT_RULES,
};
