"use strict";

// ═══════════════════════════════════════════════════════════════════════════
// KelionAI — Market Learner
// Machine learning from REAL market data — learns patterns, remembers
// outcomes, adapts strategy weights. Saves EVERYTHING unlimited to Supabase.
// "Ca unul care are o viață în spate" — acumulează experiență reală.
// ═══════════════════════════════════════════════════════════════════════════

const logger = require("./logger");

class MarketLearner {
    constructor() {
        this.supabase = null;

        // ── In-memory learning state ──
        this.patternMemory = [];     // { pattern, outcome, confidence, asset, tf, ts }
        this.signalAccuracy = {};    // { "BTC/RSI/BUY": { hits: 42, misses: 8 } }
        this.strategyWeights = {     // adaptive weights — start equal
            RSI: 15, MACD: 20, Bollinger: 15, EMA: 20,
            Fibonacci: 10, Volume: 10, Sentiment: 10,
            Stochastic: 12, ADX: 15, Ichimoku: 18,
            CCI: 8, MFI: 10, ParabolicSAR: 12,
        };
        this.sessionLearnings = [];   // what was learned this session
        this.marketRegimeHistory = []; // regime changes over time
        this.tradeOutcomes = [];      // full trade lifecycle tracking

        // ── Statistical accumulators ──
        this.priceDistributions = {};  // { BTC: { mean, variance, skew, kurtosis } }
        this.volatilityRegimes = {};   // { BTC: [{ regime, start, end, avgATR }] }
        this.correlationMemory = {};   // time-varying correlations

        // ── Error tracking ──
        this.predictionErrors = [];    // { predicted, actual, abs_error, asset, ts }

        this.initialized = false;
    }

    // ═══════════════════════════════════════════════════════════════
    // INITIALIZATION
    // ═══════════════════════════════════════════════════════════════

    async init(supabase) {
        this.supabase = supabase;
        if (!supabase) {
            logger.warn({ component: "Learner" }, "No Supabase — learning in memory only");
            this.initialized = true;
            return;
        }

        // Load previous learnings from DB
        try {
            const { data: weights } = await supabase
                .from("market_learnings")
                .select("*")
                .eq("type", "strategy_weights")
                .order("created_at", { ascending: false })
                .limit(1);

            if (weights?.[0]?.data) {
                this.strategyWeights = { ...this.strategyWeights, ...weights[0].data };
                logger.info({ component: "Learner", weights: weights[0].data }, "📚 Loaded learned strategy weights");
            }

            // Load signal accuracy history
            const { data: accuracy } = await supabase
                .from("market_learnings")
                .select("*")
                .eq("type", "signal_accuracy")
                .order("created_at", { ascending: false })
                .limit(1);

            if (accuracy?.[0]?.data) {
                this.signalAccuracy = accuracy[0].data;
                const totalSignals = Object.values(this.signalAccuracy)
                    .reduce((s, v) => s + (v.hits || 0) + (v.misses || 0), 0);
                logger.info({ component: "Learner", totalSignals }, "📊 Loaded signal accuracy data");
            }

            // Load pattern memory
            const { data: patterns, count } = await supabase
                .from("market_patterns")
                .select("*", { count: "exact" })
                .order("created_at", { ascending: false })
                .limit(500);

            if (patterns?.length > 0) {
                this.patternMemory = patterns;
                logger.info({ component: "Learner", loaded: patterns.length, total: count }, "🧠 Loaded pattern memory");
            }
        } catch (e) {
            logger.warn({ component: "Learner", err: e.message }, "Error loading learnings — starting fresh");
        }

        this.initialized = true;
        logger.info({ component: "Learner" }, "🧠 Market Learner initialized — ready to learn");
    }

    // ═══════════════════════════════════════════════════════════════
    // CORE: Record a signal and its outcome
    // ═══════════════════════════════════════════════════════════════

    recordSignal(asset, indicator, signal, entryPrice) {
        const key = `${asset}/${indicator}/${signal}`;
        if (!this.signalAccuracy[key]) {
            this.signalAccuracy[key] = { hits: 0, misses: 0, totalPnl: 0, avgHoldBars: 0 };
        }
        // Store pending signal for outcome tracking
        this.tradeOutcomes.push({
            key,
            asset,
            indicator,
            signal,
            entryPrice,
            entryTime: Date.now(),
            resolved: false,
        });
    }

    resolveSignal(asset, indicator, signal, exitPrice, holdBars = 0) {
        const key = `${asset}/${indicator}/${signal}`;
        const pending = this.tradeOutcomes.find(
            t => t.key === key && !t.resolved
        );
        if (!pending) return;

        pending.resolved = true;
        pending.exitPrice = exitPrice;
        pending.holdBars = holdBars;

        const pnlPct = signal.includes("BUY")
            ? ((exitPrice - pending.entryPrice) / pending.entryPrice) * 100
            : ((pending.entryPrice - exitPrice) / pending.entryPrice) * 100;

        pending.pnlPct = pnlPct;
        const isHit = pnlPct > 0;

        if (!this.signalAccuracy[key]) {
            this.signalAccuracy[key] = { hits: 0, misses: 0, totalPnl: 0, avgHoldBars: 0 };
        }

        const acc = this.signalAccuracy[key];
        if (isHit) acc.hits++; else acc.misses++;
        acc.totalPnl += pnlPct;
        acc.avgHoldBars = ((acc.avgHoldBars * (acc.hits + acc.misses - 1)) + holdBars) / (acc.hits + acc.misses);

        // ── ADAPTIVE WEIGHT UPDATE ──
        this._updateWeights(indicator, isHit, Math.abs(pnlPct));

        // ── PERSIST ──
        this._persistLearning("signal_outcome", {
            key, asset, indicator, signal, isHit, pnlPct,
            entryPrice: pending.entryPrice, exitPrice, holdBars,
        });

        this.sessionLearnings.push({
            type: "signal_resolved",
            key,
            isHit,
            pnlPct: +pnlPct.toFixed(4),
            ts: Date.now(),
        });

        return { isHit, pnlPct };
    }

    // ═══════════════════════════════════════════════════════════════
    // ADAPTIVE WEIGHT SYSTEM — Bayesian-inspired updating
    // ═══════════════════════════════════════════════════════════════

    _updateWeights(indicator, isHit, magnitude) {
        if (!this.strategyWeights[indicator]) return;

        // Learning rate decays with experience
        const totalExperience = Object.values(this.signalAccuracy)
            .reduce((s, v) => s + (v.hits || 0) + (v.misses || 0), 0);
        const learningRate = Math.max(0.01, 0.1 / (1 + totalExperience / 1000));

        // Adjust weight
        const adjustment = learningRate * magnitude * (isHit ? 1 : -1);
        this.strategyWeights[indicator] = Math.max(1, Math.min(30,
            this.strategyWeights[indicator] + adjustment
        ));

        // Normalize weights to sum to 100
        const total = Object.values(this.strategyWeights).reduce((s, v) => s + v, 0);
        if (total > 0) {
            for (const k of Object.keys(this.strategyWeights)) {
                this.strategyWeights[k] = +(this.strategyWeights[k] / total * 100).toFixed(2);
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════
    // PATTERN LEARNING — Remember what worked before
    // ═══════════════════════════════════════════════════════════════

    recordPattern(asset, tf, patternType, context, outcome) {
        const entry = {
            asset,
            timeframe: tf,
            pattern_type: patternType,
            context: JSON.stringify(context),
            outcome: outcome, // "bullish", "bearish", "neutral"
            confidence: 0.5,   // starts neutral
            created_at: new Date().toISOString(),
        };

        this.patternMemory.push(entry);

        // Calculate pattern confidence from history
        const similar = this.patternMemory.filter(
            p => p.pattern_type === patternType && p.asset === asset
        );
        const bullish = similar.filter(p => p.outcome === "bullish").length;
        const total = similar.length;
        entry.confidence = total > 0 ? bullish / total : 0.5;

        // Persist to Supabase
        if (this.supabase) {
            this.supabase.from("market_patterns").insert(entry).catch(() => { });
        }

        return entry;
    }

    getPatternConfidence(asset, patternType) {
        const similar = this.patternMemory.filter(
            p => p.pattern_type === patternType && p.asset === asset
        );
        if (similar.length < 5) return { confidence: 0.5, samples: similar.length, reliable: false };

        const bullish = similar.filter(p => p.outcome === "bullish").length;
        return {
            confidence: +(bullish / similar.length).toFixed(4),
            samples: similar.length,
            reliable: similar.length >= 20,
            lastSeen: similar[similar.length - 1]?.created_at,
        };
    }

    // ═══════════════════════════════════════════════════════════════
    // REGIME LEARNING — Track market regime changes
    // ═══════════════════════════════════════════════════════════════

    recordRegimeChange(asset, regime, indicators) {
        const entry = {
            asset,
            regime,  // "trending_bull", "trending_bear", "ranging", "volatile"
            indicators: JSON.stringify(indicators),
            ts: Date.now(),
        };
        this.marketRegimeHistory.push(entry);

        // Persist
        this._persistLearning("regime_change", entry);
    }

    // ═══════════════════════════════════════════════════════════════
    // PREDICTION ERROR TRACKING — learns from mistakes
    // ═══════════════════════════════════════════════════════════════

    recordPredictionError(asset, predicted, actual) {
        const absError = Math.abs(predicted - actual);
        const pctError = actual > 0 ? (absError / actual) * 100 : 0;

        this.predictionErrors.push({
            asset, predicted, actual, absError, pctError,
            ts: Date.now(),
        });

        // Keep last 5000 errors
        if (this.predictionErrors.length > 5000) {
            this.predictionErrors = this.predictionErrors.slice(-5000);
        }

        // Persist
        this._persistLearning("prediction_error", { asset, predicted, actual, pctError });
    }

    getMeanError(asset, last = 100) {
        const errors = this.predictionErrors
            .filter(e => !asset || e.asset === asset)
            .slice(-last);
        if (errors.length === 0) return { meanPctError: 0, samples: 0 };

        const meanPct = errors.reduce((s, e) => s + e.pctError, 0) / errors.length;
        return { meanPctError: +meanPct.toFixed(4), samples: errors.length };
    }

    // ═══════════════════════════════════════════════════════════════
    // PRICE DISTRIBUTION LEARNING — statistical intelligence
    // ═══════════════════════════════════════════════════════════════

    updatePriceDistribution(asset, prices) {
        if (!prices || prices.length < 30) return;

        const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
        const n = returns.length;
        const mean = returns.reduce((s, r) => s + r, 0) / n;
        const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / n;
        const stdDev = Math.sqrt(variance);

        // Skewness (asymmetry)
        const skew = returns.reduce((s, r) => s + Math.pow((r - mean) / stdDev, 3), 0) / n;

        // Kurtosis (tail heaviness — >3 = fat tails, more extreme events)
        const kurtosis = returns.reduce((s, r) => s + Math.pow((r - mean) / stdDev, 4), 0) / n;

        this.priceDistributions[asset] = {
            mean: +mean.toFixed(8),
            variance: +variance.toFixed(8),
            stdDev: +stdDev.toFixed(8),
            skew: +skew.toFixed(4),
            kurtosis: +kurtosis.toFixed(4),
            fatTails: kurtosis > 3,
            biasDirection: skew > 0.1 ? "bullish" : skew < -0.1 ? "bearish" : "neutral",
            samples: n,
            updatedAt: Date.now(),
        };

        return this.priceDistributions[asset];
    }

    // ═══════════════════════════════════════════════════════════════
    // GET ADAPTIVE WEIGHTS — the "experience" of the system
    // ═══════════════════════════════════════════════════════════════

    getWeights() {
        return { ...this.strategyWeights };
    }

    getAccuracy(asset, indicator) {
        if (asset && indicator) {
            const buyKey = `${asset}/${indicator}/BUY`;
            const sellKey = `${asset}/${indicator}/SELL`;
            return {
                buy: this.signalAccuracy[buyKey] || { hits: 0, misses: 0 },
                sell: this.signalAccuracy[sellKey] || { hits: 0, misses: 0 },
            };
        }
        return this.signalAccuracy;
    }

    // ═══════════════════════════════════════════════════════════════
    // FULL REPORT — everything the system has learned
    // ═══════════════════════════════════════════════════════════════

    getReport() {
        const totalSignals = Object.values(this.signalAccuracy)
            .reduce((s, v) => s + (v.hits || 0) + (v.misses || 0), 0);
        const totalHits = Object.values(this.signalAccuracy)
            .reduce((s, v) => s + (v.hits || 0), 0);

        // Top performers
        const performers = Object.entries(this.signalAccuracy)
            .filter(([, v]) => (v.hits + v.misses) >= 5)
            .map(([key, v]) => ({
                key,
                winRate: +((v.hits / (v.hits + v.misses)) * 100).toFixed(1),
                totalPnl: +v.totalPnl.toFixed(2),
                trades: v.hits + v.misses,
            }))
            .sort((a, b) => b.winRate - a.winRate);

        return {
            totalSignalsTracked: totalSignals,
            overallWinRate: totalSignals > 0 ? +((totalHits / totalSignals) * 100).toFixed(1) : 0,
            adaptiveWeights: this.strategyWeights,
            topPerformers: performers.slice(0, 10),
            worstPerformers: performers.slice(-5).reverse(),
            patternsLearned: this.patternMemory.length,
            regimeChanges: this.marketRegimeHistory.length,
            predictionAccuracy: this.getMeanError(),
            priceDistributions: this.priceDistributions,
            sessionLearnings: this.sessionLearnings.length,
            experience: this._getExperienceLevel(totalSignals),
        };
    }

    _getExperienceLevel(totalSignals) {
        if (totalSignals < 10) return { level: "🐣 Novice", desc: "Still learning basics" };
        if (totalSignals < 50) return { level: "📚 Student", desc: "Gathering experience" };
        if (totalSignals < 200) return { level: "🎓 Graduate", desc: "Developing intuition" };
        if (totalSignals < 1000) return { level: "💼 Professional", desc: "Pattern recognition active" };
        if (totalSignals < 5000) return { level: "🏆 Expert", desc: "Deep market understanding" };
        return { level: "🧙 Master", desc: "A lifetime of market wisdom" };
    }

    // ═══════════════════════════════════════════════════════════════
    // PERSISTENCE — Save EVERYTHING unlimited
    // ═══════════════════════════════════════════════════════════════

    async _persistLearning(type, data) {
        if (!this.supabase) return;
        try {
            await this.supabase.from("market_learnings").insert({
                type,
                data,
                created_at: new Date().toISOString(),
            });
        } catch (e) {
            // silent — non-critical
        }
    }

    async saveState() {
        if (!this.supabase) return;
        try {
            // Save current weights
            await this.supabase.from("market_learnings").upsert({
                type: "strategy_weights",
                data: this.strategyWeights,
                created_at: new Date().toISOString(),
            }, { onConflict: "type" });

            // Save accuracy
            await this.supabase.from("market_learnings").upsert({
                type: "signal_accuracy",
                data: this.signalAccuracy,
                created_at: new Date().toISOString(),
            }, { onConflict: "type" });

            logger.info({ component: "Learner" }, "💾 Learning state saved to Supabase");
        } catch (e) {
            logger.warn({ component: "Learner", err: e.message }, "State save failed");
        }
    }
}

// Singleton
const learner = new MarketLearner();

// Auto-save every 5 minutes
setInterval(() => learner.saveState(), 300000);

module.exports = learner;
module.exports.MarketLearner = MarketLearner;
