/**
 * Geopolitical & Macro Events Monitor
 * 
 * FREE real-time sources:
 * 1. GDELT Project — global conflicts, protests, political events (no API key needed)
 * 2. FRED (St. Louis Fed) — interest rates, CPI, unemployment (free API key)
 * 3. Fear & Greed Index — CNN Money market sentiment (no API key needed)
 * 4. EventRegistry — global events (free tier)
 * 
 * Integrates into trading strategy: geopolitical risk → adjusts confidence & risk profile
 */

const logger = require("pino")({ name: "geopolitical" });

// Cache to avoid hammering APIs
const cache = {};
const CACHE_TTL = 15 * 60 * 1000; // 15 min

function getCached(key) {
    const c = cache[key];
    if (c && Date.now() - c.ts < CACHE_TTL) return c.data;
    return null;
}
function setCache(key, data) {
    cache[key] = { data, ts: Date.now() };
}

// ═══════════════════════════════════════════════════════════════
// 1. GDELT PROJECT — Global conflicts, protests, military events
//    Source: https://api.gdeltproject.org/api/v2/doc/doc
//    NO API KEY NEEDED — completely free
// ═══════════════════════════════════════════════════════════════
async function fetchGdeltEvents() {
    const cached = getCached("gdelt");
    if (cached) return cached;

    try {
        // Search for high-impact geopolitical events in last 24h
        const queries = [
            "war OR military OR conflict OR sanctions OR invasion",
            "central bank OR interest rate OR federal reserve OR ECB",
            "election OR coup OR protest OR revolution OR crisis",
        ];

        const allEvents = [];

        for (const q of queries) {
            const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(q)}&mode=ArtList&maxrecords=10&format=json&timespan=24h&sort=DateDesc`;

            const res = await fetch(url, {
                headers: { "User-Agent": "KelionAI/1.0" },
                signal: AbortSignal.timeout(8000),
            });

            if (res.ok) {
                const data = await res.json();
                const articles = data.articles || [];
                articles.forEach(a => {
                    allEvents.push({
                        title: a.title || "",
                        url: a.url || "",
                        source: a.domain || a.source || "unknown",
                        date: a.seendate || new Date().toISOString(),
                        language: a.language || "English",
                        category: classifyEvent(a.title || ""),
                    });
                });
            }

            // Rate limit between queries
            await new Promise(r => setTimeout(r, 500));
        }

        const result = {
            events: allEvents.slice(0, 30),
            count: allEvents.length,
            source: "GDELT Project",
            fetchedAt: new Date().toISOString(),
        };

        setCache("gdelt", result);
        return result;
    } catch (e) {
        logger.error({ err: e.message }, "GDELT fetch failed");
        return { events: [], count: 0, error: e.message, source: "GDELT" };
    }
}

// ═══════════════════════════════════════════════════════════════
// 2. FEAR & GREED INDEX — Market sentiment
//    Source: alternative.me (free, no API key)
// ═══════════════════════════════════════════════════════════════
async function fetchFearGreed() {
    const cached = getCached("feargreed");
    if (cached) return cached;

    try {
        // Crypto Fear & Greed
        const res = await fetch("https://api.alternative.me/fng/?limit=7", {
            signal: AbortSignal.timeout(5000),
        });

        if (!res.ok) throw new Error(`Status ${res.status}`);
        const data = await res.json();
        const entries = data.data || [];

        const result = {
            current: entries[0] ? {
                value: parseInt(entries[0].value),
                label: entries[0].value_classification,
                timestamp: new Date(entries[0].timestamp * 1000).toISOString(),
            } : null,
            history: entries.map(e => ({
                value: parseInt(e.value),
                label: e.value_classification,
                date: new Date(e.timestamp * 1000).toISOString().slice(0, 10),
            })),
            source: "alternative.me",
        };

        setCache("feargreed", result);
        return result;
    } catch (e) {
        logger.error({ err: e.message }, "Fear & Greed fetch failed");
        return { current: null, history: [], error: e.message };
    }
}

// ═══════════════════════════════════════════════════════════════
// 3. FRED (St. Louis Fed) — Macro economic data
//    Interest rates, CPI, unemployment
//    Free API key from https://fred.stlouisfed.org/docs/api/api_key.html
// ═══════════════════════════════════════════════════════════════
async function fetchFredData() {
    const cached = getCached("fred");
    if (cached) return cached;

    const apiKey = process.env.FRED_API_KEY;
    // Even without API key, return known schedule
    const result = {
        indicators: {},
        source: "FRED (St. Louis Fed)",
        hasApiKey: !!apiKey,
    };

    if (!apiKey) {
        result.note = "Set FRED_API_KEY for real-time macro data. Get free key at https://fred.stlouisfed.org/docs/api/api_key.html";
        setCache("fred", result);
        return result;
    }

    // Key indicators
    const series = {
        "FEDFUNDS": "Federal Funds Rate",
        "CPIAUCSL": "CPI (Inflation)",
        "UNRATE": "Unemployment Rate",
        "T10Y2Y": "Yield Curve (10Y-2Y spread)",
        "VIXCLS": "VIX (Volatility Index)",
        "DGS10": "10-Year Treasury Rate",
    };

    for (const [id, name] of Object.entries(series)) {
        try {
            const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${apiKey}&file_type=json&sort_order=desc&limit=5`;
            const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
            if (res.ok) {
                const data = await res.json();
                const obs = data.observations || [];
                if (obs.length > 0) {
                    result.indicators[id] = {
                        name,
                        value: parseFloat(obs[0].value) || 0,
                        date: obs[0].date,
                        previous: obs.length > 1 ? parseFloat(obs[1].value) || 0 : null,
                        trend: obs.length > 1
                            ? parseFloat(obs[0].value) > parseFloat(obs[1].value) ? "rising" : "falling"
                            : "unknown",
                    };
                }
            }
        } catch { /* skip individual failures */ }
    }

    setCache("fred", result);
    return result;
}

// ═══════════════════════════════════════════════════════════════
// EVENT CLASSIFICATION — categorize by market impact
// ═══════════════════════════════════════════════════════════════
function classifyEvent(title) {
    const lower = title.toLowerCase();
    if (/war|military|attack|bomb|missile|invasion|troops/.test(lower)) return "MILITARY";
    if (/sanction|embargo|trade war|tariff/.test(lower)) return "SANCTIONS";
    if (/election|vote|referendum|parliament|congress/.test(lower)) return "POLITICAL";
    if (/protest|riot|revolution|coup|uprising/.test(lower)) return "CIVIL_UNREST";
    if (/central bank|fed|ecb|boj|interest rate|rate hike|rate cut/.test(lower)) return "MONETARY_POLICY";
    if (/inflation|cpi|gdp|unemployment|recession/.test(lower)) return "ECONOMIC";
    if (/oil|opec|energy|pipeline|gas/.test(lower)) return "ENERGY";
    if (/pandemic|outbreak|virus|lockdown/.test(lower)) return "HEALTH_CRISIS";
    return "OTHER";
}

// ═══════════════════════════════════════════════════════════════
// GEOPOLITICAL RISK SCORE — aggregated for trading decisions
// Returns 0-100 (0 = calm, 100 = extreme risk)
// ═══════════════════════════════════════════════════════════════
async function calculateGeopoliticalRisk() {
    const cached = getCached("georisk");
    if (cached) return cached;

    const [gdelt, fearGreed, fred] = await Promise.all([
        fetchGdeltEvents(),
        fetchFearGreed(),
        fetchFredData(),
    ]);

    let riskScore = 0;
    const factors = [];

    // Factor 1: GDELT high-impact events (0-40 points)
    const militaryEvents = (gdelt.events || []).filter(e =>
        ["MILITARY", "SANCTIONS", "CIVIL_UNREST"].includes(e.category)
    ).length;
    const geoPoints = Math.min(40, militaryEvents * 5);
    riskScore += geoPoints;
    if (militaryEvents > 0) {
        factors.push({ factor: "Geopolitical events", score: geoPoints, detail: `${militaryEvents} high-impact events in 24h` });
    }

    // Factor 2: Fear & Greed (0-25 points)
    if (fearGreed.current) {
        const fg = fearGreed.current.value;
        // Extreme fear (0-20) or extreme greed (80-100) = high risk
        const fgRisk = fg <= 20 ? 25 : fg >= 80 ? 20 : fg <= 35 ? 15 : fg >= 65 ? 10 : 0;
        riskScore += fgRisk;
        factors.push({ factor: "Fear & Greed", score: fgRisk, detail: `${fg} (${fearGreed.current.label})` });
    }

    // Factor 3: Yield curve inversion (0-20 points)
    if (fred.indicators?.T10Y2Y) {
        const spread = fred.indicators.T10Y2Y.value;
        if (spread < 0) {
            const ycRisk = Math.min(20, Math.abs(spread) * 10);
            riskScore += ycRisk;
            factors.push({ factor: "Yield curve inverted", score: ycRisk, detail: `Spread: ${spread}%` });
        }
    }

    // Factor 4: VIX spike (0-15 points)
    if (fred.indicators?.VIXCLS) {
        const vix = fred.indicators.VIXCLS.value;
        const vixRisk = vix > 30 ? 15 : vix > 25 ? 10 : vix > 20 ? 5 : 0;
        riskScore += vixRisk;
        if (vixRisk > 0) {
            factors.push({ factor: "VIX elevated", score: vixRisk, detail: `VIX: ${vix}` });
        }
    }

    riskScore = Math.min(100, riskScore);

    const riskLevel = riskScore >= 70 ? "EXTREME" : riskScore >= 50 ? "HIGH" : riskScore >= 30 ? "MODERATE" : "LOW";

    const result = {
        riskScore,
        riskLevel,
        factors,
        recommendation: riskScore >= 70
            ? "REDUCE exposure — extreme geopolitical risk"
            : riskScore >= 50
                ? "CAUTION — hedge positions, tighten stop-losses"
                : riskScore >= 30
                    ? "MONITOR — elevated risk, normal trading with awareness"
                    : "NORMAL — no significant geopolitical threats",
        sources: {
            gdelt: { events: gdelt.count, militaryEvents },
            fearGreed: fearGreed.current || null,
            fred: fred.hasApiKey ? Object.keys(fred.indicators).length + " indicators" : "No API key",
        },
        timestamp: new Date().toISOString(),
    };

    setCache("georisk", result);
    return result;
}

// ═══════════════════════════════════════════════════════════════
// HISTORICAL MARKET EVENTS DATABASE — 20 years of real events
// Brain scans this permanently for strategy pattern recognition
// ═══════════════════════════════════════════════════════════════
const HISTORICAL_EVENTS = [
    // 2001-2005
    { date: "2001-09-11", category: "MILITARY", severity: 100, event: "9/11 Attacks", impact: "S&P -11.6% in 1 week, markets closed 4 days", assets: ["S&P 500", "NASDAQ", "Gold", "Oil"] },
    { date: "2001-10-07", category: "MILITARY", severity: 70, event: "US invasion of Afghanistan", impact: "Oil +5%, defense stocks surge", assets: ["Oil", "S&P 500"] },
    { date: "2003-03-20", category: "MILITARY", severity: 80, event: "US invasion of Iraq", impact: "Oil +33% in 3 months, S&P rallied after uncertainty cleared", assets: ["Oil", "S&P 500", "Gold"] },

    // 2007-2009 Financial Crisis
    { date: "2007-08-09", category: "ECONOMIC", severity: 85, event: "BNP Paribas freezes funds — subprime crisis begins", impact: "Credit markets freeze, VIX spikes", assets: ["S&P 500", "NASDAQ"] },
    { date: "2008-03-16", category: "ECONOMIC", severity: 90, event: "Bear Stearns collapse", impact: "S&P -5% in 1 day", assets: ["S&P 500", "NASDAQ"] },
    { date: "2008-09-15", category: "ECONOMIC", severity: 100, event: "Lehman Brothers bankruptcy — Global Financial Crisis", impact: "S&P -57% peak-to-trough, Gold +25%", assets: ["S&P 500", "NASDAQ", "Gold", "EUR/USD"] },
    { date: "2008-10-03", category: "MONETARY_POLICY", severity: 80, event: "TARP bailout $700B signed", impact: "Markets stabilize temporarily", assets: ["S&P 500", "NASDAQ"] },
    { date: "2009-03-09", category: "ECONOMIC", severity: 95, event: "S&P 500 hits 666 — market bottom", impact: "Begin of 11-year bull run", assets: ["S&P 500", "NASDAQ"] },

    // 2010-2012 European Debt Crisis
    { date: "2010-05-02", category: "ECONOMIC", severity: 75, event: "Greece bailout €110B", impact: "EUR/USD -15% in 6 months", assets: ["EUR/USD", "S&P 500"] },
    { date: "2010-05-06", category: "ECONOMIC", severity: 60, event: "Flash Crash — Dow drops 1000 points in minutes", impact: "S&P -9.2% intraday", assets: ["S&P 500", "NASDAQ"] },
    { date: "2011-08-05", category: "ECONOMIC", severity: 70, event: "US credit rating downgraded by S&P", impact: "S&P -6.7% in 1 day, Gold +3.5%", assets: ["S&P 500", "Gold"] },
    { date: "2012-07-26", category: "MONETARY_POLICY", severity: 65, event: "Draghi: 'Whatever it takes' to save Euro", impact: "EUR rallies, European markets recover", assets: ["EUR/USD"] },

    // 2013-2015
    { date: "2013-05-22", category: "MONETARY_POLICY", severity: 55, event: "Fed Taper Tantrum — Bernanke hints QE reduction", impact: "Bond yields spike, EM currencies crash", assets: ["S&P 500", "Gold"] },
    { date: "2014-03-18", category: "MILITARY", severity: 75, event: "Russia annexes Crimea", impact: "Russian Ruble -50%, Oil starts decline, Gold +5%", assets: ["Oil", "Gold", "EUR/USD"] },
    { date: "2014-06-20", category: "ENERGY", severity: 70, event: "Oil crash begins — $107 to $26", impact: "Oil -75% over 18 months", assets: ["Oil"] },
    { date: "2015-08-11", category: "ECONOMIC", severity: 65, event: "China devalues Yuan — Black Monday Aug 24", impact: "S&P -11% in 6 days, global selloff", assets: ["S&P 500", "NASDAQ"] },

    // 2016-2017
    { date: "2016-06-23", category: "POLITICAL", severity: 75, event: "Brexit vote — UK leaves EU", impact: "GBP/USD -11% overnight, FTSE -3%", assets: ["GBP/USD", "EUR/USD", "S&P 500"] },
    { date: "2016-11-08", category: "POLITICAL", severity: 60, event: "Trump elected US President", impact: "Futures -5% overnight, then V-recovery. S&P +5% in 1 month", assets: ["S&P 500", "NASDAQ", "Gold"] },
    { date: "2017-12-17", category: "ECONOMIC", severity: 50, event: "Bitcoin hits $19,783 — first crypto bubble peak", impact: "BTC -84% over next year", assets: ["BTC"] },

    // 2018-2019
    { date: "2018-02-05", category: "ECONOMIC", severity: 55, event: "Volmageddon — VIX spike from 13 to 50", impact: "S&P -10% in 2 weeks, XIV ETN wiped out", assets: ["S&P 500", "NASDAQ"] },
    { date: "2018-03-22", category: "SANCTIONS", severity: 60, event: "US-China trade war begins — tariffs announced", impact: "S&P -20% by Dec 2018", assets: ["S&P 500", "NASDAQ"] },
    { date: "2019-08-05", category: "SANCTIONS", severity: 50, event: "US labels China currency manipulator", impact: "S&P -3% in 1 day, Gold spikes", assets: ["S&P 500", "Gold"] },

    // 2020 COVID
    { date: "2020-01-30", category: "HEALTH_CRISIS", severity: 60, event: "WHO declares COVID global emergency", impact: "Initial market uncertainty", assets: ["S&P 500", "Oil", "Gold"] },
    { date: "2020-03-09", category: "HEALTH_CRISIS", severity: 95, event: "COVID crash + Oil price war — Black Monday", impact: "S&P -12% in 1 day, Oil -26%", assets: ["S&P 500", "NASDAQ", "Oil", "BTC"] },
    { date: "2020-03-16", category: "HEALTH_CRISIS", severity: 100, event: "COVID lockdowns worldwide — worst since 1929", impact: "S&P -34% from peak, circuit breakers triggered 4x", assets: ["S&P 500", "NASDAQ", "Oil", "BTC", "Gold"] },
    { date: "2020-03-23", category: "MONETARY_POLICY", severity: 85, event: "Fed unlimited QE + $2.2T CARES Act", impact: "Market bottom, begin fastest recovery in history", assets: ["S&P 500", "NASDAQ", "BTC", "Gold"] },
    { date: "2020-04-20", category: "ENERGY", severity: 90, event: "Oil goes NEGATIVE — WTI at -$37", impact: "First negative oil price in history", assets: ["Oil"] },

    // 2021
    { date: "2021-01-27", category: "ECONOMIC", severity: 45, event: "GameStop short squeeze — retail vs Wall St", impact: "VIX +60%, broader market -3%", assets: ["S&P 500", "NASDAQ"] },
    { date: "2021-05-19", category: "SANCTIONS", severity: 55, event: "China bans crypto mining + trading", impact: "BTC -53% from peak ($64K to $30K)", assets: ["BTC", "ETH", "SOL"] },
    { date: "2021-11-10", category: "ECONOMIC", severity: 50, event: "BTC hits ATH $69,000 + ETH $4,867", impact: "Begin of crypto winter", assets: ["BTC", "ETH", "SOL"] },

    // 2022
    { date: "2022-02-24", category: "MILITARY", severity: 90, event: "Russia invades Ukraine", impact: "Oil +30%, Gold +8%, S&P -5%, Gas +300% in EU", assets: ["Oil", "Gold", "S&P 500", "EUR/USD", "BTC"] },
    { date: "2022-03-16", category: "MONETARY_POLICY", severity: 75, event: "Fed begins rate hikes — 0.25% to fight inflation", impact: "S&P -25% over 9 months, BTC -65%", assets: ["S&P 500", "NASDAQ", "BTC", "Gold"] },
    { date: "2022-05-09", category: "ECONOMIC", severity: 80, event: "Terra/LUNA collapse — $40B wiped", impact: "BTC -30%, entire crypto market crash", assets: ["BTC", "ETH", "SOL"] },
    { date: "2022-06-13", category: "ECONOMIC", severity: 70, event: "Celsius/3AC/Voyager crypto bankruptcies", impact: "BTC hits $17,600, crypto contagion", assets: ["BTC", "ETH", "SOL"] },
    { date: "2022-09-26", category: "MILITARY", severity: 65, event: "Nord Stream pipelines sabotaged", impact: "EU gas prices spike, EUR/USD hits 20-year low", assets: ["Oil", "EUR/USD"] },
    { date: "2022-11-08", category: "ECONOMIC", severity: 85, event: "FTX collapse — $32B exchange bankrupt", impact: "BTC -25%, SOL -60%, crypto trust crisis", assets: ["BTC", "ETH", "SOL"] },

    // 2023
    { date: "2023-03-10", category: "ECONOMIC", severity: 70, event: "Silicon Valley Bank collapses", impact: "Bank stocks -20%, BTC +30% (flight from banks)", assets: ["S&P 500", "BTC", "Gold"] },
    { date: "2023-10-07", category: "MILITARY", severity: 80, event: "Hamas attacks Israel — Middle East war", impact: "Oil +6%, Gold +3%, risk-off sentiment", assets: ["Oil", "Gold", "S&P 500"] },

    // 2024
    { date: "2024-01-10", category: "ECONOMIC", severity: 50, event: "Bitcoin ETF approved by SEC", impact: "BTC +60% in 2 months, institutional inflows", assets: ["BTC", "ETH"] },
    { date: "2024-03-11", category: "ECONOMIC", severity: 40, event: "BTC hits new ATH $73,000", impact: "Crypto bull market confirmed", assets: ["BTC", "ETH", "SOL"] },
    { date: "2024-08-05", category: "ECONOMIC", severity: 65, event: "Japan carry trade unwind — global selloff", impact: "Nikkei -12%, S&P -3%, BTC -15%", assets: ["S&P 500", "BTC", "NASDAQ"] },

    // 2025
    { date: "2025-01-20", category: "POLITICAL", severity: 45, event: "Trump inauguration — tariff threats", impact: "Market uncertainty, USD strengthens", assets: ["S&P 500", "EUR/USD", "BTC"] },
    { date: "2025-02-01", category: "SANCTIONS", severity: 60, event: "US tariffs on China, Canada, Mexico", impact: "S&P -2%, supply chain fears", assets: ["S&P 500", "NASDAQ"] },
];

/**
 * Get historical risk context — brain uses this to learn patterns
 * Finds similar past events to current conditions
 */
function getHistoricalRiskContext(currentCategory) {
    const similar = HISTORICAL_EVENTS.filter(e => e.category === currentCategory);
    const avgSeverity = similar.length > 0
        ? Math.round(similar.reduce((s, e) => s + e.severity, 0) / similar.length)
        : 0;

    return {
        totalEvents: HISTORICAL_EVENTS.length,
        similarEvents: similar.length,
        avgSeverity,
        worstCase: similar.sort((a, b) => b.severity - a.severity)[0] || null,
        recentSimilar: similar.filter(e => new Date(e.date) > new Date("2022-01-01")),
        allEvents: HISTORICAL_EVENTS,
    };
}

/**
 * Brain scan function — called by brain periodically to assess risk
 * Returns formatted context for strategy decisions
 */
async function brainScan() {
    const risk = await calculateGeopoliticalRisk();
    const historicalContext = {};

    // For each active risk factor, find historical parallels
    risk.factors.forEach(f => {
        const category = f.factor.includes("Geopolitical") ? "MILITARY"
            : f.factor.includes("Fear") ? "ECONOMIC"
                : f.factor.includes("Yield") ? "MONETARY_POLICY"
                    : f.factor.includes("VIX") ? "ECONOMIC"
                        : "OTHER";
        historicalContext[f.factor] = getHistoricalRiskContext(category);
    });

    return {
        currentRisk: risk,
        historicalParallels: historicalContext,
        brainRecommendation: risk.riskScore >= 50
            ? `HIGH ALERT: Geopolitical risk ${risk.riskScore}/100. Historical events with similar patterns caused avg ${Object.values(historicalContext)[0]?.avgSeverity || 'unknown'}% severity. Reduce exposure.`
            : `Normal conditions. Monitoring ${HISTORICAL_EVENTS.length} historical events for pattern matching.`,
        lastScan: new Date().toISOString(),
    };
}

module.exports = {
    fetchGdeltEvents,
    fetchFearGreed,
    fetchFredData,
    calculateGeopoliticalRisk,
    adjustStrategyForRisk,
    classifyEvent,
    getHistoricalRiskContext,
    brainScan,
    HISTORICAL_EVENTS,
};
