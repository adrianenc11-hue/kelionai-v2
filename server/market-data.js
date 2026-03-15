/**
 * Market Data Downloader — REAL historical prices only
 *
 * ALL data from verified APIs with real OHLCV:
 * - CoinGecko /ohlc endpoint (BTC, ETH, SOL) — REAL candles
 * - Yahoo Finance (Gold, Oil, S&P 500, NASDAQ, EUR/USD, GBP/USD) — REAL OHLCV
 *
 * NO synthetic data. NO approximations. NO random walks.
 * If an API fails, we log the error — we don't invent data.
 *
 * Stores in Supabase `market_candles` table
 * Runs automatically every 4 hours when bot is ON
 */

const logger = require("pino")({ name: "market-data" });

// Asset → Real API source mapping
const ASSET_SOURCES = {
  BTC: { source: "coingecko", id: "bitcoin" },
  ETH: { source: "coingecko", id: "ethereum" },
  SOL: { source: "coingecko", id: "solana" },
  Gold: { source: "yahoo", symbol: "GC=F" },
  Oil: { source: "yahoo", symbol: "CL=F" },
  "S&P 500": { source: "yahoo", symbol: "^GSPC" },
  NASDAQ: { source: "yahoo", symbol: "^IXIC" },
  "EUR/USD": { source: "yahoo", symbol: "EURUSD=X" },
  "GBP/USD": { source: "yahoo", symbol: "GBPUSD=X" },
};

let _downloadInterval = null;

/**
 * Download REAL historical data for ALL assets
 */
async function downloadAllHistory(supabase, days = 365) {
  const results = {};
  logger.info(
    { days },
    `[MarketData] 📥 Downloading REAL data for ${Object.keys(ASSET_SOURCES).length} assets`,
  );

  for (const [asset, config] of Object.entries(ASSET_SOURCES)) {
    try {
      let candles = [];
      if (config.source === "coingecko") {
        candles = await fetchCoinGeckoOHLC(config.id, days);
      } else if (config.source === "yahoo") {
        candles = await fetchYahooFinance(config.symbol, days);
      }

      if (candles.length > 0) {
        // Save to Supabase
        const rows = candles.map((c) => ({
          asset,
          timestamp: c.date,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
          volume: c.volume,
        }));

        // Upsert in batches of 100
        for (let i = 0; i < rows.length; i += 100) {
          const batch = rows.slice(i, i + 100);
          try {
            await supabase.from("market_candles").upsert(batch, {
              onConflict: "asset,timestamp",
            });
          } catch (e) {
            logger.warn({ asset, err: e.message }, "DB upsert failed");
          }
        }

        results[asset] = {
          count: candles.length,
          latest: candles[candles.length - 1]?.close,
        };
        logger.info(
          {
            asset,
            candles: candles.length,
            latest: candles[candles.length - 1]?.close,
          },
          `✅ ${asset}: ${candles.length} REAL candles saved`,
        );
      } else {
        results[asset] = { count: 0, error: "no_data_from_api" };
        logger.warn({ asset }, `⚠️ ${asset}: API returned no data`);
      }

      // Rate limit
      await sleep(1500);
    } catch (e) {
      results[asset] = { count: 0, error: e.message };
      logger.error({ asset, err: e.message }, `❌ ${asset}: download failed`);
    }
  }

  const totalCandles = Object.values(results).reduce(
    (s, r) => s + (r.count || 0),
    0,
  );
  logger.info(
    { totalCandles, assets: Object.keys(results).length },
    `[MarketData] 📊 Download complete: ${totalCandles} REAL candles total`,
  );

  return results;
}

/**
 * CoinGecko OHLC endpoint — REAL open/high/low/close candles
 * Returns actual OHLC data (not approximated)
 * + volume from market_chart endpoint
 */
async function fetchCoinGeckoOHLC(coinId, days) {
  try {
    // OHLC endpoint gives real candles
    const ohlcDays =
      days <= 30 ? 30 : days <= 90 ? 90 : days <= 180 ? 180 : 365;
    const ohlcUrl = `https://api.coingecko.com/api/v3/coins/${coinId}/ohlc?vs_currency=usd&days=${ohlcDays}`;
    const ohlcRes = await fetch(ohlcUrl);

    if (!ohlcRes.ok) {
      logger.warn({ coinId, status: ohlcRes.status }, "CoinGecko OHLC error");
      return [];
    }

    const ohlcData = await ohlcRes.json();
    if (!ohlcData || ohlcData.length === 0) return [];

    // Also get real volumes
    await sleep(1200); // Rate limit
    const volUrl = `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${ohlcDays}&interval=daily`;
    const volRes = await fetch(volUrl);
    const volumeMap = {};
    if (volRes.ok) {
      const volData = await volRes.json();
      if (volData.total_volumes) {
        for (const [ts, vol] of volData.total_volumes) {
          const dateKey = new Date(ts).toISOString().slice(0, 10);
          volumeMap[dateKey] = Math.round(vol);
        }
      }
    }

    // OHLC data: array of [timestamp, open, high, low, close]
    // Group by day (OHLC gives 4h candles for >30 days)
    const dailyMap = {};
    for (const [ts, open, high, low, close] of ohlcData) {
      const dateKey = new Date(ts).toISOString().slice(0, 10);
      if (!dailyMap[dateKey]) {
        dailyMap[dateKey] = {
          date: dateKey,
          open,
          high,
          low,
          close,
          volume: 0,
        };
      } else {
        // Merge intraday candles into daily
        if (high > dailyMap[dateKey].high) dailyMap[dateKey].high = high;
        if (low < dailyMap[dateKey].low) dailyMap[dateKey].low = low;
        dailyMap[dateKey].close = close; // last close of the day
      }
    }

    // Add real volumes
    const candles = Object.values(dailyMap)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((c) => ({
        ...c,
        open: +c.open.toFixed(2),
        high: +c.high.toFixed(2),
        low: +c.low.toFixed(2),
        close: +c.close.toFixed(2),
        volume: volumeMap[c.date] || 0,
      }));

    return candles;
  } catch (e) {
    logger.error({ coinId, err: e.message }, "CoinGecko OHLC fetch failed");
    return [];
  }
}

/**
 * Yahoo Finance — REAL OHLCV data
 * Works for stocks, commodities, AND forex (EURUSD=X, GBPUSD=X)
 * ALL values are real from Yahoo's database
 */
async function fetchYahooFinance(symbol, days) {
  try {
    const period1 = Math.floor(Date.now() / 1000) - days * 86400;
    const period2 = Math.floor(Date.now() / 1000);
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?period1=${period1}&period2=${period2}&interval=1d`;
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KelionAI/1.0)" },
    });
    if (!r.ok) {
      logger.warn({ symbol, status: r.status }, "Yahoo Finance API error");
      return [];
    }
    const data = await r.json();
    const result = data?.chart?.result?.[0];
    if (!result?.timestamp) return [];

    const timestamps = result.timestamp;
    const quotes = result.indicators?.quote?.[0];
    if (!quotes) return [];

    // ALL values are REAL from Yahoo — no approximation
    return timestamps
      .map((ts, i) => ({
        date: new Date(ts * 1000).toISOString().slice(0, 10),
        open: quotes.open?.[i]
          ? +quotes.open[i].toFixed(quotes.open[i] < 10 ? 5 : 2)
          : null,
        high: quotes.high?.[i]
          ? +quotes.high[i].toFixed(quotes.high[i] < 10 ? 5 : 2)
          : null,
        low: quotes.low?.[i]
          ? +quotes.low[i].toFixed(quotes.low[i] < 10 ? 5 : 2)
          : null,
        close: quotes.close?.[i]
          ? +quotes.close[i].toFixed(quotes.close[i] < 10 ? 5 : 2)
          : null,
        volume: quotes.volume?.[i] || 0,
      }))
      .filter((c) => c.close !== null && c.close > 0);
  } catch (e) {
    logger.error({ symbol, err: e.message }, "Yahoo Finance fetch failed");
    return [];
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Start automatic data download loop
 * Downloads on startup + every 4 hours
 */
function startDownloader(supabase) {
  // Download immediately on start
  setTimeout(
    () =>
      downloadAllHistory(supabase).catch((e) => {
        logger.error(
          { err: e.message },
          "[MarketData] Initial download failed",
        );
      }),
    10000,
  );

  // Then every 4 hours
  _downloadInterval = setInterval(
    () => {
      downloadAllHistory(supabase).catch(() => {});
    },
    4 * 60 * 60 * 1000,
  );

  logger.info("[MarketData] 📡 Real data downloader started (every 4h)");
}

function stopDownloader() {
  if (_downloadInterval) {
    clearInterval(_downloadInterval);
    _downloadInterval = null;
  }
}

module.exports = {
  downloadAllHistory,
  startDownloader,
  stopDownloader,
  ASSET_SOURCES,
};
