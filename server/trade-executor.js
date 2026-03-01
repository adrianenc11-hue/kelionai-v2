'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// KelionAI v2 — TRADE EXECUTOR ENGINE (Expert Level)
// Full pattern recognition, advanced indicators, Binance execution
// Macro intelligence: Fear & Greed, Market Regime, Volatility Guard
// ═══════════════════════════════════════════════════════════════════════════

const ccxt = require('ccxt');
const logger = require('./logger');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
    MAX_RISK_PCT: 0.02,
    MIN_CONFLUENCE: 60,
    DEFAULT_STOP_LOSS_PCT: 0.02,
    DEFAULT_TAKE_PROFIT_PCT: 0.04,
    MAX_OPEN_POSITIONS: 3,
    MAX_DAILY_TRADES: 10,
    MAX_DAILY_LOSS_PCT: 0.05,
    MAX_WEEKLY_LOSS_PCT: 0.10,
    TRAILING_STOP_ACTIVATION: 0.02,
    TRAILING_STOP_DISTANCE: 0.01,
    MIN_VOLUME_RATIO: 1.2,
    COOLDOWN_AFTER_LOSS_MS: 300000,
    EXTREME_FEAR_THRESHOLD: 20,
    EXTREME_GREED_THRESHOLD: 80,
    MAX_VOLATILITY_PCT: 0.08,
    CORRELATED_ASSETS: { BTC: ['ETH', 'SOL'], ETH: ['BTC', 'SOL'], SOL: ['BTC', 'ETH'] },
};

// ═══════════════════════════════════════════════════════════════════════════
// 0. MACRO INTELLIGENCE — Fear & Greed, Market Regime, Volatility Guard
// ═══════════════════════════════════════════════════════════════════════════

let fearGreedCache = { value: null, label: null, ts: 0 };
let weeklyPnL = 0;
let weekStart = new Date().toISOString().slice(0, 10);

async function fetchFearAndGreed() {
    if (fearGreedCache.value !== null && Date.now() - fearGreedCache.ts < 30 * 60 * 1000) {
        return fearGreedCache;
    }
    try {
        const r = await fetch('https://api.alternative.me/fng/?limit=1');
        if (r.ok) {
            const d = await r.json();
            if (d.data?.[0]) {
                const value = parseInt(d.data[0].value);
                const label = d.data[0].value_classification;
                let signal = 'HOLD';
                if (value <= CONFIG.EXTREME_FEAR_THRESHOLD) signal = 'BUY';
                else if (value >= CONFIG.EXTREME_GREED_THRESHOLD) signal = 'SELL';
                else if (value < 40) signal = 'BUY';
                else if (value > 60) signal = 'SELL';
                fearGreedCache = { value, label, signal, ts: Date.now(), source: 'alternative.me' };
                logger.info({ component: 'Macro', value, label, signal }, `🧠 Fear & Greed: ${value} (${label}) → ${signal}`);
                return fearGreedCache;
            }
        }
    } catch (e) {
        logger.warn({ component: 'Macro', err: e.message }, 'Fear & Greed fetch failed');
    }
    return { value: 50, label: 'Neutral', signal: 'HOLD', source: 'fallback' };
}

function detectMarketRegime(adx, atrPct, roc) {
    const adxVal = adx?.adx || 20;
    const absRoc = Math.abs(roc?.value || 0);
    if (adxVal > 30 && absRoc > 3) {
        return { regime: 'STRONG_TREND', tradeable: true, strategy: 'Follow the trend — EMA crossover + MACD', riskMultiplier: 1.0 };
    }
    if (atrPct > CONFIG.MAX_VOLATILITY_PCT) {
        return { regime: 'VOLATILE_CHAOS', tradeable: false, strategy: 'DO NOT TRADE — volatility too high', riskMultiplier: 0 };
    }
    if (adxVal > 20 && adxVal <= 30) {
        return { regime: 'WEAK_TREND', tradeable: true, strategy: 'Trade cautiously — half position', riskMultiplier: 0.5 };
    }
    return { regime: 'RANGING', tradeable: true, strategy: 'Mean reversion — Bollinger + RSI', riskMultiplier: 0.5 };
}

function checkCorrelationBlock(symbol, positions) {
    const asset = symbol.replace('/USDT', '');
    const correlated = CONFIG.CORRELATED_ASSETS[asset] || [];
    if (correlated.length === 0) return { blocked: false };
    const openAssets = positions.map(p => p.symbol.replace('/USDT', ''));
    const conflicting = correlated.filter(c => openAssets.includes(c));
    if (conflicting.length >= 2) {
        return { blocked: true, reason: `Too many correlated positions: ${conflicting.join(', ')} already open` };
    }
    return { blocked: false };
}

function volatilityAdjustedSize(baseSize, atrPct) {
    if (atrPct <= 0.01) return baseSize;
    if (atrPct <= 0.03) return baseSize * 0.8;
    if (atrPct <= 0.05) return baseSize * 0.5;
    if (atrPct <= 0.08) return baseSize * 0.25;
    return 0;
}

function checkWeeklyReset() {
    const today = new Date().toISOString().slice(0, 10);
    if (new Date().getDay() === 1 && today !== weekStart) { weeklyPnL = 0; weekStart = today; }
}

function recordWeeklyPnL(pnl) { checkWeeklyReset(); weeklyPnL += pnl; }

function isWeeklyLimitHit(portfolioValue) {
    checkWeeklyReset();
    return weeklyPnL < -portfolioValue * CONFIG.MAX_WEEKLY_LOSS_PCT;
}

// ═══════════════════════════════════════════════════════════════════════════
// I. CANDLESTICK PATTERN RECOGNITION (30+ patterns)
// ═══════════════════════════════════════════════════════════════════════════

function parseCandle(c) {
    const body = Math.abs(c.close - c.open);
    const range = c.high - c.low;
    const upperShadow = c.high - Math.max(c.open, c.close);
    const lowerShadow = Math.min(c.open, c.close) - c.low;
    const isBullish = c.close > c.open;
    const isBearish = c.close < c.open;
    const bodyPct = range > 0 ? body / range : 0;
    return { body, range, upperShadow, lowerShadow, isBullish, isBearish, bodyPct, ...c };
}

function detectCandlestickPatterns(candles) {
    if (!candles || candles.length < 5) return [];
    const patterns = [];
    const n = candles.length;
    const c = parseCandle(candles[n - 1]);
    const p1 = n >= 2 ? parseCandle(candles[n - 2]) : null;
    const p2 = n >= 3 ? parseCandle(candles[n - 3]) : null;

    // Single candle
    if (c.bodyPct < 0.1 && c.range > 0) {
        if (c.upperShadow > c.body * 2 && c.lowerShadow > c.body * 2) patterns.push({ pattern: 'Doji', type: 'neutral', strength: 1 });
        else if (c.upperShadow > c.body * 3 && c.lowerShadow < c.body) patterns.push({ pattern: 'Gravestone Doji', type: 'bearish', strength: 2 });
        else if (c.lowerShadow > c.body * 3 && c.upperShadow < c.body) patterns.push({ pattern: 'Dragonfly Doji', type: 'bullish', strength: 2 });
    }
    if (c.lowerShadow >= c.body * 2 && c.upperShadow < c.body * 0.5 && c.bodyPct < 0.4 && c.bodyPct > 0.05) patterns.push({ pattern: 'Hammer', type: 'bullish', strength: 2 });
    if (c.upperShadow >= c.body * 2 && c.lowerShadow < c.body * 0.5 && c.bodyPct < 0.4 && c.bodyPct > 0.05) patterns.push({ pattern: 'Inverted Hammer', type: 'bullish', strength: 1 });
    if (c.lowerShadow >= c.body * 2 && c.upperShadow < c.body * 0.5 && c.bodyPct < 0.4 && p1 && p1.isBullish) patterns.push({ pattern: 'Hanging Man', type: 'bearish', strength: 2 });
    if (c.upperShadow >= c.body * 2 && c.lowerShadow < c.body * 0.5 && c.bodyPct < 0.4 && p1 && p1.isBullish) patterns.push({ pattern: 'Shooting Star', type: 'bearish', strength: 2 });
    if (c.bodyPct > 0.95) patterns.push({ pattern: c.isBullish ? 'Bullish Marubozu' : 'Bearish Marubozu', type: c.isBullish ? 'bullish' : 'bearish', strength: 2 });
    if (c.bodyPct > 0.1 && c.bodyPct < 0.3 && c.upperShadow > c.body && c.lowerShadow > c.body) patterns.push({ pattern: 'Spinning Top', type: 'neutral', strength: 1 });

    // Two candle
    if (p1) {
        if (p1.isBearish && c.isBullish && c.open <= p1.close && c.close >= p1.open && c.body > p1.body) patterns.push({ pattern: 'Bullish Engulfing', type: 'bullish', strength: 3 });
        if (p1.isBullish && c.isBearish && c.open >= p1.close && c.close <= p1.open && c.body > p1.body) patterns.push({ pattern: 'Bearish Engulfing', type: 'bearish', strength: 3 });
        if (p1.isBearish && c.isBullish && c.body < p1.body && c.open > p1.close && c.close < p1.open) patterns.push({ pattern: 'Bullish Harami', type: 'bullish', strength: 1 });
        if (p1.isBullish && c.isBearish && c.body < p1.body && c.open < p1.close && c.close > p1.open) patterns.push({ pattern: 'Bearish Harami', type: 'bearish', strength: 1 });
        if (p1.isBearish && c.isBullish && c.open < p1.low && c.close > (p1.open + p1.close) / 2 && c.close < p1.open) patterns.push({ pattern: 'Piercing Line', type: 'bullish', strength: 2 });
        if (p1.isBullish && c.isBearish && c.open > p1.high && c.close < (p1.open + p1.close) / 2 && c.close > p1.open) patterns.push({ pattern: 'Dark Cloud Cover', type: 'bearish', strength: 2 });
        if (Math.abs(p1.low - c.low) < c.range * 0.05 && p1.isBearish && c.isBullish) patterns.push({ pattern: 'Tweezer Bottom', type: 'bullish', strength: 2 });
        if (Math.abs(p1.high - c.high) < c.range * 0.05 && p1.isBullish && c.isBearish) patterns.push({ pattern: 'Tweezer Top', type: 'bearish', strength: 2 });
    }

    // Three candle
    if (p1 && p2) {
        if (p2.isBearish && p1.bodyPct < 0.2 && c.isBullish && c.close > (p2.open + p2.close) / 2) patterns.push({ pattern: 'Morning Star', type: 'bullish', strength: 3 });
        if (p2.isBullish && p1.bodyPct < 0.2 && c.isBearish && c.close < (p2.open + p2.close) / 2) patterns.push({ pattern: 'Evening Star', type: 'bearish', strength: 3 });
        if (p2.isBullish && p1.isBullish && c.isBullish && p1.close > p2.close && c.close > p1.close && p2.bodyPct > 0.5 && p1.bodyPct > 0.5 && c.bodyPct > 0.5) patterns.push({ pattern: 'Three White Soldiers', type: 'bullish', strength: 3 });
        if (p2.isBearish && p1.isBearish && c.isBearish && p1.close < p2.close && c.close < p1.close && p2.bodyPct > 0.5 && p1.bodyPct > 0.5 && c.bodyPct > 0.5) patterns.push({ pattern: 'Three Black Crows', type: 'bearish', strength: 3 });
        if (p2.isBearish && p1.isBullish && p1.body < p2.body && c.isBullish && c.close > p2.open) patterns.push({ pattern: 'Three Inside Up', type: 'bullish', strength: 2 });
        if (p2.isBullish && p1.isBearish && p1.body < p2.body && c.isBearish && c.close < p2.open) patterns.push({ pattern: 'Three Inside Down', type: 'bearish', strength: 2 });
        if (p2.isBearish && p1.bodyPct < 0.05 && p1.high < p2.low && c.isBullish && c.low > p1.high) patterns.push({ pattern: 'Abandoned Baby (Bull)', type: 'bullish', strength: 3 });
        if (p2.isBullish && p1.bodyPct < 0.05 && p1.low > p2.high && c.isBearish && c.high < p1.low) patterns.push({ pattern: 'Abandoned Baby (Bear)', type: 'bearish', strength: 3 });
    }
    return patterns;
}

// ═══════════════════════════════════════════════════════════════════════════
// II. ADVANCED INDICATORS
// ═══════════════════════════════════════════════════════════════════════════

function calculateStochastic(highs, lows, closes, kPeriod = 14, dPeriod = 3) {
    if (closes.length < kPeriod) return { k: 50, d: 50, signal: 'HOLD' };
    const kValues = [];
    for (let i = kPeriod - 1; i < closes.length; i++) {
        const hh = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
        const ll = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
        kValues.push(hh !== ll ? ((closes[i] - ll) / (hh - ll)) * 100 : 50);
    }
    const k = kValues[kValues.length - 1];
    const dValues = [];
    for (let i = dPeriod - 1; i < kValues.length; i++) {
        dValues.push(kValues.slice(i - dPeriod + 1, i + 1).reduce((a, b) => a + b, 0) / dPeriod);
    }
    const d = dValues[dValues.length - 1] || k;
    let signal = 'HOLD';
    if (k < 20 && d < 20) signal = 'BUY';
    else if (k > 80 && d > 80) signal = 'SELL';
    else if (k > d && kValues.length >= 2 && dValues.length >= 2 && kValues[kValues.length - 2] <= dValues[dValues.length - 2]) signal = 'BUY';
    else if (k < d && kValues.length >= 2 && dValues.length >= 2 && kValues[kValues.length - 2] >= dValues[dValues.length - 2]) signal = 'SELL';
    return { k: Math.round(k * 100) / 100, d: Math.round(d * 100) / 100, signal };
}

function calculateWilliamsR(highs, lows, closes, period = 14) {
    if (closes.length < period) return { value: -50, signal: 'HOLD' };
    const i = closes.length - 1;
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    const value = hh !== ll ? ((hh - closes[i]) / (hh - ll)) * -100 : -50;
    let signal = 'HOLD';
    if (value < -80) signal = 'BUY'; else if (value > -20) signal = 'SELL';
    return { value: Math.round(value * 100) / 100, signal };
}

function calculateATR(highs, lows, closes, period = 14) {
    if (closes.length < 2) return 0;
    const trs = [];
    for (let i = 1; i < closes.length; i++) {
        trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    }
    if (trs.length < period) return trs.reduce((a, b) => a + b, 0) / trs.length;
    let atr = trs.slice(0, period).reduce((a, b) => a + b, 0) / period;
    for (let i = period; i < trs.length; i++) atr = (atr * (period - 1) + trs[i]) / period;
    return Math.round(atr * 10000) / 10000;
}

function calculateADX(highs, lows, closes, period = 14) {
    if (closes.length < period + 1) return { adx: 25, diPlus: 25, diMinus: 25, signal: 'HOLD' };
    const dmPlus = [], dmMinus = [], tr = [];
    for (let i = 1; i < closes.length; i++) {
        const up = highs[i] - highs[i - 1]; const down = lows[i - 1] - lows[i];
        dmPlus.push(up > down && up > 0 ? up : 0); dmMinus.push(down > up && down > 0 ? down : 0);
        tr.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    }
    let atr = tr.slice(0, period).reduce((a, b) => a + b, 0);
    let sDmP = dmPlus.slice(0, period).reduce((a, b) => a + b, 0);
    let sDmM = dmMinus.slice(0, period).reduce((a, b) => a + b, 0);
    const dx = [];
    for (let i = period; i < tr.length; i++) {
        atr = atr - atr / period + tr[i]; sDmP = sDmP - sDmP / period + dmPlus[i]; sDmM = sDmM - sDmM / period + dmMinus[i];
        const diP = atr > 0 ? (sDmP / atr) * 100 : 0; const diM = atr > 0 ? (sDmM / atr) * 100 : 0;
        dx.push(diP + diM > 0 ? Math.abs(diP - diM) / (diP + diM) * 100 : 0);
    }
    let adx = dx.length >= period ? dx.slice(0, period).reduce((a, b) => a + b, 0) / period : (dx.length > 0 ? dx.reduce((a, b) => a + b, 0) / dx.length : 25);
    for (let i = period; i < dx.length; i++) adx = (adx * (period - 1) + dx[i]) / period;
    const diPlus = atr > 0 ? (sDmP / atr) * 100 : 0; const diMinus = atr > 0 ? (sDmM / atr) * 100 : 0;
    let signal = 'HOLD';
    if (adx > 25 && diPlus > diMinus) signal = 'BUY'; else if (adx > 25 && diMinus > diPlus) signal = 'SELL';
    return { adx: Math.round(adx * 100) / 100, diPlus: Math.round(diPlus * 100) / 100, diMinus: Math.round(diMinus * 100) / 100, signal };
}

function calculateOBV(closes, volumes) {
    if (!closes || !volumes || closes.length < 2) return { obv: 0, signal: 'HOLD' };
    let obv = 0; const obvArr = [0];
    for (let i = 1; i < closes.length; i++) {
        if (closes[i] > closes[i - 1]) obv += (volumes[i] || 0); else if (closes[i] < closes[i - 1]) obv -= (volumes[i] || 0);
        obvArr.push(obv);
    }
    const priceUp = closes[closes.length - 1] > closes[Math.max(0, closes.length - 10)];
    const obvUp = obvArr[obvArr.length - 1] > obvArr[Math.max(0, obvArr.length - 10)];
    let signal = 'HOLD';
    if (priceUp && obvUp) signal = 'BUY'; else if (!priceUp && !obvUp) signal = 'SELL';
    else if (!priceUp && obvUp) signal = 'BUY'; else if (priceUp && !obvUp) signal = 'SELL';
    return { obv, signal };
}

function calculateCCI(highs, lows, closes, period = 20) {
    if (closes.length < period) return { value: 0, signal: 'HOLD' };
    const tp = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
    const tpSlice = tp.slice(-period);
    const mean = tpSlice.reduce((a, b) => a + b, 0) / period;
    const meanDev = tpSlice.reduce((a, b) => a + Math.abs(b - mean), 0) / period;
    const value = meanDev > 0 ? (tp[tp.length - 1] - mean) / (0.015 * meanDev) : 0;
    let signal = 'HOLD'; if (value < -100) signal = 'BUY'; else if (value > 100) signal = 'SELL';
    return { value: Math.round(value * 100) / 100, signal };
}

function calculateParabolicSAR(highs, lows, afStart = 0.02, afMax = 0.2) {
    if (highs.length < 3) return { sar: 0, trend: 'HOLD' };
    let isUp = true, sar = lows[0], ep = highs[0], af = afStart;
    for (let i = 1; i < highs.length; i++) {
        sar = sar + af * (ep - sar);
        if (isUp) {
            sar = Math.min(sar, lows[i - 1], i >= 2 ? lows[i - 2] : lows[i - 1]);
            if (lows[i] < sar) { isUp = false; sar = ep; ep = lows[i]; af = afStart; }
            else if (highs[i] > ep) { ep = highs[i]; af = Math.min(af + afStart, afMax); }
        } else {
            sar = Math.max(sar, highs[i - 1], i >= 2 ? highs[i - 2] : highs[i - 1]);
            if (highs[i] > sar) { isUp = true; sar = ep; ep = highs[i]; af = afStart; }
            else if (lows[i] < ep) { ep = lows[i]; af = Math.min(af + afStart, afMax); }
        }
    }
    return { sar: Math.round(sar * 10000) / 10000, trend: isUp ? 'BUY' : 'SELL' };
}

function calculateIchimoku(highs, lows, closes, tenkanP = 9, kijunP = 26, senkouBP = 52) {
    const calc = (h, l, p) => { if (h.length < p) return null; return (Math.max(...h.slice(-p)) + Math.min(...l.slice(-p))) / 2; };
    const tenkan = calc(highs, lows, tenkanP);
    const kijun = calc(highs, lows, kijunP);
    const senkouA = tenkan !== null && kijun !== null ? (tenkan + kijun) / 2 : null;
    const senkouB = calc(highs, lows, senkouBP);
    const price = closes[closes.length - 1];
    let signal = 'HOLD';
    if (tenkan !== null && kijun !== null && senkouA !== null && senkouB !== null) {
        if (price > Math.max(senkouA, senkouB) && tenkan > kijun) signal = 'BUY';
        else if (price < Math.min(senkouA, senkouB) && tenkan < kijun) signal = 'SELL';
    }
    return { tenkan: tenkan ? +tenkan.toFixed(2) : null, kijun: kijun ? +kijun.toFixed(2) : null, senkouA: senkouA ? +senkouA.toFixed(2) : null, senkouB: senkouB ? +senkouB.toFixed(2) : null, signal };
}

function calculateMFI(highs, lows, closes, volumes, period = 14) {
    if (closes.length < period + 1 || !volumes) return { value: 50, signal: 'HOLD' };
    const tp = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
    let posFlow = 0, negFlow = 0;
    for (let i = closes.length - period; i < closes.length; i++) {
        const mf = tp[i] * (volumes[i] || 1);
        if (tp[i] > tp[i - 1]) posFlow += mf; else negFlow += mf;
    }
    const mfi = negFlow > 0 ? 100 - 100 / (1 + posFlow / negFlow) : 100;
    let signal = 'HOLD'; if (mfi < 20) signal = 'BUY'; else if (mfi > 80) signal = 'SELL';
    return { value: Math.round(mfi * 100) / 100, signal };
}

function calculateROC(closes, period = 12) {
    if (closes.length < period + 1) return { value: 0, signal: 'HOLD' };
    const value = closes[closes.length - 1 - period] !== 0 ? ((closes[closes.length - 1] - closes[closes.length - 1 - period]) / closes[closes.length - 1 - period]) * 100 : 0;
    let signal = 'HOLD'; if (value > 5) signal = 'BUY'; else if (value < -5) signal = 'SELL';
    return { value: Math.round(value * 100) / 100, signal };
}

// ═══════════════════════════════════════════════════════════════════════════
// III. CHART PATTERN DETECTION
// ═══════════════════════════════════════════════════════════════════════════

function findPivots(prices, window = 5) {
    const peaks = [], troughs = [];
    for (let i = window; i < prices.length - window; i++) {
        const slice = prices.slice(i - window, i + window + 1);
        if (prices[i] === Math.max(...slice)) peaks.push({ index: i, price: prices[i] });
        if (prices[i] === Math.min(...slice)) troughs.push({ index: i, price: prices[i] });
    }
    return { peaks, troughs };
}

function detectChartPatterns(prices) {
    if (prices.length < 50) return [];
    const patterns = [];
    const { peaks, troughs } = findPivots(prices, 5);
    if (peaks.length >= 2) {
        const [p1, p2] = peaks.slice(-2);
        if (Math.abs(p1.price - p2.price) / p1.price < 0.02 && p2.index - p1.index > 10) patterns.push({ pattern: 'Double Top', type: 'bearish', strength: 3 });
    }
    if (troughs.length >= 2) {
        const [t1, t2] = troughs.slice(-2);
        if (Math.abs(t1.price - t2.price) / t1.price < 0.02 && t2.index - t1.index > 10) patterns.push({ pattern: 'Double Bottom', type: 'bullish', strength: 3 });
    }
    if (peaks.length >= 3) {
        const [ls, h, rs] = peaks.slice(-3);
        if (h.price > ls.price && h.price > rs.price && Math.abs(ls.price - rs.price) / ls.price < 0.05 && h.price > ls.price * 1.03) patterns.push({ pattern: 'Head & Shoulders', type: 'bearish', strength: 3 });
    }
    if (troughs.length >= 3) {
        const [ls, h, rs] = troughs.slice(-3);
        if (h.price < ls.price && h.price < rs.price && Math.abs(ls.price - rs.price) / ls.price < 0.05) patterns.push({ pattern: 'Inv Head & Shoulders', type: 'bullish', strength: 3 });
    }
    const last = prices[prices.length - 1];
    const recent = prices.slice(-50);
    const support = Math.min(...recent); const resistance = Math.max(...recent);
    if ((last - support) / last < 0.01) patterns.push({ pattern: 'At Support', type: 'bullish', strength: 2 });
    if ((resistance - last) / last < 0.01) patterns.push({ pattern: 'At Resistance', type: 'bearish', strength: 2 });
    return patterns;
}

// ═══════════════════════════════════════════════════════════════════════════
// IV. SUPER CONFLUENCE — combines ALL signals + macro
// ═══════════════════════════════════════════════════════════════════════════

function calculateSuperConfluence(indicators) {
    const weights = {
        rsi: 8, macd: 10, bollinger: 8, ema: 10, fibonacci: 5, volume: 7, sentiment: 5,
        stochastic: 8, williamsR: 5, adx: 10, obv: 7, cci: 5, parabolicSAR: 7, ichimoku: 10,
        mfi: 5, roc: 3, candlestickPatterns: 12, chartPatterns: 15,
        fearGreed: 12, marketRegime: 10,
    };
    const scoreMap = { BUY: 1, HOLD: 0, SELL: -1, 'STRONG BUY': 1.5, 'STRONG SELL': -1.5 };

    let weightedScore = 0, totalWeight = 0;
    const signals = {
        rsi: indicators.rsi?.signal, macd: indicators.macd?.crossSignal, bollinger: indicators.bollinger?.signal,
        ema: indicators.ema?.signal, fibonacci: indicators.fibonacci?.signal, volume: indicators.volume?.signal,
        sentiment: indicators.sentiment?.label === 'bullish' ? 'BUY' : indicators.sentiment?.label === 'bearish' ? 'SELL' : 'HOLD',
        stochastic: indicators.stochastic?.signal, williamsR: indicators.williamsR?.signal,
        adx: indicators.adx?.signal, obv: indicators.obv?.signal, cci: indicators.cci?.signal,
        parabolicSAR: indicators.parabolicSAR?.trend, ichimoku: indicators.ichimoku?.signal,
        mfi: indicators.mfi?.signal, roc: indicators.roc?.signal,
        fearGreed: indicators.fearGreed?.signal,
        marketRegime: indicators.marketRegime?.tradeable === false ? 'HOLD' : undefined,
    };

    if (indicators.candlestickPatterns?.length > 0) {
        const b = indicators.candlestickPatterns.filter(p => p.type === 'bullish').reduce((s, p) => s + p.strength, 0);
        const r = indicators.candlestickPatterns.filter(p => p.type === 'bearish').reduce((s, p) => s + p.strength, 0);
        signals.candlestickPatterns = b > r ? 'BUY' : r > b ? 'SELL' : 'HOLD';
    }
    if (indicators.chartPatterns?.length > 0) {
        const b = indicators.chartPatterns.filter(p => p.type === 'bullish').reduce((s, p) => s + p.strength, 0);
        const r = indicators.chartPatterns.filter(p => p.type === 'bearish').reduce((s, p) => s + p.strength, 0);
        signals.chartPatterns = b > r ? 'BUY' : r > b ? 'SELL' : 'HOLD';
    }

    for (const [key, sig] of Object.entries(signals)) {
        if (sig && scoreMap[sig] !== undefined) { weightedScore += scoreMap[sig] * (weights[key] || 5); totalWeight += weights[key] || 5; }
    }

    if (totalWeight === 0) return { signal: 'HOLD', confidence: 0, details: signals };
    const normalized = weightedScore / totalWeight;

    // Market regime multiplier
    const regimeMultiplier = indicators.marketRegime?.riskMultiplier ?? 1;
    const adjustedConfidence = Math.round(Math.abs(normalized) * 100 * regimeMultiplier);

    let signal = 'HOLD';
    if (normalized >= 0.6) signal = 'STRONG BUY';
    else if (normalized >= 0.25) signal = 'BUY';
    else if (normalized <= -0.6) signal = 'STRONG SELL';
    else if (normalized <= -0.25) signal = 'SELL';

    // Override: if regime is not tradeable, force HOLD
    if (indicators.marketRegime?.tradeable === false) signal = 'HOLD';

    return { signal, confidence: adjustedConfidence, score: Math.round(normalized * 1000) / 1000, regime: indicators.marketRegime?.regime, details: signals };
}

// ═══════════════════════════════════════════════════════════════════════════
// V. EXCHANGE CONNECTION — Binance via CCXT
// ═══════════════════════════════════════════════════════════════════════════

let exchange = null;
let paperMode = true;
const paperTrades = [];
const paperBalance = { USDT: 10000 };
let openPositions = [];
let dailyTrades = [];
let dailyPnL = 0;
let lastLossTime = 0;

function initExchange() {
    const apiKey = process.env.BINANCE_API_KEY;
    const secret = process.env.BINANCE_API_SECRET;
    const testnet = process.env.BINANCE_TESTNET === 'true';
    if (!apiKey || !secret) { paperMode = true; logger.info({ component: 'TradeExecutor' }, '📝 No Binance API keys — PAPER MODE'); return; }
    try {
        exchange = new ccxt.binance({ apiKey, secret, sandbox: testnet, enableRateLimit: true, options: { defaultType: 'spot' } });
        paperMode = testnet;
        logger.info({ component: 'TradeExecutor', testnet }, `🔗 Binance ${testnet ? 'TESTNET' : '🔴 LIVE'}`);
    } catch (err) { logger.error({ component: 'TradeExecutor', err: err.message }, 'Init failed'); paperMode = true; }
}

async function getBalance() {
    if (paperMode || !exchange) return paperBalance;
    try { const b = await exchange.fetchBalance(); return b.total || {}; }
    catch (err) { logger.error({ err: err.message }, 'Balance failed'); return paperBalance; }
}

function calculatePositionSize(balance, price, stopLossPrice, atrPct) {
    const maxTradeAmount = parseFloat(process.env.MAX_TRADE_AMOUNT || '100');
    const riskAmount = (balance.USDT || 0) * CONFIG.MAX_RISK_PCT;
    const riskPerUnit = Math.abs(price - stopLossPrice);
    const positionByRisk = riskPerUnit > 0 ? riskAmount / riskPerUnit : 0;
    const positionByMax = maxTradeAmount / price;
    let size = Math.min(positionByRisk, positionByMax);
    // Volatility adjustment
    if (atrPct) size = volatilityAdjustedSize(size, atrPct);
    return Math.floor(size * 100000) / 100000;
}

// ═══════════════════════════════════════════════════════════════════════════
// VI. ORDER EXECUTION with full protection
// ═══════════════════════════════════════════════════════════════════════════

async function executeTrade(action, symbol, price, analysis, atrPct) {
    const now = Date.now();
    const today = new Date().toDateString();
    dailyTrades = dailyTrades.filter(t => new Date(t.time).toDateString() === today);

    if (dailyTrades.length >= CONFIG.MAX_DAILY_TRADES) return { executed: false, reason: `Daily limit (${CONFIG.MAX_DAILY_TRADES})` };
    if (openPositions.length >= CONFIG.MAX_OPEN_POSITIONS) return { executed: false, reason: `Max positions (${CONFIG.MAX_OPEN_POSITIONS})` };
    if (now - lastLossTime < CONFIG.COOLDOWN_AFTER_LOSS_MS) return { executed: false, reason: `Cooldown: ${Math.round((CONFIG.COOLDOWN_AFTER_LOSS_MS - (now - lastLossTime)) / 1000)}s` };

    // Correlation check
    const corrCheck = checkCorrelationBlock(symbol, openPositions);
    if (corrCheck.blocked) return { executed: false, reason: corrCheck.reason };

    const balance = await getBalance();
    const portfolioValue = balance.USDT || 0;

    // Weekly limit
    if (isWeeklyLimitHit(portfolioValue)) return { executed: false, reason: `⛔ Weekly loss limit hit (${CONFIG.MAX_WEEKLY_LOSS_PCT * 100}%)` };

    // Daily kill switch
    if (dailyPnL < -portfolioValue * CONFIG.MAX_DAILY_LOSS_PCT) return { executed: false, reason: `⛔ KILL SWITCH: Daily loss exceeds ${CONFIG.MAX_DAILY_LOSS_PCT * 100}%` };

    const slPrice = action === 'BUY' ? price * (1 - CONFIG.DEFAULT_STOP_LOSS_PCT) : price * (1 + CONFIG.DEFAULT_STOP_LOSS_PCT);
    const tpPrice = action === 'BUY' ? price * (1 + CONFIG.DEFAULT_TAKE_PROFIT_PCT) : price * (1 - CONFIG.DEFAULT_TAKE_PROFIT_PCT);
    const size = calculatePositionSize(balance, price, slPrice, atrPct);
    if (size * price < 10) return { executed: false, reason: `Position too small: $${(size * price).toFixed(2)}` };

    const trade = {
        id: `t_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        symbol, action, price, size, stopLoss: +slPrice.toFixed(2), takeProfit: +tpPrice.toFixed(2),
        cost: +(size * price).toFixed(2), confluence: analysis.confidence, signal: analysis.signal,
        time: new Date().toISOString(), mode: paperMode ? 'PAPER' : 'LIVE', status: 'OPEN',
    };

    if (paperMode) {
        if (action === 'BUY') { paperBalance.USDT -= trade.cost; paperBalance[symbol.replace('/USDT', '')] = (paperBalance[symbol.replace('/USDT', '')] || 0) + size; }
        paperTrades.push(trade);
        logger.info({ component: 'Trade', trade }, `📝 PAPER ${action}: ${symbol} x${size} @ $${price}`);
    } else {
        try {
            const order = await exchange.createMarketOrder(symbol, action.toLowerCase(), size);
            trade.orderId = order.id; trade.filled = order.filled; trade.avgPrice = order.average;
            logger.info({ component: 'Trade', orderId: order.id }, `🔴 LIVE ${action}: ${symbol}`);
        } catch (err) {
            logger.error({ err: err.message }, 'Trade FAILED');
            return { executed: false, reason: `Exchange error: ${err.message}` };
        }
    }
    openPositions.push(trade); dailyTrades.push(trade);
    return { executed: true, trade };
}

async function closePosition(tradeId, currentPrice, reason = 'manual') {
    const idx = openPositions.findIndex(p => p.id === tradeId);
    if (idx === -1) return { closed: false, reason: 'Not found' };
    const pos = openPositions[idx];
    const pnl = pos.action === 'BUY' ? (currentPrice - pos.price) * pos.size : (pos.price - currentPrice) * pos.size;
    pos.closePrice = currentPrice; pos.pnl = +pnl.toFixed(2); pos.closeTime = new Date().toISOString(); pos.closeReason = reason; pos.status = 'CLOSED';
    if (paperMode && pos.action === 'BUY') { paperBalance.USDT += currentPrice * pos.size; const a = pos.symbol.replace('/USDT', ''); paperBalance[a] = (paperBalance[a] || 0) - pos.size; }
    else if (!paperMode && exchange) { try { await exchange.createMarketOrder(pos.symbol, pos.action === 'BUY' ? 'sell' : 'buy', pos.size); } catch (e) { logger.error({ err: e.message }, 'Close failed'); } }
    dailyPnL += pnl; recordWeeklyPnL(pnl); if (pnl < 0) lastLossTime = Date.now();
    openPositions.splice(idx, 1);
    logger.info({ tradeId, pnl: pos.pnl, reason }, `${pnl >= 0 ? '✅' : '❌'} Closed: ${pos.symbol} PnL: $${pos.pnl}`);
    return { closed: true, trade: pos };
}

async function killSwitch(currentPrices = {}) {
    logger.warn({ component: 'Trade' }, '⛔ KILL SWITCH — closing ALL');
    const results = [];
    for (const pos of [...openPositions]) results.push(await closePosition(pos.id, currentPrices[pos.symbol] || pos.price, 'KILL_SWITCH'));
    return results;
}

async function checkStopsAndTargets(currentPrices) {
    const results = [];
    for (const pos of [...openPositions]) {
        const price = currentPrices[pos.symbol]; if (!price) continue;
        if (pos.action === 'BUY') {
            if (price <= pos.stopLoss) results.push(await closePosition(pos.id, price, 'STOP_LOSS'));
            else if (price >= pos.takeProfit) results.push(await closePosition(pos.id, price, 'TAKE_PROFIT'));
        } else {
            if (price >= pos.stopLoss) results.push(await closePosition(pos.id, price, 'STOP_LOSS'));
            else if (price <= pos.takeProfit) results.push(await closePosition(pos.id, price, 'TAKE_PROFIT'));
        }
    }
    return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    detectCandlestickPatterns, detectChartPatterns, findPivots,
    calculateStochastic, calculateWilliamsR, calculateATR, calculateADX,
    calculateOBV, calculateCCI, calculateParabolicSAR, calculateIchimoku, calculateMFI, calculateROC,
    calculateSuperConfluence,
    fetchFearAndGreed, detectMarketRegime, checkCorrelationBlock, volatilityAdjustedSize,
    initExchange, getBalance, calculatePositionSize,
    executeTrade, closePosition, killSwitch, checkStopsAndTargets,
    getOpenPositions: () => [...openPositions], getDailyTrades: () => [...dailyTrades],
    getPaperTrades: () => [...paperTrades], getPaperBalance: () => ({ ...paperBalance }),
    getDailyPnL: () => dailyPnL, getWeeklyPnL: () => weeklyPnL, isPaperMode: () => paperMode,
    CONFIG,
};
