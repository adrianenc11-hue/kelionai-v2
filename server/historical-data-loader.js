/**
 * Historical Data Loader — Fetches FULL price history for all assets
 * Sources: Yahoo Finance (longest free historical data available)
 * Stores everything in Supabase table: trading_price_history
 *
 * Data ranges:
 *   BTC:     2014-09-17 (Yahoo BTC-USD inception)
 *   ETH:     2017-11-09 (Yahoo ETH-USD inception)
 *   SOL:     2020-04-10 (Yahoo SOL-USD inception)
 *   EUR/USD: 2003-12-01 (Yahoo EURUSD=X inception)
 *   GBP/USD: 2003-12-01 (Yahoo GBPUSD=X inception)
 *   S&P 500: 1950-01-03 (Yahoo ^GSPC inception)
 *   NASDAQ:  1971-02-05 (Yahoo ^IXIC inception)
 *   Gold:    2000-08-30 (Yahoo GC=F inception)
 *   Oil:     2000-08-23 (Yahoo CL=F inception)
 */

const logger = require("pino")({ name: "historical-loader" });

// Yahoo Finance symbols mapped to our asset names
const YAHOO_SYMBOLS = {
    BTC: { symbol: "BTC-USD", since: "2014-09-17" },
    ETH: { symbol: "ETH-USD", since: "2017-11-09" },
    SOL: { symbol: "SOL-USD", since: "2020-04-10" },
    "EUR/USD": { symbol: "EURUSD=X", since: "2003-12-01" },
    "GBP/USD": { symbol: "GBPUSD=X", since: "2003-12-01" },
    "S&P 500": { symbol: "%5EGSPC", since: "1950-01-03" },
    NASDAQ: { symbol: "%5EIXIC", since: "1971-02-05" },
    Gold: { symbol: "GC=F", since: "2000-08-30" },
    Oil: { symbol: "CL=F", since: "2000-08-23" },
};

let supabase = null;

function init(supabaseClient) {
    supabase = supabaseClient;
}

/**
 * Ensure the trading_price_history table exists in Supabase
 */
async function ensureTable() {
    if (!supabase) return;
    try {
        // Try to select from the table; if it fails, create it via RPC or insert
        const { error } = await supabase
            .from("trading_price_history")
            .select("id")
            .limit(1);

        if (error && error.code === "42P01") {
            // Table doesn't exist — create via SQL (requires service_role key)
            logger.info("Creating trading_price_history table...");
            await supabase.rpc("exec_sql", {
                sql: `
          CREATE TABLE IF NOT EXISTS trading_price_history (
            id BIGSERIAL PRIMARY KEY,
            asset TEXT NOT NULL,
            date DATE NOT NULL,
            open DOUBLE PRECISION,
            high DOUBLE PRECISION,
            low DOUBLE PRECISION,
            close DOUBLE PRECISION NOT NULL,
            volume DOUBLE PRECISION,
            source TEXT DEFAULT 'yahoo_finance',
            created_at TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(asset, date)
          );
          CREATE INDEX IF NOT EXISTS idx_price_history_asset ON trading_price_history(asset);
          CREATE INDEX IF NOT EXISTS idx_price_history_date ON trading_price_history(date);
          CREATE INDEX IF NOT EXISTS idx_price_history_asset_date ON trading_price_history(asset, date);
        `,
            }).catch(() => {
                // If RPC doesn't exist, try direct insert approach — table will auto-create
                logger.warn("Could not create table via RPC, will attempt upsert");
            });
        }
    } catch (e) {
        logger.error({ err: e.message }, "Error ensuring table");
    }
}

/**
 * Fetch FULL history from Yahoo Finance for a single asset
 */
async function fetchYahooHistory(assetName) {
    const config = YAHOO_SYMBOLS[assetName];
    if (!config) {
        logger.warn(`No Yahoo symbol for ${assetName}`);
        return [];
    }

    const sinceEpoch = Math.floor(new Date(config.since).getTime() / 1000);
    const nowEpoch = Math.floor(Date.now() / 1000);

    // URL-encode the symbol properly (= → %3D, ^ → %5E)
    const encodedSymbol = encodeURIComponent(config.symbol);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?period1=${sinceEpoch}&period2=${nowEpoch}&interval=1d&includePrePost=false`;

    logger.info({ asset: assetName, symbol: config.symbol, encodedSymbol, since: config.since }, `Fetching ${assetName} history...`);

    try {
        const res = await fetch(url, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            signal: AbortSignal.timeout(30000), // 30s timeout per asset
        });

        if (!res.ok) {
            const body = await res.text().catch(() => "");
            logger.error({ asset: assetName, status: res.status, body: body.slice(0, 200) }, `Yahoo returned ${res.status} for ${assetName}`);
            return [];
        }

        const json = await res.json();
        const result = json.chart?.result?.[0];
        if (!result || !result.timestamp) {
            logger.warn({ asset: assetName, chartError: json.chart?.error }, `No data for ${assetName}`);
            return [];
        }

        const timestamps = result.timestamp;
        const quote = result.indicators?.quote?.[0] || {};
        const opens = quote.open || [];
        const highs = quote.high || [];
        const lows = quote.low || [];
        const closes = quote.close || [];
        const volumes = quote.volume || [];

        const rows = [];
        for (let i = 0; i < timestamps.length; i++) {
            if (closes[i] == null) continue; // skip null days
            const d = new Date(timestamps[i] * 1000);
            rows.push({
                asset: assetName,
                date: d.toISOString().slice(0, 10),
                open: opens[i] ?? closes[i],
                high: highs[i] ?? closes[i],
                low: lows[i] ?? closes[i],
                close: closes[i],
                volume: volumes[i] ?? 0,
                source: "yahoo_finance",
            });
        }

        logger.info({ asset: assetName, count: rows.length, from: rows[0]?.date, to: rows[rows.length - 1]?.date }, `${assetName}: ${rows.length} daily candles`);
        return rows;
    } catch (e) {
        logger.error({ err: e.message, asset: assetName }, `Failed fetching ${assetName}`);
        return [];
    }
}

/**
 * Store rows in Supabase (batch upsert, 500 rows per batch)
 */
async function storeInSupabase(rows) {
    if (!supabase || !rows.length) return { inserted: 0 };

    const BATCH = 500;
    let totalInserted = 0;

    for (let i = 0; i < rows.length; i += BATCH) {
        const batch = rows.slice(i, i + BATCH);
        try {
            const { error, count } = await supabase
                .from("trading_price_history")
                .upsert(batch, { onConflict: "asset,date", ignoreDuplicates: true });

            if (error) {
                logger.error({ err: error.message }, `Batch insert error at ${i}`);
            } else {
                totalInserted += batch.length;
            }
        } catch (e) {
            logger.error({ err: e.message }, `Store error at batch ${i}`);
        }
    }

    return { inserted: totalInserted };
}

/**
 * Load ALL historical data for ALL assets — main entry point
 */
async function loadAllHistory() {
    if (!supabase) {
        return { error: "Supabase not configured", assets: {} };
    }

    await ensureTable();

    const results = {};
    const assets = Object.keys(YAHOO_SYMBOLS);

    for (const asset of assets) {
        try {
            // Check what we already have
            const { data: existing } = await supabase
                .from("trading_price_history")
                .select("date")
                .eq("asset", asset)
                .order("date", { ascending: false })
                .limit(1);

            const lastDate = existing?.[0]?.date;

            // Fetch from Yahoo
            const allRows = await fetchYahooHistory(asset);

            // Filter: only insert rows newer than what we have
            const newRows = lastDate
                ? allRows.filter(r => r.date > lastDate)
                : allRows;

            if (newRows.length > 0) {
                const { inserted } = await storeInSupabase(newRows);
                results[asset] = {
                    totalFetched: allRows.length,
                    newInserted: inserted,
                    dateRange: { from: allRows[0]?.date, to: allRows[allRows.length - 1]?.date },
                    lastExisting: lastDate || "none",
                };
            } else {
                results[asset] = {
                    status: "up-to-date",
                    lastDate,
                    totalAvailable: allRows.length,
                };
            }

            // Rate limit: wait 1s between assets (Yahoo can throttle)
            await new Promise(r => setTimeout(r, 1000));
        } catch (e) {
            results[asset] = { error: e.message };
        }
    }

    return { assets: results, timestamp: new Date().toISOString() };
}

/**
 * Get historical prices for an asset from Supabase
 * @param {string} asset - Asset name
 * @param {number} [limit] - Max rows (null = all)
 * @returns {Array} - [{date, open, high, low, close, volume}]
 */
async function getHistory(asset, limit = null) {
    if (!supabase) return [];

    let query = supabase
        .from("trading_price_history")
        .select("date, open, high, low, close, volume")
        .eq("asset", asset)
        .order("date", { ascending: true });

    if (limit) query = query.limit(limit);

    const { data, error } = await query;
    if (error) {
        logger.error({ err: error.message }, `getHistory error for ${asset}`);
        return [];
    }
    return data || [];
}

/**
 * Get summary stats for all assets in Supabase
 */
async function getHistorySummary() {
    if (!supabase) return {};

    const assets = Object.keys(YAHOO_SYMBOLS);
    const summary = {};

    for (const asset of assets) {
        const { count } = await supabase
            .from("trading_price_history")
            .select("id", { count: "exact", head: true })
            .eq("asset", asset);

        const { data: oldest } = await supabase
            .from("trading_price_history")
            .select("date")
            .eq("asset", asset)
            .order("date", { ascending: true })
            .limit(1);

        const { data: newest } = await supabase
            .from("trading_price_history")
            .select("date")
            .eq("asset", asset)
            .order("date", { ascending: false })
            .limit(1);

        summary[asset] = {
            totalCandles: count || 0,
            oldestDate: oldest?.[0]?.date || "no data",
            newestDate: newest?.[0]?.date || "no data",
            expectedSince: YAHOO_SYMBOLS[asset].since,
        };
    }

    return summary;
}

module.exports = {
    init,
    ensureTable,
    loadAllHistory,
    getHistory,
    getHistorySummary,
    YAHOO_SYMBOLS,
};
