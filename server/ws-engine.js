"use strict";

// ═══════════════════════════════════════════════════════════════════════════
// KelionAI — WebSocket Real-Time Market Engine
// Binance WS (crypto) + OANDA Streaming (forex) + Yahoo (stocks)
// Multi-Timeframe Candle Builder + Persistent Supabase Storage (UNLIMITED)
// ═══════════════════════════════════════════════════════════════════════════

const EventEmitter = require("events");
const WebSocket = require("ws");
const logger = require("./logger");

class WSEngine extends EventEmitter {
  constructor(opts = {}) {
    super();
    this.setMaxListeners(50);

    // ── Config from env ──
    this.config = {
      binanceWsUrl:
        process.env.BINANCE_WS_URL || "wss://stream.binance.com:9443/ws",
      oandaApiKey: process.env.OANDA_API_KEY || "",
      oandaAccountId: process.env.OANDA_ACCOUNT_ID || "",
      oandaEnv: process.env.OANDA_ENV || "practice", // practice=demo, live=real
      cryptoPairs: ["btcusdt", "ethusdt", "solusdt"],
      forexPairs: [
        "EUR_USD",
        "GBP_USD",
        "USD_JPY",
        "GBP_JPY",
        "EUR_GBP",
        "AUD_USD",
        "USD_CHF",
        "USD_CAD",
      ],
      stockSymbols: ["^GSPC", "^IXIC", "GC=F", "CL=F"],
      timeframes: ["1m", "5m", "15m", "1h", "4h", "1D"],
      maxCandlesPerTF: 500,
      persistToDb: true,
      saveUnlimited: true,
    };
    Object.assign(this.config, opts);

    // ── State ──
    this.connections = { binance: null, oanda: null };
    this.reconnectAttempts = { binance: 0, oanda: 0 };
    this.maxReconnect = 100;

    // ── In-memory candle store: { "BTC/1m": [...candles], "EUR_USD/5m": [...] } ──
    this.candles = {};
    this.ticks = {}; // last N ticks per asset
    this.lastPrices = {}; // { BTC: 65000, EUR_USD: 1.085, ... }

    // ── Stats ──
    this.stats = {
      ticksReceived: 0,
      candlesBuilt: 0,
      candlesPersisted: 0,
      errors: 0,
      startTime: Date.now(),
      binanceConnected: false,
      oandaConnected: false,
    };

    // ── Supabase ref (set externally via setSupabase) ──
    this.supabase = null;

    // ── Candle builders ──
    this._builders = {}; // { "BTC/1m": { open, high, low, close, volume, openTime } }
  }

  // ═══════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════

  setSupabase(sb) {
    this.supabase = sb;
    logger.info(
      { component: "WSEngine" },
      "Supabase connected for unlimited market data storage",
    );
  }

  start() {
    logger.info(
      { component: "WSEngine" },
      "🚀 Starting Multi-Market Real-Time Engine",
    );
    this._startBinance();
    if (this.config.oandaApiKey) this._startOanda();
    this._startStockPolling();
    this._startCandleFlush(); // periodic persistence
    return this;
  }

  stop() {
    if (this.connections.binance) {
      this.connections.binance.close();
      this.connections.binance = null;
    }
    if (this.connections.oanda) {
      this.connections.oanda.destroy?.();
      this.connections.oanda = null;
    }
    this.stats.binanceConnected = false;
    this.stats.oandaConnected = false;
    logger.info({ component: "WSEngine" }, "⛔ Engine stopped");
  }

  getPrice(asset) {
    return this.lastPrices[asset] || null;
  }

  getCandles(asset, tf = "1m", count = 100) {
    const key = `${asset}/${tf}`;
    const arr = this.candles[key] || [];
    return arr.slice(-count);
  }

  getTicks(asset, count = 100) {
    return (this.ticks[asset] || []).slice(-count);
  }

  getStats() {
    return {
      ...this.stats,
      uptimeMs: Date.now() - this.stats.startTime,
      assetsTracked: Object.keys(this.lastPrices).length,
      candleSeries: Object.keys(this.candles).length,
    };
  }

  // ═══════════════════════════════════════════════════════════════
  // BINANCE WEBSOCKET (Crypto)
  // ═══════════════════════════════════════════════════════════════

  _startBinance() {
    const streams = this.config.cryptoPairs
      .map((p) => `${p}@trade/${p}@kline_1m`)
      .join("/");
    const url = `${this.config.binanceWsUrl}/${streams}`;

    logger.info(
      { component: "WSEngine", url: url.substring(0, 80) },
      "📡 Connecting Binance WS...",
    );

    const ws = new WebSocket(url);
    this.connections.binance = ws;

    ws.on("open", () => {
      this.stats.binanceConnected = true;
      this.reconnectAttempts.binance = 0;
      logger.info({ component: "WSEngine" }, "✅ Binance WebSocket CONNECTED");
      this.emit("connected", { exchange: "binance" });
    });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.e === "trade") {
          this._handleBinanceTrade(msg);
        } else if (msg.e === "kline") {
          this._handleBinanceKline(msg);
        }
      } catch (_err) {
        this.stats.errors++;
      }
    });

    ws.on("close", () => {
      this.stats.binanceConnected = false;
      logger.warn({ component: "WSEngine" }, "⚠️ Binance WS disconnected");
      this._reconnect("binance");
    });

    ws.on("error", (err) => {
      this.stats.errors++;
      logger.error(
        { component: "WSEngine", err: err.message },
        "Binance WS error",
      );
    });
  }

  _handleBinanceTrade(msg) {
    const symbol = msg.s.replace("USDT", ""); // BTCUSDT → BTC
    const price = parseFloat(msg.p);
    const volume = parseFloat(msg.q);
    const ts = msg.T;

    this.lastPrices[symbol] = price;
    this.stats.ticksReceived++;

    // Store tick
    if (!this.ticks[symbol]) this.ticks[symbol] = [];
    this.ticks[symbol].push({ price, volume, ts });
    if (this.ticks[symbol].length > 1000)
      this.ticks[symbol] = this.ticks[symbol].slice(-500);

    // Update candle builders for ALL timeframes
    this._updateCandleBuilder(symbol, price, volume, ts);

    // Emit real-time
    this.emit("tick", { asset: symbol, price, volume, ts, source: "binance" });
  }

  _handleBinanceKline(msg) {
    const k = msg.k;
    const symbol = k.s.replace("USDT", "");
    const candle = {
      openTime: k.t,
      closeTime: k.T,
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
      closed: k.x,
    };

    if (candle.closed) {
      const key = `${symbol}/1m`;
      if (!this.candles[key]) this.candles[key] = [];
      this.candles[key].push(candle);
      if (this.candles[key].length > this.config.maxCandlesPerTF) {
        this.candles[key] = this.candles[key].slice(
          -this.config.maxCandlesPerTF,
        );
      }
      this.stats.candlesBuilt++;
      this.emit("candle", {
        asset: symbol,
        tf: "1m",
        candle,
        source: "binance",
      });

      // Build higher timeframes from 1m
      this._buildHigherTF(symbol, candle);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // OANDA STREAMING (Forex)
  // ═══════════════════════════════════════════════════════════════

  _startOanda() {
    const host =
      this.config.oandaEnv === "live"
        ? "stream-fxtrade.oanda.com"
        : "stream-fxpractice.oanda.com";
    const instruments = this.config.forexPairs.join(",");
    const url = `https://${host}/v3/accounts/${this.config.oandaAccountId}/pricing/stream?instruments=${instruments}`;

    logger.info(
      { component: "WSEngine", pairs: this.config.forexPairs.length },
      "📡 Connecting OANDA stream...",
    );

    const https = require("https");
    const options = {
      headers: {
        Authorization: `Bearer ${this.config.oandaApiKey}`,
        "Content-Type": "application/json",
      },
    };

    const req = https.get(url, options, (res) => {
      if (res.statusCode !== 200) {
        logger.error(
          { component: "WSEngine", status: res.statusCode },
          "OANDA stream failed",
        );
        this._reconnect("oanda");
        return;
      }
      this.stats.oandaConnected = true;
      this.reconnectAttempts.oanda = 0;
      logger.info({ component: "WSEngine" }, "✅ OANDA Stream CONNECTED");
      this.emit("connected", { exchange: "oanda" });
      this.connections.oanda = res;

      let buffer = "";
      res.on("data", (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop(); // keep incomplete line
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const data = JSON.parse(line);
            if (data.type === "PRICE") {
              this._handleOandaTick(data);
            }
          } catch (_e) {
            /* heartbeat or parse error */
          }
        }
      });

      res.on("end", () => {
        this.stats.oandaConnected = false;
        logger.warn({ component: "WSEngine" }, "OANDA stream ended");
        this._reconnect("oanda");
      });
    });

    req.on("error", (err) => {
      this.stats.errors++;
      logger.error(
        { component: "WSEngine", err: err.message },
        "OANDA connection error",
      );
      this._reconnect("oanda");
    });
  }

  _handleOandaTick(data) {
    const pair = data.instrument; // EUR_USD
    const bid = parseFloat(data.bids?.[0]?.price || 0);
    const ask = parseFloat(data.asks?.[0]?.price || 0);
    const mid = (bid + ask) / 2;
    const spread = ask - bid;
    const ts = new Date(data.time).getTime();

    this.lastPrices[pair] = mid;
    this.stats.ticksReceived++;

    // Store tick
    if (!this.ticks[pair]) this.ticks[pair] = [];
    this.ticks[pair].push({ bid, ask, mid, spread, ts });
    if (this.ticks[pair].length > 1000)
      this.ticks[pair] = this.ticks[pair].slice(-500);

    // Build candles
    this._updateCandleBuilder(pair, mid, 0, ts);

    this.emit("tick", {
      asset: pair,
      price: mid,
      bid,
      ask,
      spread,
      ts,
      source: "oanda",
    });
  }

  // ═══════════════════════════════════════════════════════════════
  // STOCK/COMMODITY POLLING (lower frequency)
  // ═══════════════════════════════════════════════════════════════

  _startStockPolling() {
    const nameMap = {
      "^GSPC": "SP500",
      "^IXIC": "NASDAQ",
      "GC=F": "Gold",
      "CL=F": "Oil",
    };

    const poll = async () => {
      for (const sym of this.config.stockSymbols) {
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&range=1d`;
          const r = await fetch(url, {
            headers: { "User-Agent": "KelionAI/2.0" },
          });
          if (r.ok) {
            const d = await r.json();
            const quotes = d.chart?.result?.[0]?.indicators?.quote?.[0];
            const closes = quotes?.close?.filter((v) => v !== null) || [];
            if (closes.length > 0) {
              const price = closes[closes.length - 1];
              const name = nameMap[sym] || sym;
              this.lastPrices[name] = price;
              this._updateCandleBuilder(name, price, 0, Date.now());
              this.emit("tick", {
                asset: name,
                price,
                ts: Date.now(),
                source: "yahoo",
              });
            }
          }
        } catch (_e) {
          this.stats.errors++;
        }
      }
    };

    poll();
    setInterval(poll, 60000); // every minute
  }

  // ═══════════════════════════════════════════════════════════════
  // MULTI-TIMEFRAME CANDLE BUILDER
  // ═══════════════════════════════════════════════════════════════

  _updateCandleBuilder(asset, price, volume, ts) {
    for (const tf of this.config.timeframes) {
      const key = `${asset}/${tf}`;
      const interval = this._tfToMs(tf);
      const bucketStart = Math.floor(ts / interval) * interval;

      if (
        !this._builders[key] ||
        this._builders[key].openTime !== bucketStart
      ) {
        // Close previous candle
        if (this._builders[key]) {
          const prev = { ...this._builders[key], closed: true };
          if (!this.candles[key]) this.candles[key] = [];
          this.candles[key].push(prev);
          if (this.candles[key].length > this.config.maxCandlesPerTF) {
            this.candles[key] = this.candles[key].slice(
              -this.config.maxCandlesPerTF,
            );
          }
          this.stats.candlesBuilt++;
          this.emit("candle", { asset, tf, candle: prev, source: "builder" });
        }
        // Start new candle
        this._builders[key] = {
          openTime: bucketStart,
          closeTime: bucketStart + interval - 1,
          open: price,
          high: price,
          low: price,
          close: price,
          volume: volume,
          ticks: 1,
        };
      } else {
        const b = this._builders[key];
        b.high = Math.max(b.high, price);
        b.low = Math.min(b.low, price);
        b.close = price;
        b.volume += volume;
        b.ticks++;
      }
    }
  }

  _buildHigherTF(_asset, _candle1m) {
    // Already handled by _updateCandleBuilder above
    // This is called when Binance kline closes — mostly redundant
    // but ensures 1m candles from exchange are authoritative
  }

  _tfToMs(tf) {
    const map = {
      "1m": 60000,
      "5m": 300000,
      "15m": 900000,
      "1h": 3600000,
      "4h": 14400000,
      "1D": 86400000,
    };
    return map[tf] || 60000;
  }

  // ═══════════════════════════════════════════════════════════════
  // PERSISTENCE — Save unlimited to Supabase
  // ═══════════════════════════════════════════════════════════════

  _startCandleFlush() {
    // Flush closed candles to Supabase every 30 seconds
    setInterval(() => this._flushToDb(), 30000);
  }

  async _flushToDb() {
    if (!this.supabase || !this.config.persistToDb) return;

    const rows = [];
    for (const [key, arr] of Object.entries(this.candles)) {
      const [asset, tf] = key.split("/");
      // Only flush closed candles not yet persisted
      for (const c of arr) {
        if (c.closed && !c._persisted) {
          rows.push({
            asset,
            timeframe: tf,
            open_time: new Date(c.openTime).toISOString(),
            close_time: new Date(c.closeTime).toISOString(),
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
            ticks: c.ticks || 0,
          });
          c._persisted = true;
        }
      }
    }

    if (rows.length === 0) return;

    try {
      // Batch insert (Supabase handles duplicates via upsert)
      const { error } = await this.supabase
        .from("market_candles")
        .upsert(rows, {
          onConflict: "asset,timeframe,open_time",
          ignoreDuplicates: true,
        });

      if (error) {
        logger.warn(
          { component: "WSEngine", err: error.message },
          "Candle persist error",
        );
      } else {
        this.stats.candlesPersisted += rows.length;
        logger.debug(
          { component: "WSEngine", count: rows.length },
          "Candles persisted to Supabase",
        );
      }
    } catch (e) {
      logger.warn({ component: "WSEngine", err: e.message }, "DB flush error");
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // RECONNECT with exponential backoff
  // ═══════════════════════════════════════════════════════════════

  _reconnect(exchange) {
    const attempts = this.reconnectAttempts[exchange]++;
    if (attempts >= this.maxReconnect) {
      logger.error(
        { component: "WSEngine", exchange },
        `Max reconnect attempts reached for ${exchange}`,
      );
      return;
    }
    const delay = Math.min(1000 * Math.pow(2, attempts), 60000); // max 60s
    logger.info(
      { component: "WSEngine", exchange, delay, attempt: attempts },
      `Reconnecting ${exchange} in ${delay}ms...`,
    );
    setTimeout(() => {
      if (exchange === "binance") this._startBinance();
      else if (exchange === "oanda") this._startOanda();
    }, delay);
  }

  // ═══════════════════════════════════════════════════════════════
  // HELPER: Get multi-TF price arrays for analysis
  // ═══════════════════════════════════════════════════════════════

  getPricesMultiTF(asset) {
    const result = {};
    for (const tf of this.config.timeframes) {
      const key = `${asset}/${tf}`;
      const arr = this.candles[key] || [];
      result[tf] = {
        prices: arr.map((c) => c.close),
        highs: arr.map((c) => c.high),
        lows: arr.map((c) => c.low),
        volumes: arr.map((c) => c.volume),
        count: arr.length,
      };
    }
    return result;
  }

  getAllPrices() {
    return { ...this.lastPrices };
  }
}

// Singleton
const engine = new WSEngine();

module.exports = engine;
module.exports.WSEngine = WSEngine;
