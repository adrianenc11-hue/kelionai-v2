/**
 * Investment Simulator — Backtests 100€ across all assets and timeframes
 * Uses ALL active trading tools to generate signals and simulate trades
 * Results become PER-ASSET learning rules for the brain
 *
 * RULE LIFECYCLE: POTENTIAL → TESTING → CONFIRMED
 *   POTENTIAL: First seen, needs verification (runs < 3)
 *   TESTING: Confirmed 3+ times, still in validation
 *   CONFIRMED: Confirmed 5+ times with consistent results
 *
 * IMPORTANT: Each rule is PER-ASSET — no general rules allowed
 *
 * Periods: 1Y, 3Y, 5Y, 10Y, MAX
 * Assets: BTC, ETH, SOL, EUR/USD, GBP/USD, S&P 500, NASDAQ, Gold, Oil
 */

const logger = require("pino")({ name: "investment-sim" });

// ═══ TECHNICAL INDICATORS ═══

function calcRSI(prices, period = 14) {
    if (prices.length < period + 1) return 50;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff > 0) gains += diff;
        else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return +(100 - 100 / (1 + avgGain / avgLoss)).toFixed(2);
}

function calcEMA(prices, period) {
    const k = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
}

// ═══ SIGNAL ENGINE — confluence of 5 indicators ═══

function generateSignal(priceWindow) {
    if (priceWindow.length < 50) return { signal: "HOLD", confidence: 0 };
    const last = priceWindow[priceWindow.length - 1];
    let bullish = 0, bearish = 0, total = 0;

    // 1. RSI
    const rsi = calcRSI(priceWindow);
    total++;
    if (rsi < 30) bullish++;
    else if (rsi > 70) bearish++;

    // 2. EMA Crossover (20 vs 50)
    total++;
    if (calcEMA(priceWindow, 20) > calcEMA(priceWindow, 50)) bullish++;
    else bearish++;

    // 3. Price vs SMA(20)
    const sma20 = priceWindow.slice(-20).reduce((s, p) => s + p, 0) / 20;
    total++;
    if (last > sma20) bullish++;
    else bearish++;

    // 4. Momentum (5-day)
    const mom = (last - priceWindow[priceWindow.length - 6]) / priceWindow[priceWindow.length - 6];
    total++;
    if (mom > 0.02) bullish++;
    else if (mom < -0.02) bearish++;

    // 5. Bollinger Bands
    const std = Math.sqrt(priceWindow.slice(-20).reduce((s, p) => s + Math.pow(p - sma20, 2), 0) / 20);
    total++;
    if (last < sma20 - 2 * std) bullish++;
    else if (last > sma20 + 2 * std) bearish++;

    const bullPct = Math.round((bullish / total) * 100);
    const bearPct = Math.round((bearish / total) * 100);
    if (bullPct >= 60) return { signal: "BUY", confidence: bullPct };
    if (bearPct >= 60) return { signal: "SELL", confidence: bearPct };
    return { signal: "HOLD", confidence: Math.max(bullPct, bearPct) };
}

// ═══ SIMULATION PER ASSET ═══

function simulateAsset(asset, prices, startCapital = 100) {
    if (!prices || prices.length < 60) {
        return { asset, error: "Insufficient data", dataPoints: prices?.length || 0 };
    }

    let cash = startCapital, holdings = 0;
    let totalTrades = 0, winTrades = 0, lossTrades = 0;
    let lastBuyPrice = 0, maxValue = startCapital, maxDrawdown = 0;
    const tradeLog = [];
    const closeValues = prices.map(p => p.close);

    for (let i = 50; i < closeValues.length; i++) {
        const window = closeValues.slice(Math.max(0, i - 100), i + 1);
        const { signal, confidence } = generateSignal(window);
        const price = closeValues[i];
        const date = prices[i].date;
        const value = cash + holdings * price;

        if (value > maxValue) maxValue = value;
        const dd = (maxValue - value) / maxValue;
        if (dd > maxDrawdown) maxDrawdown = dd;

        if (signal === "BUY" && confidence >= 60 && cash > 0) {
            holdings = cash / price;
            lastBuyPrice = price;
            cash = 0;
            totalTrades++;
            tradeLog.push({ date, action: "BUY", price, confidence });
        } else if (signal === "SELL" && confidence >= 60 && holdings > 0) {
            cash = holdings * price;
            if (price > lastBuyPrice) winTrades++;
            else lossTrades++;
            holdings = 0;
            totalTrades++;
            tradeLog.push({ date, action: "SELL", price, confidence });
        }
    }

    const lastPrice = closeValues[closeValues.length - 1];
    const finalValue = cash + holdings * lastPrice;
    const returnPct = (finalValue - startCapital) / startCapital * 100;
    const holdReturn = (lastPrice - closeValues[50]) / closeValues[50] * 100;
    const years = prices.length / 252;

    return {
        asset, startCapital,
        finalValue: +finalValue.toFixed(2),
        returnPct: +returnPct.toFixed(2),
        holdReturn: +holdReturn.toFixed(2),
        beatHold: returnPct > holdReturn,
        annualizedReturn: +(years > 0 ? (Math.pow(finalValue / startCapital, 1 / years) - 1) * 100 : 0).toFixed(2),
        totalTrades, winTrades, lossTrades,
        winRate: totalTrades > 0 ? +(winTrades / totalTrades * 100).toFixed(1) : 0,
        maxDrawdown: +(-maxDrawdown * 100).toFixed(2),
        dataPoints: prices.length,
        period: { from: prices[0]?.date, to: prices[prices.length - 1]?.date },
        strategy: "Confluence (RSI+EMA+SMA+Momentum+Bollinger)",
        lastTrades: tradeLog.slice(-5),
    };
}

// ═══ FULL SIMULATION ═══

async function runFullSimulation(supabase) {
    const PERIODS = [
        { name: "1Y", days: 252 },
        { name: "3Y", days: 756 },
        { name: "5Y", days: 1260 },
        { name: "10Y", days: 2520 },
        { name: "MAX", days: null },
    ];
    const ASSETS = ["BTC", "ETH", "SOL", "EUR/USD", "GBP/USD", "S&P 500", "NASDAQ", "Gold", "Oil"];

    const results = {};
    const bestStrategies = [];

    for (const asset of ASSETS) {
        results[asset] = {};
        for (const period of PERIODS) {
            try {
                let query = supabase
                    .from("trading_price_history")
                    .select("date, close")
                    .eq("asset", asset)
                    .order("date", { ascending: true });

                if (period.days) {
                    const since = new Date();
                    since.setDate(since.getDate() - period.days);
                    query = query.gte("date", since.toISOString().slice(0, 10));
                }

                const { data, error } = await query;
                if (error || !data || data.length < 60) {
                    results[asset][period.name] = { error: "Insufficient data", dataPoints: data?.length || 0 };
                    continue;
                }

                const sim = simulateAsset(asset, data, 100);
                results[asset][period.name] = sim;

                if (sim.returnPct > 0) {
                    bestStrategies.push({
                        asset, period: period.name,
                        returnPct: sim.returnPct, winRate: sim.winRate,
                        beatHold: sim.beatHold, annualized: sim.annualizedReturn,
                    });
                }
            } catch (e) {
                results[asset][period.name] = { error: e.message };
            }
        }
    }

    bestStrategies.sort((a, b) => b.returnPct - a.returnPct);
    const brainRules = generateBrainRules(results);

    return {
        simulation: results,
        bestStrategies: bestStrategies.slice(0, 10),
        brainRules,
        timestamp: new Date().toISOString(),
        note: "Per-asset simulation. Rules are POTENTIAL until confirmed 5+ times.",
    };
}

// ═══ PER-ASSET BRAIN RULES — lifecycle: POTENTIAL → TESTING → CONFIRMED ═══

function generateBrainRules(results) {
    const rules = [];

    for (const [asset, periods] of Object.entries(results)) {
        const valid = Object.entries(periods).filter(([, p]) => p.returnPct != null);
        if (valid.length === 0) continue;

        const tag = asset.replace(/[^A-Z0-9]/g, "_");

        // Best period for THIS asset
        const best = [...valid].sort(([, a], [, b]) => (b.returnPct || 0) - (a.returnPct || 0))[0];
        if (best && best[1].returnPct > 0) {
            rules.push({
                rule: `OPTIMAL_PERIOD_${tag}`, asset, type: "OPTIMAL_PERIOD",
                description: `${asset}: best in ${best[0]} (+${best[1].returnPct}%, WR ${best[1].winRate}%)`,
                action: `Use ${best[0]} timeframe for ${asset}`,
                status: "POTENTIAL", confirmations: 1,
                data: { period: best[0], returnPct: best[1].returnPct, winRate: best[1].winRate, maxDD: best[1].maxDrawdown },
            });
        }

        // Active beats hold?
        const beating = valid.filter(([, p]) => p.beatHold);
        if (beating.length > 0) {
            rules.push({
                rule: `ACTIVE_VS_HOLD_${tag}`, asset, type: "ACTIVE_VS_HOLD",
                description: `${asset}: active beats hold in ${beating.map(([p]) => p).join(",")}`,
                action: `Active trading recommended for ${asset}`,
                status: "POTENTIAL", confirmations: 1,
                data: { periods: beating.map(([p, d]) => ({ period: p, active: d.returnPct, hold: d.holdReturn })) },
            });
        }

        // High win rate?
        const highWin = valid.filter(([, p]) => p.winRate >= 55);
        if (highWin.length > 0) {
            const bestWR = highWin.sort(([, a], [, b]) => b.winRate - a.winRate)[0];
            rules.push({
                rule: `WIN_RATE_${tag}`, asset, type: "WIN_RATE",
                description: `${asset}: ${bestWR[1].winRate}% win rate in ${bestWR[0]}`,
                action: `High-confidence signals for ${asset}`,
                status: "POTENTIAL", confirmations: 1,
                data: { period: bestWR[0], winRate: bestWR[1].winRate, trades: bestWR[1].totalTrades },
            });
        }

        // All negative? Danger
        if (valid.every(([, p]) => p.returnPct < 0)) {
            rules.push({
                rule: `AVOID_${tag}`, asset, type: "AVOID",
                description: `${asset}: negative in ALL periods`,
                action: `Avoid or reduce ${asset}`,
                status: "POTENTIAL", confirmations: 1,
                data: { periods: valid.map(([p, d]) => ({ period: p, returnPct: d.returnPct })) },
            });
        }

        // Big drawdown risk
        const bigDD = valid.filter(([, p]) => p.maxDrawdown < -40);
        if (bigDD.length > 0) {
            rules.push({
                rule: `DD_RISK_${tag}`, asset, type: "DRAWDOWN_RISK",
                description: `${asset}: max DD ${bigDD[0][1].maxDrawdown}% in ${bigDD[0][0]}`,
                action: `Use stop-loss for ${asset}`,
                status: "POTENTIAL", confirmations: 1,
                data: { period: bigDD[0][0], maxDD: bigDD[0][1].maxDrawdown },
            });
        }
    }

    return rules;
}

/**
 * Promote rule status based on confirmations
 * POTENTIAL (1-2 runs) → TESTING (3-4 runs) → CONFIRMED (5+ runs)
 */
function updateRuleStatus(existing, newRule) {
    const c = (existing?.confirmations || 0) + 1;
    return {
        ...newRule,
        confirmations: c,
        status: c >= 5 ? "CONFIRMED" : c >= 3 ? "TESTING" : "POTENTIAL",
        first_seen: existing?.first_seen || new Date().toISOString(),
        last_confirmed: new Date().toISOString(),
    };
}

module.exports = {
    simulateAsset,
    runFullSimulation,
    generateBrainRules,
    generateSignal,
    updateRuleStatus,
};
