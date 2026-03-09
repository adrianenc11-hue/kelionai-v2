"use strict";

// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — TRADING BOT (Admin Only)
// Technical analysis, signals, backtesting, risk assessment
// ═══════════════════════════════════════════════════════════════

const express = require("express");
const rateLimit = require("express-rate-limit");
const logger = require("./logger");
const tradeEngine = require("./trade-executor");
const wsEngine = require("./ws-engine");
const marketLearner = require("./market-learner");
const aiScorer = require("./ai-scoring");
const perfTracker = require("./performance-tracker");
const tradePersist = require("./trade-persistence");

const router = express.Router();

const DISCLAIMER =
  "INFORMATIV — Nu constituie sfat financiar. KelionAI nu garantează câștiguri.";
const MAX_SEARCH_CONTEXT_LENGTH = 500;

const ASSETS = {
  crypto: ["BTC", "ETH", "SOL"],
  forex: ["EUR/USD", "GBP/USD"],
  indices: ["S&P 500", "NASDAQ"],
  commodities: ["Gold", "Oil"],
};

const STRATEGIES = [
  "RSI",
  "MACD",
  "BollingerBands",
  "EMACrossover",
  "Fibonacci",
  "VolumeProfile",
  "Sentiment",
];

// ═══ CACHE ═══
let analysisCache = null;
let cacheTsMs = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

// Init Supabase tables for trading persistence
tradePersist.ensureTables().catch(() => { });

// ═══ HISTORY ═══
const analysisHistory = [];
const MAX_HISTORY = 100;

// ═══ RATE LIMITER ═══
const tradingLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: "Prea multe cereri trading. Așteaptă un minut." },
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(tradingLimiter);

// ═══════════════════════════════════════════════════════════════
// PURE CALCULATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Calculate EMA for a price series.
 * @param {number[]} prices
 * @param {number} period
 * @returns {number[]}
 */
function calculateEMA(prices, period) {
  if (!prices || prices.length < period) return [];
  const k = 2 / (period + 1);
  const ema = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    ema.push(prices[i] * k + ema[i - 1] * (1 - k));
  }
  return ema;
}

/**
 * Calculate RSI.
 * @param {number[]} prices
 * @param {number} [period=14]
 * @returns {{ value: number, signal: 'BUY'|'SELL'|'HOLD' }}
 */
function calculateRSI(prices, period = 14) {
  if (!prices || prices.length < period + 1) {
    return { value: 50, signal: "HOLD" };
  }
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = prices[i] - prices[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;

  for (let i = period + 1; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return { value: 100, signal: "SELL" };
  const rs = avgGain / avgLoss;
  const value = 100 - 100 / (1 + rs);

  let signal = "HOLD";
  if (value < 30) signal = "BUY";
  else if (value > 70) signal = "SELL";

  return { value: Math.round(value * 100) / 100, signal };
}

/**
 * Calculate MACD.
 * @param {number[]} prices
 * @param {number} [fast=12]
 * @param {number} [slow=26]
 * @param {number} [signal=9]
 * @returns {{ macd: number, signal: number, histogram: number, crossSignal: 'BUY'|'SELL'|'HOLD' }}
 */
function calculateMACD(prices, fast = 12, slow = 26, signal = 9) {
  if (!prices || prices.length < slow + signal) {
    return { macd: 0, signal: 0, histogram: 0, crossSignal: "HOLD" };
  }
  const fastEMA = calculateEMA(prices, fast);
  const slowEMA = calculateEMA(prices, slow);
  const macdLine = fastEMA.map((v, i) => v - slowEMA[i]);
  const signalLine = calculateEMA(macdLine.slice(slow - 1), signal);
  const lastIdx = macdLine.length - 1;
  const lastSignalIdx = signalLine.length - 1;
  const macdVal = macdLine[lastIdx];
  const signalVal = signalLine[lastSignalIdx];
  const histogram = macdVal - signalVal;

  const prevMacd = macdLine[lastIdx - 1] || macdVal;
  const prevSignal = signalLine[lastSignalIdx - 1] || signalVal;
  let crossSignal = "HOLD";
  if (prevMacd <= prevSignal && macdVal > signalVal) crossSignal = "BUY";
  else if (prevMacd >= prevSignal && macdVal < signalVal) crossSignal = "SELL";

  return {
    macd: Math.round(macdVal * 10000) / 10000,
    signal: Math.round(signalVal * 10000) / 10000,
    histogram: Math.round(histogram * 10000) / 10000,
    crossSignal,
  };
}

/**
 * Calculate Bollinger Bands.
 * @param {number[]} prices
 * @param {number} [period=20]
 * @param {number} [stdMult=2]
 * @returns {{ middle: number, upper: number, lower: number, signal: 'BUY'|'SELL'|'HOLD' }}
 */
function calculateBollingerBands(prices, period = 20, stdMult = 2) {
  if (!prices || prices.length < period) {
    const last = prices ? prices[prices.length - 1] || 0 : 0;
    return { middle: last, upper: last, lower: last, signal: "HOLD" };
  }
  const slice = prices.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance =
    slice.reduce((a, b) => a + Math.pow(b - middle, 2), 0) / period;
  const std = Math.sqrt(variance);
  const upper = middle + stdMult * std;
  const lower = middle - stdMult * std;
  const last = prices[prices.length - 1];

  let signal = "HOLD";
  if (last < lower) signal = "BUY";
  else if (last > upper) signal = "SELL";

  return {
    middle: Math.round(middle * 100) / 100,
    upper: Math.round(upper * 100) / 100,
    lower: Math.round(lower * 100) / 100,
    signal,
  };
}

/**
 * EMA crossover strategy.
 * @param {number[]} prices
 * @param {number} [fast=50]
 * @param {number} [slow=200]
 * @returns {{ signal: 'BUY'|'SELL'|'HOLD', fastEMA: number, slowEMA: number }}
 */
function calculateEMACrossover(prices, fast = 50, slow = 200) {
  if (!prices || prices.length < slow) {
    const last = prices ? prices[prices.length - 1] || 0 : 0;
    return { signal: "HOLD", fastEMA: last, slowEMA: last };
  }
  const fastArr = calculateEMA(prices, fast);
  const slowArr = calculateEMA(prices, slow);
  const fastVal = fastArr[fastArr.length - 1];
  const slowVal = slowArr[slowArr.length - 1];
  const prevFast = fastArr[fastArr.length - 2] || fastVal;
  const prevSlow = slowArr[slowArr.length - 2] || slowVal;

  let signal = "HOLD";
  if (prevFast <= prevSlow && fastVal > slowVal) signal = "BUY";
  else if (prevFast >= prevSlow && fastVal < slowVal) signal = "SELL";
  else if (fastVal > slowVal) signal = "BUY";
  else if (fastVal < slowVal) signal = "SELL";

  return {
    signal,
    fastEMA: Math.round(fastVal * 100) / 100,
    slowEMA: Math.round(slowVal * 100) / 100,
  };
}

/**
 * Fibonacci retracement levels.
 * @param {number} high
 * @param {number} low
 * @returns {{ levels: Object, signal: 'BUY'|'SELL'|'HOLD' }}
 */
function calculateFibonacci(high, low) {
  const diff = high - low;
  const levels = {
    0: Math.round(high * 100) / 100,
    23.6: Math.round((high - 0.236 * diff) * 100) / 100,
    38.2: Math.round((high - 0.382 * diff) * 100) / 100,
    50: Math.round((high - 0.5 * diff) * 100) / 100,
    61.8: Math.round((high - 0.618 * diff) * 100) / 100,
    78.6: Math.round((high - 0.786 * diff) * 100) / 100,
    100: Math.round(low * 100) / 100,
  };
  return { levels, signal: "HOLD" };
}

/**
 * Volume profile / VWAP analysis.
 * @param {number[]} prices
 * @param {number[]} volumes
 * @returns {{ vwap: number, phase: 'accumulation'|'distribution'|'neutral', signal: 'BUY'|'SELL'|'HOLD' }}
 */
function analyzeVolume(prices, volumes) {
  if (!prices || !volumes || prices.length === 0 || volumes.length === 0) {
    return { vwap: 0, phase: "neutral", signal: "HOLD" };
  }
  const len = Math.min(prices.length, volumes.length);
  let totalPV = 0;
  let totalV = 0;
  for (let i = 0; i < len; i++) {
    totalPV += prices[i] * volumes[i];
    totalV += volumes[i];
  }
  const vwap = totalV > 0 ? totalPV / totalV : prices[len - 1];
  const last = prices[len - 1];
  const recentVol = volumes.slice(-5).reduce((a, b) => a + b, 0) / 5;
  const avgVol = totalV / len;

  let phase = "neutral";
  let signal = "HOLD";
  if (last > vwap && recentVol > avgVol * 1.2) {
    phase = "accumulation";
    signal = "BUY";
  } else if (last < vwap && recentVol > avgVol * 1.2) {
    phase = "distribution";
    signal = "SELL";
  }

  return { vwap: Math.round(vwap * 100) / 100, phase, signal };
}

/**
 * Sentiment analysis from news text.
 * @param {string} text
 * @returns {{ score: number, label: 'bullish'|'bearish'|'neutral' }}
 */
function analyzeSentiment(text) {
  if (!text || typeof text !== "string") return { score: 0, label: "neutral" };

  const bullishWords = [
    "bullish",
    "surge",
    "rally",
    "gain",
    "rise",
    "pump",
    "moon",
    "ath",
    "breakout",
    "buy",
    "long",
    "positive",
    "growth",
    "boom",
    "record",
    "profit",
    "uptrend",
    "higher",
  ];
  const bearishWords = [
    "bearish",
    "crash",
    "drop",
    "fall",
    "dump",
    "bear",
    "decline",
    "loss",
    "sell",
    "short",
    "negative",
    "fear",
    "panic",
    "correction",
    "downtrend",
    "lower",
    "risk",
    "warning",
  ];

  const words = text.toLowerCase().split(/\s+/);
  let score = 0;
  bullishWords.forEach((w) => {
    if (words.includes(w)) score += 12;
  });
  bearishWords.forEach((w) => {
    if (words.includes(w)) score -= 12;
  });
  score = Math.max(-100, Math.min(100, score));

  let label = "neutral";
  if (score > 15) label = "bullish";
  else if (score < -15) label = "bearish";

  return { score, label };
}

/**
 * Multi-strategy confluence scoring.
 * Weights: RSI 15%, MACD 20%, Bollinger 15%, EMA 20%, Fibonacci 10%, Volume 10%, Sentiment 10%
 * @param {{ rsi?: Object, macd?: Object, bollinger?: Object, ema?: Object, fibonacci?: Object, volume?: Object, sentiment?: Object }} signals
 * @returns {{ signal: 'STRONG BUY'|'BUY'|'HOLD'|'SELL'|'STRONG SELL', confidence: number }}
 */
function calculateConfluence(signals) {
  // Use adaptive weights from MarketLearner (Bayesian-updated) or defaults
  const learned = marketLearner.getWeights();
  const weights = {
    rsi: learned.RSI || 15,
    macd: learned.MACD || 20,
    bollinger: learned.BollingerBands || 15,
    ema: learned.EMACrossover || 20,
    fibonacci: learned.Fibonacci || 10,
    volume: learned.VolumeProfile || 10,
    sentiment: learned.Sentiment || 10,
  };
  const scoreMap = { BUY: 1, HOLD: 0, SELL: -1 };

  let weightedScore = 0;
  let totalWeight = 0;

  const map = {
    rsi: signals.rsi?.signal,
    macd: signals.macd?.crossSignal,
    bollinger: signals.bollinger?.signal,
    ema: signals.ema?.signal,
    fibonacci: signals.fibonacci?.signal,
    volume: signals.volume?.signal,
    sentiment:
      signals.sentiment?.label === "bullish"
        ? "BUY"
        : signals.sentiment?.label === "bearish"
          ? "SELL"
          : "HOLD",
  };

  for (const [key, sig] of Object.entries(map)) {
    if (sig && scoreMap[sig] !== undefined) {
      weightedScore += scoreMap[sig] * weights[key];
      totalWeight += weights[key];
    }
  }

  if (totalWeight === 0) return { signal: "HOLD", confidence: 0, weightsUsed: weights };

  const normalized = weightedScore / totalWeight; // -1 to 1
  const confidence = Math.round(Math.abs(normalized) * 100);

  let signal = "HOLD";
  if (normalized >= 0.6) signal = "STRONG BUY";
  else if (normalized >= 0.2) signal = "BUY";
  else if (normalized <= -0.6) signal = "STRONG SELL";
  else if (normalized <= -0.2) signal = "SELL";

  return { signal, confidence, weightsUsed: weights };
}

// ═══════════════════════════════════════════════════════════════
// SMART MONEY FLOW DETECTION (Wyckoff, Volume Divergence, Order Blocks)
// ═══════════════════════════════════════════════════════════════

function detectSmartMoney(prices, volumes) {
  if (!prices || prices.length < 30 || !volumes || volumes.length < 30) {
    return { phase: "unknown", signal: "HOLD", divergence: null, orderBlocks: [] };
  }

  const len = Math.min(prices.length, volumes.length);
  const p = prices.slice(-len);
  const v = volumes.slice(-len);
  const last = p[p.length - 1];

  // ── Volume Divergence ──
  const priceTrend = (p[p.length - 1] - p[Math.max(0, p.length - 20)]) / p[Math.max(0, p.length - 20)];
  const volAvgRecent = v.slice(-10).reduce((s, x) => s + x, 0) / 10;
  const volAvgPast = v.slice(-30, -10).reduce((s, x) => s + x, 0) / 20;
  const volTrend = volAvgPast > 0 ? (volAvgRecent - volAvgPast) / volAvgPast : 0;

  let divergence = null;
  if (priceTrend > 0.02 && volTrend < -0.15) divergence = "bearish_divergence";
  else if (priceTrend < -0.02 && volTrend > 0.15) divergence = "bullish_divergence";

  // ── Order Block Detection (high volume zones) ──
  const avgVol = v.reduce((s, x) => s + x, 0) / v.length;
  const orderBlocks = [];
  for (let i = 5; i < p.length - 1; i++) {
    if (v[i] > avgVol * 2.0) {
      const wickRatio = Math.abs(p[i] - p[i - 1]) / (Math.abs(p[i] - p[Math.max(0, i - 5)]) || 1);
      if (wickRatio > 0.3) {
        orderBlocks.push({ price: p[i], volume: v[i], type: p[i] > p[i - 1] ? "demand" : "supply", index: i });
      }
    }
  }
  // Keep last 5 blocks
  const recentBlocks = orderBlocks.slice(-5);

  // ── Wyckoff Phase Detection ──
  const priceRange = Math.max(...p.slice(-50)) - Math.min(...p.slice(-50));
  const recentRange = Math.max(...p.slice(-10)) - Math.min(...p.slice(-10));
  const rangeRatio = priceRange > 0 ? recentRange / priceRange : 0;
  const priceChange20 = p.length >= 20 ? (p[p.length - 1] - p[p.length - 20]) / p[p.length - 20] : 0;

  let phase = "neutral";
  if (rangeRatio < 0.3 && volTrend < 0) phase = "accumulation";
  else if (priceChange20 > 0.05 && volTrend > 0) phase = "markup";
  else if (rangeRatio < 0.3 && volTrend > 0 && priceChange20 > 0) phase = "distribution";
  else if (priceChange20 < -0.05 && volTrend > 0) phase = "markdown";

  // ── Absorption Detection ──
  let absorption = false;
  if (p.length >= 3) {
    const lastCandle = Math.abs(p[p.length - 1] - p[p.length - 2]);
    const lastWick = Math.abs(p[p.length - 1] - p[p.length - 3]) - lastCandle;
    if (lastWick > lastCandle * 1.5 && v[v.length - 1] > avgVol * 1.5) absorption = true;
  }

  // ── Signal from Smart Money ──
  let signal = "HOLD";
  if (phase === "accumulation" || divergence === "bullish_divergence") signal = "BUY";
  else if (phase === "distribution" || divergence === "bearish_divergence") signal = "SELL";
  else if (phase === "markup") signal = "BUY";
  else if (phase === "markdown") signal = "SELL";

  return {
    phase,
    signal,
    divergence,
    absorption,
    volumeTrend: +(volTrend * 100).toFixed(1) + "%",
    orderBlocks: recentBlocks.map(b => ({ price: +b.price.toFixed(2), type: b.type, volume: Math.round(b.volume) })),
    priceTrend: +(priceTrend * 100).toFixed(2) + "%",
  };
}

// ═══════════════════════════════════════════════════════════════
// KELLY CRITERION POSITION SIZING
// ═══════════════════════════════════════════════════════════════

function kellyPosition(winRate, avgWin, avgLoss, balance, maxRiskPct = 0.05) {
  if (!winRate || !avgWin || !avgLoss || avgLoss === 0 || balance <= 0) {
    return { kellyPct: 0, halfKelly: 0, positionSize: 0, reason: "insufficient_data" };
  }
  const W = winRate;
  const R = Math.abs(avgWin / avgLoss);
  const kellyPct = W - ((1 - W) / R);
  const halfKelly = Math.max(0, kellyPct / 2);
  const cappedKelly = Math.min(halfKelly, maxRiskPct); // never more than 5% per trade
  const positionSize = +(cappedKelly * balance).toFixed(2);

  return {
    kellyPct: +(kellyPct * 100).toFixed(2),
    halfKellyPct: +(halfKelly * 100).toFixed(2),
    cappedPct: +(cappedKelly * 100).toFixed(2),
    positionSize,
    balance,
    reason: kellyPct <= 0 ? "negative_edge" : "ok",
  };
}

// ═══════════════════════════════════════════════════════════════
// MULTI-TIMEFRAME ANALYSIS
// ═══════════════════════════════════════════════════════════════

async function analyzeMultiTimeframe(asset) {
  const timeframes = ["1m", "5m", "15m", "1h", "4h", "1d"];
  const results = {};
  const scoreMap = { BUY: 1, "STRONG BUY": 2, HOLD: 0, SELL: -1, "STRONG SELL": -2 };
  let totalScore = 0;
  let tfCount = 0;

  for (const tf of timeframes) {
    try {
      // Try ws-engine first (real-time)
      let candles = wsEngine.getCandles(asset, tf, 100);
      let prices = [], volumes = [];

      if (candles && candles.length >= 20) {
        prices = candles.map(c => c.close);
        volumes = candles.map(c => c.volume || 0);
      } else {
        // Fallback: use fetchRealPrices for this asset
        const data = await fetchRealPrices(asset, 100);
        prices = data.prices;
        volumes = data.volumes;
      }

      if (prices.length < 14) continue;

      const rsi = calculateRSI(prices);
      const macd = calculateMACD(prices);
      const bollinger = calculateBollingerBands(prices);
      const confluence = calculateConfluence({ rsi, macd, bollinger });

      results[tf] = {
        rsi: rsi.value,
        rsiSignal: rsi.signal,
        macdSignal: macd.crossSignal,
        bollingerSignal: bollinger.signal,
        confluence: confluence.signal,
        confidence: confluence.confidence,
        price: prices[prices.length - 1],
      };

      totalScore += scoreMap[confluence.signal] || 0;
      tfCount++;
    } catch (e) {
      results[tf] = { error: e.message };
    }
  }

  // Cross-TF alignment
  const avgScore = tfCount > 0 ? totalScore / tfCount : 0;
  let overallSignal = "HOLD";
  if (avgScore >= 1.5) overallSignal = "STRONG BUY";
  else if (avgScore >= 0.5) overallSignal = "BUY";
  else if (avgScore <= -1.5) overallSignal = "STRONG SELL";
  else if (avgScore <= -0.5) overallSignal = "SELL";

  const alignment = tfCount > 0 ? Math.round((Math.abs(avgScore) / 2) * 100) : 0;

  return {
    asset,
    timeframes: results,
    overallSignal,
    alignment: Math.min(alignment, 100),
    tfAnalyzed: tfCount,
    avgScore: +avgScore.toFixed(2),
  };
}

// ═══════════════════════════════════════════════════════════════
// ADVANCED ENTRY/EXIT (DCA, Trailing Stop, Partial TP)
// ═══════════════════════════════════════════════════════════════

function calculateAdvancedEntry(entryPrice, signal, riskProfile) {
  const profile = tradeEngine.getRiskProfile();
  const p = profile.profiles?.[riskProfile] || profile.profiles?.moderate || { DEFAULT_STOP_LOSS_PCT: 0.03, DEFAULT_TAKE_PROFIT_PCT: 0.06 };
  const slPct = p.DEFAULT_STOP_LOSS_PCT;
  const tpPct = p.DEFAULT_TAKE_PROFIT_PCT;
  const isBuy = signal.includes("BUY");
  const dir = isBuy ? 1 : -1;

  return {
    strategy: "DCA_TRAILING_PARTIAL_TP",
    dca: {
      level1: { price: +(entryPrice * (1 - dir * 0.01)).toFixed(4), size: "40%" },
      level2: { price: +(entryPrice * (1 - dir * 0.02)).toFixed(4), size: "35%" },
      level3: { price: +(entryPrice * (1 - dir * 0.03)).toFixed(4), size: "25%" },
    },
    stopLoss: {
      initial: +(entryPrice * (1 - dir * slPct)).toFixed(4),
      breakEven: { trigger: +(entryPrice * (1 + dir * 0.02)).toFixed(4), moveTo: entryPrice },
      trailing: { distance: "1.5%", activateAfter: "+2%" },
    },
    takeProfit: {
      tp1: { price: +(entryPrice * (1 + dir * tpPct * 0.5)).toFixed(4), size: "50%" },
      tp2: { price: +(entryPrice * (1 + dir * tpPct * 0.8)).toFixed(4), size: "30%" },
      tp3: { price: +(entryPrice * (1 + dir * tpPct * 1.2)).toFixed(4), size: "20%" },
    },
    riskReward: +(tpPct / slPct).toFixed(2),
  };
}

// ═══════════════════════════════════════════════════════════════
// REAL PRICE DATA — CoinGecko, exchangerate-api, fallback
// ═══════════════════════════════════════════════════════════════

// Map asset names to CoinGecko IDs
const COINGECKO_IDS = {
  BTC: "bitcoin",
  ETH: "ethereum",
  SOL: "solana",
};

// Per-asset price cache (5 min TTL)
const priceCache = {};
const PRICE_CACHE_TTL = 5 * 60 * 1000;

/**
 * Fetch REAL historical prices from CoinGecko (crypto) or exchangerate-api (forex).
 * Falls back to last known data or minimal simulation ONLY if all APIs fail.
 */
async function fetchRealPrices(asset, length = 300) {
  const cacheKey = `${asset}_${length}`;
  const cached = priceCache[cacheKey];
  if (cached && Date.now() - cached.ts < PRICE_CACHE_TTL) {
    return {
      prices: cached.prices,
      volumes: cached.volumes,
      source: cached.source,
    };
  }

  // ── PRIORITY 1: WS-ENGINE (real-time, lowest latency) ──
  try {
    const candles = wsEngine.getCandles(asset, "1m", length);
    if (candles && candles.length >= Math.min(length * 0.5, 20)) {
      const wsPrices = candles.map(c => c.close);
      const wsVolumes = candles.map(c => c.volume || 0);
      priceCache[cacheKey] = { prices: wsPrices, volumes: wsVolumes, source: "ws-engine-realtime", ts: Date.now() };
      logger.info({ component: "Trading", asset, source: "ws-engine", points: wsPrices.length }, `⚡ ${asset}: ${wsPrices.length} real-time points from WS-Engine`);
      return { prices: wsPrices, volumes: wsVolumes, source: "ws-engine-realtime" };
    }
  } catch (e) {
    logger.debug({ component: "Trading", asset, err: e.message }, "WS-Engine not available, falling back");
  }

  let prices = [];
  let volumes = [];
  let source = "fallback";

  // ── CRYPTO (CoinGecko — free, 30 req/min) ──
  const cgId = COINGECKO_IDS[asset];
  if (cgId) {
    try {
      const days = Math.min(Math.ceil(length / 24), 365); // CoinGecko gives hourly data for <=90 days
      const url = `https://api.coingecko.com/api/v3/coins/${cgId}/market_chart?vs_currency=usd&days=${days}`;
      const r = await fetch(url);
      if (r.ok) {
        const d = await r.json();
        if (d.prices && d.prices.length > 0) {
          prices = d.prices.map((p) => p[1]); // [timestamp, price]
          volumes = d.total_volumes
            ? d.total_volumes.map((v) => v[1])
            : prices.map(() => 0);
          // Trim or pad to requested length
          if (prices.length > length) {
            prices = prices.slice(-length);
            volumes = volumes.slice(-length);
          }
          source = "CoinGecko";
          logger.info(
            { component: "Trading", asset, source, points: prices.length },
            `📈 ${asset}: ${prices.length} real data points from CoinGecko`,
          );
        }
      } else {
        logger.warn(
          { component: "Trading", asset, status: r.status },
          `CoinGecko ${r.status} for ${asset}`,
        );
      }
    } catch (e) {
      logger.warn(
        { component: "Trading", asset, err: e.message },
        `CoinGecko error for ${asset}`,
      );
    }
  }

  // ── FOREX (free exchangerate-api — REAL DATA ONLY, no simulation) ──
  if (prices.length === 0 && (asset === "EUR/USD" || asset === "GBP/USD")) {
    try {
      const [base, quote] = asset.split("/");
      const url = `https://open.er-api.com/v6/latest/${base}`;
      const r = await fetch(url);
      if (r.ok) {
        const d = await r.json();
        const rate = d.rates?.[quote];
        if (rate) {
          // Only real rate — no simulated history
          prices.push(rate);
          volumes.push(0);
          source = "ExchangeRate-API (current only)";
          logger.info(
            { component: "Trading", asset, rate, source },
            `💱 ${asset}: current rate ${rate} from ExchangeRate-API (no history available)`,
          );
        }
      }
    } catch (e) {
      logger.warn(
        { component: "Trading", asset, err: e.message },
        `ExchangeRate error for ${asset}`,
      );
    }
  }

  // ── STOCKS/COMMODITIES (Yahoo Finance unofficial or Alpha Vantage) ──
  if (
    prices.length === 0 &&
    ["S&P 500", "NASDAQ", "Gold", "Oil"].includes(asset)
  ) {
    const yahooSymbols = {
      "S&P 500": "%5EGSPC",
      NASDAQ: "%5EIXIC",
      Gold: "GC%3DF",
      Oil: "CL%3DF",
    };
    const sym = yahooSymbols[asset];
    if (sym) {
      try {
        // Yahoo Finance chart API (unofficial but widely used)
        const range = length > 200 ? "1y" : "6mo";
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=${range}&interval=1d`;
        const r = await fetch(url, {
          headers: { "User-Agent": "KelionAI/2.0" },
        });
        if (r.ok) {
          const d = await r.json();
          const result = d.chart?.result?.[0];
          if (result?.indicators?.quote?.[0]) {
            const closePrices = result.indicators.quote[0].close || [];
            const vols = result.indicators.quote[0].volume || [];
            prices = closePrices
              .filter((p) => p !== null)
              .map((p) => Math.round(p * 100) / 100);
            volumes = vols.filter((v) => v !== null);
            if (prices.length > length) {
              prices = prices.slice(-length);
              volumes = volumes.slice(-length);
            }
            source = "Yahoo Finance";
            logger.info(
              { component: "Trading", asset, source, points: prices.length },
              `📊 ${asset}: ${prices.length} real data points from Yahoo Finance`,
            );
          }
        }
      } catch (e) {
        logger.warn(
          { component: "Trading", asset, err: e.message },
          `Yahoo error for ${asset}`,
        );
      }
    }
  }

  // ── NO SIMULATION — if all APIs fail, return error ──
  if (prices.length === 0) {
    if (cached && cached.prices.length > 0) {
      logger.warn(
        { component: "Trading", asset },
        `⚠️ ${asset}: using stale cached data (APIs failed)`,
      );
      return {
        prices: cached.prices,
        volumes: cached.volumes,
        source: cached.source + " (stale)",
      };
    }
    logger.error(
      { component: "Trading", asset },
      `❌ ${asset}: ALL APIs failed — NO DATA AVAILABLE (zero simulation)`,
    );
    return { prices: [], volumes: [], source: "NO_DATA", error: `No real data available for ${asset}` };
  }

  // Cache result
  priceCache[cacheKey] = { prices, volumes, source, ts: Date.now() };
  return { prices, volumes, source };
}

/** NO MORE SIMULATED PRICES — removed. Use fetchRealPrices (async) instead. */
// _generateSimulatedPrices REMOVED — zero simulation policy

/** Run all technical indicators on an asset — NOW ASYNC with real data. */
async function analyzeAsset(asset) {
  const { prices, volumes, source } = await fetchRealPrices(asset, 300);
  const high = Math.max(...prices);
  const low = Math.min(...prices);
  const last = prices[prices.length - 1];
  const prev = prices.length > 1 ? prices[prices.length - 2] : last;

  const rsi = calculateRSI(prices);
  const macd = calculateMACD(prices);
  const bollinger = calculateBollingerBands(prices);
  const ema = calculateEMACrossover(prices);
  const fibonacci = calculateFibonacci(high, low);
  const volume = analyzeVolume(prices, volumes);
  // Real sentiment from news — not hardcoded text
  let sentimentText = `${asset} market`;
  try {
    const TI = require('./trade-intelligence');
    if (typeof TI.fetchMarketNews === 'function') {
      const news = await TI.fetchMarketNews(asset.includes('/') ? 'forex' : 'crypto');
      if (news && news.length > 0) {
        sentimentText = news.map(n => n.title || n).join(' ');
      }
    }
  } catch (e) { /* trade-intelligence not available */ }
  const sentiment = analyzeSentiment(sentimentText);
  const confluence = calculateConfluence({
    rsi,
    macd,
    bollinger,
    ema,
    fibonacci,
    volume,
    sentiment,
  });

  // Format price based on asset type
  const fmtPrice = asset.includes('/') ? +last.toFixed(5) : +last.toFixed(2);
  const changePercent = prev !== 0 ? +((last - prev) / prev * 100).toFixed(2) : 0;

  return {
    asset,
    symbol: asset,
    price: fmtPrice,
    signal: confluence.signal,
    confidence: confluence.confidence,
    changePercent,
    rsi,
    macd,
    bollinger,
    ema,
    fibonacci,
    volume,
    sentiment,
    confluence,
    dataSource: source,
  };
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

// GET /status
router.get("/status", (req, res) => {
  const positions = tradeEngine.getPositions ? tradeEngine.getPositions() : [];
  const uptimeSec = process.uptime();
  const hrs = Math.floor(uptimeSec / 3600);
  const mins = Math.floor((uptimeSec % 3600) / 60);
  res.json({
    active: true,
    status: "ACTIVE",
    version: "1.0",
    strategies: STRATEGIES,
    assets: ASSETS,
    activeTrades: Array.isArray(positions) ? positions.length : 0,
    uptime: `${hrs}h ${mins}m`,
    lastUpdate: analysisCache ? new Date(cacheTsMs).toISOString() : new Date().toISOString(),
    lastAnalysis: analysisCache ? new Date(cacheTsMs).toISOString() : null,
    cacheAge: analysisCache
      ? Math.round((Date.now() - cacheTsMs) / 1000) + "s"
      : null,
    historyEntries: analysisHistory.length,
    disclaimer: DISCLAIMER,
  });
});

// GET /analysis
router.get("/analysis", async (req, res) => {
  try {
    const now = Date.now();
    if (analysisCache && now - cacheTsMs < CACHE_TTL_MS) {
      logger.info("[Trading] Returning cached analysis");
      return res.json(analysisCache);
    }

    logger.info("[Trading] Running fresh market analysis");
    const brain = req.app.locals.brain;
    let searchSummary = null;

    // Try brain search for real market context
    if (brain) {
      try {
        const searchFn =
          typeof brain.search === "function"
            ? brain.search.bind(brain)
            : typeof brain._search === "function"
              ? brain._search.bind(brain)
              : null;
        if (searchFn) {
          searchSummary = await searchFn(
            "crypto bitcoin ethereum market analysis today",
          );
        }
      } catch (searchErr) {
        logger.warn(
          { err: searchErr.message },
          "[Trading] Brain search unavailable, proceeding without real-time market context",
        );
      }
    }

    const allAssets = Object.values(ASSETS).flat();
    const results = await Promise.all(allAssets.map(analyzeAsset));

    const entry = {
      timestamp: new Date().toISOString(),
      assets: results,
      searchContext: searchSummary
        ? String(searchSummary).substring(0, MAX_SEARCH_CONTEXT_LENGTH)
        : null,
      stale: false,
      disclaimer: DISCLAIMER,
    };

    analysisCache = entry;
    cacheTsMs = now;
    analysisHistory.push({ ts: entry.timestamp, assets: results.length });
    if (analysisHistory.length > MAX_HISTORY) analysisHistory.shift();

    // ═══ PERSIST TO SUPABASE ═══
    tradePersist.saveAllAnalyses(results).catch(() => { });

    // ═══ BRAIN INTEGRATION — save analysis to memory ═══
    if (brain) {
      const topSignals = results.slice(0, 3).map(r => r.asset + ":" + r.confluence.signal + "(" + r.confluence.confidence + "%)").join(", ");
      brain.saveMemory(null, "context", "Trading analysis: " + topSignals, {
        platform: "trading", type: "analysis"
      }).catch(() => { });
    }

    res.json(entry);
  } catch (err) {
    logger.error({ err: err.message }, "[Trading] Analysis error");
    if (analysisCache) {
      return res.json({ ...analysisCache, stale: true });
    }
    res.status(500).json({ error: "Analiza nu este disponibilă momentan." });
  }
});

// GET /signals
router.get("/signals", async (req, res) => {
  try {
    const allAssets = Object.values(ASSETS).flat();
    const allData = await Promise.all(
      allAssets.map((a) => fetchRealPrices(a, 300)),
    );
    const signals = allAssets
      .map((asset, idx) => {
        const { prices, volumes } = allData[idx];
        const high = Math.max(...prices);
        const low = Math.min(...prices);
        const last = prices[prices.length - 1];
        const rsi = calculateRSI(prices);
        const macd = calculateMACD(prices);
        const bollinger = calculateBollingerBands(prices);
        const ema = calculateEMACrossover(prices);
        const fibonacci = calculateFibonacci(high, low);
        const volume = analyzeVolume(prices, volumes);
        const sentiment = analyzeSentiment(`${asset} market`);
        const confluence = calculateConfluence({
          rsi,
          macd,
          bollinger,
          ema,
          fibonacci,
          volume,
          sentiment,
        });

        // Dynamic SL/TP from ATR (volatility-based, not hardcoded)
        const atrPeriod = Math.min(14, prices.length - 1);
        let atr = 0;
        if (prices.length > atrPeriod) {
          for (let k = prices.length - atrPeriod; k < prices.length; k++) {
            atr += Math.abs(prices[k] - prices[k - 1]);
          }
          atr /= atrPeriod;
        }
        const stopLossPct = atr > 0 ? Math.max(0.005, Math.min(0.05, (atr * 2) / last)) : 0.02;
        const takeProfitPct = stopLossPct * 2; // R:R = 2:1
        const entry = last;
        const stop = confluence.signal.includes("BUY")
          ? Math.round(entry * (1 - stopLossPct) * 100) / 100
          : Math.round(entry * (1 + stopLossPct) * 100) / 100;
        const target = confluence.signal.includes("BUY")
          ? Math.round(entry * (1 + takeProfitPct) * 100) / 100
          : Math.round(entry * (1 - takeProfitPct) * 100) / 100;

        // Format prices based on asset type
        const fmt = asset.includes('/') ? 5 : 2;
        return {
          asset,
          symbol: asset,
          signal: confluence.signal,
          confidence: confluence.confidence,
          entry: +entry.toFixed(fmt),
          target: +target.toFixed(fmt),
          stopLoss: +stop.toFixed(fmt),
          takeProfit: +target.toFixed(fmt),
          riskReward: +(takeProfitPct / stopLossPct).toFixed(1),
          timeframe: "4h",
          rsi: rsi.value,
          generatedAt: new Date().toISOString(),
          timestamp: new Date().toISOString(),
        };
      })
      .filter((s) => s.signal !== "HOLD")
      .sort((a, b) => b.confidence - a.confidence);

    // ═══ PERSIST SIGNALS TO SUPABASE ═══
    signals.forEach(s => tradePersist.saveSignal(s).catch(() => { }));

    res.json({ signals, count: signals.length, disclaimer: DISCLAIMER });
  } catch (err) {
    logger.error({ err: err.message }, "[Trading] Signals error");
    res.status(500).json({ error: "Semnalele nu sunt disponibile." });
  }
});

// GET /portfolio — REAL positions from trade engine
router.get("/portfolio", async (req, res) => {
  try {
    const openPositions = tradeEngine.getOpenPositions();
    const paperBalance = tradeEngine.getPaperBalance();
    const paperTrades = tradeEngine.getPaperTrades();
    const isPaper = tradeEngine.isPaperMode();
    const profile = tradeEngine.getRiskProfile();

    // Get current prices for open positions
    const uniqueAssets = [
      ...new Set(openPositions.map((p) => p.symbol.replace("/USDT", ""))),
    ];
    const priceData = {};
    for (const asset of uniqueAssets) {
      try {
        const { prices } = await fetchRealPrices(asset, 5);
        priceData[asset] = prices[prices.length - 1];
      } catch {
        priceData[asset] = null;
      }
    }

    // Calculate P&L for each open position
    const positions = openPositions.map((pos) => {
      const asset = pos.symbol.replace("/USDT", "");
      const currentPrice = priceData[asset] || pos.price;
      const unrealizedPnl =
        pos.action === "BUY"
          ? (currentPrice - pos.price) * pos.size
          : (pos.price - currentPrice) * pos.size;
      const pnlPct =
        ((currentPrice - pos.price) / pos.price) *
        100 *
        (pos.action === "BUY" ? 1 : -1);
      return {
        ...pos,
        currentPrice,
        unrealizedPnl: +unrealizedPnl.toFixed(2),
        pnlPct: +pnlPct.toFixed(2),
        distanceToSL:
          +(
            (Math.abs(currentPrice - pos.stopLoss) / currentPrice) *
            100
          ).toFixed(2) + "%",
        distanceToTP:
          +(
            (Math.abs(pos.takeProfit - currentPrice) / currentPrice) *
            100
          ).toFixed(2) + "%",
      };
    });

    // Closed trades summary
    const closedTrades = paperTrades.filter(
      (t) => t.status === "CLOSED" || t.closedAt,
    );
    const wins = closedTrades.filter((t) => (t.pnl || 0) > 0).length;
    const losses = closedTrades.filter((t) => (t.pnl || 0) <= 0).length;

    const totalUnrealizedPnl = positions.reduce(
      (s, p) => s + p.unrealizedPnl,
      0,
    );

    res.json({
      mode: isPaper ? "PAPER" : "LIVE",
      riskProfile: {
        name: profile.name,
        emoji: profile.emoji,
        risk: profile.riskPct + "%",
      },
      balance: paperBalance,
      openPositions: positions,
      openCount: positions.length,
      maxPositions: tradeEngine.CONFIG.MAX_OPEN_POSITIONS,
      unrealizedPnl: +totalUnrealizedPnl.toFixed(2),
      dailyPnL: tradeEngine.getDailyPnL(),
      weeklyPnL: tradeEngine.getWeeklyPnL(),
      closedTradesSummary: {
        total: closedTrades.length,
        wins,
        losses,
        winRate:
          closedTrades.length > 0
            ? +((wins / closedTrades.length) * 100).toFixed(1)
            : 0,
      },
      recentTrades: paperTrades.slice(-10),
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    logger.error({ err: err.message }, "[Trading] Portfolio error");
    res.status(500).json({ error: "Portofoliul nu este disponibil." });
  }
});

// POST /backtest
router.post("/backtest", async (req, res) => {
  try {
    const {
      strategy = "RSI",
      asset = "BTC",
      period = 90,
      riskProfile = "moderate",
    } = req.body || {};
    const allAssets = Object.values(ASSETS).flat();
    if (!STRATEGIES.includes(strategy)) {
      return res.status(400).json({
        error: `Strategie invalidă. Opțiuni: ${STRATEGIES.join(", ")}.`,
      });
    }
    if (!allAssets.includes(asset)) {
      return res
        .status(400)
        .json({ error: `Asset invalid. Opțiuni: ${allAssets.join(", ")}.` });
    }
    const len = Math.min(Math.max(parseInt(period) || 90, 30), 365);
    const profile =
      tradeEngine.RISK_PROFILES[riskProfile] ||
      tradeEngine.RISK_PROFILES.moderate;
    logger.info(
      { strategy, asset, period: len, riskProfile: profile.name },
      "[Trading] Running backtest",
    );

    const COMMISSION_PCT = 0.001; // 0.1% per trade (Binance standard)
    const SLIPPAGE_PCT = 0.0005; // 0.05% slippage simulation
    const SL_PCT = profile.DEFAULT_STOP_LOSS_PCT;
    const TP_PCT = profile.DEFAULT_TAKE_PROFIT_PCT;

    const { prices, volumes } = await fetchRealPrices(asset, len + 50);
    const trades = [];
    let position = null;
    let equity = 10000;
    let totalCommissions = 0;
    let totalSlippage = 0;

    for (let i = 20; i < prices.length; i++) {
      const slice = prices.slice(0, i + 1);
      let signal = "HOLD";

      if (strategy === "RSI") {
        signal = calculateRSI(slice).signal;
      } else if (strategy === "MACD") {
        signal = calculateMACD(slice).crossSignal;
      } else if (strategy === "BollingerBands") {
        signal = calculateBollingerBands(slice).signal;
      } else if (strategy === "EMACrossover") {
        signal = calculateEMACrossover(slice).signal;
      } else {
        signal = calculateConfluence({
          rsi: calculateRSI(slice),
          macd: calculateMACD(slice),
          bollinger: calculateBollingerBands(slice),
          ema: calculateEMACrossover(slice),
          volume: analyzeVolume(slice, volumes.slice(0, i + 1)),
        }).signal;
      }

      const price = prices[i];

      // Check stop loss / take profit on open position
      if (position) {
        const slPrice = position.entry * (1 - SL_PCT);
        const tpPrice = position.entry * (1 + TP_PCT);
        let exitReason = null;
        let exitPrice = price;

        if (price <= slPrice) {
          exitReason = "STOP_LOSS";
          exitPrice = slPrice;
        } else if (price >= tpPrice) {
          exitReason = "TAKE_PROFIT";
          exitPrice = tpPrice;
        } else if (signal === "SELL" || signal === "STRONG SELL") {
          exitReason = "SIGNAL";
          exitPrice = price;
        }

        if (exitReason) {
          const slippageExit = exitPrice * SLIPPAGE_PCT;
          const actualExit = exitPrice - slippageExit;
          const commission = actualExit * COMMISSION_PCT;
          const grossPnlPct = (actualExit - position.entry) / position.entry;
          const netPnlPct = grossPnlPct - COMMISSION_PCT * 2 - SLIPPAGE_PCT * 2;
          totalCommissions += commission + position.entry * COMMISSION_PCT;
          totalSlippage += slippageExit + position.slippage;
          equity *= 1 + netPnlPct;
          trades.push({
            entry: +position.entry.toFixed(2),
            exit: +actualExit.toFixed(2),
            grossPnlPct: +(grossPnlPct * 100).toFixed(2),
            netPnlPct: +(netPnlPct * 100).toFixed(2),
            commission: +(commission + position.entry * COMMISSION_PCT).toFixed(
              2,
            ),
            exitReason,
            bars: i - position.idx,
          });
          position = null;
        }
      }

      // Open new position
      if (!position && (signal === "BUY" || signal === "STRONG BUY")) {
        const slippage = price * SLIPPAGE_PCT;
        position = { entry: price + slippage, idx: i, slippage };
      }
    }

    const wins = trades.filter((t) => t.netPnlPct > 0).length;
    const losses = trades.filter((t) => t.netPnlPct <= 0).length;
    const totalReturn = Math.round((equity - 10000) * 100) / 100;
    const grossWins = trades
      .filter((t) => t.netPnlPct > 0)
      .reduce((s, t) => s + t.netPnlPct, 0);
    const grossLosses = Math.abs(
      trades
        .filter((t) => t.netPnlPct <= 0)
        .reduce((s, t) => s + t.netPnlPct, 0),
    );
    const avgBars =
      trades.length > 0
        ? Math.round(trades.reduce((s, t) => s + t.bars, 0) / trades.length)
        : 0;

    // Max drawdown from equity curve
    let equityCurve = 10000;
    let peakEquity = 10000;
    let maxDrawdown = 0;
    trades.forEach((t) => {
      equityCurve *= 1 + t.netPnlPct / 100;
      if (equityCurve > peakEquity) peakEquity = equityCurve;
      const dd = ((equityCurve - peakEquity) / peakEquity) * 100;
      if (dd < maxDrawdown) maxDrawdown = dd;
    });

    res.json({
      strategy,
      asset,
      period: len,
      riskProfile: profile.name,
      stopLoss: SL_PCT * 100 + "%",
      takeProfit: TP_PCT * 100 + "%",
      trades: trades.length,
      wins,
      losses,
      winRate: trades.length ? +((wins / trades.length) * 100).toFixed(1) : 0,
      profitFactor:
        grossLosses > 0 ? +(grossWins / grossLosses).toFixed(2) : Infinity,
      totalReturn,
      maxDrawdown: +maxDrawdown.toFixed(2),
      finalEquity: +equity.toFixed(2),
      totalCommissions: +totalCommissions.toFixed(2),
      totalSlippage: +totalSlippage.toFixed(2),
      avgTradeDuration: avgBars + " bars",
      recentTrades: trades.slice(-10),
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    logger.error({ err: err.message }, "[Trading] Backtest error");
    res.status(500).json({ error: "Backtestul a eșuat." });
  }
});

// GET /alerts
router.get("/alerts", async (req, res) => {
  try {
    const allAssets = Object.values(ASSETS).flat();
    const allData = await Promise.all(
      allAssets.map((a) => fetchRealPrices(a, 30)),
    );
    const alerts = allAssets
      .map((asset, i) => {
        const { prices } = allData[i];
        const rsi = calculateRSI(prices);
        const last = prices[prices.length - 1];
        return {
          asset,
          price: last,
          rsiValue: rsi.value,
          alert:
            rsi.value < 30 ? "OVERSOLD" : rsi.value > 70 ? "OVERBOUGHT" : null,
          threshold: { low: last * 0.95, high: last * 1.05 },
        };
      })
      .filter((a) => a.alert !== null);

    res.json({ alerts, count: alerts.length, disclaimer: DISCLAIMER });
  } catch (err) {
    logger.error({ err: err.message }, "[Trading] Alerts error");
    res.status(500).json({ error: "Alertele nu sunt disponibile." });
  }
});

// GET /correlation
router.get("/correlation", async (req, res) => {
  try {
    const allAssets = Object.values(ASSETS).flat();
    const allData = await Promise.all(
      allAssets.map((a) => fetchRealPrices(a, 100)),
    );
    const priceData = {};
    allAssets.forEach((a, i) => {
      priceData[a] = allData[i].prices;
    });

    const matrix = {};
    allAssets.forEach((a) => {
      matrix[a] = {};
      allAssets.forEach((b) => {
        if (a === b) {
          matrix[a][b] = 1;
          return;
        }
        const xArr = priceData[a];
        const yArr = priceData[b];
        const n = Math.min(xArr.length, yArr.length);
        const meanX = xArr.slice(0, n).reduce((s, v) => s + v, 0) / n;
        const meanY = yArr.slice(0, n).reduce((s, v) => s + v, 0) / n;
        let num = 0,
          denX = 0,
          denY = 0;
        for (let i = 0; i < n; i++) {
          const dx = xArr[i] - meanX;
          const dy = yArr[i] - meanY;
          num += dx * dy;
          denX += dx * dx;
          denY += dy * dy;
        }
        const den = Math.sqrt(denX * denY);
        matrix[a][b] = den > 0 ? Math.round((num / den) * 100) / 100 : 0;
      });
    });
    res.json({
      matrix,
      assets: allAssets,
      note: "Corelații calculate din date reale",
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    logger.error({ err: err.message }, "[Trading] Correlation error");
    res.status(500).json({ error: "Corelațiile nu sunt disponibile." });
  }
});

// GET /risk
router.get("/risk", async (req, res) => {
  try {
    const allAssets = Object.values(ASSETS).flat();
    const allData = await Promise.all(
      allAssets.map((a) => fetchRealPrices(a, 252)),
    );
    const riskData = allAssets.map((asset, idx) => {
      const { prices } = allData[idx];
      const returns = prices
        .slice(1)
        .map((p, i) => (p - prices[i]) / prices[i]);
      const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance =
        returns.reduce((a, r) => a + Math.pow(r - avgReturn, 2), 0) /
        returns.length;
      const stdDev = Math.sqrt(variance);
      const sharpe =
        stdDev > 0
          ? Math.round((avgReturn / stdDev) * Math.sqrt(252) * 100) / 100
          : 0;
      const sortedReturns = [...returns].sort((a, b) => a - b);
      const varIdx = Math.floor(returns.length * 0.05);
      const var95 = Math.round(sortedReturns[varIdx] * 10000) / 100;
      let peak = prices[0];
      let maxDD = 0;
      prices.forEach((p) => {
        if (p > peak) peak = p;
        const dd = (p - peak) / peak;
        if (dd < maxDD) maxDD = dd;
      });

      return {
        asset,
        sharpeRatio: sharpe,
        maxDrawdown: Math.round(maxDD * 10000) / 100,
        var95Pct: var95,
        annualizedVol: Math.round(stdDev * Math.sqrt(252) * 10000) / 100,
      };
    });

    res.json({ risk: riskData, disclaimer: DISCLAIMER });
  } catch (err) {
    logger.error({ err: err.message }, "[Trading] Risk error");
    res.status(500).json({ error: "Analiza de risc nu este disponibilă." });
  }
});

// ═══ HISTORY ═══
router.get("/history", (req, res) => {
  res.json({
    history: analysisHistory.slice(-20),
    total: analysisHistory.length,
  });
});

// ═══════════════════════════════════════════════════════════════
// TRADE EXECUTION ROUTES — Full integration of ALL modules
// ═══════════════════════════════════════════════════════════════

const tradeIntel = require("./trade-intelligence");

// Initialize exchange on module load
tradeEngine.initExchange();

// POST /execute — FULL analysis + rules check + auto-trade
router.post("/execute", async (req, res) => {
  try {
    const { symbol = "BTC/USDT", action } = req.body || {};
    const asset = symbol.replace("/USDT", "");
    const { prices, volumes, source } = await fetchRealPrices(asset, 300);
    if (!prices || prices.length < 50) {
      return res.status(400).json({ error: "Insufficient price data." });
    }

    // Build OHLCV from close prices
    const highs = prices.map((p, i) =>
      i > 0 ? Math.max(p, prices[i - 1]) * 1.002 : p * 1.002,
    );
    const lows = prices.map((p, i) =>
      i > 0 ? Math.min(p, prices[i - 1]) * 0.998 : p * 0.998,
    );
    const candles = prices.map((p, i) => ({
      open: i > 0 ? prices[i - 1] : p,
      high: highs[i],
      low: lows[i],
      close: p,
    }));
    const lastPrice = prices[prices.length - 1];
    const high = Math.max(...prices);
    const low = Math.min(...prices);

    // ── LAYER 1: Core Indicators (trading.js) ──
    const rsi = calculateRSI(prices);
    const macd = calculateMACD(prices);
    const bollinger = calculateBollingerBands(prices);
    const ema = calculateEMACrossover(prices);
    const fibonacci = calculateFibonacci(high, low);
    const volume = analyzeVolume(prices, volumes);
    const sentiment = analyzeSentiment(`${asset} market analysis`);

    // ── LAYER 2: Advanced Indicators (trade-executor.js) ──
    const stochastic = tradeEngine.calculateStochastic(highs, lows, prices);
    const williamsR = tradeEngine.calculateWilliamsR(highs, lows, prices);
    const atr = tradeEngine.calculateATR(highs, lows, prices);
    const atrPct = lastPrice > 0 ? atr / lastPrice : 0;
    const adx = tradeEngine.calculateADX(highs, lows, prices);
    const obv = tradeEngine.calculateOBV(prices, volumes);
    const cci = tradeEngine.calculateCCI(highs, lows, prices);
    const parabolicSAR = tradeEngine.calculateParabolicSAR(highs, lows);
    const ichimoku = tradeEngine.calculateIchimoku(highs, lows, prices);
    const mfi = tradeEngine.calculateMFI(highs, lows, prices, volumes);
    const roc = tradeEngine.calculateROC(prices);

    // ── LAYER 3: Pattern Recognition (trade-executor.js) ──
    const candlestickPatterns = tradeEngine.detectCandlestickPatterns(candles);
    const chartPatterns = tradeEngine.detectChartPatterns(prices);

    // ── LAYER 4: Intelligence (trade-intelligence.js) ──
    const rsiValues = prices.map((_, i) => {
      if (i < 15) return 50;
      const slice = prices.slice(0, i + 1);
      return calculateRSI(slice).value;
    });
    const macdValues = prices.map((_, i) => {
      if (i < 35) return 0;
      return calculateMACD(prices.slice(0, i + 1)).macd;
    });
    const divergenceRSI = tradeIntel.detectDivergence(prices, rsiValues);
    const divergenceMACD = tradeIntel.detectDivergence(prices, macdValues);
    const pivotPoints = tradeIntel.calculatePivotPoints(
      Math.max(...prices.slice(-24)),
      Math.min(...prices.slice(-24)),
      prices[prices.length - 1],
      prices[prices.length - 24] || prices[0],
    );
    const keltner = tradeIntel.calculateKeltnerChannels(highs, lows, prices);
    const aroon = tradeIntel.calculateAroon(highs, lows);
    const advancedPatterns = tradeIntel.detectAdvancedChartPatterns(prices);

    // ── LAYER 5: Macro Intelligence ──
    const [fearGreed, newsData] = await Promise.all([
      tradeEngine.fetchFearAndGreed(),
      tradeIntel.fetchMarketNews(asset),
    ]);
    const marketRegime = tradeEngine.detectMarketRegime(adx, atrPct, roc);
    const economicRisks = tradeIntel.getEconomicCalendarRisks();

    // ── SUPER CONFLUENCE (everything combined) ──
    const allPatterns = [...chartPatterns, ...advancedPatterns];
    const superConfluence = tradeEngine.calculateSuperConfluence({
      rsi,
      macd,
      bollinger,
      ema,
      fibonacci,
      volume,
      sentiment,
      stochastic,
      williamsR,
      adx,
      obv,
      cci,
      parabolicSAR,
      ichimoku,
      mfi,
      roc,
      candlestickPatterns,
      chartPatterns: allPatterns,
      fearGreed,
      marketRegime,
    });

    // Determine trade action
    const tradeAction =
      action ||
      (superConfluence.signal.includes("BUY")
        ? "BUY"
        : superConfluence.signal.includes("SELL")
          ? "SELL"
          : null);

    // ── TRADING RULES ENGINE — Must pass before execution ──
    let rulesCheck = null;
    let result = { executed: false, reason: "No clear signal" };

    if (tradeAction) {
      rulesCheck = tradeIntel.evaluateTradingRules({
        action: tradeAction,
        price: lastPrice,
        confluence: superConfluence.confidence,
        adx,
        atr,
        atrPct,
        rsi,
        volume,
        marketRegime,
        fearGreed,
        economicRisks,
        openPositions: tradeEngine.getOpenPositions(),
      });

      if (
        rulesCheck.approved &&
        superConfluence.confidence >= tradeEngine.CONFIG.MIN_CONFLUENCE
      ) {
        result = await tradeEngine.executeTrade(
          tradeAction,
          symbol,
          lastPrice,
          superConfluence,
          atrPct,
        );
      } else if (!rulesCheck.approved) {
        result = { executed: false, reason: rulesCheck.summary };
      } else {
        result = {
          executed: false,
          reason: `Confluence too low: ${superConfluence.confidence}% (min: ${tradeEngine.CONFIG.MIN_CONFLUENCE}%)`,
        };
      }
    }

    // ═══ BRAIN INTEGRATION — save trade execution to memory ═══
    const tradeBrain = req.app.locals.brain;
    if (tradeBrain) {
      const memo = symbol + " " + (tradeAction || "HOLD") + " @ $" + lastPrice + " | Confluence: " + superConfluence.confidence + "% | " + (result.executed ? "EXECUTED" : result.reason);
      tradeBrain.saveMemory(null, "context", "Trade: " + memo, {
        platform: "trading", type: "execution", symbol
      }).catch(() => { });
    }

    res.json({
      symbol,
      price: lastPrice,
      dataSource: source,
      analysis: {
        // Core (7)
        rsi,
        macd,
        bollinger,
        ema,
        fibonacci,
        volume,
        sentiment,
        // Advanced (10)
        stochastic,
        adx,
        ichimoku,
        parabolicSAR,
        obv,
        cci,
        mfi,
        williamsR,
        roc,
        atr: { value: atr, pctOfPrice: +(atrPct * 100).toFixed(2) + "%" },
        // Intelligence (4)
        keltner,
        aroon,
        pivotPoints,
        divergence: { rsi: divergenceRSI, macd: divergenceMACD },
      },
      patterns: {
        candlestick: candlestickPatterns,
        chart: chartPatterns,
        advanced: advancedPatterns,
        total: candlestickPatterns.length + allPatterns.length,
      },
      macro: {
        fearGreed,
        marketRegime,
        economicRisks,
        news: newsData,
      },
      superConfluence,
      tradingRules: rulesCheck,
      execution: result,
      mode: tradeEngine.isPaperMode() ? "PAPER" : "LIVE",
      totalIndicators: 21,
      totalPatternTypes: 38,
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    logger.error({ err: err.message }, "[Trading] Execute error");
    res.status(500).json({ error: "Eroare la execuție." });
  }
});

// GET /full-analysis — Read-only analysis (no execution)
router.get("/full-analysis/:asset?", async (req, res) => {
  try {
    const asset = req.params.asset || "BTC";
    const { prices, _volumes, source } = await fetchRealPrices(asset, 300);
    if (!prices || prices.length < 50)
      return res.status(400).json({ error: "Insufficient data" });

    const highs = prices.map((p, i) =>
      i > 0 ? Math.max(p, prices[i - 1]) * 1.002 : p * 1.002,
    );
    const lows = prices.map((p, i) =>
      i > 0 ? Math.min(p, prices[i - 1]) * 0.998 : p * 0.998,
    );
    const candles = prices.map((p, i) => ({
      open: i > 0 ? prices[i - 1] : p,
      high: highs[i],
      low: lows[i],
      close: p,
    }));
    const lastPrice = prices[prices.length - 1];

    const rsi = calculateRSI(prices);
    const macd = calculateMACD(prices);
    const adx = tradeEngine.calculateADX(highs, lows, prices);
    const atr = tradeEngine.calculateATR(highs, lows, prices);
    const atrPct = lastPrice > 0 ? atr / lastPrice : 0;
    const roc = tradeEngine.calculateROC(prices);
    const fearGreed = await tradeEngine.fetchFearAndGreed();
    const marketRegime = tradeEngine.detectMarketRegime(adx, atrPct, roc);
    const candlestickPatterns = tradeEngine.detectCandlestickPatterns(candles);
    const chartPatterns = tradeEngine.detectChartPatterns(prices);
    const advancedPatterns = tradeIntel.detectAdvancedChartPatterns(prices);
    const keltner = tradeIntel.calculateKeltnerChannels(highs, lows, prices);
    const aroon = tradeIntel.calculateAroon(highs, lows);
    const pivots = tradeIntel.calculatePivotPoints(
      Math.max(...prices.slice(-24)),
      Math.min(...prices.slice(-24)),
      lastPrice,
      prices[Math.max(0, prices.length - 24)],
    );
    const economicRisks = tradeIntel.getEconomicCalendarRisks();

    res.json({
      asset,
      price: lastPrice,
      dataSource: source,
      indicators: {
        rsi,
        macd,
        adx,
        atr: { value: atr, pct: +(atrPct * 100).toFixed(2) },
        roc,
        keltner,
        aroon,
        pivots,
      },
      patterns: {
        candlestick: candlestickPatterns,
        chart: chartPatterns,
        advanced: advancedPatterns,
      },
      macro: { fearGreed, marketRegime, economicRisks },
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    logger.error({ err: err.message }, "[Trading] Full analysis error");
    res.status(500).json({ error: "Eroare la analiză." });
  }
});

// GET /calendar — Economic calendar risks
router.get("/calendar", (req, res) => {
  res.json(tradeIntel.getEconomicCalendarRisks());
});

router.get("/positions", (req, res) => {
  res.json({
    positions: tradeEngine.getOpenPositions(),
    dailyPnL: tradeEngine.getDailyPnL(),
    weeklyPnL: tradeEngine.getWeeklyPnL(),
    mode: tradeEngine.isPaperMode() ? "PAPER" : "LIVE",
  });
});

router.post("/close/:tradeId", async (req, res) => {
  const { currentPrice } = req.body || {};
  if (!currentPrice)
    return res.status(400).json({ error: "currentPrice required" });
  const result = await tradeEngine.closePosition(
    req.params.tradeId,
    currentPrice,
    "admin_manual",
  );
  res.json(result);
});

router.post("/kill-switch", async (req, res) => {
  const result = await tradeEngine.killSwitch(req.body?.prices || {});
  res.json({ killed: true, closedPositions: result });
});

router.get("/paper-balance", (req, res) => {
  res.json({
    balance: tradeEngine.getPaperBalance(),
    trades: tradeEngine.getPaperTrades().slice(-20),
    mode: tradeEngine.isPaperMode() ? "PAPER" : "LIVE",
  });
});

// ═══ RISK PROFILES ═══

router.get("/risk-profile", (req, res) => {
  res.json(tradeEngine.getRiskProfile());
});

router.post("/risk-profile", (req, res) => {
  const { profile } = req.body || {};
  if (!profile)
    return res.status(400).json({
      error: "profile required (conservative, moderate, aggressive, yolo)",
    });
  const result = tradeEngine.setRiskProfile(profile.toLowerCase());
  if (result.error) return res.status(400).json(result);
  logger.info(
    { component: "Trading", profile: result.profile },
    `Risk profile changed to ${result.emoji} ${result.profile}`,
  );
  res.json(result);
});

router.get("/projections", (req, res) => {
  const capital = parseFloat(req.query.capital) || 10;
  const profiles = {};
  for (const [key, p] of Object.entries(tradeEngine.RISK_PROFILES)) {
    const dailyRate = 1 + p.projections.daily / 100;
    profiles[key] = {
      name: p.name,
      emoji: p.emoji,
      risk: p.riskPct + "%",
      sl: p.DEFAULT_STOP_LOSS_PCT * 100 + "%",
      tp: p.DEFAULT_TAKE_PROFIT_PCT * 100 + "%",
      results: {
        "1_day": +(capital * Math.pow(dailyRate, 1)).toFixed(2),
        "1_week": +(capital * Math.pow(dailyRate, 7)).toFixed(2),
        "1_month": +(capital * Math.pow(dailyRate, 30)).toFixed(2),
        "3_months": +(capital * Math.pow(dailyRate, 90)).toFixed(2),
        "6_months": +(capital * Math.pow(dailyRate, 180)).toFixed(2),
        "1_year": +(capital * Math.pow(dailyRate, 365)).toFixed(2),
      },
      maxDrawdown5Losses:
        +((1 - Math.pow(1 - p.DEFAULT_STOP_LOSS_PCT, 5)) * 100).toFixed(1) +
        "%",
    };
  }
  res.json({
    capital,
    currency: "lei",
    profiles,
    activeProfile: tradeEngine.getRiskProfile().active,
    disclaimer: DISCLAIMER,
  });
});

// ═══════════════════════════════════════════════════════════════
// FAZA 2 — INTELLIGENCE ROUTES
// ═══════════════════════════════════════════════════════════════

// GET /mta/:asset — Multi-Timeframe Analysis
router.get("/mta/:asset", async (req, res) => {
  try {
    const asset = req.params.asset.toUpperCase();
    const allAssets = Object.values(ASSETS).flat();
    if (!allAssets.includes(asset) && !allAssets.includes(req.params.asset)) {
      return res.status(400).json({ error: `Asset invalid: ${asset}` });
    }
    const mta = await analyzeMultiTimeframe(allAssets.includes(asset) ? asset : req.params.asset);
    res.json({ ...mta, disclaimer: DISCLAIMER });
  } catch (err) {
    logger.error({ err: err.message }, "[Trading] MTA error");
    res.status(500).json({ error: "Multi-Timeframe Analysis nu este disponibil." });
  }
});

// GET /smart-money/:asset — Smart Money Flow Detection
router.get("/smart-money/:asset", async (req, res) => {
  try {
    const asset = req.params.asset.toUpperCase();
    const allAssets = Object.values(ASSETS).flat();
    const realAsset = allAssets.includes(asset) ? asset : allAssets.includes(req.params.asset) ? req.params.asset : null;
    if (!realAsset) return res.status(400).json({ error: `Asset invalid: ${asset}` });

    const { prices, volumes, source } = await fetchRealPrices(realAsset, 300);
    const smartMoney = detectSmartMoney(prices, volumes);
    const advancedEntry = smartMoney.signal !== "HOLD"
      ? calculateAdvancedEntry(prices[prices.length - 1], smartMoney.signal, tradeEngine.getRiskProfile().active)
      : null;

    res.json({
      asset: realAsset,
      dataSource: source,
      smartMoney,
      advancedEntry,
      dataPoints: prices.length,
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    logger.error({ err: err.message }, "[Trading] Smart Money error");
    res.status(500).json({ error: "Smart Money Analysis nu este disponibil." });
  }
});

// GET /kelly/:asset — Kelly Criterion Position Sizing
router.get("/kelly/:asset", async (req, res) => {
  try {
    const asset = req.params.asset.toUpperCase();
    const allAssets = Object.values(ASSETS).flat();
    const realAsset = allAssets.includes(asset) ? asset : allAssets.includes(req.params.asset) ? req.params.asset : null;
    if (!realAsset) return res.status(400).json({ error: `Asset invalid: ${asset}` });

    // Get win rate from market-learner or paper trades
    const paperTrades = tradeEngine.getPaperTrades();
    const assetTrades = paperTrades.filter(t => t.asset === realAsset || t.symbol?.includes(realAsset));
    const closedTrades = assetTrades.filter(t => t.exitPrice);
    const wins = closedTrades.filter(t => (t.pnl || 0) > 0);
    const losses = closedTrades.filter(t => (t.pnl || 0) <= 0);

    const winRate = closedTrades.length > 0 ? wins.length / closedTrades.length : 0.5;
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + Math.abs(t.pnl || 0), 0) / wins.length : 0.03;
    const avgLoss = losses.length > 0 ? losses.reduce((s, t) => s + Math.abs(t.pnl || 0), 0) / losses.length : 0.02;
    const balance = tradeEngine.getPaperBalance();

    const kelly = kellyPosition(winRate, avgWin, avgLoss, balance);
    const learnerAccuracy = marketLearner.getAccuracy(realAsset);

    res.json({
      asset: realAsset,
      kelly,
      tradeHistory: {
        totalTrades: closedTrades.length,
        wins: wins.length,
        losses: losses.length,
        winRate: +(winRate * 100).toFixed(1) + "%",
        avgWin: +avgWin.toFixed(4),
        avgLoss: +avgLoss.toFixed(4),
      },
      learnerAccuracy,
      recommendation: kelly.reason === "ok"
        ? `Invest ${kelly.cappedPct}% ($${kelly.positionSize}) per trade`
        : "Nu exista edge matematic — reduce riscul sau nu tranzactiona",
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    logger.error({ err: err.message }, "[Trading] Kelly error");
    res.status(500).json({ error: "Kelly Criterion nu este disponibil." });
  }
});

// GET /learner/weights — Current adaptive weights from MarketLearner
router.get("/learner/weights", (req, res) => {
  try {
    const report = marketLearner.getReport();
    res.json({
      weights: marketLearner.getWeights(),
      report,
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    logger.error({ err: err.message }, "[Trading] Learner weights error");
    res.status(500).json({ error: "Learner weights nu sunt disponibile." });
  }
});

// GET /learner/accuracy/:asset — Accuracy per indicator for an asset
router.get("/learner/accuracy/:asset", (req, res) => {
  try {
    const asset = req.params.asset.toUpperCase();
    const accuracy = {};
    for (const strategy of STRATEGIES) {
      accuracy[strategy] = marketLearner.getAccuracy(asset, strategy);
    }
    const meanError = marketLearner.getMeanError(asset);

    res.json({
      asset,
      accuracy,
      meanPredictionError: meanError,
      experienceLevel: marketLearner.getReport()?.experienceLevel || "beginner",
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    logger.error({ err: err.message }, "[Trading] Learner accuracy error");
    res.status(500).json({ error: "Learner accuracy nu este disponibil." });
  }
});

// ═══════════════════════════════════════════════════════════════
// FAZA 3 — AI SCORING + PERFORMANCE + ALERTS
// ═══════════════════════════════════════════════════════════════

// GET /ai-score/:asset — AI-powered signal evaluation
router.get("/ai-score/:asset", async (req, res) => {
  try {
    const asset = req.params.asset.toUpperCase();
    const allAssets = Object.values(ASSETS).flat();
    const realAsset = allAssets.includes(asset) ? asset : allAssets.includes(req.params.asset) ? req.params.asset : null;
    if (!realAsset) return res.status(400).json({ error: `Asset invalid: ${asset}` });

    // Gather all data for scoring
    const analysis = await analyzeAsset(realAsset);
    const { prices, volumes } = await fetchRealPrices(realAsset, 300);
    const smartMoney = detectSmartMoney(prices, volumes);

    let mta = null;
    try { mta = await analyzeMultiTimeframe(realAsset); } catch (e) { /* optional */ }

    const scoreResult = await aiScorer.scoreSignal({
      asset: realAsset,
      price: analysis.price,
      confluence: analysis.confluence,
      rsi: analysis.rsi,
      macd: analysis.macd,
      smartMoney,
      mta,
    });

    // Record signal in learner
    if (analysis.confluence?.signal !== "HOLD") {
      for (const ind of STRATEGIES) {
        const sig = analysis[ind.toLowerCase()]?.signal || analysis[ind.toLowerCase()]?.crossSignal;
        if (sig) marketLearner.recordSignal(realAsset, ind, sig, analysis.price);
      }
    }

    res.json({
      asset: realAsset,
      price: analysis.price,
      aiScore: scoreResult,
      confluence: analysis.confluence,
      smartMoney: { phase: smartMoney.phase, signal: smartMoney.signal },
      mta: mta ? { signal: mta.overallSignal, alignment: mta.alignment } : null,
      advancedEntry: scoreResult.action.includes("BUY") || scoreResult.action.includes("SELL")
        ? calculateAdvancedEntry(analysis.price, scoreResult.action.replace("_", " "), tradeEngine.getRiskProfile().active)
        : null,
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    logger.error({ err: err.message }, "[Trading] AI Score error");
    res.status(500).json({ error: "AI Scoring nu este disponibil." });
  }
});

// GET /performance — Full performance report
router.get("/performance", (req, res) => {
  try {
    const report = perfTracker.getReport();
    res.json({
      ...report,
      aiScoringStats: aiScorer.getStats(),
      learnerReport: marketLearner.getReport(),
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    logger.error({ err: err.message }, "[Trading] Performance error");
    res.status(500).json({ error: "Performance report nu este disponibil." });
  }
});

// GET /alert-check — Check for actionable alerts (signals > 70% confidence)
router.get("/alert-check", async (req, res) => {
  try {
    const allAssets = Object.values(ASSETS).flat();
    const alerts = [];

    for (const asset of allAssets) {
      try {
        const analysis = await analyzeAsset(asset);
        if (!analysis.confluence || analysis.confluence.signal === "HOLD") continue;
        if (analysis.confluence.confidence < 70) continue;

        const { prices, volumes } = await fetchRealPrices(asset, 100);
        const smartMoney = detectSmartMoney(prices, volumes);

        // Only alert if Smart Money agrees
        const smAgrees = smartMoney.signal === analysis.confluence.signal.replace("STRONG ", "");

        alerts.push({
          asset,
          signal: analysis.confluence.signal,
          confidence: analysis.confluence.confidence,
          price: analysis.price,
          rsi: analysis.rsi?.value,
          smartMoneyPhase: smartMoney.phase,
          smartMoneyAgrees: smAgrees,
          priority: smAgrees ? "HIGH" : "MEDIUM",
          timestamp: new Date().toISOString(),
        });
      } catch (e) {
        // Skip failed assets
      }
    }

    alerts.sort((a, b) => b.confidence - a.confidence);

    res.json({
      alerts,
      count: alerts.length,
      highPriority: alerts.filter(a => a.priority === "HIGH").length,
      checkedAt: new Date().toISOString(),
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    logger.error({ err: err.message }, "[Trading] Alert check error");
    res.status(500).json({ error: "Alert check nu este disponibil." });
  }
});

// GET /full-intelligence/:asset — Everything in one call
router.get("/full-intelligence/:asset", async (req, res) => {
  try {
    const asset = req.params.asset.toUpperCase();
    const allAssets = Object.values(ASSETS).flat();
    const realAsset = allAssets.includes(asset) ? asset : allAssets.includes(req.params.asset) ? req.params.asset : null;
    if (!realAsset) return res.status(400).json({ error: `Asset invalid: ${asset}` });

    const [analysis, mta] = await Promise.all([
      analyzeAsset(realAsset),
      analyzeMultiTimeframe(realAsset).catch(() => null),
    ]);

    const { prices, volumes } = await fetchRealPrices(realAsset, 300);
    const smartMoney = detectSmartMoney(prices, volumes);
    const aiScore = await aiScorer.scoreSignal({
      asset: realAsset, price: analysis.price, confluence: analysis.confluence,
      rsi: analysis.rsi, macd: analysis.macd, smartMoney, mta,
    });

    const profile = tradeEngine.getRiskProfile();
    const kelly = kellyPosition(
      0.5, 0.03, 0.02, tradeEngine.getPaperBalance()
    );

    const advEntry = aiScore.action !== "HOLD"
      ? calculateAdvancedEntry(analysis.price, aiScore.action.replace("_", " "), profile.active)
      : null;

    res.json({
      asset: realAsset,
      timestamp: new Date().toISOString(),
      price: analysis.price,
      dataSource: analysis.dataSource,
      technicals: {
        rsi: analysis.rsi,
        macd: analysis.macd,
        bollinger: analysis.bollinger,
        ema: analysis.ema,
        fibonacci: analysis.fibonacci,
        volume: analysis.volume,
      },
      confluence: analysis.confluence,
      multiTimeframe: mta,
      smartMoney,
      aiScore,
      kelly,
      advancedEntry: advEntry,
      riskProfile: { name: profile.profiles?.[profile.active]?.name, risk: profile.active },
      performance: perfTracker.getReport()?.summary,
      disclaimer: DISCLAIMER,
    });
  } catch (err) {
    logger.error({ err: err.message }, "[Trading] Full intelligence error");
    res.status(500).json({ error: "Full intelligence nu este disponibil." });
  }
});

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════
module.exports = router;

module.exports.calculateRSI = calculateRSI;
module.exports.calculateMACD = calculateMACD;
module.exports.calculateBollingerBands = calculateBollingerBands;
module.exports.calculateEMA = calculateEMA;
module.exports.calculateEMACrossover = calculateEMACrossover;
module.exports.calculateFibonacci = calculateFibonacci;
module.exports.analyzeVolume = analyzeVolume;
module.exports.analyzeSentiment = analyzeSentiment;
module.exports.calculateConfluence = calculateConfluence;
module.exports.detectSmartMoney = detectSmartMoney;
module.exports.kellyPosition = kellyPosition;
module.exports.analyzeMultiTimeframe = analyzeMultiTimeframe;
module.exports.calculateAdvancedEntry = calculateAdvancedEntry;
module.exports.aiScorer = aiScorer;
module.exports.perfTracker = perfTracker;
module.exports.tradeEngine = tradeEngine;
module.exports.tradeIntel = tradeIntel;
module.exports.analyzeAsset = analyzeAsset;
module.exports.fetchRealPrices = fetchRealPrices;
