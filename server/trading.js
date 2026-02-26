// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — TRADING BOT (ADMIN ONLY — purely informational)
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const fetch = require('node-fetch');
const logger = require('./logger');

const router = express.Router();

// ═══ DISCLAIMER ═══
const DISCLAIMER = '⚠️ DISCLAIMER: This is informational analysis only. NOT financial advice. Past performance does not guarantee future results. Always consult a licensed financial advisor before making any investment decisions. KelionAI never executes trades.';

// ═══ IN-MEMORY CACHE (5 min TTL) ═══
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

function getCache(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(key); return null; }
    return entry.data;
}
function setCache(key, data) {
    cache.set(key, { data, ts: Date.now() });
}

// ═══ IN-MEMORY WATCHLIST ═══
const watchlist = [];
const MAX_WATCHLIST = 20;

// ═══ FETCH WITH TIMEOUT ═══
async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        return res;
    } finally {
        clearTimeout(timer);
    }
}

// ═══ COMMON TICKER → COINGECKO ID MAP ═══
const COIN_ID_MAP = {
    BTC: 'bitcoin', ETH: 'ethereum', BNB: 'binancecoin', SOL: 'solana',
    XRP: 'ripple', ADA: 'cardano', DOGE: 'dogecoin', DOT: 'polkadot',
    MATIC: 'matic-network', AVAX: 'avalanche-2', LINK: 'chainlink',
    LTC: 'litecoin', UNI: 'uniswap', ATOM: 'cosmos', XLM: 'stellar',
    ALGO: 'algorand', TRX: 'tron', VET: 'vechain', FIL: 'filecoin',
    AAVE: 'aave', CRO: 'crypto-com-chain', SHIB: 'shiba-inu'
};

function toCoinGeckoId(symbol) {
    const upper = symbol.toUpperCase().replace('-USD', '').replace('-USDT', '').replace('-USDC', '');
    return COIN_ID_MAP[upper] || symbol.toLowerCase().replace('-usd', '').replace('-usdt', '').replace('-usdc', '');
}
function computeSMA(prices, period) {
    if (prices.length < period) return null;
    const slice = prices.slice(-period);
    return slice.reduce((sum, p) => sum + p, 0) / period;
}

function computeRSI(prices, period = 14) {
    if (prices.length < period + 1) return null;
    const changes = [];
    for (let i = 1; i < prices.length; i++) {
        changes.push(prices[i] - prices[i - 1]);
    }
    const recent = changes.slice(-period);
    const gains = recent.filter(c => c > 0).reduce((sum, c) => sum + c, 0) / period;
    const losses = Math.abs(recent.filter(c => c < 0).reduce((sum, c) => sum + c, 0)) / period;
    if (losses === 0) return 100;
    const rs = gains / losses;
    return 100 - (100 / (1 + rs));
}

function buildAnalysis(prices) {
    if (!prices || prices.length === 0) return null;
    const sma20 = computeSMA(prices, 20);
    const rsi14 = computeRSI(prices, 14);
    const currentPrice = prices[prices.length - 1];

    let trend = 'neutral';
    if (sma20 !== null) {
        if (currentPrice > sma20 * 1.01) trend = 'bullish';
        else if (currentPrice < sma20 * 0.99) trend = 'bearish';
    }

    let signal = 'HOLD';
    let confidence = 'medium';
    if (rsi14 !== null) {
        if (rsi14 < 30 && trend === 'bullish') { signal = 'BUY'; confidence = 'low'; }
        else if (rsi14 > 70 && trend === 'bearish') { signal = 'SELL'; confidence = 'low'; }
        else if (rsi14 < 30 || rsi14 > 70) { confidence = 'low'; }
        else { confidence = 'medium'; }
    }

    return {
        sma20: sma20 !== null ? Math.round(sma20 * 100) / 100 : null,
        rsi14: rsi14 !== null ? Math.round(rsi14 * 100) / 100 : null,
        trend,
        signal,
        confidence
    };
}

// ═══ GET /api/trading/markets ═══
router.get('/markets', async (req, res) => {
    try {
        const cached = getCache('markets');
        if (cached) return res.json(cached);

        const data = {
            markets: [
                { id: 'crypto', name: 'Cryptocurrency', status: 'open', description: 'Digital assets — 24/7' },
                { id: 'forex', name: 'Forex', status: 'open', description: 'Major & minor currency pairs' },
                { id: 'stocks', name: 'Stocks', status: 'open', description: 'Equities (US markets)' },
                { id: 'commodities', name: 'Commodities', status: 'open', description: 'Gold, Silver, Oil, Gas' },
                { id: 'indices', name: 'Indices', status: 'open', description: 'S&P 500, NASDAQ, DAX, FTSE' }
            ],
            disclaimer: DISCLAIMER,
            fetchedAt: new Date().toISOString()
        };
        setCache('markets', data);
        res.json(data);
    } catch (e) {
        logger.error({ component: 'Trading' }, `markets error: ${e.message}`);
        res.status(500).json({ error: 'Failed to fetch markets', disclaimer: DISCLAIMER });
    }
});

// ═══ GET /api/trading/crypto ═══
router.get('/crypto', async (req, res) => {
    try {
        const cached = getCache('crypto');
        if (cached) return res.json(cached);

        let coins = null;
        try {
            const r = await fetchWithTimeout(
                'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=20&page=1'
            );
            if (r.ok) {
                const raw = await r.json();
                coins = raw.map(c => ({
                    symbol: c.symbol.toUpperCase(),
                    name: c.name,
                    price: c.current_price,
                    change24h: c.price_change_percentage_24h,
                    marketCap: c.market_cap,
                    volume24h: c.total_volume,
                    image: c.image,
                    dataSource: 'CoinGecko'
                }));
            }
        } catch (_) { /* fallback below */ }

        if (!coins) {
            const r = await fetchWithTimeout('https://api.coincap.io/v2/assets?limit=20');
            if (r.ok) {
                const raw = await r.json();
                coins = (raw.data || []).map(c => ({
                    symbol: c.symbol,
                    name: c.name,
                    price: parseFloat(c.priceUsd),
                    change24h: parseFloat(c.changePercent24Hr),
                    marketCap: parseFloat(c.marketCapUsd),
                    volume24h: parseFloat(c.volumeUsd24Hr),
                    dataSource: 'CoinCap'
                }));
            }
        }

        const data = { coins: coins || [], disclaimer: DISCLAIMER, fetchedAt: new Date().toISOString() };
        setCache('crypto', data);
        res.json(data);
    } catch (e) {
        logger.error({ component: 'Trading' }, `crypto error: ${e.message}`);
        res.status(500).json({ error: 'Failed to fetch crypto data', disclaimer: DISCLAIMER });
    }
});

// ═══ GET /api/trading/forex ═══
router.get('/forex', async (req, res) => {
    try {
        const cached = getCache('forex');
        if (cached) return res.json(cached);

        let pairs = null;
        try {
            const r = await fetchWithTimeout('https://api.frankfurter.app/latest?from=USD&to=EUR,GBP,RON,JPY,CHF,CAD,AUD,NZD');
            if (r.ok) {
                const raw = await r.json();
                pairs = Object.entries(raw.rates).map(([to, rate]) => ({
                    pair: `USD/${to}`,
                    base: 'USD',
                    quote: to,
                    rate,
                    dataSource: 'Frankfurter'
                }));
            }
        } catch (_) { /* fallback */ }

        if (!pairs) {
            const r = await fetchWithTimeout('https://open.er-api.com/v6/latest/USD');
            if (r.ok) {
                const raw = await r.json();
                const wanted = ['EUR', 'GBP', 'RON', 'JPY', 'CHF', 'CAD', 'AUD', 'NZD'];
                pairs = wanted
                    .filter(c => raw.rates[c])
                    .map(c => ({
                        pair: `USD/${c}`,
                        base: 'USD',
                        quote: c,
                        rate: raw.rates[c],
                        dataSource: 'ExchangeRate-API'
                    }));
            }
        }

        const data = { pairs: pairs || [], disclaimer: DISCLAIMER, fetchedAt: new Date().toISOString() };
        setCache('forex', data);
        res.json(data);
    } catch (e) {
        logger.error({ component: 'Trading' }, `forex error: ${e.message}`);
        res.status(500).json({ error: 'Failed to fetch forex data', disclaimer: DISCLAIMER });
    }
});

// ═══ GET /api/trading/analysis/:symbol ═══
router.get('/analysis/:symbol', async (req, res) => {
    try {
        const symbol = req.params.symbol.toUpperCase();
        const cacheKey = `analysis_${symbol}`;
        const cached = getCache(cacheKey);
        if (cached) return res.json(cached);

        let prices = [];
        let price = null;
        let change24h = null;
        let marketCap = null;
        let volume24h = null;
        let name = symbol;
        let dataSource = 'unknown';

        // Try CoinGecko for crypto symbols
        try {
            const cgId = toCoinGeckoId(symbol);
            const r = await fetchWithTimeout(
                `https://api.coingecko.com/api/v3/coins/${cgId}/market_chart?vs_currency=usd&days=30&interval=daily`
            );
            if (r.ok) {
                const raw = await r.json();
                if (raw.prices && raw.prices.length > 0) {
                    prices = raw.prices.map(p => p[1]);
                    price = prices[prices.length - 1];
                    dataSource = 'CoinGecko';

                    // get current data
                    const r2 = await fetchWithTimeout(
                        `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${cgId}&per_page=1&page=1`
                    );
                    if (r2.ok) {
                        const raw2 = await r2.json();
                        if (raw2[0]) {
                            change24h = raw2[0].price_change_percentage_24h;
                            marketCap = raw2[0].market_cap;
                            volume24h = raw2[0].total_volume;
                            name = raw2[0].name;
                        }
                    }
                }
            }
        } catch (_) { /* try stocks */ }

        // Fallback to Yahoo Finance for stocks / other
        if (prices.length === 0) {
            try {
                const r = await fetchWithTimeout(
                    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1mo&interval=1d`
                );
                if (r.ok) {
                    const raw = await r.json();
                    const result = raw.chart && raw.chart.result && raw.chart.result[0];
                    if (result) {
                        prices = (result.indicators.quote[0].close || []).filter(p => p !== null);
                        price = prices[prices.length - 1];
                        name = (result.meta.longName || result.meta.symbol) || symbol;
                        dataSource = 'Yahoo Finance';
                        const meta = result.meta;
                        if (meta.regularMarketPrice) price = meta.regularMarketPrice;
                        if (meta.regularMarketChangePercent) change24h = meta.regularMarketChangePercent;
                        volume24h = meta.regularMarketVolume || null;
                        marketCap = meta.marketCap || null;
                    }
                }
            } catch (_) { /* ignore */ }
        }

        // Alpha Vantage if key is set and still no data
        if (prices.length === 0 && process.env.ALPHA_VANTAGE_KEY) {
            try {
                const r = await fetchWithTimeout(
                    `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${process.env.ALPHA_VANTAGE_KEY}`
                );
                if (r.ok) {
                    const raw = await r.json();
                    const series = raw['Time Series (Daily)'];
                    if (series) {
                        prices = Object.values(series).reverse().map(d => parseFloat(d['4. close']));
                        price = prices[prices.length - 1];
                        dataSource = 'Alpha Vantage';
                    }
                }
            } catch (_) { /* ignore */ }
        }

        const analysis = buildAnalysis(prices);

        const data = {
            symbol,
            name,
            price: price !== null ? Math.round(price * 10000) / 10000 : null,
            change24h: change24h !== null ? Math.round(change24h * 100) / 100 : null,
            marketCap,
            volume24h,
            analysis,
            disclaimer: DISCLAIMER,
            dataSource,
            fetchedAt: new Date().toISOString()
        };

        if (prices.length > 0) setCache(cacheKey, data);
        res.json(data);
    } catch (e) {
        logger.error({ component: 'Trading' }, `analysis error: ${e.message}`);
        res.status(500).json({ error: 'Failed to fetch analysis', disclaimer: DISCLAIMER });
    }
});

// ═══ GET /api/trading/watchlist ═══
router.get('/watchlist', (req, res) => {
    res.json({ watchlist, disclaimer: DISCLAIMER });
});

// ═══ POST /api/trading/watchlist ═══
router.post('/watchlist', (req, res) => {
    try {
        const { symbol, action } = req.body;
        if (!symbol || typeof symbol !== 'string') {
            return res.status(400).json({ error: 'symbol required', disclaimer: DISCLAIMER });
        }
        const sym = symbol.toUpperCase().trim();
        if (action === 'remove') {
            const idx = watchlist.indexOf(sym);
            if (idx !== -1) watchlist.splice(idx, 1);
            return res.json({ watchlist, disclaimer: DISCLAIMER });
        }
        // add
        if (watchlist.includes(sym)) {
            return res.json({ watchlist, disclaimer: DISCLAIMER });
        }
        if (watchlist.length >= MAX_WATCHLIST) {
            return res.status(400).json({ error: `Watchlist limit is ${MAX_WATCHLIST} symbols`, disclaimer: DISCLAIMER });
        }
        watchlist.push(sym);
        res.json({ watchlist, disclaimer: DISCLAIMER });
    } catch (e) {
        logger.error({ component: 'Trading' }, `watchlist error: ${e.message}`);
        res.status(500).json({ error: 'Watchlist error', disclaimer: DISCLAIMER });
    }
});

// Strip all HTML tags from text extracted from RSS
function stripHtml(str) {
    return str.replace(/&lt;script[\s\S]*?&gt;[\s\S]*?&lt;\/script&gt;/gi, '')
        .replace(/</g, ' ').replace(/>/g, ' ')
        .replace(/&[a-z]+;/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

// ═══ GET /api/trading/news ═══
router.get('/news', async (req, res) => {
    try {
        const cached = getCache('news');
        if (cached) return res.json(cached);

        let articles = [];
        const rssUrls = [
            'https://feeds.reuters.com/reuters/businessNews',
            'https://feeds.bloomberg.com/markets/news.rss'
        ];

        for (const url of rssUrls) {
            try {
                const r = await fetchWithTimeout(url);
                if (r.ok) {
                    const xml = await r.text();
                    // Simple RSS parser — extract <item> blocks
                    const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
                    articles = items.slice(0, 10).map(item => {
                        const title = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                            item.match(/<title>(.*?)<\/title>/) || [])[1] || '';
                        const link = (item.match(/<link>(.*?)<\/link>/) || [])[1] || '';
                        const pubDate = (item.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
                        const desc = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
                            item.match(/<description>(.*?)<\/description>/) || [])[1] || '';
                        return {
                            title: stripHtml(title),
                            link: link.replace(/[<>"' ]/g, '').trim(),
                            pubDate: pubDate.trim(),
                            description: stripHtml(desc).substring(0, 200)
                        };
                    }).filter(a => a.title);
                    if (articles.length > 0) break;
                }
            } catch (_) { continue; }
        }

        const data = { articles, disclaimer: DISCLAIMER, fetchedAt: new Date().toISOString() };
        setCache('news', data);
        res.json(data);
    } catch (e) {
        logger.error({ component: 'Trading' }, `news error: ${e.message}`);
        res.status(500).json({ error: 'Failed to fetch news', disclaimer: DISCLAIMER });
    }
});

module.exports = router;
