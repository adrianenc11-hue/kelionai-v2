// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — TRADING ANALYSIS ROUTER (Admin Only)
// Informational purposes ONLY. NOT financial advice.
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const fetch = require('node-fetch');
const logger = require('./logger');

const router = express.Router();

// ═══ DISCLAIMER ═══
const DISCLAIMER = '⚠️ INFORMATIONAL PURPOSES ONLY. This is NOT financial advice. KelionAI does not recommend buying or selling any financial instrument. Always consult a licensed financial advisor. Past performance is not indicative of future results.';

// ═══ IN-MEMORY STATE ═══
const cache = new Map();   // symbol → { data, ts }
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

const defaultWatchlist = ['BTC', 'ETH', 'SOL', 'EUR/USD', 'GBP/USD', '^GSPC', 'AAPL', 'GOLD'];
const watchlist = new Set(defaultWatchlist);

// ═══ MARKETS DEFINITION ═══
const MARKETS = {
    crypto: [
        { symbol: 'BTC', name: 'Bitcoin', id: 'bitcoin' },
        { symbol: 'ETH', name: 'Ethereum', id: 'ethereum' },
        { symbol: 'SOL', name: 'Solana', id: 'solana' },
        { symbol: 'BNB', name: 'BNB', id: 'binancecoin' },
        { symbol: 'ADA', name: 'Cardano', id: 'cardano' },
        { symbol: 'XRP', name: 'XRP', id: 'ripple' },
    ],
    forex: [
        { symbol: 'EUR/USD', name: 'Euro / US Dollar', base: 'EUR', quote: 'USD' },
        { symbol: 'GBP/USD', name: 'British Pound / US Dollar', base: 'GBP', quote: 'USD' },
        { symbol: 'USD/JPY', name: 'US Dollar / Japanese Yen', base: 'USD', quote: 'JPY' },
        { symbol: 'USD/CHF', name: 'US Dollar / Swiss Franc', base: 'USD', quote: 'CHF' },
        { symbol: 'AUD/USD', name: 'Australian Dollar / US Dollar', base: 'AUD', quote: 'USD' },
    ],
    stocks: [
        { symbol: 'AAPL', name: 'Apple Inc.' },
        { symbol: 'MSFT', name: 'Microsoft Corp.' },
        { symbol: 'GOOGL', name: 'Alphabet Inc.' },
        { symbol: 'AMZN', name: 'Amazon.com Inc.' },
        { symbol: 'NVDA', name: 'NVIDIA Corp.' },
        { symbol: 'META', name: 'Meta Platforms' },
        { symbol: 'TSLA', name: 'Tesla Inc.' },
    ],
    indices: [
        { symbol: '^GSPC', name: 'S&P 500' },
        { symbol: '^DJI', name: 'Dow Jones Industrial Average' },
        { symbol: '^IXIC', name: 'NASDAQ Composite' },
        { symbol: '^FTSE', name: 'FTSE 100' },
        { symbol: '^N225', name: 'Nikkei 225' },
    ],
    commodities: [
        { symbol: 'GOLD', name: 'Gold', cgId: 'gold' },
        { symbol: 'SILVER', name: 'Silver', cgId: 'silver' },
        { symbol: 'OIL', name: 'Crude Oil (WTI)', yahooSymbol: 'CL=F' },
        { symbol: 'GAS', name: 'Natural Gas', yahooSymbol: 'NG=F' },
    ],
};

// ═══ CACHE HELPERS ═══
function getCached(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL) { cache.delete(key); return null; }
    return entry.data;
}

function setCached(key, data) {
    cache.set(key, { data, ts: Date.now() });
}

// ═══ TECHNICAL INDICATORS ═══
function computeTrend(prices) {
    if (!prices || prices.length < 3) return 'UNKNOWN';
    const first = prices[0];
    const last = prices[prices.length - 1];
    const change = ((last - first) / first) * 100;
    if (change > 2) return 'BULLISH';
    if (change < -2) return 'BEARISH';
    return 'SIDEWAYS';
}

function computeRSI(prices, period = 14) {
    if (!prices || prices.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = prices.length - period; i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff >= 0) gains += diff;
        else losses -= diff;
    }
    if (losses === 0) return 100;
    const rs = gains / losses;
    return Math.round(100 - 100 / (1 + rs));
}

function computeSupportResistance(prices) {
    if (!prices || prices.length < 5) return { support: null, resistance: null };
    const recent = prices.slice(-14);
    return {
        support: Math.min(...recent),
        resistance: Math.max(...recent),
    };
}

function computeMA(prices, period) {
    if (!prices || prices.length < period) return null;
    const slice = prices.slice(-period);
    return slice.reduce((a, b) => a + b, 0) / period;
}

function rsiLabel(rsi) {
    if (rsi === null) return 'N/A';
    if (rsi >= 70) return 'overbought';
    if (rsi <= 30) return 'oversold';
    return 'neutral';
}

function buildAnalysisText(symbol, price, change24h, prices) {
    const trend = computeTrend(prices);
    const rsi = computeRSI(prices);
    const { support, resistance } = computeSupportResistance(prices);
    const ma7 = computeMA(prices, 7);
    const ma21 = computeMA(prices, 21);
    const changeSign = change24h >= 0 ? '+' : '';
    const maSignal = ma7 && ma21 ? (ma7 > ma21 ? 'MA7 > MA21 (bullish cross)' : 'MA7 < MA21 (bearish cross)') : 'Insufficient data';

    let outlook = 'Neutral';
    if (trend === 'BULLISH' && rsi && rsi < 70) outlook = 'Cautiously Bullish';
    else if (trend === 'BEARISH' && rsi && rsi > 30) outlook = 'Cautiously Bearish';
    else if (rsi && rsi >= 70) outlook = 'Overbought — potential pullback';
    else if (rsi && rsi <= 30) outlook = 'Oversold — potential bounce';

    const priceStr = price !== null ? `$${Number(price).toLocaleString('en-US', { maximumFractionDigits: 6 })}` : 'N/A';
    const supportStr = support !== null ? `$${Number(support).toLocaleString('en-US', { maximumFractionDigits: 6 })}` : 'N/A';
    const resistanceStr = resistance !== null ? `$${Number(resistance).toLocaleString('en-US', { maximumFractionDigits: 6 })}` : 'N/A';

    return [
        `${symbol}: ${priceStr} (${changeSign}${change24h !== null ? change24h.toFixed(2) : 'N/A'}%)`,
        `Trend: ${trend}.`,
        `RSI(14): ${rsi !== null ? rsi : 'N/A'} (${rsiLabel(rsi)}).`,
        `Support: ${supportStr} | Resistance: ${resistanceStr}.`,
        `MA Signal: ${maSignal}.`,
        `Short-term outlook: ${outlook}.`,
        DISCLAIMER,
    ].join(' ');
}

// ═══ DATA FETCHERS ═══
async function fetchCryptoData(symbol) {
    const market = MARKETS.crypto.find(m => m.symbol === symbol);
    if (!market) return null;
    const cacheKey = `crypto_${symbol}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;
    try {
        const url = `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${market.id}&order=market_cap_desc&price_change_percentage=24h`;
        const res = await fetch(url, { timeout: 8000 });
        if (!res.ok) throw new Error(`CoinGecko HTTP ${res.status}`);
        const data = await res.json();
        if (!data || !data[0]) throw new Error('No data');
        const coin = data[0];
        // Fetch 7-day history
        const histRes = await fetch(`https://api.coingecko.com/api/v3/coins/${market.id}/market_chart?vs_currency=usd&days=30&interval=daily`, { timeout: 8000 });
        let prices = [];
        if (histRes.ok) {
            const histData = await histRes.json();
            prices = (histData.prices || []).map(p => p[1]);
        }
        const result = {
            symbol,
            name: market.name,
            price: coin.current_price,
            change24h: coin.price_change_percentage_24h,
            marketCap: coin.market_cap,
            volume: coin.total_volume,
            prices,
            type: 'crypto',
        };
        setCached(cacheKey, result);
        return result;
    } catch (e) {
        logger.warn({ component: 'Trading', symbol, err: e.message }, 'Crypto fetch failed');
        return null;
    }
}

async function fetchForexData(symbol) {
    const market = MARKETS.forex.find(m => m.symbol === symbol);
    if (!market) return null;
    const cacheKey = `forex_${symbol}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;
    try {
        const url = `https://api.exchangerate-api.com/v4/latest/${market.base}`;
        const res = await fetch(url, { timeout: 8000 });
        if (!res.ok) throw new Error(`ExchangeRate HTTP ${res.status}`);
        const data = await res.json();
        const rate = data.rates && data.rates[market.quote];
        if (!rate) throw new Error('Rate not found');
        const result = {
            symbol,
            name: market.name,
            price: rate,
            change24h: null, // ExchangeRate free tier doesn't provide 24h change
            prices: [rate],  // minimal history
            type: 'forex',
        };
        setCached(cacheKey, result);
        return result;
    } catch (e) {
        logger.warn({ component: 'Trading', symbol, err: e.message }, 'Forex fetch failed');
        return null;
    }
}

async function fetchYahooData(symbol) {
    const cacheKey = `yahoo_${symbol}`;
    const cached = getCached(cacheKey);
    if (cached) return cached;
    try {
        const encodedSymbol = encodeURIComponent(symbol);
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodedSymbol}?interval=1d&range=1mo`;
        const res = await fetch(url, {
            timeout: 8000,
            headers: { 'User-Agent': 'Mozilla/5.0' }
        });
        if (!res.ok) throw new Error(`Yahoo Finance HTTP ${res.status}`);
        const data = await res.json();
        const result = data.chart && data.chart.result && data.chart.result[0];
        if (!result) throw new Error('No chart result');
        const closes = result.indicators && result.indicators.quote && result.indicators.quote[0] && result.indicators.quote[0].close;
        if (!closes || closes.length === 0) throw new Error('No close prices');
        const prices = closes.filter(p => p !== null && p !== undefined);
        const price = prices[prices.length - 1];
        const prevClose = prices.length >= 2 ? prices[prices.length - 2] : null;
        const change24h = prevClose ? ((price - prevClose) / prevClose) * 100 : null;
        const meta = result.meta || {};
        const output = {
            symbol,
            name: meta.longName || meta.shortName || symbol,
            price,
            change24h,
            prices,
            currency: meta.currency || 'USD',
            type: symbol.startsWith('^') ? 'index' : 'stock',
        };
        setCached(cacheKey, output);
        return output;
    } catch (e) {
        logger.warn({ component: 'Trading', symbol, err: e.message }, 'Yahoo Finance fetch failed');
        return null;
    }
}

async function fetchGoldData() {
    // Gold via CoinGecko (tracks gold price in USD)
    const cacheKey = 'commodity_GOLD';
    const cached = getCached(cacheKey);
    if (cached) return cached;
    try {
        const url = 'https://api.coingecko.com/api/v3/simple/price?ids=gold&vs_currencies=usd&include_24hr_change=true';
        const res = await fetch(url, { timeout: 8000 });
        if (!res.ok) throw new Error(`CoinGecko GOLD HTTP ${res.status}`);
        const data = await res.json();
        if (!data.gold) throw new Error('No gold data');
        const result = {
            symbol: 'GOLD',
            name: 'Gold',
            price: data.gold.usd,
            change24h: data.gold.usd_24h_change || null,
            prices: [data.gold.usd],
            type: 'commodity',
        };
        setCached(cacheKey, result);
        return result;
    } catch (e) {
        logger.warn({ component: 'Trading', symbol: 'GOLD', err: e.message }, 'Gold fetch failed');
        return null;
    }
}

async function fetchSilverData() {
    const cacheKey = 'commodity_SILVER';
    const cached = getCached(cacheKey);
    if (cached) return cached;
    try {
        const url = 'https://api.coingecko.com/api/v3/simple/price?ids=silver&vs_currencies=usd&include_24hr_change=true';
        const res = await fetch(url, { timeout: 8000 });
        if (!res.ok) throw new Error(`CoinGecko SILVER HTTP ${res.status}`);
        const data = await res.json();
        if (!data.silver) throw new Error('No silver data');
        const result = {
            symbol: 'SILVER',
            name: 'Silver',
            price: data.silver.usd,
            change24h: data.silver.usd_24h_change || null,
            prices: [data.silver.usd],
            type: 'commodity',
        };
        setCached(cacheKey, result);
        return result;
    } catch (e) {
        logger.warn({ component: 'Trading', symbol: 'SILVER', err: e.message }, 'Silver fetch failed');
        return null;
    }
}

// ═══ UNIFIED FETCH ═══
async function fetchSymbolData(symbol) {
    // Crypto
    if (MARKETS.crypto.find(m => m.symbol === symbol)) return fetchCryptoData(symbol);
    // Forex
    if (MARKETS.forex.find(m => m.symbol === symbol)) return fetchForexData(symbol);
    // Commodities (Gold/Silver via CoinGecko, others via Yahoo)
    if (symbol === 'GOLD') return fetchGoldData();
    if (symbol === 'SILVER') return fetchSilverData();
    const comm = MARKETS.commodities.find(m => m.symbol === symbol);
    if (comm && comm.yahooSymbol) return fetchYahooData(comm.yahooSymbol).then(d => d ? { ...d, symbol } : null);
    // Stocks and Indices (Yahoo Finance)
    return fetchYahooData(symbol);
}

// ═══ ROUTES ═══

// GET /api/trading/markets
router.get('/markets', (req, res) => {
    res.json({ markets: MARKETS, disclaimer: DISCLAIMER });
});

// GET /api/trading/analysis/:symbol
router.get('/analysis/:symbol', async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    try {
        const data = await fetchSymbolData(symbol);
        if (!data) {
            return res.json({
                symbol,
                price: null,
                change24h: null,
                analysis: 'Data unavailable',
                disclaimer: DISCLAIMER,
            });
        }
        const analysis = buildAnalysisText(symbol, data.price, data.change24h, data.prices);
        const trend = computeTrend(data.prices);
        const rsi = computeRSI(data.prices);
        const { support, resistance } = computeSupportResistance(data.prices);
        const ma7 = computeMA(data.prices, 7);
        const ma21 = computeMA(data.prices, 21);
        res.json({
            symbol,
            name: data.name,
            price: data.price,
            change24h: data.change24h,
            type: data.type,
            indicators: {
                trend,
                rsi,
                rsiLabel: rsiLabel(rsi),
                support,
                resistance,
                ma7: ma7 ? parseFloat(ma7.toFixed(6)) : null,
                ma21: ma21 ? parseFloat(ma21.toFixed(6)) : null,
                maSignal: ma7 && ma21 ? (ma7 > ma21 ? 'bullish' : 'bearish') : null,
            },
            sparkline: data.prices.slice(-14),
            analysis,
            disclaimer: DISCLAIMER,
            cachedAt: new Date().toISOString(),
        });
    } catch (e) {
        logger.error({ component: 'Trading', symbol, err: e.message }, 'Analysis error');
        res.json({ symbol, price: null, analysis: 'Data unavailable', disclaimer: DISCLAIMER });
    }
});

// GET /api/trading/watchlist
router.get('/watchlist', (req, res) => {
    res.json({ watchlist: Array.from(watchlist), disclaimer: DISCLAIMER });
});

// POST /api/trading/watchlist
router.post('/watchlist', (req, res) => {
    const { symbol } = req.body;
    if (!symbol || typeof symbol !== 'string' || symbol.trim().length === 0) {
        return res.status(400).json({ error: 'Symbol is required' });
    }
    const sym = symbol.trim().toUpperCase();
    if (sym.length > 20) {
        return res.status(400).json({ error: 'Symbol too long' });
    }
    watchlist.add(sym);
    res.json({ success: true, watchlist: Array.from(watchlist) });
});

// DELETE /api/trading/watchlist/:symbol
router.delete('/watchlist/:symbol', (req, res) => {
    const sym = req.params.symbol.toUpperCase();
    watchlist.delete(sym);
    res.json({ success: true, watchlist: Array.from(watchlist) });
});

// GET /api/trading/news/:symbol
router.get('/news/:symbol', async (req, res) => {
    const symbol = req.params.symbol.toUpperCase();
    try {
        // Use Tavily search if brain/tavily key is available
        const tavilyKey = process.env.TAVILY_API_KEY;
        if (!tavilyKey) {
            return res.json({ symbol, news: [], message: 'News search unavailable — no search API key configured', disclaimer: DISCLAIMER });
        }
        const cacheKey = `news_${symbol}`;
        const cached = getCached(cacheKey);
        if (cached) return res.json(cached);

        const searchRes = await fetch('https://api.tavily.com/search', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                api_key: tavilyKey,
                query: `${symbol} market news today`,
                search_depth: 'basic',
                max_results: 5,
                include_domains: ['reuters.com', 'bloomberg.com', 'cnbc.com', 'marketwatch.com', 'finance.yahoo.com'],
            }),
            timeout: 8000,
        });
        if (!searchRes.ok) throw new Error(`Tavily HTTP ${searchRes.status}`);
        const searchData = await searchRes.json();
        const news = (searchData.results || []).map(r => ({
            title: r.title,
            url: r.url,
            snippet: r.content ? r.content.slice(0, 200) : '',
            publishedDate: r.published_date || null,
        }));
        const result = { symbol, news, disclaimer: DISCLAIMER };
        setCached(cacheKey, result);
        res.json(result);
    } catch (e) {
        logger.warn({ component: 'Trading', symbol, err: e.message }, 'News fetch failed');
        res.json({ symbol, news: [], message: 'News unavailable', disclaimer: DISCLAIMER });
    }
});

module.exports = router;
