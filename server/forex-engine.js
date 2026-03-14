'use strict';

// ═══════════════════════════════════════════════════════════════════════════
// KelionAI — Forex Engine (OANDA v20)
// Pip calculator, lot sizing, session-aware trading, spread monitoring,
// swap awareness, margin management. Built for EUR/USD, GBP/USD, etc.
// "Intrăm în forex cu tancul."
// ═══════════════════════════════════════════════════════════════════════════

const logger = require('./logger');

// ── Forex pair metadata ──
const PAIRS = {
  EUR_USD: {
    pipSize: 0.0001,
    pipValue: 10,
    avgSpread: 0.00012,
    baseCcy: 'EUR',
    quoteCcy: 'USD',
  },
  GBP_USD: {
    pipSize: 0.0001,
    pipValue: 10,
    avgSpread: 0.00015,
    baseCcy: 'GBP',
    quoteCcy: 'USD',
  },
  USD_JPY: {
    pipSize: 0.01,
    pipValue: 6.7,
    avgSpread: 0.012,
    baseCcy: 'USD',
    quoteCcy: 'JPY',
  },
  GBP_JPY: {
    pipSize: 0.01,
    pipValue: 6.7,
    avgSpread: 0.025,
    baseCcy: 'GBP',
    quoteCcy: 'JPY',
  },
  EUR_GBP: {
    pipSize: 0.0001,
    pipValue: 12.5,
    avgSpread: 0.00015,
    baseCcy: 'EUR',
    quoteCcy: 'GBP',
  },
  AUD_USD: {
    pipSize: 0.0001,
    pipValue: 10,
    avgSpread: 0.00015,
    baseCcy: 'AUD',
    quoteCcy: 'USD',
  },
  USD_CHF: {
    pipSize: 0.0001,
    pipValue: 10,
    avgSpread: 0.00015,
    baseCcy: 'USD',
    quoteCcy: 'CHF',
  },
  USD_CAD: {
    pipSize: 0.0001,
    pipValue: 7.5,
    avgSpread: 0.00018,
    baseCcy: 'USD',
    quoteCcy: 'CAD',
  },
  NZD_USD: {
    pipSize: 0.0001,
    pipValue: 10,
    avgSpread: 0.00018,
    baseCcy: 'NZD',
    quoteCcy: 'USD',
  },
  EUR_JPY: {
    pipSize: 0.01,
    pipValue: 6.7,
    avgSpread: 0.02,
    baseCcy: 'EUR',
    quoteCcy: 'JPY',
  },
};

// ── Trading sessions (UTC) ──
const SESSIONS = {
  tokyo: { open: 0, close: 9, name: 'Tokyo', emoji: '🇯🇵', quality: 'medium' },
  london: { open: 7, close: 16, name: 'London', emoji: '🇬🇧', quality: 'high' },
  newYork: {
    open: 13,
    close: 22,
    name: 'New York',
    emoji: '🇺🇸',
    quality: 'high',
  },
  sydney: { open: 22, close: 7, name: 'Sydney', emoji: '🇦🇺', quality: 'low' },
};

// Session overlaps — BEST trading times
const OVERLAPS = [
  { name: 'London-NY', start: 13, end: 16, quality: 'premium', emoji: '🔥' },
  { name: 'Tokyo-London', start: 7, end: 9, quality: 'good', emoji: '⚡' },
];

class ForexEngine {
  constructor() {
    this.oandaKey = process.env.OANDA_API_KEY || '';
    this.oandaAcct = process.env.OANDA_ACCOUNT_ID || '';
    this.oandaHost =
      (process.env.OANDA_ENV || 'practice') === 'live' ? 'api-fxtrade.oanda.com' : 'api-fxpractice.oanda.com';
    this.maxSpreadPips = parseFloat(process.env.FOREX_MAX_SPREAD_PIPS || '3');
    this.defaultLeverage = parseInt(process.env.FOREX_LEVERAGE || '100', 10);
  }

  // ═══════════════════════════════════════════════════════════════
  // PIP CALCULATOR — the math that matters
  // ═══════════════════════════════════════════════════════════════

  getPairInfo(pair) {
    return PAIRS[pair] || null;
  }

  // Convert price difference to pips
  toPips(pair, priceDiff) {
    const info = PAIRS[pair];
    if (!info) return 0;
    return Math.abs(priceDiff) / info.pipSize;
  }

  // Convert pips to price difference
  fromPips(pair, pips) {
    const info = PAIRS[pair];
    if (!info) return 0;
    return pips * info.pipSize;
  }

  // Calculate pip value in account currency (USD assumed)
  pipValueUSD(pair, lotSize = 1.0) {
    const info = PAIRS[pair];
    if (!info) return 0;
    return info.pipValue * lotSize; // standard lot = 100,000 units
  }

  // ═══════════════════════════════════════════════════════════════
  // LOT SIZING — risk-based position sizing
  // ═══════════════════════════════════════════════════════════════

  // Calculate lot size based on risk percentage and SL distance
  calculateLotSize(pair, accountBalance, riskPct, stopLossPips) {
    const info = PAIRS[pair];
    if (!info || stopLossPips <= 0) return { lots: 0, units: 0, error: 'Invalid params' };

    const riskAmount = accountBalance * (riskPct / 100);
    const pipVal = info.pipValue; // per standard lot
    const lots = riskAmount / (stopLossPips * pipVal);

    // Lot types
    const standardLots = +lots.toFixed(2);
    const miniLots = +(lots * 10).toFixed(1);
    const microLots = +(lots * 100).toFixed(0);
    const units = Math.round(lots * 100000);

    return {
      lots: standardLots,
      miniLots,
      microLots,
      units,
      riskAmount: +riskAmount.toFixed(2),
      pipValue: +(pipVal * standardLots).toFixed(2),
      marginRequired: +(units / this.defaultLeverage).toFixed(2),
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // SESSION AWARENESS — when to trade
  // ═══════════════════════════════════════════════════════════════

  getCurrentSession() {
    const now = new Date();
    const hour = now.getUTCHours();
    const minute = now.getUTCMinutes();
    const decimal = hour + minute / 60;

    const activeSessions = [];
    for (const [key, ses] of Object.entries(SESSIONS)) {
      if (ses.open < ses.close) {
        if (decimal >= ses.open && decimal < ses.close) activeSessions.push({ ...ses, key });
      } else {
        // Overnight (Sydney)
        if (decimal >= ses.open || decimal < ses.close) activeSessions.push({ ...ses, key });
      }
    }

    // Check overlaps
    const activeOverlaps = OVERLAPS.filter((o) => decimal >= o.start && decimal < o.end);

    const isWeekend = now.getUTCDay() === 0 || now.getUTCDay() === 6;
    const bestTime = activeOverlaps.length > 0;
    const goodTime = activeSessions.some((s) => s.quality === 'high');

    return {
      utcHour: hour,
      sessions: activeSessions,
      overlaps: activeOverlaps,
      isWeekend,
      marketOpen: !isWeekend,
      tradingQuality: isWeekend ? 'closed' : bestTime ? 'premium' : goodTime ? 'high' : 'medium',
      recommendation: isWeekend
        ? '⛔ Market closed (weekend)'
        : bestTime
          ? '🔥 BEST TIME — London-NY overlap'
          : goodTime
            ? '✅ Good — major session active'
            : '⚠️ Low volatility — careful',
    };
  }

  // Best pairs for current session
  getBestPairsNow() {
    const session = this.getCurrentSession();
    if (!session.marketOpen) return [];

    const isLondon = session.sessions.some((s) => s.key === 'london');
    const isNY = session.sessions.some((s) => s.key === 'newYork');
    const isTokyo = session.sessions.some((s) => s.key === 'tokyo');

    const pairs = [];
    if (isLondon || isNY) {
      pairs.push('EUR_USD', 'GBP_USD', 'USD_CHF', 'EUR_GBP');
    }
    if (isNY) {
      pairs.push('USD_CAD', 'USD_JPY');
    }
    if (isTokyo) {
      pairs.push('USD_JPY', 'EUR_JPY', 'GBP_JPY', 'AUD_USD', 'NZD_USD');
    }

    return [...new Set(pairs)];
  }

  // ═══════════════════════════════════════════════════════════════
  // SPREAD MONITORING — don't enter when spread is wide
  // ═══════════════════════════════════════════════════════════════

  checkSpread(pair, currentBid, currentAsk) {
    const info = PAIRS[pair];
    if (!info) return { ok: false, reason: 'Unknown pair' };

    const spreadRaw = currentAsk - currentBid;
    const spreadPips = spreadRaw / info.pipSize;
    const avgSpreadPips = info.avgSpread / info.pipSize;
    const spreadRatio = spreadPips / avgSpreadPips;

    const ok = spreadPips <= this.maxSpreadPips;

    return {
      ok,
      spreadPips: +spreadPips.toFixed(1),
      avgSpreadPips: +avgSpreadPips.toFixed(1),
      spreadRatio: +spreadRatio.toFixed(2),
      status: ok ? '✅ Normal' : '🚫 Too wide',
      reason: ok ? null : `Spread ${spreadPips.toFixed(1)} pips > max ${this.maxSpreadPips} pips`,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // STOP LOSS / TAKE PROFIT — forex-specific
  // ═══════════════════════════════════════════════════════════════

  calculateSLTP(pair, entryPrice, direction, slPips = 20, tpPips = 40) {
    const info = PAIRS[pair];
    if (!info) return null;

    const slDistance = slPips * info.pipSize;
    const tpDistance = tpPips * info.pipSize;

    if (direction === 'BUY') {
      return {
        entry: entryPrice,
        stopLoss: +(entryPrice - slDistance).toFixed(5),
        takeProfit: +(entryPrice + tpDistance).toFixed(5),
        riskReward: +(tpPips / slPips).toFixed(2),
        slPips,
        tpPips,
      };
    } else {
      return {
        entry: entryPrice,
        stopLoss: +(entryPrice + slDistance).toFixed(5),
        takeProfit: +(entryPrice - tpDistance).toFixed(5),
        riskReward: +(tpPips / slPips).toFixed(2),
        slPips,
        tpPips,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // SWAP/ROLLOVER AWARENESS — overnight costs
  // ═══════════════════════════════════════════════════════════════

  getSwapInfo(pair) {
    // Approximate daily swap rates (in pips) — updated from broker
    const swapRates = {
      EUR_USD: { long: -0.8, short: 0.2, tripleWed: true },
      GBP_USD: { long: -0.5, short: 0.1, tripleWed: true },
      USD_JPY: { long: 0.4, short: -1.2, tripleWed: true },
      GBP_JPY: { long: 0.3, short: -1.0, tripleWed: true },
      AUD_USD: { long: -0.3, short: -0.1, tripleWed: true },
    };
    return swapRates[pair] || { long: 0, short: 0, tripleWed: true };
  }

  shouldAvoidOvernight(pair, direction) {
    const swap = this.getSwapInfo(pair);
    const cost = direction === 'BUY' ? swap.long : swap.short;
    return { avoidOvernight: cost < -0.5, swapCostPips: cost };
  }

  // ═══════════════════════════════════════════════════════════════
  // OANDA API — place real/paper orders
  // ═══════════════════════════════════════════════════════════════

  async placeOrder(pair, units, type = 'MARKET', slPrice = null, tpPrice = null) {
    if (!this.oandaKey || !this.oandaAcct) {
      return {
        success: false,
        error: 'OANDA not configured (set OANDA_API_KEY + OANDA_ACCOUNT_ID)',
      };
    }

    const orderBody = {
      order: {
        type: type,
        instrument: pair,
        units: String(units), // positive=buy, negative=sell
        timeInForce: 'FOK', // Fill or Kill
      },
    };

    if (slPrice) orderBody.order.stopLossOnFill = { price: String(slPrice) };
    if (tpPrice) orderBody.order.takeProfitOnFill = { price: String(tpPrice) };

    try {
      const url = `https://${this.oandaHost}/v3/accounts/${this.oandaAcct}/orders`;
      const r = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.oandaKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(orderBody),
      });
      const data = await r.json();

      if (r.ok) {
        logger.info({ component: 'Forex', pair, units, type }, '✅ Order placed via OANDA');
        return { success: true, data };
      } else {
        logger.error({ component: 'Forex', err: JSON.stringify(data) }, 'OANDA order failed');
        return { success: false, error: data.errorMessage || 'Order rejected' };
      }
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // ACCOUNT INFO
  // ═══════════════════════════════════════════════════════════════

  async getAccountSummary() {
    if (!this.oandaKey || !this.oandaAcct) {
      return { connected: false, error: 'OANDA not configured' };
    }
    try {
      const url = `https://${this.oandaHost}/v3/accounts/${this.oandaAcct}/summary`;
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${this.oandaKey}` },
      });
      if (r.ok) {
        const data = await r.json();
        const acct = data.account;
        return {
          connected: true,
          balance: parseFloat(acct.balance),
          unrealizedPnL: parseFloat(acct.unrealizedPL),
          nav: parseFloat(acct.NAV),
          marginUsed: parseFloat(acct.marginUsed),
          marginAvailable: parseFloat(acct.marginAvailable),
          openPositions: parseInt(acct.openPositionCount),
          openTrades: parseInt(acct.openTradeCount),
          currency: acct.currency,
        };
      }
      return { connected: false, error: 'API error' };
    } catch (e) {
      return { connected: false, error: e.message };
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // FULL PRE-TRADE CHECK — everything before entering a forex trade
  // ═══════════════════════════════════════════════════════════════

  preTradeCheck(pair, direction, currentBid, currentAsk) {
    const checks = [];

    // 1. Session check
    const session = this.getCurrentSession();
    checks.push({
      name: 'Session',
      passed: session.tradingQuality !== 'closed' && session.tradingQuality !== 'medium',
      detail: session.recommendation,
    });

    // 2. Spread check
    const spread = this.checkSpread(pair, currentBid, currentAsk);
    checks.push({
      name: 'Spread',
      passed: spread.ok,
      detail: `${spread.spreadPips} pips (max: ${this.maxSpreadPips})`,
    });

    // 3. Best pairs check
    const bestPairs = this.getBestPairsNow();
    checks.push({
      name: 'Pair Quality',
      passed: bestPairs.includes(pair),
      detail: bestPairs.includes(pair) ? '✅ Good for this session' : '⚠️ Not ideal for current session',
    });

    // 4. Overnight risk
    const swap = this.shouldAvoidOvernight(pair, direction);
    checks.push({
      name: 'Swap Risk',
      passed: !swap.avoidOvernight,
      detail: `Swap: ${swap.swapCostPips} pips/day`,
    });

    const allPassed = checks.every((c) => c.passed);
    const criticalFails = checks.filter((c) => !c.passed && (c.name === 'Session' || c.name === 'Spread'));

    return {
      approved: allPassed || criticalFails.length === 0,
      checks,
      summary: allPassed ? '✅ All checks passed' : `⚠️ ${checks.filter((c) => !c.passed).length} issues`,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // ALL PAIRS INFO
  // ═══════════════════════════════════════════════════════════════

  getAllPairs() {
    return Object.entries(PAIRS).map(([pair, info]) => ({
      pair,
      ...info,
      swap: this.getSwapInfo(pair),
    }));
  }
}

const forexEngine = new ForexEngine();

/**
 * undefined
 * @returns {*}
 */
module.exports = forexEngine;
module.exports.ForexEngine = ForexEngine;
module.exports.PAIRS = PAIRS;
module.exports.SESSIONS = SESSIONS;
