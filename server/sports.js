// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — SPORTS BOT (ADMIN ONLY)
// Live scores, fixtures, results, analysis — INFORMATIONAL ONLY
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const fetch = require('node-fetch');
const logger = require('./logger');

const router = express.Router();

// ═══ CONSTANTS ═══

const SPORTS_DISCLAIMER = '⚠️ This analysis is INFORMATIONAL ONLY. KelionAI NEVER guarantees any outcome. Sports predictions are inherently uncertain. This is NOT betting advice. Always gamble responsibly.';

// Minimum point difference to consider one team clearly in better form
const FORM_DIFFERENCE_THRESHOLD = 2;

const LEAGUES = {
    'Liga 1': '4768',
    'Premier League': '4328',
    'La Liga': '4335',
    'Serie A': '4332',
    'Bundesliga': '4331',
    'Champions League': '4480'
};

const TSDB_BASE = 'https://www.thesportsdb.com/api/v1/json/3';
const FOOTBALL_DATA_BASE = 'https://api.football-data.org/v4';
const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io';

const FETCH_TIMEOUT = 8000;

// ═══ CACHE ═══

const cache = new Map();

function cacheGet(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) { cache.delete(key); return null; }
    return entry.data;
}

function cacheSet(key, data, ttlMs) {
    cache.set(key, { data, expires: Date.now() + ttlMs });
}

// ═══ HELPERS ═══

async function fetchWithTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT);
    try {
        const res = await fetch(url, { ...options, signal: controller.signal });
        return res;
    } finally {
        clearTimeout(timer);
    }
}

function emptyResult(note = 'Data temporarily unavailable') {
    return { error: null, data: [], note };
}

function buildHeaders(source) {
    const headers = {};
    if (source === 'football-data' && process.env.FOOTBALL_DATA_KEY) {
        headers['X-Auth-Token'] = process.env.FOOTBALL_DATA_KEY;
    }
    if (source === 'api-football' && process.env.API_FOOTBALL_KEY) {
        headers['x-apisports-key'] = process.env.API_FOOTBALL_KEY;
    }
    return headers;
}

function computeFormPoints(formStr) {
    if (!formStr) return 0;
    return formStr.split('').reduce((pts, c) => {
        if (c === 'W') return pts + 3;
        if (c === 'D') return pts + 1;
        return pts;
    }, 0);
}

function mapEvent(event) {
    const home = parseInt(event.intHomeScore, 10);
    const away = parseInt(event.intAwayScore, 10);
    const hasScore = !isNaN(home) && !isNaN(away);
    return {
        id: event.idEvent || '',
        sport: (event.strSport || 'football').toLowerCase(),
        homeTeam: { name: event.strHomeTeam || '', logo: event.strHomeTeamBadge || '', form: '' },
        awayTeam: { name: event.strAwayTeam || '', logo: event.strAwayTeamBadge || '', form: '' },
        date: event.dateEvent ? `${event.dateEvent}T${event.strTime || '00:00:00'}Z` : null,
        venue: event.strVenue || '',
        league: event.strLeague || '',
        status: event.strStatus === 'Match Finished' ? 'finished' : event.strProgress ? 'live' : 'scheduled',
        score: { home: hasScore ? home : null, away: hasScore ? away : null },
        analysis: null,
        disclaimer: SPORTS_DISCLAIMER
    };
}

// ═══ THESPORTSDB FETCHER ═══

async function fetchTSDBLeagueEvents(leagueId, type = 'next') {
    const endpoint = type === 'next'
        ? `${TSDB_BASE}/eventsnextleague.php?id=${leagueId}`
        : `${TSDB_BASE}/eventspastleague.php?id=${leagueId}`;
    try {
        const res = await fetchWithTimeout(endpoint);
        if (!res.ok) return [];
        const json = await res.json();
        return (json.events || []).map(mapEvent);
    } catch (e) {
        logger.warn({ component: 'Sports', leagueId, type }, `TSDB fetch failed: ${e.message}`);
        return [];
    }
}

async function fetchTSDBTeamLastEvents(teamId, n = 5) {
    try {
        const res = await fetchWithTimeout(`${TSDB_BASE}/eventslast.php?id=${teamId}`);
        if (!res.ok) return [];
        const json = await res.json();
        return (json.results || []).slice(0, n);
    } catch (e) {
        logger.warn({ component: 'Sports', teamId }, `TSDB team events fetch failed: ${e.message}`);
        return [];
    }
}

async function fetchTSDBH2H(firstTeamId, secondTeamId) {
    try {
        const res = await fetchWithTimeout(`${TSDB_BASE}/eventsh2h.php?firstid=${firstTeamId}&secondid=${secondTeamId}`);
        if (!res.ok) return [];
        const json = await res.json();
        return (json.results || []).slice(0, 3);
    } catch (e) {
        logger.warn({ component: 'Sports', firstTeamId, secondTeamId }, `TSDB H2H fetch failed: ${e.message}`);
        return [];
    }
}

async function fetchTSDBTopTeams(leagueId) {
    try {
        const res = await fetchWithTimeout(`${TSDB_BASE}/lookup_all_teams.php?id=${leagueId}`);
        if (!res.ok) return [];
        const json = await res.json();
        return (json.teams || []).slice(0, 10).map(t => ({
            id: t.idTeam,
            name: t.strTeam,
            logo: t.strTeamBadge,
            country: t.strCountry,
            stadium: t.strStadium
        }));
    } catch (e) {
        logger.warn({ component: 'Sports', leagueId }, `TSDB top teams fetch failed: ${e.message}`);
        return [];
    }
}

// ═══ NEWS (RSS) ═══

async function fetchSportsNews() {
    const feeds = [
        { name: 'DigiSport', url: 'https://www.digisport.ro/rss' },
        { name: 'ProSport', url: 'https://www.prosport.ro/feed/' },
        { name: 'GSP', url: 'https://www.gsp.ro/rss.xml' }
    ];

    const results = [];
    for (const feed of feeds) {
        try {
            const res = await fetchWithTimeout(feed.url);
            if (!res.ok) continue;
            const text = await res.text();
            // Best-effort RSS extraction without an XML parser dependency.
            // Handles CDATA sections and basic entity encoding; may miss items
            // from non-standard feeds.
            const items = text.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
            items.slice(0, 5).forEach(item => {
                const title = (item.match(/<title[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i) ||
                               item.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '';
                const link = (item.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || '';
                const pubDate = (item.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1] || '';
                if (title.trim()) {
                    results.push({
                        source: feed.name,
                        title: title.trim(),
                        link: link.trim(),
                        pubDate: pubDate.trim()
                    });
                }
            });
        } catch (e) {
            logger.warn({ component: 'Sports', feed: feed.name }, `RSS fetch failed: ${e.message}`);
        }
    }
    return results;
}

// ═══ ROUTES ═══

// GET /api/sports/live — live scores across all sports
router.get('/live', async (req, res) => {
    const cacheKey = 'live';
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    try {
        // TheSportsDB premium livescore not available on free tier — try API-Football if key present
        let data = [];

        if (process.env.API_FOOTBALL_KEY) {
            try {
                const r = await fetchWithTimeout(`${API_FOOTBALL_BASE}/fixtures?live=all`, {
                    headers: buildHeaders('api-football')
                });
                if (r.ok) {
                    const json = await r.json();
                    data = (json.response || []).slice(0, 50).map(f => ({
                        id: String(f.fixture?.id || ''),
                        sport: 'football',
                        homeTeam: { name: f.teams?.home?.name || '', logo: f.teams?.home?.logo || '', form: '' },
                        awayTeam: { name: f.teams?.away?.name || '', logo: f.teams?.away?.logo || '', form: '' },
                        date: f.fixture?.date || null,
                        venue: f.fixture?.venue?.name || '',
                        league: f.league?.name || '',
                        status: 'live',
                        score: { home: f.goals?.home ?? null, away: f.goals?.away ?? null },
                        analysis: null,
                        disclaimer: SPORTS_DISCLAIMER
                    }));
                }
            } catch (e) {
                logger.warn({ component: 'Sports' }, `API-Football live fetch failed: ${e.message}`);
            }
        }

        const result = data.length > 0 ? { error: null, data } : emptyResult('Live scores require API_FOOTBALL_KEY or premium TheSportsDB access');
        cacheSet(cacheKey, result, 3 * 60 * 1000); // 3 min TTL
        res.json(result);
    } catch (e) {
        logger.error({ component: 'Sports' }, `Live scores error: ${e.message}`);
        res.json(emptyResult());
    }
});

// GET /api/sports/fixtures — upcoming matches (next 48h)
router.get('/fixtures', async (req, res) => {
    const cacheKey = 'fixtures';
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    try {
        const allEvents = [];
        // Fetch from TheSportsDB (free) for all configured leagues
        // Liga 1 first (Romanian focus)
        const leagueOrder = ['Liga 1', 'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Champions League'];
        for (const name of leagueOrder) {
            const id = LEAGUES[name];
            const events = await fetchTSDBLeagueEvents(id, 'next');
            events.forEach(e => { e.league = e.league || name; });
            allEvents.push(...events);
        }

        // Filter to next 48h
        const now = Date.now();
        const cutoff = now + 48 * 60 * 60 * 1000;
        const filtered = allEvents.filter(e => {
            if (!e.date) return true; // include if no date info
            const t = new Date(e.date).getTime();
            return t >= now - 60000 && t <= cutoff;
        });

        const result = { error: null, data: filtered.length > 0 ? filtered : allEvents.slice(0, 30) };
        cacheSet(cacheKey, result, 30 * 60 * 1000); // 30 min TTL
        res.json(result);
    } catch (e) {
        logger.error({ component: 'Sports' }, `Fixtures error: ${e.message}`);
        res.json(emptyResult());
    }
});

// GET /api/sports/results — recent results (last 24h)
router.get('/results', async (req, res) => {
    const cacheKey = 'results';
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    try {
        const allEvents = [];
        const leagueOrder = ['Liga 1', 'Premier League', 'La Liga', 'Serie A', 'Bundesliga', 'Champions League'];
        for (const name of leagueOrder) {
            const id = LEAGUES[name];
            const events = await fetchTSDBLeagueEvents(id, 'past');
            events.forEach(e => { e.league = e.league || name; });
            allEvents.push(...events);
        }

        // Filter to last 24h
        const now = Date.now();
        const since = now - 24 * 60 * 60 * 1000;
        const filtered = allEvents.filter(e => {
            if (!e.date) return true;
            const t = new Date(e.date).getTime();
            return t >= since && t <= now + 60000;
        });

        const result = { error: null, data: filtered.length > 0 ? filtered : allEvents.slice(0, 30) };
        cacheSet(cacheKey, result, 30 * 60 * 1000);
        res.json(result);
    } catch (e) {
        logger.error({ component: 'Sports' }, `Results error: ${e.message}`);
        res.json(emptyResult());
    }
});

// GET /api/sports/:sport/top — top teams/players in a sport
router.get('/:sport/top', async (req, res) => {
    const sport = req.params.sport.toLowerCase();
    const cacheKey = `top_${sport}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    try {
        let data = [];
        if (sport === 'football') {
            // Return top teams from Liga 1 and Premier League
            const liga1Teams = await fetchTSDBTopTeams(LEAGUES['Liga 1']);
            const plTeams = await fetchTSDBTopTeams(LEAGUES['Premier League']);
            data = [
                { league: 'Liga 1', teams: liga1Teams },
                { league: 'Premier League', teams: plTeams }
            ];
        } else {
            data = [];
        }

        const result = { error: null, data, sport };
        cacheSet(cacheKey, result, 30 * 60 * 1000);
        res.json(result);
    } catch (e) {
        logger.error({ component: 'Sports', sport }, `Top teams error: ${e.message}`);
        res.json({ ...emptyResult(), sport });
    }
});

// GET /api/sports/analysis/:id — pre-match analysis for a fixture
router.get('/analysis/:id', async (req, res) => {
    const { id } = req.params;
    const cacheKey = `analysis_${id}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    try {
        // Fetch event details from TheSportsDB
        const eventRes = await fetchWithTimeout(`${TSDB_BASE}/lookupevent.php?id=${id}`);
        if (!eventRes.ok) return res.status(404).json({ error: 'Fixture not found' });
        const eventJson = await eventRes.json();
        const event = (eventJson.events || [])[0];
        if (!event) return res.status(404).json({ error: 'Fixture not found' });

        const mapped = mapEvent(event);

        // Fetch last 5 events for each team
        const [homeEvents, awayEvents] = await Promise.all([
            event.idHomeTeam ? fetchTSDBTeamLastEvents(event.idHomeTeam, 5) : Promise.resolve([]),
            event.idAwayTeam ? fetchTSDBTeamLastEvents(event.idAwayTeam, 5) : Promise.resolve([])
        ]);

        // Compute form from each team's perspective
        function teamForm(teamId, events) {
            return events.slice(0, 5).map(e => {
                const h = parseInt(e.intHomeScore, 10);
                const a = parseInt(e.intAwayScore, 10);
                if (isNaN(h) || isNaN(a)) return '?';
                const isHome = e.idHomeTeam === teamId;
                if (h === a) return 'D';
                if (isHome) return h > a ? 'W' : 'L';
                return a > h ? 'W' : 'L';
            }).join('');
        }

        const homeForm = teamForm(event.idHomeTeam, homeEvents);
        const awayForm = teamForm(event.idAwayTeam, awayEvents);
        const homeFormPoints = computeFormPoints(homeForm);
        const awayFormPoints = computeFormPoints(awayForm);

        // Head-to-head
        let h2h = [];
        if (event.idHomeTeam && event.idAwayTeam) {
            h2h = await fetchTSDBH2H(event.idHomeTeam, event.idAwayTeam);
        }

        // Verdict — NEVER says "X will win", only form comparison
        let verdict;
        if (homeFormPoints > awayFormPoints + FORM_DIFFERENCE_THRESHOLD) {
            verdict = 'Home team in better recent form';
        } else if (awayFormPoints > homeFormPoints + FORM_DIFFERENCE_THRESHOLD) {
            verdict = 'Away team in better recent form';
        } else {
            verdict = 'Teams in similar recent form';
        }

        mapped.homeTeam.form = homeForm;
        mapped.awayTeam.form = awayForm;
        mapped.analysis = {
            homeFormPoints,
            awayFormPoints,
            h2hMatches: h2h.length,
            verdict,
            confidence: 'low' // always low or medium, never high
        };
        mapped.disclaimer = SPORTS_DISCLAIMER;

        cacheSet(cacheKey, mapped, 30 * 60 * 1000);
        res.json(mapped);
    } catch (e) {
        logger.error({ component: 'Sports', id }, `Analysis error: ${e.message}`);
        res.status(500).json({ error: 'Analysis temporarily unavailable', disclaimer: SPORTS_DISCLAIMER });
    }
});

// GET /api/sports/news — sports news (Romanian focus)
router.get('/news', async (req, res) => {
    const cacheKey = 'news';
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    try {
        const items = await fetchSportsNews();
        const result = { error: null, data: items };
        cacheSet(cacheKey, result, 30 * 60 * 1000);
        res.json(result);
    } catch (e) {
        logger.error({ component: 'Sports' }, `News error: ${e.message}`);
        res.json(emptyResult());
    }
});

module.exports = router;
