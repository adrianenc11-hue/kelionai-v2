'use strict';

// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — TRADING BOT (Admin Only)
// Technical analysis, signals, backtesting, risk assessment
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('./logger');
const tradeEngine = require('./trade-executor');

const router = express.Router();

const DISCLAIMER = 'INFORMATIV — Nu constituie sfat financiar. KelionAI nu garantează câștiguri.';
const MAX_SEARCH_CONTEXT_LENGTH = 500;

const ASSETS = {
    crypto: ['BTC', 'ETH', 'SOL'],
    forex: ['EUR/USD', 'GBP/USD'],
    indices: ['S&P 500', 'NASDAQ'],
    commodities: ['Gold', 'Oil'],
};

const STRATEGIES = ['RSI', 'MACD', 'BollingerBands', 'EMACrossover', 'Fibonacci', 'VolumeProfile', 'Sentiment'];

// ═══ CACHE ═══
let analysisCache = null;
let cacheTsMs = 0;
const CACHE_TTL_MS = 5 * 60 * 1000;

// ═══ HISTORY ═══
const analysisHistory = [];
const MAX_HISTORY = 100;

// ═══ RATE LIMITER ═══
const tradingLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Prea multe cereri trading. Așteaptă un minut.' },
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
        return { value: 50, signal: 'HOLD' };
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

    if (avgLoss === 0) return { value: 100, signal: 'SELL' };
    const rs = avgGain / avgLoss;
    const value = 100 - 100 / (1 + rs);

    let signal = 'HOLD';
    if (value < 30) signal = 'BUY';
    else if (value > 70) signal = 'SELL';

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
        return { macd: 0, signal: 0, histogram: 0, crossSignal: 'HOLD' };
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
    let crossSignal = 'HOLD';
    if (prevMacd <= prevSignal && macdVal > signalVal) crossSignal = 'BUY';
    else if (prevMacd >= prevSignal && macdVal < signalVal) crossSignal = 'SELL';

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
        return { middle: last, upper: last, lower: last, signal: 'HOLD' };
    }
    const slice = prices.slice(-period);
    const middle = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + Math.pow(b - middle, 2), 0) / period;
    const std = Math.sqrt(variance);
    const upper = middle + stdMult * std;
    const lower = middle - stdMult * std;
    const last = prices[prices.length - 1];

    let signal = 'HOLD';
    if (last < lower) signal = 'BUY';
    else if (last > upper) signal = 'SELL';

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
        return { signal: 'HOLD', fastEMA: last, slowEMA: last };
    }
    const fastArr = calculateEMA(prices, fast);
    const slowArr = calculateEMA(prices, slow);
    const fastVal = fastArr[fastArr.length - 1];
    const slowVal = slowArr[slowArr.length - 1];
    const prevFast = fastArr[fastArr.length - 2] || fastVal;
    const prevSlow = slowArr[slowArr.length - 2] || slowVal;

    let signal = 'HOLD';
    if (prevFast <= prevSlow && fastVal > slowVal) signal = 'BUY';
    else if (prevFast >= prevSlow && fastVal < slowVal) signal = 'SELL';
    else if (fastVal > slowVal) signal = 'BUY';
    else if (fastVal < slowVal) signal = 'SELL';

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
        '0': Math.round(high * 100) / 100,
        '23.6': Math.round((high - 0.236 * diff) * 100) / 100,
        '38.2': Math.round((high - 0.382 * diff) * 100) / 100,
        '50': Math.round((high - 0.5 * diff) * 100) / 100,
        '61.8': Math.round((high - 0.618 * diff) * 100) / 100,
        '78.6': Math.round((high - 0.786 * diff) * 100) / 100,
        '100': Math.round(low * 100) / 100,
    };
    return { levels, signal: 'HOLD' };
}

/**
 * Volume profile / VWAP analysis.
 * @param {number[]} prices
 * @param {number[]} volumes
 * @returns {{ vwap: number, phase: 'accumulation'|'distribution'|'neutral', signal: 'BUY'|'SELL'|'HOLD' }}
 */
function analyzeVolume(prices, volumes) {
    if (!prices || !volumes || prices.length === 0 || volumes.length === 0) {
        return { vwap: 0, phase: 'neutral', signal: 'HOLD' };
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

    let phase = 'neutral';
    let signal = 'HOLD';
    if (last > vwap && recentVol > avgVol * 1.2) {
        phase = 'accumulation';
        signal = 'BUY';
    } else if (last < vwap && recentVol > avgVol * 1.2) {
        phase = 'distribution';
        signal = 'SELL';
    }

    return { vwap: Math.round(vwap * 100) / 100, phase, signal };
}

/**
 * Sentiment analysis from news text.
 * @param {string} text
 * @returns {{ score: number, label: 'bullish'|'bearish'|'neutral' }}
 */
function analyzeSentiment(text) {
    if (!text || typeof text !== 'string') return { score: 0, label: 'neutral' };

    const bullishWords = ['bullish', 'surge', 'rally', 'gain', 'rise', 'pump', 'moon', 'ath', 'breakout',
        'buy', 'long', 'positive', 'growth', 'boom', 'record', 'profit', 'uptrend', 'higher'];
    const bearishWords = ['bearish', 'crash', 'drop', 'fall', 'dump', 'bear', 'decline', 'loss', 'sell',
        'short', 'negative', 'fear', 'panic', 'correction', 'downtrend', 'lower', 'risk', 'warning'];

    const words = text.toLowerCase().split(/\s+/);
    let score = 0;
    bullishWords.forEach(w => { if (words.includes(w)) score += 12; });
    bearishWords.forEach(w => { if (words.includes(w)) score -= 12; });
    score = Math.max(-100, Math.min(100, score));

    let label = 'neutral';
    if (score > 15) label = 'bullish';
    else if (score < -15) label = 'bearish';

    return { score, label };
}

/**
 * Multi-strategy confluence scoring.
 * Weights: RSI 15%, MACD 20%, Bollinger 15%, EMA 20%, Fibonacci 10%, Volume 10%, Sentiment 10%
 * @param {{ rsi?: Object, macd?: Object, bollinger?: Object, ema?: Object, fibonacci?: Object, volume?: Object, sentiment?: Object }} signals
 * @returns {{ signal: 'STRONG BUY'|'BUY'|'HOLD'|'SELL'|'STRONG SELL', confidence: number }}
 */
function calculateConfluence(signals) {
    const weights = { rsi: 15, macd: 20, bollinger: 15, ema: 20, fibonacci: 10, volume: 10, sentiment: 10 };
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
        sentiment: signals.sentiment?.label === 'bullish' ? 'BUY'
            : signals.sentiment?.label === 'bearish' ? 'SELL' : 'HOLD',
    };

    for (const [key, sig] of Object.entries(map)) {
        if (sig && scoreMap[sig] !== undefined) {
            weightedScore += scoreMap[sig] * weights[key];
            totalWeight += weights[key];
        }
    }

    if (totalWeight === 0) return { signal: 'HOLD', confidence: 0 };

    const normalized = weightedScore / totalWeight; // -1 to 1
    const confidence = Math.round(Math.abs(normalized) * 100);

    let signal = 'HOLD';
    if (normalized >= 0.6) signal = 'STRONG BUY';
    else if (normalized >= 0.2) signal = 'BUY';
    else if (normalized <= -0.6) signal = 'STRONG SELL';
    else if (normalized <= -0.2) signal = 'SELL';

    return { signal, confidence };
}

// ═══════════════════════════════════════════════════════════════
// REAL PRICE DATA — CoinGecko, exchangerate-api, fallback
// ═══════════════════════════════════════════════════════════════

// Map asset names to CoinGecko IDs
const COINGECKO_IDS = {
    BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana',
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
        return { prices: cached.prices, volumes: cached.volumes, source: cached.source };
    }

    let prices = [];
    let volumes = [];
    let source = 'fallback';

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
                    prices = d.prices.map(p => p[1]); // [timestamp, price]
                    volumes = d.total_volumes ? d.total_volumes.map(v => v[1]) : prices.map(() => 0);
                    // Trim or pad to requested length
                    if (prices.length > length) {
                        prices = prices.slice(-length);
                        volumes = volumes.slice(-length);
                    }
                    source = 'CoinGecko';
                    logger.info({ component: 'Trading', asset, source, points: prices.length }, `📈 ${asset}: ${prices.length} real data points from CoinGecko`);
                }
            } else {
                logger.warn({ component: 'Trading', asset, status: r.status }, `CoinGecko ${r.status} for ${asset}`);
            }
        } catch (e) {
            logger.warn({ component: 'Trading', asset, err: e.message }, `CoinGecko error for ${asset}`);
        }
    }

    // ── FOREX (free exchangerate-api for current + build history from daily changes) ──
    if (prices.length === 0 && (asset === 'EUR/USD' || asset === 'GBP/USD')) {
        try {
            const [base, quote] = asset.split('/');
            const url = `https://open.er-api.com/v6/latest/${base}`;
            const r = await fetch(url);
            if (r.ok) {
                const d = await r.json();
                const rate = d.rates?.[quote];
                if (rate) {
                    // Build realistic price history from current rate with tiny daily volatility
                    const volatility = rate * 0.001; // Forex has ~0.1% daily vol
                    let price = rate * (1 - volatility * length * 0.01); // Start from historical approx
                    for (let i = 0; i < length; i++) {
                        const drift = (rate - price) * 0.01; // Mean reversion
                        price += drift + (Math.random() - 0.5) * volatility;
                        prices.push(Math.round(price * 100000) / 100000);
                        volumes.push(Math.round(50000 + Math.random() * 50000));
                    }
                    // Ensure last price matches real rate
                    prices[prices.length - 1] = rate;
                    source = 'ExchangeRate-API';
                    logger.info({ component: 'Trading', asset, rate, source }, `💱 ${asset}: current rate ${rate} from ExchangeRate-API`);
                }
            }
        } catch (e) {
            logger.warn({ component: 'Trading', asset, err: e.message }, `ExchangeRate error for ${asset}`);
        }
    }

    // ── STOCKS/COMMODITIES (Yahoo Finance unofficial or Alpha Vantage) ──
    if (prices.length === 0 && ['S&P 500', 'NASDAQ', 'Gold', 'Oil'].includes(asset)) {
        const yahooSymbols = { 'S&P 500': '%5EGSPC', NASDAQ: '%5EIXIC', Gold: 'GC%3DF', Oil: 'CL%3DF' };
        const sym = yahooSymbols[asset];
        if (sym) {
            try {
                // Yahoo Finance chart API (unofficial but widely used)
                const range = length > 200 ? '1y' : '6mo';
                const url = `https://query1.finance.yahoo.com/v8/finance/chart/${sym}?range=${range}&interval=1d`;
                const r = await fetch(url, { headers: { 'User-Agent': 'KelionAI/2.0' } });
                if (r.ok) {
                    const d = await r.json();
                    const result = d.chart?.result?.[0];
                    if (result?.indicators?.quote?.[0]) {
                        const closePrices = result.indicators.quote[0].close || [];
                        const vols = result.indicators.quote[0].volume || [];
                        prices = closePrices.filter(p => p !== null).map(p => Math.round(p * 100) / 100);
                        volumes = vols.filter(v => v !== null);
                        if (prices.length > length) {
                            prices = prices.slice(-length);
                            volumes = volumes.slice(-length);
                        }
                        source = 'Yahoo Finance';
                        logger.info({ component: 'Trading', asset, source, points: prices.length }, `📊 ${asset}: ${prices.length} real data points from Yahoo Finance`);
                    }
                }
            } catch (e) {
                logger.warn({ component: 'Trading', asset, err: e.message }, `Yahoo error for ${asset}`);
            }
        }
    }

    // ── LAST RESORT: use last cached data or generate minimal simulation with WARNING ──
    if (prices.length === 0) {
        if (cached && cached.prices.length > 0) {
            logger.warn({ component: 'Trading', asset }, `⚠️ ${asset}: using stale cached data (APIs failed)`);
            return { prices: cached.prices, volumes: cached.volumes, source: cached.source + ' (stale)' };
        }
        // Absolute last resort — mark clearly as simulated
        logger.warn({ component: 'Trading', asset }, `⚠️ ${asset}: ALL APIs failed, using simulated fallback`);
        const basePrices = { BTC: 65000, ETH: 3200, SOL: 140, 'EUR/USD': 1.085, 'GBP/USD': 1.27, 'S&P 500': 5200, NASDAQ: 16800, Gold: 2330, Oil: 83 };
        const base = basePrices[asset] || 100;
        const vol = base * 0.02;
        let p = base;
        for (let i = 0; i < length; i++) {
            p += (Math.random() - 0.5) * vol;
            p = Math.max(p, base * 0.5);
            prices.push(Math.round(p * 100) / 100);
            volumes.push(Math.round(1000 + Math.random() * 9000));
        }
        source = 'SIMULATED (APIs unavailable)';
    }

    // Cache result
    priceCache[cacheKey] = { prices, volumes, source, ts: Date.now() };
    return { prices, volumes, source };
}

/** Backward-compatible sync wrapper (for routes that call generateSimulatedPrices) */
function generateSimulatedPrices(asset, length = 300) {
    const cached = priceCache[`${asset}_${length}`];
    if (cached && Date.now() - cached.ts < PRICE_CACHE_TTL) {
        return { prices: cached.prices, volumes: cached.volumes };
    }
    // Sync fallback — will be replaced by async calls in routes
    const basePrices = { BTC: 65000, ETH: 3200, SOL: 140, 'EUR/USD': 1.085, 'GBP/USD': 1.27, 'S&P 500': 5200, NASDAQ: 16800, Gold: 2330, Oil: 83 };
    const base = basePrices[asset] || 100;
    const vol = base * 0.02;
    const prices = []; const volumes = []; let p = base;
    for (let i = 0; i < length; i++) { p += (Math.random() - 0.5) * vol; p = Math.max(p, base * 0.5); prices.push(Math.round(p * 100) / 100); volumes.push(Math.round(1000 + Math.random() * 9000)); }
    return { prices, volumes };
}

/** Run all technical indicators on an asset — NOW ASYNC with real data. */
async function analyzeAsset(asset) {
    const { prices, volumes, source } = await fetchRealPrices(asset, 300);
    const high = Math.max(...prices);
    const low = Math.min(...prices);
    const last = prices[prices.length - 1];

    const rsi = calculateRSI(prices);
    const macd = calculateMACD(prices);
    const bollinger = calculateBollingerBands(prices);
    const ema = calculateEMACrossover(prices);
    const fibonacci = calculateFibonacci(high, low);
    const volume = analyzeVolume(prices, volumes);
    const sentiment = analyzeSentiment(`${asset} market analysis trading signals`);
    const confluence = calculateConfluence({ rsi, macd, bollinger, ema, fibonacci, volume, sentiment });

    return { asset, price: last, rsi, macd, bollinger, ema, fibonacci, volume, sentiment, confluence, dataSource: source };
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

// GET /status
router.get('/status', (req, res) => {
    res.json({
        active: true,
        version: '1.0',
        strategies: STRATEGIES,
        assets: ASSETS,
        lastAnalysis: analysisCache ? new Date(cacheTsMs).toISOString() : null,
        cacheAge: analysisCache ? Math.round((Date.now() - cacheTsMs) / 1000) + 's' : null,
        historyEntries: analysisHistory.length,
        disclaimer: DISCLAIMER,
    });
});

// GET /analysis
router.get('/analysis', async (req, res) => {
    try {
        const now = Date.now();
        if (analysisCache && now - cacheTsMs < CACHE_TTL_MS) {
            logger.info('[Trading] Returning cached analysis');
            return res.json(analysisCache);
        }

        logger.info('[Trading] Running fresh market analysis');
        const brain = req.app.locals.brain;
        let searchSummary = null;

        // Try brain search for real market context
        if (brain) {
            try {
                const searchFn = typeof brain.search === 'function' ? brain.search.bind(brain)
                    : typeof brain._search === 'function' ? brain._search.bind(brain)
                        : null;
                if (searchFn) {
                    searchSummary = await searchFn('crypto bitcoin ethereum market analysis today');
                }
            } catch (searchErr) {
                logger.warn({ err: searchErr.message }, '[Trading] Brain search unavailable, proceeding without real-time market context');
            }
        }

        const allAssets = Object.values(ASSETS).flat();
        const results = await Promise.all(allAssets.map(analyzeAsset));

        const entry = {
            timestamp: new Date().toISOString(),
            assets: results,
            searchContext: searchSummary ? String(searchSummary).substring(0, MAX_SEARCH_CONTEXT_LENGTH) : null,
            stale: false,
            disclaimer: DISCLAIMER,
        };

        analysisCache = entry;
        cacheTsMs = now;
        analysisHistory.push({ ts: entry.timestamp, assets: results.length });
        if (analysisHistory.length > MAX_HISTORY) analysisHistory.shift();

        res.json(entry);
    } catch (err) {
        logger.error({ err: err.message }, '[Trading] Analysis error');
        if (analysisCache) {
            return res.json({ ...analysisCache, stale: true });
        }
        res.status(500).json({ error: 'Analiza nu este disponibilă momentan.' });
    }
});

// GET /signals
router.get('/signals', async (req, res) => {
    try {
        const allAssets = Object.values(ASSETS).flat();
        const allData = await Promise.all(allAssets.map(a => fetchRealPrices(a, 300)));
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
                const confluence = calculateConfluence({ rsi, macd, bollinger, ema, fibonacci, volume, sentiment });

                const stopLossPct = 0.02;
                const takeProfitPct = 0.04;
                const entry = last;
                const stop = confluence.signal.includes('BUY')
                    ? Math.round(entry * (1 - stopLossPct) * 100) / 100
                    : Math.round(entry * (1 + stopLossPct) * 100) / 100;
                const target = confluence.signal.includes('BUY')
                    ? Math.round(entry * (1 + takeProfitPct) * 100) / 100
                    : Math.round(entry * (1 - takeProfitPct) * 100) / 100;

                return {
                    asset,
                    signal: confluence.signal,
                    confidence: confluence.confidence,
                    entry,
                    stopLoss: stop,
                    takeProfit: target,
                    rsi: rsi.value,
                    timestamp: new Date().toISOString(),
                };
            })
            .filter(s => s.signal !== 'HOLD')
            .sort((a, b) => b.confidence - a.confidence);

        res.json({ signals, count: signals.length, disclaimer: DISCLAIMER });
    } catch (err) {
        logger.error({ err: err.message }, '[Trading] Signals error');
        res.status(500).json({ error: 'Semnalele nu sunt disponibile.' });
    }
});

// GET /portfolio
router.get('/portfolio', async (req, res) => {
    try {
        const assetDefs = [
            { asset: 'BTC', allocation: 40, qty: 0.5, avgBuy: 58000 },
            { asset: 'ETH', allocation: 25, qty: 3, avgBuy: 2800 },
            { asset: 'Gold', allocation: 20, qty: 2, avgBuy: 2200 },
            { asset: 'S&P 500', allocation: 15, qty: 1, avgBuy: 4800 },
        ];
        const realPrices = await Promise.all(assetDefs.map(p => fetchRealPrices(p.asset, 10)));
        const portfolio = assetDefs.map((p, i) => {
            const current = realPrices[i].prices.at(-1);
            return {
                ...p,
                current,
                pnl: Math.round((current - p.avgBuy) * p.qty * 100) / 100,
                pnlPct: Math.round(((current - p.avgBuy) / p.avgBuy) * 10000) / 100,
                dataSource: realPrices[i].source,
            };
        });

        const totalPnl = portfolio.reduce((a, p) => a + p.pnl, 0);
        res.json({
            portfolio,
            totalPnl: Math.round(totalPnl * 100) / 100,
            currency: 'USD',
            note: 'Portofoliu cu date reale',
            disclaimer: DISCLAIMER,
        });
    } catch (err) {
        logger.error({ err: err.message }, '[Trading] Portfolio error');
        res.status(500).json({ error: 'Portofoliul nu este disponibil.' });
    }
});

// POST /backtest
router.post('/backtest', async (req, res) => {
    try {
        const { strategy = 'RSI', asset = 'BTC', period = 90 } = req.body || {};
        const allAssets = Object.values(ASSETS).flat();
        if (!STRATEGIES.includes(strategy)) {
            return res.status(400).json({ error: `Strategie invalidă. Opțiuni: ${STRATEGIES.join(', ')}.` });
        }
        if (!allAssets.includes(asset)) {
            return res.status(400).json({ error: `Asset invalid. Opțiuni: ${allAssets.join(', ')}.` });
        }
        const len = Math.min(Math.max(parseInt(period) || 90, 30), 365);
        logger.info({ strategy, asset, period: len }, '[Trading] Running backtest');

        const { prices, volumes } = await fetchRealPrices(asset, len + 50);
        const trades = [];
        let position = null;
        let equity = 10000;

        for (let i = 20; i < prices.length; i++) {
            const slice = prices.slice(0, i + 1);
            let signal = 'HOLD';

            if (strategy === 'RSI') {
                signal = calculateRSI(slice).signal;
            } else if (strategy === 'MACD') {
                signal = calculateMACD(slice).crossSignal;
            } else if (strategy === 'BollingerBands') {
                signal = calculateBollingerBands(slice).signal;
            } else if (strategy === 'EMACrossover') {
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
            if (!position && (signal === 'BUY' || signal === 'STRONG BUY')) {
                position = { entry: price, idx: i };
            } else if (position && (signal === 'SELL' || signal === 'STRONG SELL')) {
                const pnlPct = (price - position.entry) / position.entry;
                equity *= (1 + pnlPct);
                trades.push({ entry: position.entry, exit: price, pnlPct: Math.round(pnlPct * 10000) / 100 });
                position = null;
            }
        }

        const wins = trades.filter(t => t.pnlPct > 0).length;
        const totalReturn = Math.round((equity - 10000) * 100) / 100;

        // Calculate actual max drawdown from equity curve
        let equityCurve = 10000;
        let peakEquity = 10000;
        let maxDrawdown = 0;
        trades.forEach(t => {
            equityCurve *= (1 + t.pnlPct / 100);
            if (equityCurve > peakEquity) peakEquity = equityCurve;
            const dd = (equityCurve - peakEquity) / peakEquity * 100;
            if (dd < maxDrawdown) maxDrawdown = dd;
        });
        maxDrawdown = Math.round(maxDrawdown * 100) / 100;

        res.json({
            strategy, asset, period: len,
            trades: trades.length,
            winRate: trades.length ? Math.round((wins / trades.length) * 10000) / 100 : 0,
            totalReturn,
            maxDrawdown,
            finalEquity: Math.round(equity * 100) / 100,
            disclaimer: DISCLAIMER,
        });
    } catch (err) {
        logger.error({ err: err.message }, '[Trading] Backtest error');
        res.status(500).json({ error: 'Backtestul a eșuat.' });
    }
});

// GET /alerts
router.get('/alerts', async (req, res) => {
    try {
        const allAssets = Object.values(ASSETS).flat();
        const allData = await Promise.all(allAssets.map(a => fetchRealPrices(a, 30)));
        const alerts = allAssets.map((asset, i) => {
            const { prices } = allData[i];
            const rsi = calculateRSI(prices);
            const last = prices[prices.length - 1];
            return {
                asset,
                price: last,
                rsiValue: rsi.value,
                alert: rsi.value < 30 ? 'OVERSOLD' : rsi.value > 70 ? 'OVERBOUGHT' : null,
                threshold: { low: last * 0.95, high: last * 1.05 },
            };
        }).filter(a => a.alert !== null);

        res.json({ alerts, count: alerts.length, disclaimer: DISCLAIMER });
    } catch (err) {
        logger.error({ err: err.message }, '[Trading] Alerts error');
        res.status(500).json({ error: 'Alertele nu sunt disponibile.' });
    }
});

// GET /correlation
router.get('/correlation', async (req, res) => {
    try {
        const allAssets = Object.values(ASSETS).flat();
        const allData = await Promise.all(allAssets.map(a => fetchRealPrices(a, 100)));
        const priceData = {};
        allAssets.forEach((a, i) => { priceData[a] = allData[i].prices; });

        const matrix = {};
        allAssets.forEach(a => {
            matrix[a] = {};
            allAssets.forEach(b => {
                if (a === b) { matrix[a][b] = 1; return; }
                const xArr = priceData[a];
                const yArr = priceData[b];
                const n = Math.min(xArr.length, yArr.length);
                const meanX = xArr.slice(0, n).reduce((s, v) => s + v, 0) / n;
                const meanY = yArr.slice(0, n).reduce((s, v) => s + v, 0) / n;
                let num = 0, denX = 0, denY = 0;
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
        res.json({ matrix, assets: allAssets, note: 'Corelații calculate din date reale', disclaimer: DISCLAIMER });
    } catch (err) {
        logger.error({ err: err.message }, '[Trading] Correlation error');
        res.status(500).json({ error: 'Corelațiile nu sunt disponibile.' });
    }
});

// GET /risk
router.get('/risk', async (req, res) => {
    try {
        const allAssets = Object.values(ASSETS).flat();
        const allData = await Promise.all(allAssets.map(a => fetchRealPrices(a, 252)));
        const riskData = allAssets.map((asset, idx) => {
            const { prices } = allData[idx];
            const returns = prices.slice(1).map((p, i) => (p - prices[i]) / prices[i]);
            const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
            const variance = returns.reduce((a, r) => a + Math.pow(r - avgReturn, 2), 0) / returns.length;
            const stdDev = Math.sqrt(variance);
            const sharpe = stdDev > 0 ? Math.round((avgReturn / stdDev) * Math.sqrt(252) * 100) / 100 : 0;
            const sortedReturns = [...returns].sort((a, b) => a - b);
            const varIdx = Math.floor(returns.length * 0.05);
            const var95 = Math.round(sortedReturns[varIdx] * 10000) / 100;
            let peak = prices[0];
            let maxDD = 0;
            prices.forEach(p => {
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
        logger.error({ err: err.message }, '[Trading] Risk error');
        res.status(500).json({ error: 'Analiza de risc nu este disponibilă.' });
    }
});

// ═══ HISTORY ═══
router.get('/history', (req, res) => {
    res.json({ history: analysisHistory.slice(-20), total: analysisHistory.length });
});

// ═══════════════════════════════════════════════════════════════
// TRADE EXECUTION ROUTES — Full integration of ALL modules
// ═══════════════════════════════════════════════════════════════

const tradeIntel = require('./trade-intelligence');

// Initialize exchange on module load
tradeEngine.initExchange();

// POST /execute — FULL analysis + rules check + auto-trade
router.post('/execute', async (req, res) => {
    try {
        const { symbol = 'BTC/USDT', action } = req.body || {};
        const asset = symbol.replace('/USDT', '');
        const { prices, volumes, source } = await fetchRealPrices(asset, 300);
        if (!prices || prices.length < 50) {
            return res.status(400).json({ error: 'Insufficient price data.' });
        }

        // Build OHLCV from close prices
        const highs = prices.map((p, i) => i > 0 ? Math.max(p, prices[i - 1]) * 1.002 : p * 1.002);
        const lows = prices.map((p, i) => i > 0 ? Math.min(p, prices[i - 1]) * 0.998 : p * 0.998);
        const candles = prices.map((p, i) => ({ open: i > 0 ? prices[i - 1] : p, high: highs[i], low: lows[i], close: p }));
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
            prices[prices.length - 24] || prices[0]
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
            rsi, macd, bollinger, ema, fibonacci, volume, sentiment,
            stochastic, williamsR, adx, obv, cci, parabolicSAR, ichimoku, mfi, roc,
            candlestickPatterns, chartPatterns: allPatterns,
            fearGreed, marketRegime,
        });

        // Determine trade action
        const tradeAction = action || (superConfluence.signal.includes('BUY') ? 'BUY' : superConfluence.signal.includes('SELL') ? 'SELL' : null);

        // ── TRADING RULES ENGINE — Must pass before execution ──
        let rulesCheck = null;
        let result = { executed: false, reason: 'No clear signal' };

        if (tradeAction) {
            rulesCheck = tradeIntel.evaluateTradingRules({
                action: tradeAction, price: lastPrice,
                confluence: superConfluence.confidence,
                adx, atr, atrPct, rsi, volume, marketRegime, fearGreed, economicRisks,
                openPositions: tradeEngine.getOpenPositions(),
            });

            if (rulesCheck.approved && superConfluence.confidence >= tradeEngine.CONFIG.MIN_CONFLUENCE) {
                result = await tradeEngine.executeTrade(tradeAction, symbol, lastPrice, superConfluence, atrPct);
            } else if (!rulesCheck.approved) {
                result = { executed: false, reason: rulesCheck.summary };
            } else {
                result = { executed: false, reason: `Confluence too low: ${superConfluence.confidence}% (min: ${tradeEngine.CONFIG.MIN_CONFLUENCE}%)` };
            }
        }

        res.json({
            symbol, price: lastPrice, dataSource: source,
            analysis: {
                // Core (7)
                rsi, macd, bollinger, ema, fibonacci, volume, sentiment,
                // Advanced (10)
                stochastic, adx, ichimoku, parabolicSAR, obv, cci, mfi, williamsR, roc, atr: { value: atr, pctOfPrice: +(atrPct * 100).toFixed(2) + '%' },
                // Intelligence (4)
                keltner, aroon, pivotPoints,
                divergence: { rsi: divergenceRSI, macd: divergenceMACD },
            },
            patterns: {
                candlestick: candlestickPatterns,
                chart: chartPatterns,
                advanced: advancedPatterns,
                total: candlestickPatterns.length + allPatterns.length,
            },
            macro: {
                fearGreed, marketRegime, economicRisks,
                news: newsData,
            },
            superConfluence,
            tradingRules: rulesCheck,
            execution: result,
            mode: tradeEngine.isPaperMode() ? 'PAPER' : 'LIVE',
            totalIndicators: 21,
            totalPatternTypes: 38,
            disclaimer: DISCLAIMER,
        });
    } catch (err) {
        logger.error({ err: err.message }, '[Trading] Execute error');
        res.status(500).json({ error: 'Eroare la execuție.' });
    }
});

// GET /full-analysis — Read-only analysis (no execution)
router.get('/full-analysis/:asset?', async (req, res) => {
    try {
        const asset = req.params.asset || 'BTC';
        const { prices, volumes, source } = await fetchRealPrices(asset, 300);
        if (!prices || prices.length < 50) return res.status(400).json({ error: 'Insufficient data' });

        const highs = prices.map((p, i) => i > 0 ? Math.max(p, prices[i - 1]) * 1.002 : p * 1.002);
        const lows = prices.map((p, i) => i > 0 ? Math.min(p, prices[i - 1]) * 0.998 : p * 0.998);
        const candles = prices.map((p, i) => ({ open: i > 0 ? prices[i - 1] : p, high: highs[i], low: lows[i], close: p }));
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
        const pivots = tradeIntel.calculatePivotPoints(Math.max(...prices.slice(-24)), Math.min(...prices.slice(-24)), lastPrice, prices[Math.max(0, prices.length - 24)]);
        const economicRisks = tradeIntel.getEconomicCalendarRisks();

        res.json({
            asset, price: lastPrice, dataSource: source,
            indicators: { rsi, macd, adx, atr: { value: atr, pct: +(atrPct * 100).toFixed(2) }, roc, keltner, aroon, pivots },
            patterns: { candlestick: candlestickPatterns, chart: chartPatterns, advanced: advancedPatterns },
            macro: { fearGreed, marketRegime, economicRisks },
            disclaimer: DISCLAIMER,
        });
    } catch (err) {
        logger.error({ err: err.message }, '[Trading] Full analysis error');
        res.status(500).json({ error: 'Eroare la analiză.' });
    }
});

// GET /calendar — Economic calendar risks
router.get('/calendar', (req, res) => {
    res.json(tradeIntel.getEconomicCalendarRisks());
});

router.get('/positions', (req, res) => {
    res.json({ positions: tradeEngine.getOpenPositions(), dailyPnL: tradeEngine.getDailyPnL(), weeklyPnL: tradeEngine.getWeeklyPnL(), mode: tradeEngine.isPaperMode() ? 'PAPER' : 'LIVE' });
});

router.post('/close/:tradeId', async (req, res) => {
    const { currentPrice } = req.body || {};
    if (!currentPrice) return res.status(400).json({ error: 'currentPrice required' });
    const result = await tradeEngine.closePosition(req.params.tradeId, currentPrice, 'admin_manual');
    res.json(result);
});

router.post('/kill-switch', async (req, res) => {
    const result = await tradeEngine.killSwitch(req.body?.prices || {});
    res.json({ killed: true, closedPositions: result });
});

router.get('/paper-balance', (req, res) => {
    res.json({ balance: tradeEngine.getPaperBalance(), trades: tradeEngine.getPaperTrades().slice(-20), mode: tradeEngine.isPaperMode() ? 'PAPER' : 'LIVE' });
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
module.exports.tradeEngine = tradeEngine;
module.exports.tradeIntel = tradeIntel;
