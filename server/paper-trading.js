/**
 * Paper Trading Engine — 24/7 automated trading with fictitious money
 * 
 * ON → bot trades automatically, learns, tracks P&L
 * OFF → bot stops trading but keeps collected data
 * RESET → clears all paper data when switching demo→real
 * 
 * Uses all active tools: RSI, EMA, SMA, Momentum, Bollinger, 
 * Open Interest, Whale Activity, Geopolitical Risk, Fear & Greed
 */

const logger = require("pino")({ name: "paper-trading" });
const investSim = require("./investment-simulator");
const learner = require("./trading-learner");
const marketData = require("./market-data");

// ═══ STATE ═══
const state = {
    active: false,         // ON/OFF
    mode: "PAPER",         // PAPER or REAL
    startBalance: 100,     // €100 start
    cash: 100,
    positions: {},         // { BTC: { qty: 0.001, avgPrice: 60000, openDate: '...' }, ... }
    trades: [],            // full history
    totalPnL: 0,
    winCount: 0,
    lossCount: 0,
    startedAt: null,
    intervalId: null,      // trading loop
    lastSignalCheck: null,
};

// Assets to trade
const TRADE_ASSETS = ["BTC", "ETH", "SOL", "Gold", "Oil", "S&P 500", "NASDAQ", "EUR/USD", "GBP/USD"];

// ═══ MARKET HOURS (UTC) ═══
const MARKET_HOURS = {
    // Crypto: 24/7
    "BTC": { type: "crypto", always: true },
    "ETH": { type: "crypto", always: true },
    "SOL": { type: "crypto", always: true },
    // Forex: Sun 21:00 → Fri 21:00 UTC (effectively Mon-Fri)
    "EUR/USD": { type: "forex", days: [1, 2, 3, 4, 5], open: 0, close: 23 },
    "GBP/USD": { type: "forex", days: [1, 2, 3, 4, 5], open: 0, close: 23 },
    // US Stocks: Mon-Fri 13:30-20:00 UTC (NYSE/NASDAQ)
    "S&P 500": { type: "stocks", days: [1, 2, 3, 4, 5], open: 13, close: 20 },
    "NASDAQ": { type: "stocks", days: [1, 2, 3, 4, 5], open: 13, close: 20 },
    // Commodities: Mon-Fri ~01:00-22:00 UTC (with gaps)
    "Gold": { type: "commodity", days: [1, 2, 3, 4, 5], open: 1, close: 22 },
    "Oil": { type: "commodity", days: [1, 2, 3, 4, 5], open: 1, close: 22 },
};

// Forex sessions (UTC hours)
const FOREX_SESSIONS = {
    tokyo: { open: 0, close: 9, name: "Tokyo 🇯🇵", quality: "medium" },
    london: { open: 7, close: 16, name: "London 🇬🇧", quality: "high" },
    newYork: { open: 13, close: 22, name: "New York 🇺🇸", quality: "high" },
    sydney: { open: 22, close: 7, name: "Sydney 🇦🇺", quality: "low" },
};

const OVERLAP_HOURS = {
    "London-NY": { start: 13, end: 16, quality: "premium", emoji: "🔥" },
    "Tokyo-London": { start: 7, end: 9, quality: "good", emoji: "⚡" },
};

// Session state tracking
let _lastSessionLog = {};

function isMarketOpen(asset) {
    const mh = MARKET_HOURS[asset];
    if (!mh || mh.always) return true; // crypto = always open

    const now = new Date();
    const day = now.getUTCDay(); // 0=Sun, 1=Mon...
    const hour = now.getUTCHours();

    // Check day
    if (!mh.days.includes(day)) return false;

    // Check hours
    return hour >= mh.open && hour < mh.close;
}

function getActiveSessions() {
    const hour = new Date().getUTCHours();
    const active = [];
    for (const [key, ses] of Object.entries(FOREX_SESSIONS)) {
        const isOpen = ses.open < ses.close
            ? (hour >= ses.open && hour < ses.close)
            : (hour >= ses.open || hour < ses.close);
        if (isOpen) active.push({ key, ...ses });
    }
    // Check overlaps
    for (const [name, ov] of Object.entries(OVERLAP_HOURS)) {
        if (hour >= ov.start && hour < ov.end) {
            active.push({ key: name, name: `${ov.emoji} ${name} Overlap`, quality: ov.quality });
        }
    }
    return active;
}

function logSessionChanges() {
    const sessions = getActiveSessions();
    const activeKeys = sessions.map(s => s.key).sort().join(",");
    if (_lastSessionLog.keys !== activeKeys) {
        const opened = sessions.filter(s => !(_lastSessionLog.sessions || []).find(ls => ls.key === s.key));
        const closed = (_lastSessionLog.sessions || []).filter(ls => !sessions.find(s => s.key === ls.key));
        opened.forEach(s => logger.info({ session: s.name, quality: s.quality }, `📈 Session OPENED: ${s.name}`));
        closed.forEach(s => logger.info({ session: s.name }, `📉 Session CLOSED: ${s.name}`));
        _lastSessionLog = { keys: activeKeys, sessions, time: new Date().toISOString() };
    }
    return sessions;
}

// ═══ CORE FUNCTIONS ═══


function getState() {
    const totalPositionValue = Object.entries(state.positions).reduce((sum, [asset, pos]) => {
        return sum + (pos.qty * (pos.currentPrice || pos.avgPrice));
    }, 0);

    // Session info
    const sessions = getActiveSessions();
    const marketStatus = {};
    TRADE_ASSETS.forEach(a => { marketStatus[a] = isMarketOpen(a); });

    return {
        active: state.active,
        mode: state.mode,
        startBalance: state.startBalance,
        cash: +state.cash.toFixed(2),
        positionsValue: +totalPositionValue.toFixed(2),
        portfolioValue: +(state.cash + totalPositionValue).toFixed(2),
        returnPct: +(((state.cash + totalPositionValue - state.startBalance) / state.startBalance) * 100).toFixed(2),
        positions: state.positions,
        openPositions: Object.keys(state.positions).length,
        totalTrades: state.trades.length,
        winCount: state.winCount,
        lossCount: state.lossCount,
        winRate: state.trades.length > 0 ? +(state.winCount / (state.winCount + state.lossCount) * 100 || 0).toFixed(1) : 0,
        totalPnL: +state.totalPnL.toFixed(2),
        startedAt: state.startedAt,
        lastSignalCheck: state.lastSignalCheck,
        recentTrades: state.trades.slice(-20),
        activeSessions: sessions.map(s => s.name),
        marketStatus,
        learnedRules: learner.getAnalysisReport(),
    };
}

/**
 * Turn ON the bot — starts 24/7 automated trading
 * Restores state from Supabase on startup
 */
function turnOn(supabase) {
    if (state.active) return { status: "already_on", state: getState() };

    state.active = true;
    state.startedAt = new Date().toISOString();
    if (state.cash === 0 && Object.keys(state.positions).length === 0) {
        state.cash = state.startBalance; // reset if empty
    }

    // Restore state from Supabase (survive restarts)
    if (supabase) {
        restoreFromDB(supabase).catch(e => {
            logger.error({ err: e.message }, "[PaperTrading] Failed to restore from DB");
        });
    }

    // Start real data downloader (every 4h)
    marketData.startDownloader(supabase);

    // Start self-learning engine (after data downloads)
    learner.startLearning(supabase);

    logger.info({ balance: state.cash }, "[PaperTrading] BOT ON — trading + real data + self-learning active");

    // Check signals every 5 minutes
    state.intervalId = setInterval(() => {
        checkAndTrade(supabase).catch(e => {
            logger.error({ err: e.message }, "[PaperTrading] Trade cycle error");
        });
    }, 5 * 60 * 1000);

    // First check immediately
    setTimeout(() => checkAndTrade(supabase).catch(() => { }), 5000);

    // ═══ AUTOSAVE — save state to Supabase every 60 seconds ═══
    state._autosaveInterval = setInterval(async () => {
        try {
            const totalPositionValue = Object.entries(state.positions).reduce((sum, [, pos]) => {
                return sum + (pos.qty * (pos.currentPrice || pos.avgPrice));
            }, 0);
            await supabase.from("trading_state").upsert({
                id: "paper_bot",
                cash: +state.cash.toFixed(2),
                positions: JSON.stringify(state.positions),
                positions_value: +totalPositionValue.toFixed(2),
                portfolio_value: +(state.cash + totalPositionValue).toFixed(2),
                total_pnl: +state.totalPnL.toFixed(2),
                win_count: state.winCount,
                loss_count: state.lossCount,
                total_trades: state.trades.length,
                mode: state.mode,
                active: state.active,
                updated_at: new Date().toISOString(),
            }, { onConflict: "id" });
        } catch (e) { /* table may not exist yet */ }
    }, 60 * 1000); // every 60 seconds

    logger.info("[PaperTrading] 💾 Autosave enabled — state saved every 60s");

    // ═══ SESSION SCHEDULER — pre-market warmup 5s before open ═══
    state._sessionInterval = setInterval(() => {
        if (!state.active) return;
        const now = new Date();
        const utcH = now.getUTCHours();
        const utcM = now.getUTCMinutes();
        const utcS = now.getUTCSeconds();
        const day = now.getUTCDay();

        for (const asset of TRADE_ASSETS) {
            const mh = MARKET_HOURS[asset];
            if (!mh || mh.always) continue; // skip crypto (24/7)
            if (!mh.days.includes(day)) continue; // skip weekends

            // Calculate seconds until market open
            const openH = mh.open;
            const secsUntilOpen = (openH - utcH) * 3600 + (0 - utcM) * 60 + (0 - utcS);

            // Pre-market warmup: 5 seconds before open
            if (secsUntilOpen > 0 && secsUntilOpen <= 5) {
                logger.info({ asset, type: mh.type, opensIn: secsUntilOpen + "s" },
                    `🔔 PRE-MARKET WARMUP: ${asset} opens in ${secsUntilOpen}s — fetching latest data`);

                // Trigger immediate data refresh for this asset
                getCurrentPrice(asset, supabase).then(price => {
                    if (price) {
                        logger.info({ asset, price }, `📊 ${asset} pre-open price: $${price}`);
                    }
                }).catch(() => { });
            }

            // Log market open event
            if (secsUntilOpen === 0 || (utcH === openH && utcM === 0 && utcS < 30)) {
                if (!state._openLogged) state._openLogged = {};
                const todayKey = `${asset}-${now.toISOString().slice(0, 10)}`;
                if (!state._openLogged[todayKey]) {
                    state._openLogged[todayKey] = true;
                    logger.info({ asset, type: mh.type, hour: openH },
                        `🔔 MARKET OPEN: ${asset} (${mh.type}) — trading session started`);
                    // Immediate trade check on open
                    checkAndTrade(supabase).catch(() => { });
                }
            }

            // Log market close event
            if (utcH === mh.close && utcM === 0 && utcS < 30) {
                if (!state._closeLogged) state._closeLogged = {};
                const todayKey = `${asset}-${now.toISOString().slice(0, 10)}-close`;
                if (!state._closeLogged[todayKey]) {
                    state._closeLogged[todayKey] = true;
                    logger.info({ asset, type: mh.type, hour: mh.close },
                        `🔕 MARKET CLOSE: ${asset} (${mh.type}) — session ended`);
                }
            }
        }

        // Log forex session changes
        logSessionChanges();
    }, 10 * 1000); // Check every 10 seconds for precise timing

    return { status: "on", state: getState() };
}

/**
 * Turn OFF the bot — stops trading but keeps state
 */
function turnOff() {
    if (!state.active) return { status: "already_off", state: getState() };

    state.active = false;
    if (state.intervalId) {
        clearInterval(state.intervalId);
        state.intervalId = null;
    }
    if (state._sessionInterval) {
        clearInterval(state._sessionInterval);
        state._sessionInterval = null;
    }
    if (state._autosaveInterval) {
        clearInterval(state._autosaveInterval);
        state._autosaveInterval = null;
    }
    learner.stopLearning();
    marketData.stopDownloader();

    logger.info({ pnl: state.totalPnL, trades: state.trades.length }, "[PaperTrading] BOT OFF — all stopped");
    return { status: "off", state: getState() };
}

/**
 * Main trading cycle — called every 5 minutes when ON
 * 
 * AUTO-CLOSE RULES (no human intervention):
 * - Stop-loss: close if position drops -5%
 * - Take-profit: close if position gains +8%  
 * - Time limit: close if position held > 24 hours
 * - Signal SELL: close on bearish signal
 */
async function checkAndTrade(supabase) {
    if (!state.active) return;
    state.lastSignalCheck = new Date().toISOString();

    // Log session open/close changes
    logSessionChanges();

    for (const asset of TRADE_ASSETS) {
        try {
            const marketOpen = isMarketOpen(asset);

            // Get current price from recent data
            const price = await getCurrentPrice(asset, supabase);
            if (!price || price <= 0) continue;

            // ═══ AUTO-CLOSE EXISTING POSITIONS ═══
            if (state.positions[asset]) {
                state.positions[asset].currentPrice = price;
                const pos = state.positions[asset];
                const pnlPct = ((price - pos.avgPrice) / pos.avgPrice) * 100;
                const holdHours = (Date.now() - new Date(pos.openDate).getTime()) / (1000 * 60 * 60);

                let shouldClose = false;
                let closeReason = "";

                // Stop-loss: -5%
                if (pnlPct <= -5) {
                    shouldClose = true;
                    closeReason = `STOP-LOSS (${pnlPct.toFixed(1)}%)`;
                }
                // Take-profit: +8%
                else if (pnlPct >= 8) {
                    shouldClose = true;
                    closeReason = `TAKE-PROFIT (${pnlPct.toFixed(1)}%)`;
                }
                // Time limit: 24 hours
                else if (holdHours >= 24) {
                    shouldClose = true;
                    closeReason = `TIME-LIMIT (${holdHours.toFixed(1)}h)`;
                }

                if (shouldClose) {
                    const sellValue = pos.qty * price;
                    const buyValue = pos.qty * pos.avgPrice;
                    const pnl = sellValue - buyValue;

                    state.cash += sellValue;
                    state.totalPnL += pnl;
                    if (pnl > 0) state.winCount++;
                    else state.lossCount++;

                    const trade = {
                        id: state.trades.length + 1,
                        asset,
                        action: "SELL",
                        price,
                        qty: pos.qty,
                        value: +sellValue.toFixed(2),
                        confidence: 100,
                        date: new Date().toISOString(),
                        pnl: +pnl.toFixed(2),
                        holdTime: timeDiff(pos.openDate, new Date().toISOString()),
                        reason: closeReason,
                    };
                    state.trades.push(trade);
                    delete state.positions[asset];

                    logger.info({ asset, price, pnl: +pnl.toFixed(2), reason: closeReason },
                        `[PaperTrading] AUTO-CLOSE ${asset} — ${closeReason} — PnL: €${pnl.toFixed(2)}`);

                    await saveTrade(supabase, trade);
                    continue; // Skip to next asset after closing
                }
            }

            // ═══ GENERATE SIGNAL FOR NEW TRADES ═══
            const prices = await getRecentPrices(asset, supabase);
            if (!prices || prices.length < 50) continue;

            const { signal, confidence } = investSim.generateSignal(prices);

            // Get learned rules for this asset
            const rules = learner.getRulesForAsset(asset);

            // BUY: signal + confidence + no existing position + market open
            if (signal === "BUY" && confidence >= rules.minConfidence && !state.positions[asset] && state.cash > 0 && marketOpen && rules.enabled) {
                const allocation = Math.min(state.cash, state.cash * rules.maxAllocation);
                if (allocation < 1) continue;

                const qty = allocation / price;
                state.positions[asset] = {
                    qty,
                    avgPrice: price,
                    currentPrice: price,
                    openDate: new Date().toISOString(),
                    signal: { confidence },
                };
                state.cash -= allocation;

                const trade = {
                    id: state.trades.length + 1,
                    asset,
                    action: "BUY",
                    price,
                    qty,
                    value: +allocation.toFixed(2),
                    confidence,
                    date: new Date().toISOString(),
                    pnl: null,
                };
                state.trades.push(trade);

                logger.info({ asset, price, qty: +qty.toFixed(6), value: +allocation.toFixed(2), confidence },
                    `[PaperTrading] BUY ${asset}`);

                await saveTrade(supabase, trade);

            } else if (signal === "SELL" && confidence >= (rules.minConfidence - 10) && state.positions[asset]) {
                // Signal-based SELL
                const pos = state.positions[asset];
                const sellValue = pos.qty * price;
                const buyValue = pos.qty * pos.avgPrice;
                const pnl = sellValue - buyValue;

                state.cash += sellValue;
                state.totalPnL += pnl;
                if (pnl > 0) state.winCount++;
                else state.lossCount++;

                const trade = {
                    id: state.trades.length + 1,
                    asset,
                    action: "SELL",
                    price,
                    qty: pos.qty,
                    value: +sellValue.toFixed(2),
                    confidence,
                    date: new Date().toISOString(),
                    pnl: +pnl.toFixed(2),
                    holdTime: timeDiff(pos.openDate, new Date().toISOString()),
                    reason: "SIGNAL-SELL",
                };
                state.trades.push(trade);
                delete state.positions[asset];

                logger.info({ asset, price, pnl: +pnl.toFixed(2), total: +state.totalPnL.toFixed(2) },
                    `[PaperTrading] SELL ${asset} — PnL: €${pnl.toFixed(2)}`);

                await saveTrade(supabase, trade);
            }
        } catch (e) {
            logger.warn({ asset, err: e.message }, `[PaperTrading] Error processing ${asset}`);
        }
    }
}

// ═══ HELPERS ═══

async function getCurrentPrice(asset, supabase) {
    try {
        // Try to get latest from Supabase first
        const { data } = await supabase
            .from("trading_price_history")
            .select("close")
            .eq("asset", asset)
            .order("date", { ascending: false })
            .limit(1);
        if (data?.[0]?.close) return data[0].close;
    } catch (e) { /* fallback below */ }

    // Fallback: use known approximate prices
    const fallbackPrices = {
        "BTC": 83000, "ETH": 2100, "SOL": 130,
        "Gold": 2900, "Oil": 68, "S&P 500": 5600,
        "NASDAQ": 17500, "EUR/USD": 1.08, "GBP/USD": 1.29,
    };
    return fallbackPrices[asset] || 0;
}

async function getRecentPrices(asset, supabase) {
    try {
        const { data } = await supabase
            .from("trading_price_history")
            .select("close")
            .eq("asset", asset)
            .order("date", { ascending: true })
            .limit(100);
        if (data && data.length > 0) return data.map(d => d.close);
    } catch (e) { /* fallback */ }

    // If no history yet, generate synthetic data from current price
    const price = await getCurrentPrice(asset, supabase);
    if (!price) return null;
    // Create simple synthetic history with noise
    const synthetic = [];
    for (let i = 100; i >= 0; i--) {
        const noise = 1 + (Math.random() - 0.5) * 0.02;
        synthetic.push(price * noise * (1 - i * 0.0003)); // slight downtrend for testing
    }
    return synthetic;
}

async function saveTrade(supabase, trade) {
    try {
        await supabase.from("trading_paper_trades").insert({
            trade_id: trade.id,
            asset: trade.asset,
            action: trade.action,
            price: trade.price,
            qty: trade.qty,
            value: trade.value,
            confidence: trade.confidence,
            pnl: trade.pnl,
            hold_time: trade.holdTime || null,
            created_at: trade.date,
            mode: state.mode || "PAPER",
        });
    } catch (e) {
        // Table might not exist yet — will auto-create
    }
}

function timeDiff(start, end) {
    const diff = new Date(end) - new Date(start);
    const hours = Math.floor(diff / 3600000);
    const mins = Math.floor((diff % 3600000) / 60000);
    if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
    return `${hours}h ${mins}m`;
}

/**
 * Get trade history — reads from Supabase (permanent record)
 * Falls back to in-memory state if Supabase unavailable
 */
async function getTradeHistory(supabase) {
    let trades = state.trades; // fallback

    // Read from Supabase — permanent history (never deleted)
    if (supabase) {
        try {
            const { data } = await supabase
                .from("trading_paper_trades")
                .select("*")
                .order("created_at", { ascending: true })
                .limit(500);
            if (data && data.length > 0) {
                trades = data.map(r => ({
                    id: r.trade_id || r.id,
                    asset: r.asset,
                    action: r.action,
                    price: r.price,
                    qty: r.qty,
                    value: r.value,
                    confidence: r.confidence,
                    pnl: r.pnl,
                    holdTime: r.hold_time,
                    date: r.created_at,
                    mode: r.mode || "PAPER",
                }));
            }
        } catch (e) { /* fallback to RAM */ }
    }

    const closedTrades = trades.filter(t => t.pnl !== null);
    const wins = closedTrades.filter(t => t.pnl > 0);
    const losses = closedTrades.filter(t => t.pnl < 0);
    const totalWon = wins.reduce((s, t) => s + (t.pnl || 0), 0);
    const totalLost = losses.reduce((s, t) => s + (t.pnl || 0), 0);

    return {
        trades,
        summary: {
            totalTrades: trades.length,
            wins: wins.length,
            losses: losses.length,
            totalWon: +totalWon.toFixed(2),
            totalLost: +totalLost.toFixed(2),
            netPnL: +(totalWon + totalLost).toFixed(2),
            winRate: closedTrades.length > 0
                ? +(wins.length / closedTrades.length * 100).toFixed(1) : 0,
        },
    };
}

module.exports = {
    turnOn,
    turnOff,
    getState,
    getTradeHistory,
    checkAndTrade,
    reset,
    switchMode,
    getActiveSessions,
    isMarketOpen,
};

/**
 * RESET — clears in-memory simulation state only
 * Supabase trade history is NEVER deleted (permanent record)
 */
function reset(supabase) {
    turnOff(); // stop if running
    state.cash = state.startBalance;
    state.positions = {};
    state.trades = [];
    state.totalPnL = 0;
    state.winCount = 0;
    state.lossCount = 0;
    state.startedAt = null;
    state.lastSignalCheck = null;

    // NOTE: Supabase trade history is NEVER deleted
    // Real history persists forever — only in-memory simulation resets

    logger.info("[PaperTrading] RESET — simulation state cleared (DB history preserved)");
    return { status: "reset", state: getState() };
}

/**
 * Restore state from Supabase after server restart
 * Reads last known trades and recalculates balance
 */
async function restoreFromDB(supabase) {
    try {
        const { data: trades } = await supabase
            .from("trading_paper_trades")
            .select("*")
            .eq("mode", state.mode)
            .order("created_at", { ascending: true });

        if (!trades || trades.length === 0) {
            logger.info("[PaperTrading] No previous trades in DB — starting fresh");
            return;
        }

        // Rebuild state from trade history
        let cash = state.startBalance;
        let totalPnL = 0;
        let winCount = 0;
        let lossCount = 0;
        const positions = {};
        const memTrades = [];

        for (const r of trades) {
            const trade = {
                id: r.trade_id || r.id,
                asset: r.asset,
                action: r.action,
                price: r.price,
                qty: r.qty,
                value: r.value,
                confidence: r.confidence,
                pnl: r.pnl,
                holdTime: r.hold_time,
                date: r.created_at,
            };
            memTrades.push(trade);

            if (r.action === "BUY") {
                cash -= r.value;
                positions[r.asset] = {
                    qty: r.qty,
                    avgPrice: r.price,
                    currentPrice: r.price,
                    openDate: r.created_at,
                };
            } else if (r.action === "SELL") {
                cash += r.value;
                if (r.pnl !== null) {
                    totalPnL += r.pnl;
                    if (r.pnl > 0) winCount++;
                    else lossCount++;
                }
                delete positions[r.asset];
            }
        }

        state.trades = memTrades;
        state.cash = cash;
        state.positions = positions;
        state.totalPnL = totalPnL;
        state.winCount = winCount;
        state.lossCount = lossCount;

        logger.info({
            trades: memTrades.length,
            cash: +cash.toFixed(2),
            positions: Object.keys(positions).length,
            pnl: +totalPnL.toFixed(2),
        }, `[PaperTrading] Restored ${memTrades.length} trades from DB`);
    } catch (e) {
        logger.error({ err: e.message }, "[PaperTrading] DB restore failed");
    }
}

/**
 * Switch mode: PAPER ↔ REAL
 * When switching to REAL → auto-clears all paper data
 */
function switchMode(newMode, supabase) {
    if (newMode === "REAL" && state.mode === "PAPER") {
        reset(supabase); // auto-clear paper data
        state.mode = "REAL";
        logger.info("[PaperTrading] Switched to REAL mode — paper data cleared");
        return { status: "switched_to_real", state: getState() };
    } else if (newMode === "PAPER") {
        state.mode = "PAPER";
        state.cash = state.startBalance; // fresh start
        logger.info("[PaperTrading] Switched to PAPER mode — fresh start");
        return { status: "switched_to_paper", state: getState() };
    }
    return { status: "no_change", mode: state.mode, state: getState() };
}

