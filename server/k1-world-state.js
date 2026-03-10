"use strict";

/**
 * K1 WORLD STATE — Modelul lumii K1
 * 
 * Menține un snapshot actualizat constant cu:
 * - Markets (prețuri, trenduri, Fear&Greed)
 * - System (health, uptime, active agents)
 * - User (last seen, active project, mood)
 * - Environment (ora, piețe deschise, sesiuni active)
 * - Active Tasks (în curs, progres, ETA)
 * 
 * Actualizare: la fiecare 5 minute
 * Proactive Intelligence: alertează când se schimbă ceva important
 */

const logger = require("pino")({ name: "k1-world-state" });

// ═══════════════════════════════════════════════════════════════
// WORLD STATE — Snapshot al realității
// ═══════════════════════════════════════════════════════════════

const worldState = {
    markets: {
        btc: { price: 0, change24h: 0, trend: "unknown", signal: "HOLD" },
        eth: { price: 0, change24h: 0, trend: "unknown", signal: "HOLD" },
        sol: { price: 0, change24h: 0, trend: "unknown", signal: "HOLD" },
        gold: { price: 0, change24h: 0, trend: "unknown", signal: "HOLD" },
        nasdaq: { price: 0, change24h: 0, trend: "unknown", signal: "HOLD" },
        "sp500": { price: 0, change24h: 0, trend: "unknown", signal: "HOLD" },
        oil: { price: 0, change24h: 0, trend: "unknown", signal: "HOLD" },
        "eurusd": { price: 0, change24h: 0, trend: "unknown", signal: "HOLD" },
        "gbpusd": { price: 0, change24h: 0, trend: "unknown", signal: "HOLD" },
        fearGreed: { value: 50, label: "Neutral", signal: "HOLD" },
    },
    system: {
        health: 100,
        uptime: 0,
        startedAt: new Date().toISOString(),
        activeModules: [],
        lastError: null,
        botActive: false,
        botMode: "PAPER",
        botBalance: 0,
        openPositions: 0,
    },
    user: {
        lastSeen: null,
        lastMessage: null,
        activeProject: "unknown",
        interactionCount: 0,
        preferredDomain: "general",
        sessionStart: null,
    },
    environment: {
        serverTime: new Date().toISOString(),
        dayOfWeek: new Date().getUTCDay(),
        hour: new Date().getUTCHours(),
        marketsOpen: [],
        activeSessions: [],
    },
    activeTasks: [],
    alerts: [],   // Alerte proactive generate
    lastUpdate: null,
};

const bootTime = Date.now();

// ═══════════════════════════════════════════════════════════════
// UPDATE FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Actualizare date piețe — apelat din trading
 */
function updateMarkets(marketData) {
    if (!marketData) return;

    const oldState = JSON.parse(JSON.stringify(worldState.markets));

    Object.entries(marketData).forEach(([key, data]) => {
        const k = key.toLowerCase().replace("/", "").replace(" ", "");
        const target = worldState.markets[k] || worldState.markets[key.toLowerCase()];
        if (target && data) {
            if (data.price) target.price = data.price;
            if (data.change24h !== undefined) target.change24h = data.change24h;
            if (data.signal) target.signal = data.signal;
            target.trend = data.change24h > 2 ? "bullish" : data.change24h < -2 ? "bearish" : "sideways";
        }
    });

    // PROACTIVE: Detectează schimbări mari
    checkMarketAlerts(oldState);
}

/**
 * Actualizare stare sistem
 */
function updateSystem(data) {
    if (data.health !== undefined) worldState.system.health = data.health;
    if (data.botActive !== undefined) worldState.system.botActive = data.botActive;
    if (data.botMode) worldState.system.botMode = data.botMode;
    if (data.botBalance !== undefined) worldState.system.botBalance = data.botBalance;
    if (data.openPositions !== undefined) worldState.system.openPositions = data.openPositions;
    if (data.lastError) worldState.system.lastError = data.lastError;
    if (data.activeModules) worldState.system.activeModules = data.activeModules;
    worldState.system.uptime = Math.round((Date.now() - bootTime) / 1000 / 60); // minutes
}

/**
 * Actualizare date utilizator
 */
function updateUser(data) {
    if (data.lastSeen) worldState.user.lastSeen = data.lastSeen;
    if (data.lastMessage) worldState.user.lastMessage = data.lastMessage;
    if (data.activeProject) worldState.user.activeProject = data.activeProject;
    if (data.interactionCount) worldState.user.interactionCount++;
    if (data.preferredDomain) worldState.user.preferredDomain = data.preferredDomain;
    if (data.sessionStart) worldState.user.sessionStart = data.sessionStart;
}

/**
 * Actualizare environment
 */
function refreshEnvironment() {
    const now = new Date();
    worldState.environment.serverTime = now.toISOString();
    worldState.environment.dayOfWeek = now.getUTCDay();
    worldState.environment.hour = now.getUTCHours();

    // Ce piețe sunt deschise acum?
    const h = now.getUTCHours();
    const day = now.getUTCDay();
    const open = ["crypto"]; // Crypto mereu

    if (day >= 1 && day <= 5) {
        if (h >= 8 && h <= 16) open.push("europe"); // LSE
        if (h >= 14 && h <= 21) open.push("us"); // NYSE/NASDAQ
        if (h >= 0 && h <= 6) open.push("asia"); // Tokyo
        // Forex: Luni-Vineri non-stop
        open.push("forex");
    }

    worldState.environment.marketsOpen = open;

    // Sesiuni de overlap (cele mai bune momente de trading)
    const sessions = [];
    if (h >= 13 && h <= 16) sessions.push("🔥 London-NY overlap (premium)");
    if (h >= 7 && h <= 9) sessions.push("⚡ Tokyo-London overlap");
    worldState.environment.activeSessions = sessions;

    worldState.lastUpdate = now.toISOString();
}

// ═══════════════════════════════════════════════════════════════
// PROACTIVE INTELLIGENCE — Alertează când e important
// ═══════════════════════════════════════════════════════════════

const MAX_ALERTS = 50;

function checkMarketAlerts(oldMarkets) {
    // BTC scade >5% → alertă
    const btcOld = oldMarkets.btc?.price || 0;
    const btcNew = worldState.markets.btc.price;
    if (btcOld > 0 && btcNew > 0) {
        const change = ((btcNew - btcOld) / btcOld) * 100;
        if (change <= -5) {
            addAlert("warning", `⚠️ BTC a scăzut ${change.toFixed(1)}% — de la $${btcOld} la $${btcNew}`);
        }
        if (change >= 5) {
            addAlert("info", `📈 BTC a crescut ${change.toFixed(1)}% — de la $${btcOld} la $${btcNew}`);
        }
    }

    // Fear & Greed extreme
    const fg = worldState.markets.fearGreed;
    if (fg.value <= 20 && fg.value > 0) {
        addAlert("opportunity", `😱 Extreme Fear (${fg.value}) — posibilitate de cumpărare`);
    }
    if (fg.value >= 80) {
        addAlert("warning", `🤑 Extreme Greed (${fg.value}) — atenție la corecție`);
    }
}

function addAlert(type, message) {
    const alert = {
        id: worldState.alerts.length + 1,
        type, // info, warning, opportunity, error
        message,
        timestamp: new Date().toISOString(),
        read: false,
    };
    worldState.alerts.push(alert);
    if (worldState.alerts.length > MAX_ALERTS) worldState.alerts.shift();
    logger.info({ type }, `[K1-World] 🔔 ${message}`);
}

function getAlerts(unreadOnly = false) {
    if (unreadOnly) return worldState.alerts.filter(a => !a.read);
    return worldState.alerts.slice(-20);
}

function markAlertsRead() {
    worldState.alerts.forEach(a => { a.read = true; });
}

// ═══════════════════════════════════════════════════════════════
// GETTERS
// ═══════════════════════════════════════════════════════════════

function getWorldState() {
    refreshEnvironment();
    return { ...worldState };
}

function getMarketSummary() {
    return {
        markets: worldState.markets,
        openMarkets: worldState.environment.marketsOpen,
        sessions: worldState.environment.activeSessions,
        fearGreed: worldState.markets.fearGreed,
    };
}

function getSystemHealth() {
    return worldState.system;
}

// Auto-refresh environment la 5 min
setInterval(refreshEnvironment, 5 * 60 * 1000);
refreshEnvironment(); // Prima dată la boot

module.exports = {
    getWorldState,
    getMarketSummary,
    getSystemHealth,
    updateMarkets,
    updateSystem,
    updateUser,
    addAlert,
    getAlerts,
    markAlertsRead,
    refreshEnvironment,
};
