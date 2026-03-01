// Test real al modulelor de trading — fără server, doar logică pură
'use strict';

const tradeEngine = require('./server/trade-executor');
const tradeIntel = require('./server/trade-intelligence');

// Simulăm date reale (300 close prices, BTC-like)
const base = 45000;
const prices = Array.from({ length: 300 }, (_, i) => {
    return base + Math.sin(i / 20) * 2000 + Math.cos(i / 7) * 500 + (i > 200 ? (i - 200) * 20 : 0);
});
const volumes = Array.from({ length: 300 }, () => Math.random() * 1000000 + 500000);
const highs = prices.map((p, i) => i > 0 ? Math.max(p, prices[i - 1]) * 1.002 : p * 1.002);
const lows = prices.map((p, i) => i > 0 ? Math.min(p, prices[i - 1]) * 0.998 : p * 0.998);
const candles = prices.map((p, i) => ({ open: i > 0 ? prices[i - 1] : p, high: highs[i], low: lows[i], close: p }));

let passed = 0;
let failed = 0;
let total = 0;

function test(name, fn) {
    total++;
    try {
        const result = fn();
        if (result === false) { failed++; console.log(`❌ ${name}`); }
        else { passed++; console.log(`✅ ${name}`); }
    } catch (e) { failed++; console.log(`❌ ${name} — ERROR: ${e.message}`); }
}

console.log('\n═══════════ TRADE-EXECUTOR.JS ═══════════\n');

// Indicators
test('Stochastic', () => { const r = tradeEngine.calculateStochastic(highs, lows, prices); return r.k !== undefined && r.d !== undefined && r.signal; });
test('WilliamsR', () => { const r = tradeEngine.calculateWilliamsR(highs, lows, prices); return r.value !== undefined && r.signal; });
test('ATR', () => { const r = tradeEngine.calculateATR(highs, lows, prices); return typeof r === 'number' && r > 0; });
test('ADX', () => { const r = tradeEngine.calculateADX(highs, lows, prices); return r.adx !== undefined && r.diPlus !== undefined && r.signal; });
test('OBV', () => { const r = tradeEngine.calculateOBV(prices, volumes); return r.obv !== undefined && r.signal; });
test('CCI', () => { const r = tradeEngine.calculateCCI(highs, lows, prices); return r.value !== undefined && r.signal; });
test('Parabolic SAR', () => { const r = tradeEngine.calculateParabolicSAR(highs, lows); return r.sar !== undefined && r.trend; });
test('Ichimoku', () => { const r = tradeEngine.calculateIchimoku(highs, lows, prices); return r.tenkan !== null && r.kijun !== null && r.signal; });
test('MFI', () => { const r = tradeEngine.calculateMFI(highs, lows, prices, volumes); return r.value !== undefined && r.signal; });
test('ROC', () => { const r = tradeEngine.calculateROC(prices); return r.value !== undefined && r.signal; });

// Patterns  
test('Candlestick Patterns', () => { const r = tradeEngine.detectCandlestickPatterns(candles); return Array.isArray(r); });
test('Chart Patterns', () => { const r = tradeEngine.detectChartPatterns(prices); return Array.isArray(r); });

// Macro
test('Fear & Greed (structure)', () => { const r = tradeEngine.fetchFearAndGreed; return typeof r === 'function'; });
test('Market Regime', () => {
    const adx = tradeEngine.calculateADX(highs, lows, prices);
    const atr = tradeEngine.calculateATR(highs, lows, prices);
    const roc = tradeEngine.calculateROC(prices);
    const r = tradeEngine.detectMarketRegime(adx, atr / prices[prices.length - 1], roc);
    return r.regime && r.strategy && r.riskMultiplier !== undefined;
});
test('Correlation Block', () => {
    const r = tradeEngine.checkCorrelationBlock('BTC/USDT', [{ symbol: 'ETH/USDT' }, { symbol: 'SOL/USDT' }]);
    return r.blocked === true;
});
test('Volatility Adjusted Size', () => {
    const full = tradeEngine.volatilityAdjustedSize(1.0, 0.005);
    const half = tradeEngine.volatilityAdjustedSize(1.0, 0.04);
    const zero = tradeEngine.volatilityAdjustedSize(1.0, 0.1);
    return full === 1.0 && half === 0.5 && zero === 0;
});

// Super Confluence
test('Super Confluence', () => {
    const rsi = { value: 35, signal: 'BUY' };
    const macd = { macd: 0.5, crossSignal: 'BUY' };
    const bollinger = { signal: 'BUY' };
    const ema = { signal: 'BUY' };
    const stochastic = { signal: 'BUY' };
    const adx = { adx: 35, signal: 'BUY' };
    const r = tradeEngine.calculateSuperConfluence({ rsi, macd, bollinger, ema, stochastic, adx, candlestickPatterns: [], chartPatterns: [] });
    return r.signal && r.confidence !== undefined && r.score !== undefined;
});

// Execution engine
test('Paper Mode Active', () => tradeEngine.isPaperMode() === true);
test('Paper Balance', () => { const b = tradeEngine.getPaperBalance(); return b.USDT === 10000; });
test('Config exists', () => tradeEngine.CONFIG.MAX_RISK_PCT === 0.02 && tradeEngine.CONFIG.MAX_WEEKLY_LOSS_PCT === 0.10);

console.log('\n═══════════ TRADE-INTELLIGENCE.JS ═══════════\n');

// Divergence
test('Divergence RSI', () => {
    const oscValues = prices.map((p, i) => 50 + Math.sin(i / 10) * 30);
    const r = tradeIntel.detectDivergence(prices, oscValues);
    return Array.isArray(r);
});

// Pivot Points
test('Pivot Points (Classic)', () => {
    const r = tradeIntel.calculatePivotPoints(46000, 44000, 45500, 45000);
    return r.classic && r.classic.PP && r.classic.R1 && r.classic.S1 && r.woodie && r.camarilla && r.signal;
});

// Keltner Channels
test('Keltner Channels', () => {
    const r = tradeIntel.calculateKeltnerChannels(highs, lows, prices);
    return r.middle !== undefined && r.upper !== undefined && r.lower !== undefined && r.signal;
});

// Aroon
test('Aroon Indicator', () => {
    const r = tradeIntel.calculateAroon(highs, lows);
    return r.aroonUp !== undefined && r.aroonDown !== undefined && r.oscillator !== undefined && r.signal;
});

// Advanced Patterns
test('Advanced Chart Patterns', () => {
    const r = tradeIntel.detectAdvancedChartPatterns(prices);
    return Array.isArray(r);
});

// News Sentiment Classification
test('News Sentiment NLP', () => {
    const bull = tradeIntel.classifyNewsSentiment('Bitcoin surges to all-time high massive rally');
    const bear = tradeIntel.classifyNewsSentiment('Crypto crash as exchange hack causes panic sell-off');
    const neutral = tradeIntel.classifyNewsSentiment('Markets mixed today in light trading');
    return bull.label === 'bullish' && bear.label === 'bearish' && neutral.label === 'neutral';
});

// Economic Calendar
test('Economic Calendar', () => {
    const r = tradeIntel.getEconomicCalendarRisks();
    return Array.isArray(r.risks) && typeof r.highRisk === 'boolean' && r.timestamp;
});

// Trading Rules
test('Trading Rules (approved)', () => {
    const r = tradeIntel.evaluateTradingRules({
        action: 'BUY', price: 45000, confluence: 75,
        adx: { adx: 35, signal: 'BUY' }, atrPct: 0.03,
        rsi: { value: 40 }, volume: { phase: 'accumulation' },
        marketRegime: { regime: 'STRONG_TREND' }, fearGreed: { value: 35 },
        economicRisks: { shouldPause: false },
    });
    return r.approved === true && r.rules.length >= 10;
});

test('Trading Rules (blocked - against trend)', () => {
    const r = tradeIntel.evaluateTradingRules({
        action: 'BUY', price: 45000, confluence: 75,
        adx: { adx: 35, signal: 'SELL' }, atrPct: 0.03,
        rsi: { value: 40 }, volume: { phase: 'neutral' },
        marketRegime: { regime: 'STRONG_TREND' }, fearGreed: { value: 50 },
        economicRisks: { shouldPause: false },
    });
    return r.approved === false && r.criticalFailed > 0;
});

test('Trading Rules (blocked - extreme greed + BUY)', () => {
    const r = tradeIntel.evaluateTradingRules({
        action: 'BUY', price: 45000, confluence: 75,
        adx: { adx: 15, signal: 'HOLD' }, atrPct: 0.09,
        rsi: { value: 45 }, volume: { phase: 'neutral' },
        marketRegime: { regime: 'RANGING' }, fearGreed: { value: 90 },
        economicRisks: { shouldPause: true },
    });
    return r.approved === false;
});

console.log('\n═══════════ RESULTS ═══════════');
console.log(`✅ Passed: ${passed}/${total}`);
console.log(`❌ Failed: ${failed}/${total}`);
console.log(failed === 0 ? '\n🎯 ALL TESTS PASSED' : '\n⚠️ SOME TESTS FAILED');
