'use strict';

// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — TRADING BOT (Admin Only)
// Technical analysis, signals, backtesting, risk assessment
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('./logger');

const router = express.Router();

const DISCLAIMER = 'INFORMATIV — Nu constituie sfat financiar. KelionAI nu garantează câștiguri.';
const MAX_SEARCH_CONTEXT_LENGTH = 500;

const ASSETS = {
    crypto:      ['BTC', 'ETH', 'SOL'],
    forex:       ['EUR/USD', 'GBP/USD'],
    indices:     ['S&P 500', 'NASDAQ'],
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
        '0':    Math.round(high * 100) / 100,
        '23.6': Math.round((high - 0.236 * diff) * 100) / 100,
        '38.2': Math.round((high - 0.382 * diff) * 100) / 100,
        '50':   Math.round((high - 0.5   * diff) * 100) / 100,
        '61.8': Math.round((high - 0.618 * diff) * 100) / 100,
        '78.6': Math.round((high - 0.786 * diff) * 100) / 100,
        '100':  Math.round(low  * 100) / 100,
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
        rsi:       signals.rsi?.signal,
        macd:      signals.macd?.crossSignal,
        bollinger: signals.bollinger?.signal,
        ema:       signals.ema?.signal,
        fibonacci: signals.fibonacci?.signal,
        volume:    signals.volume?.signal,
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
    if (normalized >= 0.6)  signal = 'STRONG BUY';
    else if (normalized >= 0.2)  signal = 'BUY';
    else if (normalized <= -0.6) signal = 'STRONG SELL';
    else if (normalized <= -0.2) signal = 'SELL';

    return { signal, confidence };
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

/** Generate simulated OHLCV data for an asset when live data unavailable. */
function generateSimulatedPrices(asset, length = 300) {
    const basePrices = {
        BTC: 65000, ETH: 3200, SOL: 140,
        'EUR/USD': 1.085, 'GBP/USD': 1.27,
        'S&P 500': 5200, NASDAQ: 16800,
        Gold: 2330, Oil: 83,
    };
    const base = basePrices[asset] || 100;
    const volatility = base * 0.02;
    const prices = [];
    const volumes = [];
    let price = base;
    for (let i = 0; i < length; i++) {
        price += (Math.random() - 0.5) * volatility;
        price = Math.max(price, base * 0.5);
        prices.push(Math.round(price * 100) / 100);
        volumes.push(Math.round(1000 + Math.random() * 9000));
    }
    return { prices, volumes };
}

/** Run all technical indicators on an asset. */
function analyzeAsset(asset) {
    const { prices, volumes } = generateSimulatedPrices(asset, 300);
    const high = Math.max(...prices);
    const low  = Math.min(...prices);
    const last = prices[prices.length - 1];

    const rsi       = calculateRSI(prices);
    const macd      = calculateMACD(prices);
    const bollinger = calculateBollingerBands(prices);
    const ema       = calculateEMACrossover(prices);
    const fibonacci = calculateFibonacci(high, low);
    const volume    = analyzeVolume(prices, volumes);
    const sentiment = analyzeSentiment(`${asset} market analysis trading signals`);
    const confluence = calculateConfluence({ rsi, macd, bollinger, ema, fibonacci, volume, sentiment });

    return { asset, price: last, rsi, macd, bollinger, ema, fibonacci, volume, sentiment, confluence };
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
        const results = allAssets.map(analyzeAsset);

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
router.get('/signals', (req, res) => {
    try {
        const allAssets = Object.values(ASSETS).flat();
        const signals = allAssets
            .map(asset => {
                const { prices, volumes } = generateSimulatedPrices(asset, 300);
                const high = Math.max(...prices);
                const low  = Math.min(...prices);
                const last = prices[prices.length - 1];
                const rsi       = calculateRSI(prices);
                const macd      = calculateMACD(prices);
                const bollinger = calculateBollingerBands(prices);
                const ema       = calculateEMACrossover(prices);
                const fibonacci = calculateFibonacci(high, low);
                const volume    = analyzeVolume(prices, volumes);
                const sentiment = analyzeSentiment(`${asset} market`);
                const confluence = calculateConfluence({ rsi, macd, bollinger, ema, fibonacci, volume, sentiment });

                const stopLossPct = 0.02;
                const takeProfitPct = 0.04;
                const entry = last;
                const stop  = confluence.signal.includes('BUY')
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
router.get('/portfolio', (req, res) => {
    const assetDefs = [
        { asset: 'BTC',     allocation: 40, qty: 0.5, avgBuy: 58000 },
        { asset: 'ETH',     allocation: 25, qty: 3,   avgBuy: 2800  },
        { asset: 'Gold',    allocation: 20, qty: 2,   avgBuy: 2200  },
        { asset: 'S&P 500', allocation: 15, qty: 1,   avgBuy: 4800  },
    ];
    const portfolio = assetDefs.map(p => {
        const current = generateSimulatedPrices(p.asset, 10).prices.at(-1);
        return {
            ...p,
            current,
            pnl: Math.round((current - p.avgBuy) * p.qty * 100) / 100,
            pnlPct: Math.round(((current - p.avgBuy) / p.avgBuy) * 10000) / 100,
        };
    });

    const totalPnl = portfolio.reduce((a, p) => a + p.pnl, 0);
    res.json({
        portfolio,
        totalPnl: Math.round(totalPnl * 100) / 100,
        currency: 'USD',
        note: 'Portofoliu simulat — valori demo',
        disclaimer: DISCLAIMER,
    });
});

// POST /backtest
router.post('/backtest', (req, res) => {
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

        const { prices, volumes } = generateSimulatedPrices(asset, len + 50);
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
router.get('/alerts', (req, res) => {
    const alerts = Object.values(ASSETS).flat().map(asset => {
        const { prices } = generateSimulatedPrices(asset, 30);
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
});

// GET /correlation
router.get('/correlation', (req, res) => {
    const allAssets = Object.values(ASSETS).flat();
    const priceData = {};
    allAssets.forEach(a => {
        priceData[a] = generateSimulatedPrices(a, 100).prices;
    });

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
    res.json({ matrix, assets: allAssets, note: 'Corelații calculate din date simulate', disclaimer: DISCLAIMER });
});

// GET /risk
router.get('/risk', (req, res) => {
    const allAssets = Object.values(ASSETS).flat();
    const riskData = allAssets.map(asset => {
        const { prices } = generateSimulatedPrices(asset, 252);
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
});

// ═══ HISTORY ═══
router.get('/history', (req, res) => {
    res.json({ history: analysisHistory.slice(-20), total: analysisHistory.length });
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
module.exports.generateSimulatedPrices = generateSimulatedPrices;
