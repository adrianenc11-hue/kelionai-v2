"use strict";

// ═══════════════════════════════════════════════════════════════════════════
// TRADE PERSISTENCE — Supabase storage for all trading data
// Saves: analyses, signals, trades, performance metrics
// Brain reads this for strategy learning and optimization
// ═══════════════════════════════════════════════════════════════════════════

const logger = require("./logger");
const { supabaseAdmin } = require("./supabase");

const TABLE = {
    ANALYSES: "trading_analyses",
    SIGNALS: "trading_signals",
    TRADES: "trading_trades",
    PERFORMANCE: "trading_performance",
    STRATEGIES: "trading_strategy_log",
};

// ═══ ENSURE TABLES EXIST ═══
async function ensureTables() {
    if (!supabaseAdmin) {
        logger.warn({ component: "TradePersistence" }, "⚠️ Supabase not configured — trading data will NOT be persisted");
        return false;
    }

    try {
        // Create tables if they don't exist via raw SQL
        const { error } = await supabaseAdmin.rpc("exec_sql", {
            query: `
        CREATE TABLE IF NOT EXISTS trading_analyses (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          asset TEXT NOT NULL,
          price NUMERIC,
          signal TEXT,
          confidence INTEGER,
          rsi NUMERIC,
          macd_signal TEXT,
          bollinger_signal TEXT,
          ema_signal TEXT,
          volume_phase TEXT,
          sentiment TEXT,
          data_source TEXT,
          change_pct NUMERIC,
          raw_data JSONB,
          created_at TIMESTAMPTZ DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS trading_signals (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          asset TEXT NOT NULL,
          signal TEXT NOT NULL,
          confidence INTEGER,
          entry_price NUMERIC,
          target_price NUMERIC,
          stop_loss NUMERIC,
          risk_reward NUMERIC,
          timeframe TEXT,
          atr_pct NUMERIC,
          raw_data JSONB,
          created_at TIMESTAMPTZ DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS trading_trades (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          asset TEXT NOT NULL,
          action TEXT NOT NULL,
          entry_price NUMERIC,
          exit_price NUMERIC,
          size NUMERIC,
          pnl NUMERIC,
          pnl_pct NUMERIC,
          reason TEXT,
          strategy TEXT,
          confluence INTEGER,
          status TEXT DEFAULT 'open',
          opened_at TIMESTAMPTZ DEFAULT now(),
          closed_at TIMESTAMPTZ
        );

        CREATE TABLE IF NOT EXISTS trading_performance (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          date DATE NOT NULL,
          total_trades INTEGER DEFAULT 0,
          wins INTEGER DEFAULT 0,
          losses INTEGER DEFAULT 0,
          total_pnl NUMERIC DEFAULT 0,
          win_rate NUMERIC,
          sharpe_ratio NUMERIC,
          max_drawdown NUMERIC,
          best_strategy TEXT,
          raw_data JSONB,
          created_at TIMESTAMPTZ DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS trading_strategy_log (
          id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
          strategy TEXT NOT NULL,
          asset TEXT,
          signal TEXT,
          confidence INTEGER,
          outcome TEXT,
          pnl NUMERIC,
          notes TEXT,
          brain_analysis TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_analyses_asset ON trading_analyses(asset, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_signals_asset ON trading_signals(asset, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_trades_asset ON trading_trades(asset, opened_at DESC);
        CREATE INDEX IF NOT EXISTS idx_perf_date ON trading_performance(date DESC);
      `,
        });

        if (error) {
            // If rpc doesn't exist, try direct insert to check if tables exist
            logger.warn({ component: "TradePersistence", err: error.message }, "RPC not available, tables may need manual creation");
            return false;
        }

        logger.info({ component: "TradePersistence" }, "✅ Trading tables ensured in Supabase");
        return true;
    } catch (e) {
        logger.warn({ component: "TradePersistence", err: e.message }, "Table creation skipped — will try direct inserts");
        return true; // Try anyway
    }
}

// ═══ SAVE ANALYSIS ═══
async function saveAnalysis(assetData) {
    if (!supabaseAdmin || !assetData) return;

    try {
        const record = {
            asset: assetData.asset || assetData.symbol,
            price: assetData.price,
            signal: assetData.signal || assetData.confluence?.signal,
            confidence: assetData.confidence || assetData.confluence?.confidence,
            rsi: assetData.rsi?.value,
            macd_signal: assetData.macd?.crossSignal,
            bollinger_signal: assetData.bollinger?.signal,
            ema_signal: assetData.ema?.signal,
            volume_phase: assetData.volume?.phase,
            sentiment: assetData.sentiment?.label,
            data_source: assetData.dataSource,
            change_pct: assetData.changePercent,
            raw_data: assetData,
        };

        const { error } = await supabaseAdmin
            .from(TABLE.ANALYSES)
            .insert(record);

        if (error) throw error;
        logger.debug({ component: "TradePersistence", asset: record.asset }, `💾 Analysis saved: ${record.asset}`);
    } catch (e) {
        logger.warn({ component: "TradePersistence", err: e.message }, "Failed to save analysis");
    }
}

// ═══ SAVE ALL ANALYSES (batch) ═══
async function saveAllAnalyses(assetsArray) {
    if (!supabaseAdmin || !assetsArray?.length) return;

    try {
        const records = assetsArray.map(a => ({
            asset: a.asset || a.symbol,
            price: a.price,
            signal: a.signal || a.confluence?.signal,
            confidence: a.confidence || a.confluence?.confidence,
            rsi: a.rsi?.value,
            macd_signal: a.macd?.crossSignal,
            bollinger_signal: a.bollinger?.signal,
            ema_signal: a.ema?.signal,
            volume_phase: a.volume?.phase,
            sentiment: a.sentiment?.label,
            data_source: a.dataSource,
            change_pct: a.changePercent,
            raw_data: a,
        }));

        const { error } = await supabaseAdmin
            .from(TABLE.ANALYSES)
            .insert(records);

        if (error) throw error;
        logger.info({ component: "TradePersistence", count: records.length }, `💾 ${records.length} analyses saved to Supabase`);
    } catch (e) {
        logger.warn({ component: "TradePersistence", err: e.message }, "Failed to save batch analyses");
    }
}

// ═══ SAVE SIGNAL ═══
async function saveSignal(signalData) {
    if (!supabaseAdmin || !signalData) return;

    try {
        const record = {
            asset: signalData.asset || signalData.symbol,
            signal: signalData.signal,
            confidence: signalData.confidence,
            entry_price: signalData.entry,
            target_price: signalData.target || signalData.takeProfit,
            stop_loss: signalData.stopLoss,
            risk_reward: signalData.riskReward,
            timeframe: signalData.timeframe,
            raw_data: signalData,
        };

        const { error } = await supabaseAdmin
            .from(TABLE.SIGNALS)
            .insert(record);

        if (error) throw error;
        logger.debug({ component: "TradePersistence", asset: record.asset }, `💾 Signal saved: ${record.asset} ${record.signal}`);
    } catch (e) {
        logger.warn({ component: "TradePersistence", err: e.message }, "Failed to save signal");
    }
}

// ═══ SAVE TRADE ═══
async function saveTrade(tradeData) {
    if (!supabaseAdmin || !tradeData) return;

    try {
        const record = {
            asset: tradeData.asset || tradeData.symbol,
            action: tradeData.action || tradeData.signal,
            entry_price: tradeData.entryPrice || tradeData.entry,
            exit_price: tradeData.exitPrice,
            size: tradeData.size || tradeData.positionSize,
            pnl: tradeData.pnl,
            pnl_pct: tradeData.pnlPct,
            reason: tradeData.reason,
            strategy: tradeData.strategy,
            confluence: tradeData.confluence,
            status: tradeData.exitPrice ? "closed" : "open",
            closed_at: tradeData.exitPrice ? new Date().toISOString() : null,
        };

        const { error } = await supabaseAdmin
            .from(TABLE.TRADES)
            .insert(record);

        if (error) throw error;
        logger.info({ component: "TradePersistence", asset: record.asset, action: record.action }, `💾 Trade saved: ${record.action} ${record.asset}`);
    } catch (e) {
        logger.warn({ component: "TradePersistence", err: e.message }, "Failed to save trade");
    }
}

// ═══ SAVE DAILY PERFORMANCE ═══
async function saveDailyPerformance(perfData) {
    if (!supabaseAdmin || !perfData) return;

    try {
        const today = new Date().toISOString().slice(0, 10);
        const record = {
            date: today,
            total_trades: perfData.totalTrades || 0,
            wins: perfData.wins || 0,
            losses: perfData.losses || 0,
            total_pnl: perfData.totalPnl || 0,
            win_rate: perfData.winRate,
            sharpe_ratio: perfData.sharpeRatio,
            max_drawdown: perfData.maxDrawdown,
            best_strategy: perfData.bestStrategy,
            raw_data: perfData,
        };

        // Upsert by date
        const { error } = await supabaseAdmin
            .from(TABLE.PERFORMANCE)
            .upsert(record, { onConflict: "date" });

        if (error) throw error;
        logger.info({ component: "TradePersistence", date: today }, `💾 Daily performance saved`);
    } catch (e) {
        logger.warn({ component: "TradePersistence", err: e.message }, "Failed to save performance");
    }
}

// ═══ SAVE STRATEGY LOG (brain learning) ═══
async function logStrategy(strategyData) {
    if (!supabaseAdmin || !strategyData) return;

    try {
        const record = {
            strategy: strategyData.strategy,
            asset: strategyData.asset,
            signal: strategyData.signal,
            confidence: strategyData.confidence,
            outcome: strategyData.outcome,
            pnl: strategyData.pnl,
            notes: strategyData.notes,
            brain_analysis: strategyData.brainAnalysis,
        };

        const { error } = await supabaseAdmin
            .from(TABLE.STRATEGIES)
            .insert(record);

        if (error) throw error;
        logger.debug({ component: "TradePersistence" }, `💾 Strategy logged: ${record.strategy} on ${record.asset}`);
    } catch (e) {
        logger.warn({ component: "TradePersistence", err: e.message }, "Failed to log strategy");
    }
}

// ═══ READ: Get recent analyses for brain ═══
async function getRecentAnalyses(asset, limit = 50) {
    if (!supabaseAdmin) return [];

    try {
        let query = supabaseAdmin
            .from(TABLE.ANALYSES)
            .select("*")
            .order("created_at", { ascending: false })
            .limit(limit);

        if (asset) query = query.eq("asset", asset);
        const { data, error } = await query;
        if (error) throw error;
        return data || [];
    } catch (e) {
        logger.warn({ component: "TradePersistence", err: e.message }, "Failed to read analyses");
        return [];
    }
}

// ═══ READ: Get trade history ═══
async function getTradeHistory(limit = 100) {
    if (!supabaseAdmin) return [];

    try {
        const { data, error } = await supabaseAdmin
            .from(TABLE.TRADES)
            .select("*")
            .order("opened_at", { ascending: false })
            .limit(limit);

        if (error) throw error;
        return data || [];
    } catch (e) {
        logger.warn({ component: "TradePersistence", err: e.message }, "Failed to read trades");
        return [];
    }
}

// ═══ READ: Get strategy performance ═══
async function getStrategyStats() {
    if (!supabaseAdmin) return {};

    try {
        const { data, error } = await supabaseAdmin
            .from(TABLE.STRATEGIES)
            .select("strategy, outcome, pnl");

        if (error) throw error;
        if (!data?.length) return {};

        // Aggregate by strategy
        const stats = {};
        data.forEach(row => {
            if (!stats[row.strategy]) {
                stats[row.strategy] = { total: 0, wins: 0, losses: 0, totalPnl: 0 };
            }
            stats[row.strategy].total++;
            if (row.outcome === "win") stats[row.strategy].wins++;
            if (row.outcome === "loss") stats[row.strategy].losses++;
            stats[row.strategy].totalPnl += row.pnl || 0;
        });

        for (const s of Object.keys(stats)) {
            stats[s].winRate = stats[s].total > 0
                ? Math.round((stats[s].wins / stats[s].total) * 100)
                : 0;
        }

        return stats;
    } catch (e) {
        logger.warn({ component: "TradePersistence", err: e.message }, "Failed to read strategy stats");
        return {};
    }
}

module.exports = {
    ensureTables,
    saveAnalysis,
    saveAllAnalyses,
    saveSignal,
    saveTrade,
    saveDailyPerformance,
    logStrategy,
    getRecentAnalyses,
    getTradeHistory,
    getStrategyStats,
    TABLE,
};
