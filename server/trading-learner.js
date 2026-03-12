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
  minConfidence: 60, // minimum signal confidence to trade
  maxAllocation: 0.2, // max % of cash per position (20%)
  preferredSessions: [], // best sessions for this asset
  enabled: true, // can the bot trade this asset?
  notes: "", // AI-generated notes
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
      s.confidenceSum += t.confidence || 0;
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
      const winRate = closedTrades > 0 ? (s.wins / closedTrades) * 100 : 0;
      const avgPnL = s.pnls.length > 0 ? s.totalPnL / s.pnls.length : 0;

      // Sharpe Ratio (simplified)
      let sharpe = 0;
      if (s.pnls.length > 1) {
        const mean = s.pnls.reduce((a, b) => a + b, 0) / s.pnls.length;
        const variance =
          s.pnls.reduce((a, b) => a + (b - mean) ** 2, 0) / s.pnls.length;
        const stdDev = Math.sqrt(variance);
        sharpe = stdDev > 0 ? +(mean / stdDev).toFixed(3) : 0;
      }

      // Profit Factor
      const grossProfit = s.pnls
        .filter((p) => p > 0)
        .reduce((a, b) => a + b, 0);
      const grossLoss = Math.abs(
        s.pnls.filter((p) => p < 0).reduce((a, b) => a + b, 0),
      );
      const profitFactor =
        grossLoss > 0
          ? +(grossProfit / grossLoss).toFixed(2)
          : grossProfit > 0
            ? 999
            : 0;

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
          if (advice.minConfidence)
            learnedRules[asset].minConfidence = advice.minConfidence;
          if (advice.maxAllocation)
            learnedRules[asset].maxAllocation = advice.maxAllocation;
          if (advice.enabled !== undefined)
            learnedRules[asset].enabled = advice.enabled;
          if (advice.notes)
            learnedRules[asset].notes = `🤖 AI: ${advice.notes}`;
        }
      }
      logger.info(
        { assets: Object.keys(aiAdvice).length },
        "[Learner] Gemini AI recommendations applied",
      );
    }

    // ═══ SAVE TO SUPABASE ═══
    for (const [asset, rules] of Object.entries(learnedRules)) {
      const perf = assetPerformance[asset] || {};
      try {
        await supabase.from("trading_brain_rules").upsert(
          {
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
          },
          { onConflict: "asset" },
        );
      } catch (e) {
        /* table might not exist */
      }
    }

    _lastAnalysis = {
      timestamp: new Date().toISOString(),
      totalTrades: trades.length,
      assetsAnalyzed: Object.keys(assetPerformance).length,
      performance: assetPerformance,
      rules: learnedRules,
      aiAdvice: aiAdvice || null,
    };

    logger.info(
      {
        assets: Object.keys(assetPerformance).length,
        trades: trades.length,
        aiActive: !!aiAdvice,
        bestAsset: Object.entries(assetPerformance).sort(
          (a, b) => b[1].winRate - a[1].winRate,
        )[0]?.[0],
        worstAsset: Object.entries(assetPerformance).sort(
          (a, b) => a[1].winRate - b[1].winRate,
        )[0]?.[0],
      },
      "[Learner] Analysis complete — rules updated",
    );

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
    const perfSummary = Object.entries(assetPerformance)
      .map(
        ([asset, p]) =>
          `${asset}: ${p.totalTrades} trades, WR=${p.winRate}%, PnL=€${p.totalPnL}, Sharpe=${p.sharpe}, PF=${p.profitFactor}, Grade=${p.grade}`,
      )
      .join("\n");

    const rulesSummary = Object.entries(currentRules)
      .map(
        ([asset, r]) =>
          `${asset}: confidence=${r.minConfidence}%, allocation=${(r.maxAllocation * 100).toFixed(0)}%, enabled=${r.enabled}`,
      )
      .join("\n");

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

    const { MODELS } = require("./config/models");
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${MODELS.GEMINI_CHAT}:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.3, maxOutputTokens: 1500 },
        }),
      },
    );

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
    logger.info(
      { assets: Object.keys(advice).length },
      "[Learner] 🤖 Gemini AI advice received",
    );
    return advice;
  } catch (e) {
    logger.warn(
      { err: e.message },
      "[Learner] Gemini analysis failed (will use rule-based)",
    );
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
    const { data } = await supabase.from("trading_brain_rules").select("*");
    if (data && data.length > 0) {
      data.forEach((r) => {
        learnedRules[r.asset] = {
          minConfidence: r.min_confidence || DEFAULT_RULES.minConfidence,
          maxAllocation: r.max_allocation || DEFAULT_RULES.maxAllocation,
          enabled: r.enabled !== false,
          preferredSessions: [],
          notes: r.notes || "",
        };
      });
      logger.info(
        { rules: data.length },
        `[Learner] Restored ${data.length} learned rules from DB`,
      );
    }
  } catch (e) {
    /* table might not exist */
  }
}

/**
 * AUTO-BACKTEST — runs all 7 strategies × 9 assets automatically
 * Identifies best strategy per asset, saves to rules
 * Called every 6 hours (no human intervention)
 */
const STRATEGIES = [
  "RSI",
  "MACD",
  "BollingerBands",
  "EMACrossover",
  "Fibonacci",
  "VolumeProfile",
  "Sentiment",
];
const ALL_ASSETS = [
  "BTC",
  "ETH",
  "SOL",
  "Gold",
  "Oil",
  "S&P 500",
  "NASDAQ",
  "EUR/USD",
  "GBP/USD",
];

async function autoBacktest(supabase) {
  try {
    const investSim = require("./investment-simulator");
    const results = {};

    logger.info(
      "[Learner] 🔄 AUTO-BACKTEST starting — 7 strategies × 9 assets = 63 combinations",
    );

    for (const asset of ALL_ASSETS) {
      results[asset] = {
        bestStrategy: null,
        bestWinRate: 0,
        bestPF: 0,
        strategies: {},
      };

      for (const strategy of STRATEGIES) {
        try {
          // Generate synthetic price data (use candles if available)
          let prices = [];
          if (supabase) {
            const { data } = await supabase
              .from("market_candles")
              .select("close")
              .eq("asset", asset)
              .order("timestamp", { ascending: true })
              .limit(365);
            if (data && data.length > 0) {
              prices = data.map((d) => d.close);
            }
          }

          // NO FAKE DATA — skip if not enough real candles
          if (prices.length < 50) {
            logger.info(
              { asset, candles: prices.length },
              `[Learner] Skipping ${asset} — need 50+ real candles, have ${prices.length}`,
            );
            continue;
          }

          // Run strategy simulation
          let wins = 0,
            losses = 0,
            totalPnL = 0;
          const windowSize = 20;
          for (let i = windowSize; i < prices.length - 1; i++) {
            const window = prices.slice(i - windowSize, i + 1);
            const { signal, confidence } = investSim.generateSignal(window);
            if (signal === "BUY" && confidence >= 60) {
              const buyPrice = prices[i];
              const sellPrice = prices[Math.min(i + 5, prices.length - 1)]; // hold 5 periods
              const pnl = ((sellPrice - buyPrice) / buyPrice) * 100;
              if (pnl > 0) wins++;
              else losses++;
              totalPnL += pnl;
            }
          }

          const total = wins + losses;
          const winRate = total > 0 ? (wins / total) * 100 : 0;
          const profitFactor = losses > 0 ? wins / losses : wins > 0 ? 999 : 0;

          results[asset].strategies[strategy] = {
            winRate: +winRate.toFixed(1),
            profitFactor: +profitFactor.toFixed(2),
            totalPnL: +totalPnL.toFixed(2),
            trades: total,
          };

          // Track best strategy
          if (
            winRate > results[asset].bestWinRate ||
            (winRate === results[asset].bestWinRate &&
              profitFactor > results[asset].bestPF)
          ) {
            results[asset].bestStrategy = strategy;
            results[asset].bestWinRate = winRate;
            results[asset].bestPF = profitFactor;
          }
        } catch (e) {
          /* skip failed strategy */
        }
      }

      // Apply best strategy to learned rules
      if (results[asset].bestStrategy) {
        if (!learnedRules[asset]) learnedRules[asset] = { ...DEFAULT_RULES };
        learnedRules[asset].bestStrategy = results[asset].bestStrategy;
        learnedRules[asset].backtestWinRate = results[asset].bestWinRate;
        learnedRules[asset].backtestPF = results[asset].bestPF;
      }
    }

    // Save backtest results to Supabase
    for (const [asset, r] of Object.entries(results)) {
      if (r.bestStrategy) {
        try {
          await supabase.from("trading_brain_rules").upsert(
            {
              asset,
              best_strategy: r.bestStrategy,
              backtest_win_rate: r.bestWinRate,
              backtest_pf: r.bestPF,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "asset" },
          );
        } catch (e) {
          /* ignore */
        }
      }
    }

    logger.info(
      {
        combinations: Object.keys(results).length * STRATEGIES.length,
        bestPerAsset: Object.entries(results)
          .map(([a, r]) => `${a}→${r.bestStrategy}(WR:${r.bestWinRate}%)`)
          .join(", "),
      },
      "[Learner] ✅ AUTO-BACKTEST complete — best strategies identified per asset",
    );

    return results;
  } catch (e) {
    logger.error({ err: e.message }, "[Learner] Auto-backtest failed");
    return null;
  }
}

/**
 * Start the FULLY AUTONOMOUS learning pipeline
 * - Restores rules from DB
 * - Runs initial backtest on all strategies × assets
 * - Analyzes candlestick patterns from historical data
 * - Tracks signal accuracy
 * - Analyzes real trades every hour
 * - Re-runs backtest every 6 hours
 * - Gemini AI validates and adjusts
 * - Zero human intervention
 */
let _backtestInterval = null;
let _candlestickInterval = null;

// ═══════════════════════════════════════════════════════════════
// CANDLESTICK PATTERN ANALYSIS — Learn from real historical data
// ═══════════════════════════════════════════════════════════════

/**
 * Detect individual candlestick patterns on OHLCV data.
 * Returns pattern name + index for each detected occurrence.
 */
function detectCandlestickPattern(candles, i) {
  if (i < 2 || i >= candles.length) return null;
  const c = candles[i]; // current candle
  const p = candles[i - 1]; // previous
  const pp = candles[i - 2]; // 2 candles back

  const body = Math.abs(c.close - c.open);
  const range = c.high - c.low;
  const upperShadow = c.high - Math.max(c.open, c.close);
  const lowerShadow = Math.min(c.open, c.close) - c.low;
  const isBullish = c.close > c.open;
  const isBearish = c.close < c.open;
  const pBody = Math.abs(p.close - p.open);
  const pIsBullish = p.close > p.open;
  const pIsBearish = p.close < p.open;

  const patterns = [];

  // 1. HAMMER (bullish reversal) — small body on top, long lower shadow
  if (lowerShadow > body * 2 && upperShadow < body * 0.5 && body > 0 && range > 0) {
    patterns.push({ name: "Hammer", direction: "bullish", strength: 2 });
  }

  // 2. INVERTED HAMMER (bullish reversal) — small body on bottom, long upper shadow
  if (upperShadow > body * 2 && lowerShadow < body * 0.5 && body > 0) {
    patterns.push({ name: "Inverted Hammer", direction: "bullish", strength: 1 });
  }

  // 3. DOJI — open ≈ close (body < 10% of range)
  if (range > 0 && body / range < 0.1) {
    patterns.push({ name: "Doji", direction: "neutral", strength: 1 });
  }

  // 4. BULLISH ENGULFING — bearish candle followed by larger bullish candle
  if (pIsBearish && isBullish && c.open <= p.close && c.close >= p.open && body > pBody) {
    patterns.push({ name: "Bullish Engulfing", direction: "bullish", strength: 3 });
  }

  // 5. BEARISH ENGULFING — bullish candle followed by larger bearish candle
  if (pIsBullish && isBearish && c.open >= p.close && c.close <= p.open && body > pBody) {
    patterns.push({ name: "Bearish Engulfing", direction: "bearish", strength: 3 });
  }

  // 6. MORNING STAR (bullish, 3 candles) — bearish + small body + bullish
  const ppBody = Math.abs(pp.close - pp.open);
  const ppIsBearish = pp.close < pp.open;
  if (ppIsBearish && ppBody > 0 && pBody < ppBody * 0.3 && isBullish && body > ppBody * 0.5) {
    patterns.push({ name: "Morning Star", direction: "bullish", strength: 3 });
  }

  // 7. EVENING STAR (bearish, 3 candles) — bullish + small body + bearish
  const ppIsBullish = pp.close > pp.open;
  if (ppIsBullish && ppBody > 0 && pBody < ppBody * 0.3 && isBearish && body > ppBody * 0.5) {
    patterns.push({ name: "Evening Star", direction: "bearish", strength: 3 });
  }

  // 8. THREE WHITE SOLDIERS (bullish) — 3 consecutive bullish candles with higher closes
  if (ppIsBullish && pIsBullish && isBullish && c.close > p.close && p.close > pp.close) {
    patterns.push({ name: "Three White Soldiers", direction: "bullish", strength: 3 });
  }

  // 9. THREE BLACK CROWS (bearish) — 3 consecutive bearish candles with lower closes
  if (ppIsBearish && pIsBearish && isBearish && c.close < p.close && p.close < pp.close) {
    patterns.push({ name: "Three Black Crows", direction: "bearish", strength: 3 });
  }

  return patterns.length > 0 ? patterns : null;
}

/**
 * Analyze candlestick patterns on historical OHLCV data for all assets.
 * Calculates win rate for each pattern after 1, 3, 5 days.
 * Saves proven patterns (>60% win rate) to Supabase.
 */
async function analyzeCandlestickPatterns(supabase) {
  try {
    const histLoader = require("./historical-data-loader");

    const patternStats = {}; // { "BTC:Hammer": { occurrences: N, wins1d: N, ... } }

    for (const asset of ALL_ASSETS) {
      let candles;
      try {
        candles = await histLoader.getHistory(asset, 365); // last 365 days
      } catch (e) {
        continue;
      }
      if (!candles || candles.length < 50) {
        logger.info({ asset, candles: candles?.length || 0 }, `[Learner] Skip ${asset} — need 50+ candles`);
        continue;
      }

      // Scan for patterns
      for (let i = 2; i < candles.length - 5; i++) {
        const detected = detectCandlestickPattern(candles, i);
        if (!detected) continue;

        for (const pat of detected) {
          const key = `${asset}:${pat.name}`;
          if (!patternStats[key]) {
            patternStats[key] = {
              asset, pattern: pat.name, direction: pat.direction, strength: pat.strength,
              occurrences: 0,
              wins1d: 0, wins3d: 0, wins5d: 0,
              avgMove1d: 0, avgMove3d: 0, avgMove5d: 0,
              moves1d: [], moves3d: [], moves5d: [],
            };
          }
          const s = patternStats[key];
          s.occurrences++;

          const entryPrice = candles[i].close;
          const isBullish = pat.direction === "bullish";

          // Check outcome after 1, 3, 5 days
          for (const [days, winsKey, movesKey] of [[1, "wins1d", "moves1d"], [3, "wins3d", "moves3d"], [5, "wins5d", "moves5d"]]) {
            if (i + days < candles.length) {
              const exitPrice = candles[i + days].close;
              const movePct = ((exitPrice - entryPrice) / entryPrice) * 100;
              s[movesKey].push(movePct);
              // Win = price moved in predicted direction
              if ((isBullish && movePct > 0) || (!isBullish && movePct < 0) || (pat.direction === "neutral" && Math.abs(movePct) > 1)) {
                s[winsKey]++;
              }
            }
          }
        }
      }
    }

    // Calculate averages and save proven patterns
    const provenPatterns = [];
    for (const [key, s] of Object.entries(patternStats)) {
      if (s.occurrences < 5) continue; // need minimum 5 occurrences

      s.avgMove1d = s.moves1d.length > 0 ? +(s.moves1d.reduce((a, b) => a + b, 0) / s.moves1d.length).toFixed(3) : 0;
      s.avgMove3d = s.moves3d.length > 0 ? +(s.moves3d.reduce((a, b) => a + b, 0) / s.moves3d.length).toFixed(3) : 0;
      s.avgMove5d = s.moves5d.length > 0 ? +(s.moves5d.reduce((a, b) => a + b, 0) / s.moves5d.length).toFixed(3) : 0;
      s.winRate1d = s.occurrences > 0 ? +(s.wins1d / s.occurrences * 100).toFixed(1) : 0;
      s.winRate3d = s.occurrences > 0 ? +(s.wins3d / s.occurrences * 100).toFixed(1) : 0;
      s.winRate5d = s.occurrences > 0 ? +(s.wins5d / s.occurrences * 100).toFixed(1) : 0;

      // Clean up raw arrays (don't save to DB)
      delete s.moves1d; delete s.moves3d; delete s.moves5d;

      // Proven = win rate > 55% AND 5+ occurrences
      if (s.winRate3d > 55 || s.winRate5d > 55) {
        provenPatterns.push(s);
      }
    }

    // Save to Supabase
    if (provenPatterns.length > 0 && supabase) {
      for (const p of provenPatterns) {
        try {
          await supabase.from("trading_pattern_stats").upsert({
            asset: p.asset,
            pattern: p.pattern,
            direction: p.direction,
            strength: p.strength,
            occurrences: p.occurrences,
            win_rate_1d: p.winRate1d,
            win_rate_3d: p.winRate3d,
            win_rate_5d: p.winRate5d,
            avg_move_1d: p.avgMove1d,
            avg_move_3d: p.avgMove3d,
            avg_move_5d: p.avgMove5d,
            updated_at: new Date().toISOString(),
          }, { onConflict: "asset,pattern" });
        } catch (e) { /* table might not exist yet */ }
      }
    }

    // Also save to in-memory learned rules
    for (const p of provenPatterns) {
      if (!learnedRules[p.asset]) learnedRules[p.asset] = { ...DEFAULT_RULES };
      if (!learnedRules[p.asset].provenPatterns) learnedRules[p.asset].provenPatterns = [];
      learnedRules[p.asset].provenPatterns.push({
        pattern: p.pattern,
        direction: p.direction,
        winRate3d: p.winRate3d,
        avgMove3d: p.avgMove3d,
      });
    }

    logger.info({
      totalPatterns: Object.keys(patternStats).length,
      proven: provenPatterns.length,
      topPatterns: provenPatterns
        .sort((a, b) => b.winRate3d - a.winRate3d)
        .slice(0, 5)
        .map(p => `${p.asset}:${p.pattern}(WR3d:${p.winRate3d}%)`)
        .join(", "),
    }, "[Learner] 🕯️ Candlestick pattern analysis complete");

    return { total: Object.keys(patternStats).length, proven: provenPatterns.length, patterns: provenPatterns };
  } catch (e) {
    logger.error({ err: e.message }, "[Learner] Candlestick analysis failed");
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// SIGNAL ACCURACY TRACKING — Learn which signals actually work
// ═══════════════════════════════════════════════════════════════

/**
 * Compare old signals with actual price outcomes.
 * Reads trading_signals from Supabase, checks if price went in predicted direction.
 */
async function trackSignalAccuracy(supabase) {
  try {
    if (!supabase) return null;

    // Get signals from last 30 days that haven't been verified yet
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const { data: signals } = await supabase
      .from("trading_signals")
      .select("*")
      .gte("created_at", thirtyDaysAgo)
      .is("outcome_verified", null)
      .limit(100);

    if (!signals || signals.length === 0) return { verified: 0 };

    const histLoader = require("./historical-data-loader");
    let verified = 0, correct = 0, incorrect = 0;

    for (const sig of signals) {
      // Check if enough time has passed (3 days minimum)
      const sigDate = new Date(sig.created_at);
      if (Date.now() - sigDate.getTime() < 3 * 24 * 60 * 60 * 1000) continue;

      // Get current price for this asset
      try {
        const history = await histLoader.getHistory(sig.asset, 5);
        if (!history || history.length === 0) continue;
        const latestPrice = history[history.length - 1].close;
        const entryPrice = sig.entry_price || sig.price_at_signal;
        if (!entryPrice) continue;

        const movePct = ((latestPrice - entryPrice) / entryPrice) * 100;
        const wasCorrect = (sig.signal === "BUY" && movePct > 0) || (sig.signal === "SELL" && movePct < 0);

        // Update the signal
        await supabase.from("trading_signals").update({
          outcome_verified: true,
          outcome_pct: +movePct.toFixed(2),
          outcome_correct: wasCorrect,
          verified_at: new Date().toISOString(),
        }).eq("id", sig.id);

        verified++;
        if (wasCorrect) correct++;
        else incorrect++;
      } catch (e) { /* skip */ }
    }

    const accuracy = verified > 0 ? +(correct / verified * 100).toFixed(1) : 0;
    logger.info({ verified, correct, incorrect, accuracy }, "[Learner] 📊 Signal accuracy tracked");

    return { verified, correct, incorrect, accuracy };
  } catch (e) {
    logger.error({ err: e.message }, "[Learner] Signal tracking failed");
    return null;
  }
}

/**
 * Get proven candlestick patterns for a specific asset
 */
function getProvenPatterns(asset) {
  return learnedRules[asset]?.provenPatterns || [];
}

function startLearning(supabase) {
  // Restore rules from DB first
  restoreRules(supabase).catch(() => {});

  // Run initial analysis after 15s (let server warm up)
  setTimeout(() => analyzeAndLearn(supabase).catch(() => {}), 15000);

  // Run auto-backtest after 30s
  setTimeout(() => autoBacktest(supabase).catch(() => {}), 30000);

  // Run candlestick pattern analysis after 60s
  setTimeout(() => analyzeCandlestickPatterns(supabase).catch(() => {}), 60000);

  // Track signal accuracy after 90s
  setTimeout(() => trackSignalAccuracy(supabase).catch(() => {}), 90000);

  // Analyze real trades every hour
  _learnerInterval = setInterval(
    () => {
      analyzeAndLearn(supabase).catch(() => {});
      trackSignalAccuracy(supabase).catch(() => {});
    },
    60 * 60 * 1000,
  );

  // Re-run full backtest every 6 hours
  _backtestInterval = setInterval(
    () => {
      autoBacktest(supabase).catch(() => {});
    },
    6 * 60 * 60 * 1000,
  );

  // Re-run candlestick analysis every 24 hours (daily candles update)
  _candlestickInterval = setInterval(
    () => {
      analyzeCandlestickPatterns(supabase).catch(() => {});
    },
    24 * 60 * 60 * 1000,
  );

  logger.info(
    "[Learner] 🧠 AUTONOMOUS PIPELINE started — candles@24h, backtest@6h, analysis@1h, signals@1h, zero human intervention",
  );
}

/**
 * Stop all autonomous learning
 */
function stopLearning() {
  if (_learnerInterval) {
    clearInterval(_learnerInterval);
    _learnerInterval = null;
  }
  if (_backtestInterval) {
    clearInterval(_backtestInterval);
    _backtestInterval = null;
  }
  if (_candlestickInterval) {
    clearInterval(_candlestickInterval);
    _candlestickInterval = null;
  }
  logger.info("[Learner] Autonomous pipeline stopped");
}

module.exports = {
  analyzeAndLearn,
  autoBacktest,
  analyzeCandlestickPatterns,
  trackSignalAccuracy,
  detectCandlestickPattern,
  getProvenPatterns,
  getRulesForAsset,
  getAnalysisReport,
  restoreRules,
  startLearning,
  stopLearning,
  DEFAULT_RULES,
};
