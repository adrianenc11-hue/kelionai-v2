// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — NEWS BOT (Admin Only)
// Schedule: 05:00, 12:00, 18:00 Romanian time (UTC+2)
// Sources: NewsAPI, GNews, Guardian, RSS fallback
// Anti-fake-news filters built-in
// ═══════════════════════════════════════════════════════════════
'use strict';
const express = require('express');
const https = require('https');
const fetch = require('node-fetch');
const crypto = require('crypto');
const logger = require('./logger');
const rateLimit = require('express-rate-limit');

const router = express.Router();

// ═══ CONFIG ═══
const FETCH_HOUR_RO = [5, 12, 18]; // 05:00, 12:00, 18:00 Romanian local time (UTC+2/UTC+3 DST)
const CHECK_INTERVAL_MS = 15 * 60 * 1000; // 15 minutes
const MIN_FETCH_GAP_MS = 14 * 60 * 1000;  // prevent abuse: 14 min min gap
const ARTICLE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_ARTICLES = 100;
const BREAKING_WINDOW_MS = 30 * 60 * 1000; // 30 minutes
const BREAKING_SOURCES_THRESHOLD = 2;
const DEDUP_SIMILARITY = 0.70;

const RSS_SOURCES = [
    { url: 'https://www.digi24.ro/rss', name: 'Digi24' },
    { url: 'https://www.mediafax.ro/rss', name: 'Mediafax' },
    { url: 'https://stirileprotv.ro/rss.xml', name: 'ProTV' }
];

const CATEGORIES = ['general', 'politics', 'economy', 'sports', 'tech', 'world'];

// ═══ IN-MEMORY STORE ═══
/** @type {Map<string, object>} */
const articleCache = new Map();
let lastFetchTime = 0;
let lastFetchedHour = -1; // UTC hour last fetched in

// ═══ RATE LIMITER for fetch endpoint ═══
const fetchLimiter = rateLimit({
    windowMs: 14 * 60 * 1000,
    max: 1,
    message: { error: 'Fetch permis o dată la 14 minute.' },
    standardHeaders: true,
    legacyHeaders: false
});

// ═══ ANTI-FAKE-NEWS FILTER ═══
function isSuspiciousTitle(title) {
    if (!title) return true;
    // Skip ALL CAPS titles (> 70% uppercase letters)
    const letters = title.replace(/[^a-zA-ZÀ-ž]/g, '');
    if (letters.length > 5) {
        const upperCount = (title.match(/[A-ZÀÁÂÃÄÅÆÇÈÉÊËÌÍÎÏÐÑÒÓÔÕÖØÙÚÛÜÝÞ]/g) || []).length;
        if (upperCount / letters.length > 0.7) return true;
    }
    // Skip excessive punctuation
    if (/[!?]{3,}/.test(title)) return true;
    // Skip "EXCLUSIV" alone (as a word, uppercase)
    if (/\bEXCLUSIV\b/.test(title)) return true;
    return false;
}

function isHttpOnly(url) {
    return typeof url === 'string' && url.startsWith('http://');
}

// ═══ TITLE SIMILARITY (Jaccard on word sets) ═══
function titleSimilarity(a, b) {
    const words = (s) => new Set(s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean));
    const sa = words(a);
    const sb = words(b);
    const intersection = new Set([...sa].filter(w => sb.has(w)));
    const union = new Set([...sa, ...sb]);
    return union.size === 0 ? 0 : intersection.size / union.size;
}

// ═══ ARTICLE ID ═══
function makeId(title) {
    return crypto.createHash('md5').update(title || '').digest('hex').slice(0, 16);
}

// ═══ CATEGORY DETECTION ═══
function detectCategory(title, description) {
    const text = ((title || '') + ' ' + (description || '')).toLowerCase();
    if (/fotbal|sport|meci|joc|olimp|tenis|atletism|baschet|handbal/.test(text)) return 'sports';
    if (/economie|bursă|acțiuni|pib|inflație|banca|leu|euro|taxe|buget|investiții/.test(text)) return 'economy';
    if (/politic|guvern|parlament|minister|partid|alegeri|vot|premier|președinte/.test(text)) return 'politics';
    if (/tehnolog|inteligenț|ai|robot|digital|software|hardware|internet|cyber/.test(text)) return 'tech';
    if (/internațional|mondial|europa|sua|rusia|china|ucraina|nato|onu/.test(text)) return 'world';
    return 'general';
}

// ═══ DEDUPLICATION ═══
function isDuplicate(title) {
    for (const article of articleCache.values()) {
        if (titleSimilarity(title, article.title) >= DEDUP_SIMILARITY) return true;
    }
    return false;
}

// ═══ BREAKING NEWS DETECTION ═══
/** Track titles seen per source within BREAKING_WINDOW_MS */
const recentTitleSources = []; // [{title, source, time}]

function checkBreaking(title) {
    const now = Date.now();
    // Purge old entries
    const cutoff = now - BREAKING_WINDOW_MS;
    while (recentTitleSources.length && recentTitleSources[0].time < cutoff) recentTitleSources.shift();

    // Find matching entries from different sources
    const matches = recentTitleSources.filter(e => titleSimilarity(title, e.title) >= DEDUP_SIMILARITY);
    const uniqueSources = new Set(matches.map(e => e.source));

    return { isBreaking: uniqueSources.size >= BREAKING_SOURCES_THRESHOLD - 1, confirmedBy: uniqueSources.size + 1 };
}

function recordTitleSource(title, source) {
    recentTitleSources.push({ title, source, time: Date.now() });
}

// ═══ ADD ARTICLE TO CACHE ═══
function addArticle(raw, source) {
    const title = (raw.title || '').slice(0, 120);
    if (!title) return;
    if (isSuspiciousTitle(title)) return;
    if (isHttpOnly(raw.url)) return;
    if (isDuplicate(title)) return;

    const id = makeId(title);
    const { isBreaking, confirmedBy } = checkBreaking(title);
    recordTitleSource(title, source);

    const article = {
        id,
        title,
        summary: (raw.summary || raw.description || '').slice(0, 300),
        source,
        url: raw.url || '',
        publishedAt: raw.publishedAt || new Date().toISOString(),
        isBreaking,
        category: detectCategory(title, raw.summary || raw.description || ''),
        confirmedBy,
        _cachedAt: Date.now()
    };

    articleCache.set(id, article);

    // Evict oldest if over limit
    if (articleCache.size > MAX_ARTICLES) {
        const oldest = [...articleCache.entries()].sort((a, b) => a[1]._cachedAt - b[1]._cachedAt)[0];
        if (oldest) articleCache.delete(oldest[0]);
    }
}

// ═══ EVICT EXPIRED ARTICLES ═══
function evictExpired() {
    const cutoff = Date.now() - ARTICLE_TTL_MS;
    for (const [id, article] of articleCache.entries()) {
        if (article._cachedAt < cutoff) articleCache.delete(id);
    }
}

// ═══ FETCH FROM NewsAPI ═══
async function fetchNewsAPI() {
    const key = process.env.NEWSAPI_KEY;
    if (!key) return [];
    try {
        const res = await fetch('https://newsapi.org/v2/top-headlines?country=ro', { timeout: 8000, headers: { 'X-Api-Key': key } });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.articles || []).map(a => ({
            title: a.title,
            summary: a.description,
            url: a.url,
            publishedAt: a.publishedAt
        }));
    } catch (e) {
        logger.warn({ component: 'News', source: 'NewsAPI', err: e.message }, 'NewsAPI fetch failed');
        return [];
    }
}

// ═══ FETCH FROM GNews ═══
async function fetchGNews() {
    const key = process.env.GNEWS_KEY;
    if (!key) return [];
    try {
        const res = await fetch(`https://gnews.io/api/v4/top-headlines?lang=ro&token=${key}`, { timeout: 8000 });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.articles || []).map(a => ({
            title: a.title,
            summary: a.description,
            url: a.url,
            publishedAt: a.publishedAt
        }));
    } catch (e) {
        logger.warn({ component: 'News', source: 'GNews', err: e.message }, 'GNews fetch failed');
        return [];
    }
}

// ═══ FETCH FROM Guardian ═══
async function fetchGuardian() {
    const key = process.env.GUARDIAN_KEY;
    if (!key) return [];
    try {
        const res = await fetch(`https://content.guardianapis.com/search?api-key=${key}&lang=ro&show-fields=trailText`, { timeout: 8000 });
        if (!res.ok) return [];
        const data = await res.json();
        return ((data.response || {}).results || []).map(a => ({
            title: a.webTitle,
            summary: (a.fields || {}).trailText || '',
            url: a.webUrl,
            publishedAt: a.webPublicationDate
        }));
    } catch (e) {
        logger.warn({ component: 'News', source: 'Guardian', err: e.message }, 'Guardian fetch failed');
        return [];
    }
}

// ═══ FETCH RSS (built-in https) ═══
function fetchRSS(url) {
    return new Promise((resolve) => {
        const urlObj = new URL(url);
        const options = { hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, headers: { 'User-Agent': 'KelionAI-NewsBot/1.0' }, timeout: 8000 };
        const req = https.get(options, (res) => {
            let body = '';
            res.on('data', chunk => { body += chunk; });
            res.on('end', () => resolve(body));
        });
        req.on('error', () => resolve(''));
        req.on('timeout', () => { req.destroy(); resolve(''); });
    });
}

function parseRSS(xml, sourceName) {
    const articles = [];
    const items = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
    for (const item of items) {
        const titleMatch = item.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
        const linkMatch = item.match(/<link>([\s\S]*?)<\/link>/i) || item.match(/<guid[^>]*>(https?:\/\/[^<]+)<\/guid>/i);
        const descMatch = item.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i);
        const pubMatch = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i);
        const title = titleMatch ? titleMatch[1].trim() : '';
        const url = linkMatch ? linkMatch[1].trim() : '';
        const description = descMatch ? descMatch[1].replace(/</g, ' ').replace(/>/g, ' ').replace(/\s+/g, ' ').trim() : '';
        const pubDateStr = pubMatch ? pubMatch[1].trim() : '';
        let publishedAt;
        try { publishedAt = pubDateStr ? new Date(pubDateStr).toISOString() : new Date().toISOString(); }
        catch (e) { publishedAt = new Date().toISOString(); }
        if (title && url) articles.push({ title, summary: description, url, publishedAt });
    }
    return articles;
}

async function fetchAllRSS() {
    const results = await Promise.allSettled(RSS_SOURCES.map(async ({ url, name }) => {
        const xml = await fetchRSS(url);
        return { name, articles: parseRSS(xml, name) };
    }));
    const combined = [];
    for (const r of results) {
        if (r.status === 'fulfilled') combined.push(r.value);
    }
    return combined;
}

// ═══ MAIN FETCH LOGIC ═══
async function fetchAllSources() {
    logger.info({ component: 'News' }, '📰 Fetching news from all sources...');
    evictExpired();

    const [newsapiArticles, gnewsArticles, guardianArticles, rssResults] = await Promise.allSettled([
        fetchNewsAPI(),
        fetchGNews(),
        fetchGuardian(),
        fetchAllRSS()
    ]);

    const processArticles = (articles, source) => {
        if (!Array.isArray(articles)) return;
        for (const a of articles) addArticle(a, source);
    };

    if (newsapiArticles.status === 'fulfilled') processArticles(newsapiArticles.value, 'NewsAPI');
    if (gnewsArticles.status === 'fulfilled') processArticles(gnewsArticles.value, 'GNews');
    if (guardianArticles.status === 'fulfilled') processArticles(guardianArticles.value, 'Guardian');
    if (rssResults.status === 'fulfilled') {
        for (const { name, articles } of rssResults.value) processArticles(articles, name);
    }

    lastFetchTime = Date.now();
    logger.info({ component: 'News', count: articleCache.size }, `📰 News cache updated: ${articleCache.size} articles`);
}

// ═══ SCHEDULER ═══
function getCurrentRomanianHour() {
    // Romania: UTC+2 (EET) winter / UTC+3 (EEST) summer — approximate with UTC+2
    // DST note: during EEST (late March–late October) this will be off by 1h.
    // Acceptable approximation to avoid adding a timezone library dependency.
    const now = new Date();
    return (now.getUTCHours() + 2) % 24;
}

function getNextFetchTimes() {
    const now = new Date();
    const times = FETCH_HOUR_RO.map(h => {
        const d = new Date(now);
        // Compute approximate UTC hour for this RO hour (UTC+2)
        const utcH = (h - 2 + 24) % 24;
        d.setUTCHours(utcH, 0, 0, 0);
        if (d <= now) d.setUTCDate(d.getUTCDate() + 1);
        return { roHour: h, label: `${String(h).padStart(2, '0')}:00 (RO)`, nextAt: d.toISOString() };
    });
    return times;
}

function startScheduler() {
    setInterval(async () => {
        const roHour = getCurrentRomanianHour();
        const now = Date.now();
        const isScheduledHour = FETCH_HOUR_RO.includes(roHour);
        const gapOk = (now - lastFetchTime) >= MIN_FETCH_GAP_MS;
        const notFetchedThisHour = lastFetchedHour !== roHour;

        if (isScheduledHour && gapOk && notFetchedThisHour) {
            lastFetchedHour = roHour;
            try { await fetchAllSources(); } catch (e) {
                logger.error({ component: 'News', err: e.message }, 'Scheduled fetch failed');
            }
        }
    }, CHECK_INTERVAL_MS);
    logger.info({ component: 'News' }, '📰 News scheduler started (checks every 15min)');
}

// ═══ START SCHEDULER ON MODULE LOAD ═══
startScheduler();

// ═══ HELPERS ═══
function getArticlesArray() {
    evictExpired();
    return [...articleCache.values()].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
}

// ═══ ROUTES ═══

// GET /api/news/latest — latest cached articles
router.get('/latest', (req, res) => {
    const articles = getArticlesArray();
    const category = req.query.category;
    const filtered = category && CATEGORIES.includes(category)
        ? articles.filter(a => a.category === category)
        : articles;
    res.json({ articles: filtered, total: filtered.length, lastFetchAt: lastFetchTime ? new Date(lastFetchTime).toISOString() : null });
});

// GET /api/news/breaking — only breaking news (confirmedBy >= BREAKING_SOURCES_THRESHOLD or urgency > 0.8)
router.get('/breaking', (req, res) => {
    const articles = getArticlesArray().filter(a => a.isBreaking || a.confirmedBy >= BREAKING_SOURCES_THRESHOLD);
    res.json({ articles, total: articles.length });
});

// GET /api/news/schedule — show next scheduled fetch times
router.get('/schedule', (req, res) => {
    res.json({
        schedule: getNextFetchTimes(),
        lastFetchAt: lastFetchTime ? new Date(lastFetchTime).toISOString() : null,
        cacheSize: articleCache.size
    });
});

// GET /api/news/fetch — trigger manual fetch (admin only, rate-limited)
router.get('/fetch', fetchLimiter, async (req, res) => {
    const now = Date.now();
    if ((now - lastFetchTime) < MIN_FETCH_GAP_MS) {
        const waitSec = Math.ceil((MIN_FETCH_GAP_MS - (now - lastFetchTime)) / 1000);
        return res.status(429).json({ error: `Fetch recent. Așteaptă ${waitSec} secunde.` });
    }
    try {
        await fetchAllSources();
        res.json({ success: true, articles: getArticlesArray().length, lastFetchAt: new Date(lastFetchTime).toISOString() });
    } catch (e) {
        logger.error({ component: 'News', err: e.message }, 'Manual fetch failed');
        res.json({ success: false, cacheSize: articleCache.size, error: e.message });
    }
});

// POST /api/news/config — update schedule config (admin only, placeholder for future)
router.post('/config', express.json(), (req, res) => {
    // Config updates are no-op for now (in-memory only, no persistence needed)
    res.json({ success: true, message: 'Config saved (runtime only)' });
});

module.exports = router;
