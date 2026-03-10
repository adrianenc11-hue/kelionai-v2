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

        // ═══ ASK GEMINI AI FOR REAL RECOMMENDATIONS ═══
        const aiAdvice = await askGeminiForAdvice(assetPerformance, learnedRules);
        if (aiAdvice) {
            // Apply AI recommendations to learned rules
            for (const [asset, advice] of Object.entries(aiAdvice)) {
                if (learnedRules[asset]) {
                    if (advice.minConfidence) learnedRules[asset].minConfidence = advice.minConfidence;
                    if (advice.maxAllocation) learnedRules[asset].maxAllocation = advice.maxAllocation;
                    if (advice.enabled !== undefined) learnedRules[asset].enabled = advice.enabled;
                    if (advice.notes) learnedRules[asset].notes = `🤖 AI: ${advice.notes}`;
                }
            }
            logger.info({ assets: Object.keys(aiAdvice).length }, "[Learner] Gemini AI recommendations applied");
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
                    ai_advice: aiAdvice?.[asset]?.notes || "",
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
            aiAdvice: aiAdvice || null,
        };

        logger.info({
            assets: Object.keys(assetPerformance).length,
            trades: trades.length,
            aiActive: !!aiAdvice,
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
 * Ask Gemini AI for trading recommendations
 * Sends performance data, gets back adjusted rules per asset
 */
async function askGeminiForAdvice(assetPerformance, currentRules) {
    const geminiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
    if (!geminiKey) {
        logger.info("[Learner] No Gemini API key — skipping AI analysis");
        return null;
    }

    try {
        const perfSummary = Object.entries(assetPerformance).map(([asset, p]) => (
            `${asset}: ${p.totalTrades} trades, WR=${p.winRate}%, PnL=€${p.totalPnL}, Sharpe=${p.sharpe}, PF=${p.profitFactor}, Grade=${p.grade}`
        )).join("\n");

        const rulesSummary = Object.entries(currentRules).map(([asset, r]) => (
            `${asset}: confidence=${r.minConfidence}%, allocation=${(r.maxAllocation * 100).toFixed(0)}%, enabled=${r.enabled}`
        )).join("\n");

        const prompt = `You are an AI trading strategy advisor for a paper trading bot.

CURRENT PERFORMANCE PER ASSET:
${perfSummary}

CURRENT RULES:
${rulesSummary}

MARKET CONTEXT: Current UTC hour is ${new Date().getUTCHours()}. Active sessions: ${getActiveSessionNames()}.

Analyze the performance and provide SPECIFIC recommendations for each asset.
For each asset, provide:
- minConfidence (50-90): lower = more trades, higher = fewer but better trades
- maxAllocation (0.05-0.35): percentage of cash to risk per trade
- enabled (true/false): should bot trade this asset?
- notes: brief explanation of your recommendation (max 50 words)

RESPOND ONLY WITH VALID JSON in this exact format:
{
  "BTC": {"minConfidence": 55, "maxAllocation": 0.25, "enabled": true, "notes": "Strong momentum..."},
  "ETH": {"minConfidence": 60, "maxAllocation": 0.2, "enabled": true, "notes": "Stable performance..."}
}`;

        const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.3, maxOutputTokens: 1500 },
            }),
        });

        if (!r.ok) {
            logger.warn({ status: r.status }, "[Learner] Gemini API error");
            return null;
        }

        const data = await r.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";

        // Extract JSON from response (handle markdown code blocks)
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
            logger.warn("[Learner] Gemini returned no valid JSON");
            return null;
        }

        const advice = JSON.parse(jsonMatch[0]);
        logger.info({ assets: Object.keys(advice).length }, "[Learner] 🤖 Gemini AI advice received");
        return advice;
    } catch (e) {
        logger.warn({ err: e.message }, "[Learner] Gemini analysis failed (will use rule-based)");
        return null;
    }
}

function getActiveSessionNames() {
    const hour = new Date().getUTCHours();
    const sessions = [];
    if (hour >= 0 && hour < 9) sessions.push("Tokyo");
    if (hour >= 7 && hour < 16) sessions.push("London");
    if (hour >= 13 && hour < 22) sessions.push("New York");
    if (hour >= 22 || hour < 7) sessions.push("Sydney");
    return sessions.join(", ") || "none";
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
