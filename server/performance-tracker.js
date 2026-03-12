"use strict";

// ═══════════════════════════════════════════════════════════════════════════
// KelionAI — PERFORMANCE TRACKER
// Tracks equity curve, win rate, Sharpe ratio, max drawdown, streaks
// Persists to Supabase via trades + trade_intelligence tables
// ═══════════════════════════════════════════════════════════════════════════

const logger = require("./logger");

class PerformanceTracker {
  constructor() {
    this.supabase = null;
    this.equityCurve = []; // { ts, equity, pnl, asset, tradeId }
    this.startingBalance = 10000;
    this.stats = {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      breakEven: 0,
      totalPnl: 0,
      bestTrade: null,
      worstTrade: null,
      currentStreak: 0,
      longestWinStreak: 0,
      longestLoseStreak: 0,
      avgHoldTime: 0,
      profitFactor: 0,
    };
  }

  init(supabase) {
    this.supabase = supabase;
    this._loadHistory();
    logger.info(
      { component: "PerfTracker" },
      "Performance Tracker initialized",
    );
  }

  async _loadHistory() {
    if (!this.supabase) return;
    try {
      const { data } = await this.supabase
        .from("trades")
        .select("*")
        .order("created_at", { ascending: true })
        .limit(1000);

      if (data && data.length > 0) {
        let equity = this.startingBalance;
        for (const trade of data) {
          const pnl = parseFloat(trade.pnl) || 0;
          equity += pnl;
          this.equityCurve.push({
            ts: trade.created_at,
            equity: +equity.toFixed(2),
            pnl: +pnl.toFixed(2),
            asset: trade.asset || trade.symbol,
            tradeId: trade.id,
          });
          this._updateStats(trade);
        }
        this._calculateDerivedStats();
        logger.info(
          { component: "PerfTracker", trades: data.length },
          `Loaded ${data.length} historical trades`,
        );
      }
    } catch (e) {
      logger.warn(
        { component: "PerfTracker", err: e.message },
        "Failed to load trade history",
      );
    }
  }

  /**
   * Record a completed trade
   */
  recordTrade(trade) {
    const pnl = parseFloat(trade.pnl) || 0;
    const lastEquity =
      this.equityCurve.length > 0
        ? this.equityCurve[this.equityCurve.length - 1].equity
        : this.startingBalance;

    this.equityCurve.push({
      ts: new Date().toISOString(),
      equity: +(lastEquity + pnl).toFixed(2),
      pnl: +pnl.toFixed(2),
      asset: trade.asset || trade.symbol,
      tradeId: trade.id,
    });

    this._updateStats(trade);
    this._calculateDerivedStats();

    // Keep last 1000 entries
    if (this.equityCurve.length > 1000) {
      this.equityCurve = this.equityCurve.slice(-1000);
    }
  }

  _updateStats(trade) {
    const pnl = parseFloat(trade.pnl) || 0;
    this.stats.totalTrades++;
    this.stats.totalPnl += pnl;

    if (pnl > 0) {
      this.stats.wins++;
      this.stats.currentStreak = Math.max(1, this.stats.currentStreak + 1);
      this.stats.longestWinStreak = Math.max(
        this.stats.longestWinStreak,
        this.stats.currentStreak,
      );
    } else if (pnl < 0) {
      this.stats.losses++;
      this.stats.currentStreak = Math.min(-1, this.stats.currentStreak - 1);
      this.stats.longestLoseStreak = Math.max(
        this.stats.longestLoseStreak,
        Math.abs(this.stats.currentStreak),
      );
    } else {
      this.stats.breakEven++;
      this.stats.currentStreak = 0;
    }

    if (!this.stats.bestTrade || pnl > (this.stats.bestTrade.pnl || 0)) {
      this.stats.bestTrade = {
        pnl: +pnl.toFixed(2),
        asset: trade.asset || trade.symbol,
        date: trade.created_at,
      };
    }
    if (!this.stats.worstTrade || pnl < (this.stats.worstTrade.pnl || 0)) {
      this.stats.worstTrade = {
        pnl: +pnl.toFixed(2),
        asset: trade.asset || trade.symbol,
        date: trade.created_at,
      };
    }
  }

  _calculateDerivedStats() {
    if (this.stats.totalTrades === 0) return;

    // Profit Factor
    const grossProfit = this.equityCurve
      .filter((e) => e.pnl > 0)
      .reduce((s, e) => s + e.pnl, 0);
    const grossLoss = Math.abs(
      this.equityCurve.filter((e) => e.pnl < 0).reduce((s, e) => s + e.pnl, 0),
    );
    this.stats.profitFactor =
      grossLoss > 0
        ? +(grossProfit / grossLoss).toFixed(2)
        : grossProfit > 0
          ? 999
          : 0;
  }

  /**
   * Calculate Sharpe Ratio (annualized)
   */
  getSharpeRatio() {
    if (this.equityCurve.length < 2) return 0;
    const returns = [];
    for (let i = 1; i < this.equityCurve.length; i++) {
      const prev = this.equityCurve[i - 1].equity;
      if (prev > 0) returns.push((this.equityCurve[i].equity - prev) / prev);
    }
    if (returns.length < 2) return 0;

    const avgReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance =
      returns.reduce((s, r) => s + Math.pow(r - avgReturn, 2), 0) /
      (returns.length - 1);
    const stdDev = Math.sqrt(variance);

    if (stdDev === 0) return 0;
    const riskFreeRate = 0.04 / 252; // ~4% annual / 252 trading days
    const sharpe = ((avgReturn - riskFreeRate) / stdDev) * Math.sqrt(252);
    return +sharpe.toFixed(2);
  }

  /**
   * Calculate Max Drawdown (peak-to-trough)
   */
  getMaxDrawdown() {
    if (this.equityCurve.length < 2)
      return {
        pct: 0,
        amount: 0,
        peak: this.startingBalance,
        trough: this.startingBalance,
      };

    let peak = this.equityCurve[0].equity;
    let maxDD = 0;
    let maxDDPct = 0;
    let ddPeak = peak;
    let ddTrough = peak;

    for (const point of this.equityCurve) {
      if (point.equity > peak) peak = point.equity;
      const dd = peak - point.equity;
      const ddPctCalc = peak > 0 ? dd / peak : 0;
      if (ddPctCalc > maxDDPct) {
        maxDDPct = ddPctCalc;
        maxDD = dd;
        ddPeak = peak;
        ddTrough = point.equity;
      }
    }

    return {
      pct: +(maxDDPct * 100).toFixed(2),
      amount: +maxDD.toFixed(2),
      peak: +ddPeak.toFixed(2),
      trough: +ddTrough.toFixed(2),
    };
  }

  /**
   * Get equity curve data for charting
   */
  getEquityCurve(limit = 100) {
    return this.equityCurve.slice(-limit);
  }

  /**
   * Get daily P&L breakdown
   */
  getDailyPnL(days = 30) {
    const daily = {};
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);

    for (const point of this.equityCurve) {
      if (new Date(point.ts) < cutoff) continue;
      const day = point.ts.split("T")[0];
      if (!daily[day]) daily[day] = { date: day, pnl: 0, trades: 0 };
      daily[day].pnl += point.pnl;
      daily[day].trades++;
    }

    return Object.values(daily).map((d) => ({ ...d, pnl: +d.pnl.toFixed(2) }));
  }

  /**
   * Get full performance report
   */
  getReport() {
    const winRate =
      this.stats.totalTrades > 0
        ? +((this.stats.wins / this.stats.totalTrades) * 100).toFixed(1)
        : 0;

    const currentEquity =
      this.equityCurve.length > 0
        ? this.equityCurve[this.equityCurve.length - 1].equity
        : this.startingBalance;

    return {
      summary: {
        totalTrades: this.stats.totalTrades,
        wins: this.stats.wins,
        losses: this.stats.losses,
        breakEven: this.stats.breakEven,
        winRate: winRate + "%",
        totalPnl: +this.stats.totalPnl.toFixed(2),
        totalReturn:
          +(
            ((currentEquity - this.startingBalance) / this.startingBalance) *
            100
          ).toFixed(2) + "%",
        currentEquity,
        startingBalance: this.startingBalance,
      },
      risk: {
        sharpeRatio: this.getSharpeRatio(),
        maxDrawdown: this.getMaxDrawdown(),
        profitFactor: this.stats.profitFactor,
      },
      streaks: {
        current: this.stats.currentStreak,
        longestWin: this.stats.longestWinStreak,
        longestLoss: this.stats.longestLoseStreak,
      },
      bestTrade: this.stats.bestTrade,
      worstTrade: this.stats.worstTrade,
      dailyPnL: this.getDailyPnL(30),
      equityCurve: this.getEquityCurve(50),
    };
  }
}

const tracker = new PerformanceTracker();
module.exports = tracker;
module.exports.PerformanceTracker = PerformanceTracker;
