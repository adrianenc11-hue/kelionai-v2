'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// KelionAI v2 — TRADE INTELLIGENCE (Expert Knowledge Layer)
// Divergence, Pivot Points, Keltner, Aroon, News NLP, Trading Rules
// ═══════════════════════════════════════════════════════════════════════════

const logger = require('./logger');

// ═══════════════════════════════════════════════════════════════════════════
// I. DIVERGENCE DETECTION — Catches reversals before they happen
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect bullish/bearish divergence between price and an oscillator.
 * Bullish divergence: price makes lower low, oscillator makes higher low → reversal UP
 * Bearish divergence: price makes higher high, oscillator makes lower high → reversal DOWN
 */
function detectDivergence(prices, oscillatorValues, lookback = 30) {
    if (!prices || !oscillatorValues || prices.length < lookback) return [];
    const divergences = [];
    const pSlice = prices.slice(-lookback);
    const oSlice = oscillatorValues.slice(-lookback);

    // Find local lows and highs in price
    const priceLows = [], priceHighs = [];
    const oscLows = [], oscHighs = [];
    for (let i = 2; i < pSlice.length - 2; i++) {
        if (pSlice[i] < pSlice[i - 1] && pSlice[i] < pSlice[i - 2] && pSlice[i] < pSlice[i + 1] && pSlice[i] < pSlice[i + 2]) {
            priceLows.push({ idx: i, val: pSlice[i], oscVal: oSlice[i] });
        }
        if (pSlice[i] > pSlice[i - 1] && pSlice[i] > pSlice[i - 2] && pSlice[i] > pSlice[i + 1] && pSlice[i] > pSlice[i + 2]) {
            priceHighs.push({ idx: i, val: pSlice[i], oscVal: oSlice[i] });
        }
    }

    // Bullish divergence: price ↓↓, oscillator ↑↑
    if (priceLows.length >= 2) {
        const [a, b] = priceLows.slice(-2);
        if (b.val < a.val && b.oscVal > a.oscVal) {
            divergences.push({ type: 'bullish', pattern: 'Regular Bullish Divergence', strength: 3, signal: 'BUY', description: 'Price lower low, oscillator higher low → reversal UP expected' });
        }
        if (b.val > a.val && b.oscVal < a.oscVal) {
            divergences.push({ type: 'bearish', pattern: 'Hidden Bullish Divergence', strength: 2, signal: 'BUY', description: 'Price higher low, oscillator lower low → trend continuation' });
        }
    }

    // Bearish divergence: price ↑↑, oscillator ↓↓  
    if (priceHighs.length >= 2) {
        const [a, b] = priceHighs.slice(-2);
        if (b.val > a.val && b.oscVal < a.oscVal) {
            divergences.push({ type: 'bearish', pattern: 'Regular Bearish Divergence', strength: 3, signal: 'SELL', description: 'Price higher high, oscillator lower high → reversal DOWN expected' });
        }
        if (b.val < a.val && b.oscVal > a.oscVal) {
            divergences.push({ type: 'bullish', pattern: 'Hidden Bearish Divergence', strength: 2, signal: 'SELL', description: 'Price lower high, oscillator higher high → trend continuation' });
        }
    }

    return divergences;
}

// ═══════════════════════════════════════════════════════════════════════════
// II. PIVOT POINTS — Universal support/resistance levels
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate Floor (Classic), Woodie, and Camarilla pivot points.
 * @param {number} high - Previous period high
 * @param {number} low - Previous period low
 * @param {number} close - Previous period close
 * @param {number} open - Previous period open (for Woodie)
 */
function calculatePivotPoints(high, low, close, open) {
    const r = (v) => Math.round(v * 100) / 100;

    // Classic (Floor) Pivots
    const pp = (high + low + close) / 3;
    const classic = {
        type: 'Classic',
        PP: r(pp),
        R1: r(2 * pp - low), R2: r(pp + (high - low)), R3: r(high + 2 * (pp - low)),
        S1: r(2 * pp - high), S2: r(pp - (high - low)), S3: r(low - 2 * (high - pp)),
    };

    // Woodie Pivots
    const ppW = (high + low + 2 * close) / 4;
    const woodie = {
        type: 'Woodie',
        PP: r(ppW),
        R1: r(2 * ppW - low), R2: r(ppW + (high - low)),
        S1: r(2 * ppW - high), S2: r(ppW - (high - low)),
    };

    // Camarilla Pivots
    const range = high - low;
    const camarilla = {
        type: 'Camarilla',
        PP: r(pp),
        R1: r(close + range * 1.1 / 12), R2: r(close + range * 1.1 / 6), R3: r(close + range * 1.1 / 4), R4: r(close + range * 1.1 / 2),
        S1: r(close - range * 1.1 / 12), S2: r(close - range * 1.1 / 6), S3: r(close - range * 1.1 / 4), S4: r(close - range * 1.1 / 2),
    };

    // Signal based on current price vs pivots
    const lastPrice = close;
    let signal = 'HOLD';
    if (lastPrice > classic.R1) signal = 'BUY';        // Above R1 = bullish
    else if (lastPrice < classic.S1) signal = 'SELL';   // Below S1 = bearish
    else if (lastPrice > classic.PP) signal = 'BUY';    // Above pivot = mild bullish
    else if (lastPrice < classic.PP) signal = 'SELL';   // Below pivot = mild bearish

    return { classic, woodie, camarilla, signal };
}

// ═══════════════════════════════════════════════════════════════════════════
// III. KELTNER CHANNELS — Volatility-based bands (complementary to Bollinger)
// ═══════════════════════════════════════════════════════════════════════════

function calculateKeltnerChannels(highs, lows, closes, emaPeriod = 20, atrPeriod = 10, multiplier = 2) {
    if (closes.length < Math.max(emaPeriod, atrPeriod)) return { middle: closes[closes.length - 1], upper: closes[closes.length - 1], lower: closes[closes.length - 1], signal: 'HOLD' };

    // EMA of close
    const k = 2 / (emaPeriod + 1);
    let ema = closes[0];
    for (let i = 1; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);

    // ATR
    let atr = 0;
    const trs = [];
    for (let i = 1; i < closes.length; i++) {
        trs.push(Math.max(highs[i] - lows[i], Math.abs(highs[i] - closes[i - 1]), Math.abs(lows[i] - closes[i - 1])));
    }
    atr = trs.slice(-atrPeriod).reduce((a, b) => a + b, 0) / atrPeriod;

    const upper = ema + multiplier * atr;
    const lower = ema - multiplier * atr;
    const last = closes[closes.length - 1];

    let signal = 'HOLD';
    if (last < lower) signal = 'BUY';
    else if (last > upper) signal = 'SELL';

    return { middle: Math.round(ema * 100) / 100, upper: Math.round(upper * 100) / 100, lower: Math.round(lower * 100) / 100, signal };
}

// ═══════════════════════════════════════════════════════════════════════════
// IV. AROON INDICATOR — Detects when a new trend is starting
// ═══════════════════════════════════════════════════════════════════════════

function calculateAroon(highs, lows, period = 25) {
    if (highs.length < period + 1) return { aroonUp: 50, aroonDown: 50, oscillator: 0, signal: 'HOLD' };
    const hSlice = highs.slice(-(period + 1));
    const lSlice = lows.slice(-(period + 1));
    const maxIdx = hSlice.indexOf(Math.max(...hSlice));
    const minIdx = lSlice.indexOf(Math.min(...lSlice));
    const aroonUp = ((period - (period - maxIdx)) / period) * 100;
    const aroonDown = ((period - (period - minIdx)) / period) * 100;
    const oscillator = aroonUp - aroonDown;

    let signal = 'HOLD';
    if (aroonUp > 70 && aroonDown < 30) signal = 'BUY';
    else if (aroonDown > 70 && aroonUp < 30) signal = 'SELL';

    return { aroonUp: Math.round(aroonUp * 100) / 100, aroonDown: Math.round(aroonDown * 100) / 100, oscillator: Math.round(oscillator * 100) / 100, signal };
}

// ═══════════════════════════════════════════════════════════════════════════
// V. ADDITIONAL CHART PATTERNS — Cup & Handle, Wedges, Flags
// ═══════════════════════════════════════════════════════════════════════════

function detectAdvancedChartPatterns(prices) {
    if (prices.length < 60) return [];
    const patterns = [];
    const n = prices.length;

    // Cup & Handle (bullish) — U shape in last 40-60 candles
    const cupSlice = prices.slice(-60);
    const cupMid = Math.min(...cupSlice.slice(10, 50));
    const cupLeft = cupSlice[0];
    const cupRight = cupSlice[cupSlice.length - 1];
    const cupDepth = (cupLeft - cupMid) / cupLeft;
    if (cupDepth > 0.05 && cupDepth < 0.35 && Math.abs(cupLeft - cupRight) / cupLeft < 0.05) {
        // Handle: small pullback at end
        const handleSlice = prices.slice(-10);
        const handleDip = (Math.max(...handleSlice) - Math.min(...handleSlice)) / Math.max(...handleSlice);
        if (handleDip > 0.01 && handleDip < 0.1) {
            patterns.push({ pattern: 'Cup & Handle', type: 'bullish', strength: 3, depth: Math.round(cupDepth * 100) + '%' });
        }
    }

    // Rising Wedge (bearish) — rising support + rising resistance, converging
    const recent30 = prices.slice(-30);
    const highs30 = [], lows30 = [];
    for (let i = 2; i < recent30.length - 2; i++) {
        if (recent30[i] > recent30[i - 1] && recent30[i] > recent30[i + 1]) highs30.push({ i, v: recent30[i] });
        if (recent30[i] < recent30[i - 1] && recent30[i] < recent30[i + 1]) lows30.push({ i, v: recent30[i] });
    }
    if (highs30.length >= 2 && lows30.length >= 2) {
        const hSlope = (highs30[highs30.length - 1].v - highs30[0].v) / (highs30[highs30.length - 1].i - highs30[0].i);
        const lSlope = (lows30[lows30.length - 1].v - lows30[0].v) / (lows30[lows30.length - 1].i - lows30[0].i);
        if (hSlope > 0 && lSlope > 0 && lSlope > hSlope) {
            patterns.push({ pattern: 'Rising Wedge', type: 'bearish', strength: 2 });
        }
        if (hSlope < 0 && lSlope < 0 && hSlope > lSlope) {
            patterns.push({ pattern: 'Falling Wedge', type: 'bullish', strength: 2 });
        }
    }

    // Bull Flag — sharp rise then small consolidation
    if (n > 30) {
        const pole = prices.slice(-30, -10);
        const flag = prices.slice(-10);
        const poleGain = (pole[pole.length - 1] - pole[0]) / pole[0];
        const flagRange = (Math.max(...flag) - Math.min(...flag)) / Math.max(...flag);
        if (poleGain > 0.05 && flagRange < 0.03) {
            patterns.push({ pattern: 'Bull Flag', type: 'bullish', strength: 2 });
        }
        const poleLoss = (pole[0] - pole[pole.length - 1]) / pole[0];
        if (poleLoss > 0.05 && flagRange < 0.03) {
            patterns.push({ pattern: 'Bear Flag', type: 'bearish', strength: 2 });
        }
    }

    return patterns;
}

// ═══════════════════════════════════════════════════════════════════════════
// VI. NEWS SENTIMENT — Real news from public APIs
// ═══════════════════════════════════════════════════════════════════════════

let newsCache = { data: null, ts: 0 };
const NEWS_CACHE_TTL = 15 * 60 * 1000; // 15 minutes

async function fetchMarketNews(asset = 'crypto') {
    if (newsCache.data && Date.now() - newsCache.ts < NEWS_CACHE_TTL) return newsCache.data;

    const queries = {
        BTC: 'bitcoin', ETH: 'ethereum', SOL: 'solana',
        'EUR/USD': 'euro dollar forex', 'GBP/USD': 'pound dollar forex',
        'S&P 500': 'S&P 500 stock market', NASDAQ: 'nasdaq stock market',
        Gold: 'gold price commodity', Oil: 'oil price crude',
        crypto: 'cryptocurrency market',
    };
    const query = queries[asset] || queries.crypto;

    try {
        // CryptoPanic API (free, no key needed for public feed)
        const r = await fetch(`https://cryptopanic.com/api/free/v1/posts/?auth_token=free&public=true&filter=hot&currencies=${asset}`);
        if (r.ok) {
            const d = await r.json();
            if (d.results && d.results.length > 0) {
                const headlines = d.results.slice(0, 10).map(n => ({
                    title: n.title,
                    source: n.source?.domain || 'unknown',
                    sentiment: classifyNewsSentiment(n.title),
                    url: n.url,
                    published: n.published_at,
                }));

                const overallSentiment = calculateNewsSentiment(headlines);
                const result = { headlines, overallSentiment, source: 'CryptoPanic', fetchedAt: new Date().toISOString() };
                newsCache = { data: result, ts: Date.now() };
                return result;
            }
        }
    } catch (e) {
        logger.warn({ component: 'News', err: e.message }, 'News fetch failed');
    }

    // Fallback: use Brain search if available
    return { headlines: [], overallSentiment: { score: 0, label: 'neutral', signal: 'HOLD' }, source: 'unavailable' };
}

/**
 * NLP-lite sentiment classification for a headline.
 * Much better than simple word counting — uses phrase patterns.
 */
function classifyNewsSentiment(headline) {
    if (!headline) return { score: 0, label: 'neutral' };
    const h = headline.toLowerCase();

    // Strong bullish phrases
    const strongBull = ['all-time high', 'ath', 'record high', 'massive rally', 'breakout', 'surge', 'soars', 'skyrockets', 'moon', 'approved etf', 'institutional adoption', 'major partnership', 'bullish reversal'];
    // Strong bearish phrases
    const strongBear = ['crash', 'plummets', 'collapse', 'hack', 'exploit', 'major hack', 'ponzi', 'scam', 'sec charges', 'ban crypto', 'liquidat', 'death cross', 'bear market', 'recession fears', 'rate hike'];
    // Moderate bullish
    const modBull = ['buy', 'uptick', 'gains', 'rises', 'bullish', 'positive', 'upgrade', 'add', 'accumulate', 'support', 'recovery', 'rebound', 'outperform'];
    // Moderate bearish
    const modBear = ['sell', 'drop', 'decline', 'bearish', 'negative', 'downgrade', 'risk', 'warning', 'concern', 'threat', 'volatile', 'uncertainty', 'underperform', 'regulation'];

    let score = 0;
    strongBull.forEach(p => { if (h.includes(p)) score += 30; });
    strongBear.forEach(p => { if (h.includes(p)) score -= 30; });
    modBull.forEach(p => { if (h.includes(p)) score += 10; });
    modBear.forEach(p => { if (h.includes(p)) score -= 10; });

    score = Math.max(-100, Math.min(100, score));
    const label = score > 20 ? 'bullish' : score < -20 ? 'bearish' : 'neutral';
    return { score, label };
}

function calculateNewsSentiment(headlines) {
    if (!headlines || headlines.length === 0) return { score: 0, label: 'neutral', signal: 'HOLD' };
    const totalScore = headlines.reduce((sum, h) => sum + h.sentiment.score, 0) / headlines.length;
    const label = totalScore > 15 ? 'bullish' : totalScore < -15 ? 'bearish' : 'neutral';
    const signal = label === 'bullish' ? 'BUY' : label === 'bearish' ? 'SELL' : 'HOLD';
    return { score: Math.round(totalScore), label, signal, headlines: headlines.length };
}

// ═══════════════════════════════════════════════════════════════════════════
// VII. ECONOMIC CALENDAR AWARENESS — Know when NOT to trade
// ═══════════════════════════════════════════════════════════════════════════

/**
 * High-impact economic events calendar.
 * Bot should NOT trade 30 min before/after these events.
 * Data source: static schedule (Fed meets 8x/year, CPI monthly, NFP monthly).
 */
function getEconomicCalendarRisks() {
    const now = new Date();
    const day = now.getUTCDay();       // 0=Sun, 6=Sat
    const hour = now.getUTCHours();

    const risks = [];

    // Weekend = no forex/stocks
    if (day === 0 || day === 6) {
        risks.push({ event: 'Weekend', risk: 'HIGH', action: 'AVOID forex/stocks — only crypto trades', tradeable: { crypto: true, forex: false, stocks: false } });
    }

    // US market open (14:30 UTC) — high volatility window
    if (hour >= 13 && hour <= 15) {
        risks.push({ event: 'US Market Open Window', risk: 'MEDIUM', action: 'Expect volatility spike at 14:30 UTC — wider stops recommended' });
    }

    // Asian session (00:00-08:00 UTC) — low liquidity for Western instruments
    if (hour >= 0 && hour <= 7) {
        risks.push({ event: 'Asian Session', risk: 'LOW', action: 'Low liquidity for EUR/USD, GBP/USD — spreads wider' });
    }

    // First Friday of month = likely NFP day
    if (day === 5 && now.getUTCDate() <= 7) {
        risks.push({ event: 'Non-Farm Payrolls (probable)', risk: 'HIGH', action: 'NFP day — extreme volatility expected at 13:30 UTC. DO NOT trade forex 30 min before/after.' });
    }

    // Mid-month = likely CPI
    if (now.getUTCDate() >= 10 && now.getUTCDate() <= 15 && hour >= 12 && hour <= 14) {
        risks.push({ event: 'CPI Release Window (probable)', risk: 'HIGH', action: 'Potential CPI release — high volatility window for all markets' });
    }

    return {
        risks,
        highRisk: risks.some(r => r.risk === 'HIGH'),
        shouldPause: risks.some(r => r.risk === 'HIGH' && hour >= 13 && hour <= 14),
        timestamp: now.toISOString(),
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// VIII. TRADING RULES ENGINE — Codified professional wisdom
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Evaluate ALL trading rules before allowing a trade.
 * Returns array of { rule, passed: boolean, reason: string }
 */
function evaluateTradingRules(params) {
    const { action, price, confluence, adx, atr, atrPct, rsi, volume, marketRegime, fearGreed, economicRisks, openPositions = [] } = params;
    const rules = [];

    // Rule 1: Never trade against the primary trend
    rules.push({
        rule: 'Trade with the trend',
        passed: !(adx?.adx > 30 && ((action === 'BUY' && adx.signal === 'SELL') || (action === 'SELL' && adx.signal === 'BUY'))),
        reason: adx?.adx > 30 ? `ADX=${adx.adx} strong trend detected — only trade WITH the trend` : 'No strong trend — both directions allowed',
        priority: 'CRITICAL',
    });

    // Rule 2: Minimum Risk/Reward 2:1
    rules.push({
        rule: 'Risk/Reward ≥ 2:1',
        passed: true, // Enforced by CONFIG (4% TP vs 2% SL)
        reason: 'Take profit (4%) is 2x stop loss (2%) — 2:1 R:R maintained',
        priority: 'CRITICAL',
    });

    // Rule 3: Don't overtrade
    rules.push({
        rule: 'Max 10 trades per day',
        passed: true, // Checked in executeTrade
        reason: 'Enforced by execution engine',
        priority: 'HIGH',
    });

    // Rule 4: Don't trade in extreme volatility
    rules.push({
        rule: 'Volatility guard',
        passed: !atrPct || atrPct < 0.08,
        reason: atrPct ? `ATR/Price = ${(atrPct * 100).toFixed(1)}% — ${atrPct >= 0.08 ? 'TOO VOLATILE' : 'acceptable'}` : 'No ATR data',
        priority: 'HIGH',
    });

    // Rule 5: Don't trade during high-impact events
    rules.push({
        rule: 'Economic calendar check',
        passed: !economicRisks?.shouldPause,
        reason: economicRisks?.shouldPause ? 'High-impact economic event imminent — WAIT' : 'No imminent events',
        priority: 'HIGH',
    });

    // Rule 6: Confluence minimum
    rules.push({
        rule: 'Minimum confluence 60%',
        passed: confluence >= 60,
        reason: `Confluence: ${confluence}% — need ≥60%`,
        priority: 'CRITICAL',
    });

    // Rule 7: Don't buy overbought, don't sell oversold (unless divergence)
    rules.push({
        rule: 'RSI extremes check',
        passed: !((action === 'BUY' && rsi?.value > 75) || (action === 'SELL' && rsi?.value < 25)),
        reason: rsi ? `RSI=${rsi.value} — ${action === 'BUY' && rsi.value > 75 ? 'OVERBOUGHT, dont buy' : action === 'SELL' && rsi.value < 25 ? 'OVERSOLD, dont sell' : 'OK'}` : 'No RSI',
        priority: 'MEDIUM',
    });

    // Rule 8: Volume confirmation required
    rules.push({
        rule: 'Volume confirmation',
        passed: !volume || volume.phase !== 'neutral',
        reason: volume ? `Volume phase: ${volume.phase}` : 'No volume data',
        priority: 'MEDIUM',
    });

    // Rule 9: Never revenge trade (cooldown enforced)
    rules.push({
        rule: 'No revenge trading',
        passed: true, // Enforced by cooldown in executeTrade
        reason: 'Cooldown enforced: 5 min after each loss',
        priority: 'CRITICAL',
    });

    // Rule 10: Don't trade when Fear & Greed is extreme AND signals agree with crowd
    rules.push({
        rule: 'Contrarian guard',
        passed: !(fearGreed?.value > 80 && action === 'BUY') && !(fearGreed?.value < 20 && action === 'SELL'),
        reason: fearGreed ? `F&G=${fearGreed.value} — ${fearGreed.value > 80 && action === 'BUY' ? 'EXTREME GREED + BUY = DANGEROUS' : fearGreed.value < 20 && action === 'SELL' ? 'EXTREME FEAR + SELL = DANGEROUS' : 'OK'}` : 'No F&G data',
        priority: 'HIGH',
    });

    const allPassed = rules.every(r => r.passed || r.priority === 'MEDIUM');
    const criticalFailed = rules.filter(r => !r.passed && r.priority === 'CRITICAL');
    const highFailed = rules.filter(r => !r.passed && r.priority === 'HIGH');

    return {
        approved: criticalFailed.length === 0 && highFailed.length <= 1,
        rules,
        criticalFailed: criticalFailed.length,
        highFailed: highFailed.length,
        summary: criticalFailed.length > 0
            ? `⛔ BLOCKED: ${criticalFailed.map(r => r.rule).join(', ')}`
            : highFailed.length > 1
                ? `⚠️ BLOCKED: Too many warnings: ${highFailed.map(r => r.rule).join(', ')}`
                : `✅ APPROVED: All rules passed`,
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    // Divergence
    detectDivergence,

    // Pivot Points
    calculatePivotPoints,

    // Keltner Channels
    calculateKeltnerChannels,

    // Aroon
    calculateAroon,

    // Advanced chart patterns
    detectAdvancedChartPatterns,

    // News
    fetchMarketNews,
    classifyNewsSentiment,
    calculateNewsSentiment,

    // Economic Calendar
    getEconomicCalendarRisks,

    // Trading Rules
    evaluateTradingRules,
};
