// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — SPORTS BOT (ADMIN ONLY)
// Free data sources: TheSportsDB (key=3), Ergast F1, BBC RSS
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const router = express.Router();
const logger = require('./logger');

// ── HTTP helper (node-fetch v2, CommonJS) ──────────────────────
let _fetch;
try { _fetch = require('node-fetch'); } catch (_) { _fetch = globalThis.fetch; }

const FETCH_TIMEOUT_MS = 8000;

async function fetchJSON(url, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await _fetch(url, { signal: ctrl.signal, ...opts });
        if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
        return await res.json();
    } finally {
        clearTimeout(timer);
    }
}

async function fetchText(url, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
    try {
        const res = await _fetch(url, { signal: ctrl.signal, ...opts });
        if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
        return await res.text();
    } finally {
        clearTimeout(timer);
    }
}

// ── Cache ──────────────────────────────────────────────────────
const CACHE_TTL_LIVE = 90 * 1000;          // 90 s for live scores
const CACHE_TTL_FIXTURES = 10 * 60 * 1000; // 10 min for fixtures / standings
const _cache = new Map();

function cacheGet(key) {
    const entry = _cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > entry.ttl) { _cache.delete(key); return null; }
    return entry.data;
}

function cacheSet(key, data, ttl) {
    _cache.set(key, { data, ts: Date.now(), ttl });
}

// ── Data-source config ─────────────────────────────────────────
const TSDB_BASE = 'https://www.thesportsdb.com/api/v1/json/3'; // free key = "3"
const ERGAST_BASE = 'https://ergast.com/api/f1';
const BBC_SPORT_RSS = 'https://feeds.bbci.co.uk/sport/rss.xml';
const ESPN_RSS = 'https://www.espn.com/espn/rss/news';

// Disclaimer — MANDATORY in every analysis response
const SPORTS_DISCLAIMER = '⚠️ INFO ONLY: Sports analysis is for informational purposes only. This is NOT betting advice. KelionAI provides no guarantees about match outcomes. Please gamble responsibly.';

// ── Sport → TheSportsDB sport name mapping ─────────────────────
const SPORT_MAP = {
    football: 'Soccer',
    basketball: 'Basketball',
    tennis: 'Tennis',
    f1: 'Motorsport',
    rugby: 'Rugby',
    baseball: 'Baseball',
    hockey: 'Ice Hockey',
};

// ══════════════════════════════════════════════════════════════
// Helper: parse simple RSS XML without xml2js
// ══════════════════════════════════════════════════════════════
function parseRSS(xml) {
    const items = [];
    const itemRx = /<item[\s\S]*?<\/item>/gi;
    const tagRx = (tag) => new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    let match;
    while ((match = itemRx.exec(xml)) !== null) {
        const raw = match[0];
        const titleM = tagRx('title').exec(raw);
        const linkM = tagRx('link').exec(raw);
        const descM = tagRx('description').exec(raw);
        const pubM = tagRx('pubDate').exec(raw);
        if (titleM) {
            items.push({
                title: titleM[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim(),
                link: linkM ? linkM[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '',
                description: descM ? descM[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/</g, '').replace(/>/g, '').trim() : '',
                pubDate: pubM ? pubM[1].trim() : '',
            });
        }
    }
    return items;
}

// ══════════════════════════════════════════════════════════════
// Helper: compute form rating (1-10) from "WWDLW" string
// ══════════════════════════════════════════════════════════════
function formRating(formStr) {
    if (!formStr) return 5;
    const pts = { W: 3, D: 1, L: 0 };
    const games = formStr.toUpperCase().split('').filter(c => pts[c] !== undefined);
    if (!games.length) return 5;
    const max = games.length * 3;
    const score = games.reduce((s, c) => s + pts[c], 0);
    return Math.round((score / max) * 9) + 1;
}

// ══════════════════════════════════════════════════════════════
// Helper: compute analysis from fixture data
// ══════════════════════════════════════════════════════════════
function buildAnalysis(fixture) {
    const homeRating = formRating(fixture.homeTeam && fixture.homeTeam.form);
    const awayRating = formRating(fixture.awayTeam && fixture.awayTeam.form);

    let formAdvantage = 'even';
    if (homeRating > awayRating + 1) formAdvantage = 'home';
    else if (awayRating > homeRating + 1) formAdvantage = 'away';

    const keyFactors = [];
    if (fixture.homeTeam && fixture.homeTeam.form) keyFactors.push(`Home form: ${fixture.homeTeam.form} (rating ${homeRating}/10)`);
    if (fixture.awayTeam && fixture.awayTeam.form) keyFactors.push(`Away form: ${fixture.awayTeam.form} (rating ${awayRating}/10)`);
    keyFactors.push('Home field advantage is a standard statistical factor');

    let signal;
    if (formAdvantage === 'home') {
        signal = `Slight statistical advantage for ${(fixture.homeTeam && fixture.homeTeam.name) || 'home team'} based on recent form`;
    } else if (formAdvantage === 'away') {
        signal = `Slight statistical advantage for ${(fixture.awayTeam && fixture.awayTeam.name) || 'away team'} based on recent form`;
    } else {
        signal = 'Both teams appear evenly matched based on available data';
    }

    return {
        homeAdvantage: true,
        homeFormRating: homeRating,
        awayFormRating: awayRating,
        formAdvantage,
        keyFactors,
        signal,
        disclaimer: SPORTS_DISCLAIMER,
    };
}

// ══════════════════════════════════════════════════════════════
// Helper: normalise a TSDB event into the fixture schema
// ══════════════════════════════════════════════════════════════
function normaliseTSDBEvent(ev) {
    const status = ev.strStatus === 'Match Finished' ? 'finished'
        : ev.strStatus === 'In Progress' || ev.strProgress ? 'live'
            : 'scheduled';

    const homeScore = ev.intHomeScore !== null && ev.intHomeScore !== '' ? parseInt(ev.intHomeScore, 10) : null;
    const awayScore = ev.intAwayScore !== null && ev.intAwayScore !== '' ? parseInt(ev.intAwayScore, 10) : null;

    const fixture = {
        id: String(ev.idEvent || ev.idLiveScore || `${ev.strHomeTeam || ''}-${ev.strAwayTeam || ''}-${ev.dateEvent || Date.now()}`),
        sport: (ev.strSport || 'football').toLowerCase(),
        homeTeam: { name: ev.strHomeTeam || '', logo: ev.strHomeTeamBadge || '', form: ev.strHomeTeamForm || '' },
        awayTeam: { name: ev.strAwayTeam || '', logo: ev.strAwayTeamBadge || '', form: ev.strAwayTeamForm || '' },
        date: ev.dateEvent ? `${ev.dateEvent}T${ev.strTime || '00:00:00'}Z` : new Date().toISOString(),
        league: ev.strLeague || ev.strCircuit || '',
        venue: ev.strVenue || '',
        status,
        score: (homeScore !== null && awayScore !== null) ? { home: homeScore, away: awayScore } : null,
        liveMinute: ev.strProgress || null,
    };
    fixture.analysis = buildAnalysis(fixture);
    return fixture;
}

// ══════════════════════════════════════════════════════════════
// GET /api/sports/live — live scores across all sports
// ══════════════════════════════════════════════════════════════
router.get('/live', async (req, res) => {
    const cacheKey = 'live:all';
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const results = [];

    // TheSportsDB livescore (all sports, free)
    try {
        const data = await fetchJSON(`${TSDB_BASE}/livescore.php`);
        if (data && data.events) {
            data.events.forEach(ev => results.push(normaliseTSDBEvent(ev)));
        }
    } catch (err) {
        logger.warn({ component: 'Sports' }, `livescore fetch failed: ${err.message}`);
    }

    // If a paid API_SPORTS_KEY is present, augment with football live (api-sports.io)
    // This runs independently of TheSportsDB to supplement live data with additional leagues.
    if (process.env.API_SPORTS_KEY) {
        try {
            const data = await fetchJSON('https://v3.football.api-sports.io/fixtures?live=all', {
                headers: { 'x-apisports-key': process.env.API_SPORTS_KEY },
            });
            if (data && data.response) {
                data.response.forEach(item => {
                    const f = item.fixture;
                    const t = item.teams;
                    const g = item.goals;
                    results.push({
                        id: String(f.id),
                        sport: 'football',
                        homeTeam: { name: t.home.name, logo: t.home.logo, form: '' },
                        awayTeam: { name: t.away.name, logo: t.away.logo, form: '' },
                        date: f.date,
                        league: item.league.name,
                        venue: f.venue && f.venue.name || '',
                        status: 'live',
                        score: { home: g.home, away: g.away },
                        liveMinute: f.status && f.status.elapsed ? `${f.status.elapsed}'` : null,
                        analysis: buildAnalysis({ homeTeam: { name: t.home.name, form: '' }, awayTeam: { name: t.away.name, form: '' } }),
                    });
                });
            }
        } catch (err) {
            logger.warn({ component: 'Sports' }, `api-sports live fetch failed: ${err.message}`);
        }
    }

    const payload = { live: results, timestamp: new Date().toISOString(), count: results.length };
    cacheSet(cacheKey, payload, CACHE_TTL_LIVE);
    res.json(payload);
});

// ══════════════════════════════════════════════════════════════
// GET /api/sports/fixtures — today's + tomorrow's fixtures
// ══════════════════════════════════════════════════════════════
router.get('/fixtures', async (req, res) => {
    const cacheKey = 'fixtures:all';
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const fmt = (d) => d.toISOString().slice(0, 10);

    const fixtures = [];

    // Fetch today + tomorrow for each sport
    const sportNames = Object.values(SPORT_MAP);
    await Promise.all([fmt(today), fmt(tomorrow)].map(async (dateStr) => {
        await Promise.all(sportNames.map(async (sport) => {
            try {
                const data = await fetchJSON(`${TSDB_BASE}/eventsday.php?d=${dateStr}&s=${encodeURIComponent(sport)}`);
                if (data && data.events) {
                    data.events.forEach(ev => fixtures.push(normaliseTSDBEvent(ev)));
                }
            } catch (err) {
                logger.warn({ component: 'Sports' }, `fixtures fetch failed (${sport} ${dateStr}): ${err.message}`);
            }
        }));
    }));

    // F1 — next race from Ergast
    try {
        const f1Data = await fetchJSON(`${ERGAST_BASE}/current.json`);
        if (f1Data && f1Data.MRData && f1Data.MRData.RaceTable && f1Data.MRData.RaceTable.Races) {
            const races = f1Data.MRData.RaceTable.Races;
            const upcoming = races.find(r => new Date(`${r.date}T${r.time || '00:00:00Z'}`) >= today);
            if (upcoming) {
                fixtures.push({
                    id: `f1-${upcoming.round}-${upcoming.season}`,
                    sport: 'f1',
                    homeTeam: { name: upcoming.Circuit.circuitName, logo: '', form: '' },
                    awayTeam: { name: `Round ${upcoming.round}`, logo: '', form: '' },
                    date: `${upcoming.date}T${upcoming.time || '00:00:00Z'}`,
                    league: `Formula 1 ${upcoming.season}`,
                    venue: upcoming.Circuit.Location.locality || '',
                    status: 'scheduled',
                    score: null,
                    analysis: {
                        homeAdvantage: false,
                        formAdvantage: 'even',
                        keyFactors: ['F1 race — circuit characteristics affect outcome'],
                        signal: 'Race outcome depends on qualifying, strategy, and car performance',
                        disclaimer: SPORTS_DISCLAIMER,
                    },
                });
            }
        }
    } catch (err) {
        logger.warn({ component: 'Sports' }, `F1 fixtures fetch failed: ${err.message}`);
    }

    const payload = { fixtures, timestamp: new Date().toISOString(), count: fixtures.length };
    cacheSet(cacheKey, payload, CACHE_TTL_FIXTURES);
    res.json(payload);
});

// ══════════════════════════════════════════════════════════════
// GET /api/sports/:sport/standings — league standings
// ══════════════════════════════════════════════════════════════
router.get('/:sport/standings', async (req, res) => {
    const sportParam = req.params.sport.toLowerCase();
    const cacheKey = `standings:${sportParam}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    // F1 standings via Ergast
    if (sportParam === 'f1') {
        try {
            const [driversData, constructorsData] = await Promise.all([
                fetchJSON(`${ERGAST_BASE}/current/driverStandings.json`),
                fetchJSON(`${ERGAST_BASE}/current/constructorStandings.json`),
            ]);

            const drivers = (driversData.MRData.StandingsTable.StandingsLists[0] || {}).DriverStandings || [];
            const constructors = (constructorsData.MRData.StandingsTable.StandingsLists[0] || {}).ConstructorStandings || [];

            const payload = {
                sport: 'f1',
                season: driversData.MRData.StandingsTable.season,
                drivers: drivers.map(d => ({
                    position: parseInt(d.position, 10),
                    name: `${d.Driver.givenName} ${d.Driver.familyName}`,
                    nationality: d.Driver.nationality,
                    team: d.Constructors[0] && d.Constructors[0].name || '',
                    points: parseFloat(d.points),
                    wins: parseInt(d.wins, 10),
                })),
                constructors: constructors.map(c => ({
                    position: parseInt(c.position, 10),
                    name: c.Constructor.name,
                    nationality: c.Constructor.nationality,
                    points: parseFloat(c.points),
                    wins: parseInt(c.wins, 10),
                })),
                timestamp: new Date().toISOString(),
            };
            cacheSet(cacheKey, payload, CACHE_TTL_FIXTURES);
            return res.json(payload);
        } catch (err) {
            logger.warn({ component: 'Sports' }, `F1 standings fetch failed: ${err.message}`);
            return res.status(502).json({ error: 'F1 standings unavailable', details: err.message });
        }
    }

    // Other sports — TheSportsDB: search top leagues by sport name
    const tsdbSport = SPORT_MAP[sportParam];
    if (!tsdbSport) {
        return res.status(400).json({ error: `Unknown sport. Valid: ${Object.keys(SPORT_MAP).join(', ')}` });
    }

    try {
        // Get leagues for the sport
        const leaguesData = await fetchJSON(`${TSDB_BASE}/all_leagues.php?s=${encodeURIComponent(tsdbSport)}`);
        const leagues = (leaguesData.countrys || leaguesData.leagues || []).slice(0, 5);

        const standings = await Promise.all(leagues.map(async (lg) => {
            try {
                const tableData = await fetchJSON(`${TSDB_BASE}/lookuptable.php?l=${lg.idLeague}&s=2024-2025`);
                return {
                    leagueId: lg.idLeague,
                    leagueName: lg.strLeague,
                    country: lg.strCountry || '',
                    table: (tableData.table || []).map(row => ({
                        position: parseInt(row.intRank, 10),
                        team: row.strTeam,
                        played: parseInt(row.intPlayed, 10),
                        won: parseInt(row.intWin, 10),
                        drawn: parseInt(row.intDraw, 10),
                        lost: parseInt(row.intLoss, 10),
                        goalsFor: parseInt(row.intGoalsFor, 10),
                        goalsAgainst: parseInt(row.intGoalsAgainst, 10),
                        points: parseInt(row.intPoints, 10),
                        form: row.strForm || '',
                    })),
                };
            } catch (_) {
                return { leagueId: lg.idLeague, leagueName: lg.strLeague, table: [] };
            }
        }));

        const payload = { sport: sportParam, standings, timestamp: new Date().toISOString() };
        cacheSet(cacheKey, payload, CACHE_TTL_FIXTURES);
        res.json(payload);
    } catch (err) {
        logger.warn({ component: 'Sports' }, `standings fetch failed (${sportParam}): ${err.message}`);
        res.status(502).json({ error: 'Standings unavailable', details: err.message });
    }
});

// ══════════════════════════════════════════════════════════════
// GET /api/sports/analysis/:matchId — pre-match analysis
// ══════════════════════════════════════════════════════════════
router.get('/analysis/:matchId', async (req, res) => {
    const { matchId } = req.params;
    const cacheKey = `analysis:${matchId}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    try {
        const data = await fetchJSON(`${TSDB_BASE}/lookupevent.php?id=${encodeURIComponent(matchId)}`);
        if (!data || !data.events || !data.events[0]) {
            return res.status(404).json({ error: 'Match not found' });
        }

        const fixture = normaliseTSDBEvent(data.events[0]);

        // Try to enrich with H2H if available
        try {
            const h2hData = await fetchJSON(
                `${TSDB_BASE}/eventspastleague.php?id=${encodeURIComponent(matchId)}`
            );
            if (h2hData && h2hData.results) {
                const homeWins = h2hData.results.filter(
                    e => e.strHomeTeam === fixture.homeTeam.name && e.intHomeScore > e.intAwayScore
                        || e.strAwayTeam === fixture.homeTeam.name && e.intAwayScore > e.intHomeScore
                ).length;
                fixture.analysis.keyFactors.push(`H2H record available: home team won ${homeWins} of last ${h2hData.results.length} meetings`);
            }
        } catch (_) { /* H2H optional */ }

        cacheSet(cacheKey, fixture, CACHE_TTL_FIXTURES);
        res.json(fixture);
    } catch (err) {
        logger.warn({ component: 'Sports' }, `analysis fetch failed (${matchId}): ${err.message}`);
        res.status(502).json({ error: 'Analysis unavailable', details: err.message });
    }
});

// ══════════════════════════════════════════════════════════════
// GET /api/sports/news — sports news from free RSS feeds
// ══════════════════════════════════════════════════════════════
router.get('/news', async (req, res) => {
    const cacheKey = 'news:sports';
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const allItems = [];

    await Promise.all([BBC_SPORT_RSS, ESPN_RSS].map(async (rssUrl) => {
        try {
            const xml = await fetchText(rssUrl);
            const items = parseRSS(xml).slice(0, 15);
            items.forEach(item => allItems.push({ ...item, source: rssUrl.includes('bbc') ? 'BBC Sport' : 'ESPN' }));
        } catch (err) {
            logger.warn({ component: 'Sports' }, `RSS fetch failed (${rssUrl}): ${err.message}`);
        }
    }));

    // Sort by pubDate descending
    allItems.sort((a, b) => {
        const ta = a.pubDate ? new Date(a.pubDate).getTime() : 0;
        const tb = b.pubDate ? new Date(b.pubDate).getTime() : 0;
        return tb - ta;
    });

    const payload = { news: allItems, timestamp: new Date().toISOString(), count: allItems.length };
    cacheSet(cacheKey, payload, CACHE_TTL_FIXTURES);
    res.json(payload);
});

module.exports = router;
