// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — SPORTS BOT (ADMIN ONLY)
// Live scores, upcoming matches, match analysis
// Data source: TheSportsDB (free, no API key required)
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const fetch = require('node-fetch');
const logger = require('./logger');

const router = express.Router();

// ═══ IN-MEMORY CACHE (10-minute TTL) ═══
const cache = new Map();
const CACHE_TTL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 8000;
const MAX_DESCRIPTION_LENGTH = 300;

function getCached(key) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.ts > CACHE_TTL_MS) {
        cache.delete(key);
        return null;
    }
    return entry.data;
}

function setCached(key, data) {
    cache.set(key, { ts: Date.now(), data });
}

// ═══ BASE URL ═══
const TSDB = 'https://www.thesportsdb.com/api/v1/json/3';

// League IDs for TheSportsDB
const LEAGUES = {
    football_epl:        { id: '4328', name: 'English Premier League', sport: 'Football', icon: '⚽' },
    football_laliga:     { id: '4335', name: 'La Liga', sport: 'Football', icon: '⚽' },
    football_bundesliga: { id: '4331', name: 'Bundesliga', sport: 'Football', icon: '⚽' },
    football_seriea:     { id: '4332', name: 'Serie A', sport: 'Football', icon: '⚽' },
    football_ligue1:     { id: '4334', name: 'Ligue 1', sport: 'Football', icon: '⚽' },
    basketball_nba:      { id: '4387', name: 'NBA', sport: 'Basketball', icon: '🏀' },
    american_football:   { id: '4391', name: 'NFL', sport: 'NFL', icon: '🏈' },
    formula1:            { id: '4370', name: 'Formula 1', sport: 'F1', icon: '🏎️' },
    tennis_atp:          { id: '4424', name: 'ATP Tennis', sport: 'Tennis', icon: '🎾' },
};

// ═══ HELPERS ═══
async function fetchTSDB(endpoint) {
    const cacheKey = endpoint;
    const cached = getCached(cacheKey);
    if (cached) return cached;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const res = await fetch(`${TSDB}${endpoint}`, {
            headers: { 'User-Agent': 'KelionAI/2.0' },
            signal: controller.signal,
        });
        if (!res.ok) {
            logger.warn({ component: 'Sports' }, `TheSportsDB returned ${res.status} for ${endpoint}`);
            return null;
        }
        const data = await res.json();
        setCached(cacheKey, data);
        return data;
    } catch (err) {
        logger.error({ component: 'Sports', err }, `Fetch error for ${endpoint}`);
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function formatForm(events, teamName) {
    if (!events || !events.length) return 'N/A';
    const results = events.slice(-5).map(e => {
        const home = e.strHomeTeam;
        const away = e.strAwayTeam;
        const hs = parseInt(e.intHomeScore, 10);
        const as = parseInt(e.intAwayScore, 10);
        if (isNaN(hs) || isNaN(as)) return '?';
        const isHome = home === teamName;
        const teamScore = isHome ? hs : as;
        const oppScore  = isHome ? as : hs;
        if (teamScore > oppScore) return 'W';
        if (teamScore === oppScore) return 'D';
        return 'L';
    });
    return results.join(' ');
}

function buildDisclaimer() {
    return '⚠️ Sports analysis for informational purposes only. KelionAI NEVER guarantees match outcomes. Betting involves financial risk. Never bet more than you can afford to lose. If you have a gambling problem, seek help.';
}

// ═══ GET /api/sports/live ═══
router.get('/live', async (req, res) => {
    try {
        const data = await fetchTSDB('/livescore.php');
        const events = data && (data.events || data.livescore) ? (data.events || data.livescore) : [];
        res.json({
            live: events.map(e => ({
                id: e.idEvent,
                homeTeam: e.strHomeTeam,
                awayTeam: e.strAwayTeam,
                homeScore: e.intHomeScore,
                awayScore: e.intAwayScore,
                sport: e.strSport,
                league: e.strLeague,
                status: e.strStatus || e.strProgress || 'Live',
                time: e.strTime || null,
                homeLogoUrl: e.strHomeTeamBadge || null,
                awayLogoUrl: e.strAwayTeamBadge || null,
            })),
            disclaimer: buildDisclaimer(),
            cachedAt: new Date().toISOString(),
        });
    } catch (err) {
        logger.error({ component: 'Sports', err: err.message }, 'GET /live');
        res.status(500).json({ error: 'No data available', disclaimer: buildDisclaimer() });
    }
});

// ═══ GET /api/sports/upcoming ═══
router.get('/upcoming', async (req, res) => {
    try {
        const sport = (req.query.sport || '').toLowerCase();
        const leagueFilter = req.query.league || null;

        // Pick leagues to fetch
        const toFetch = leagueFilter
            ? Object.values(LEAGUES).filter(l => l.id === leagueFilter || l.name.toLowerCase().includes(leagueFilter.toLowerCase()))
            : Object.values(LEAGUES);

        const results = await Promise.all(
            toFetch.map(async l => {
                const data = await fetchTSDB(`/eventsnextleague.php?id=${l.id}`);
                const events = (data && data.events) ? data.events : [];
                return events.map(e => ({
                    id: e.idEvent,
                    homeTeam: e.strHomeTeam,
                    awayTeam: e.strAwayTeam,
                    date: e.dateEvent,
                    time: e.strTime,
                    sport: l.sport,
                    league: l.name,
                    icon: l.icon,
                    homeLogoUrl: e.strHomeTeamBadge || null,
                    awayLogoUrl: e.strAwayTeamBadge || null,
                    venue: e.strVenue || null,
                }));
            })
        );

        let all = results.flat();

        // Optional sport filter
        if (sport) {
            all = all.filter(e => e.sport.toLowerCase().includes(sport) || e.league.toLowerCase().includes(sport));
        }

        // Sort by date/time
        all.sort((a, b) => {
            const da = new Date(`${a.date}T${a.time || '00:00:00'}`);
            const db = new Date(`${b.date}T${b.time || '00:00:00'}`);
            return da - db;
        });

        res.json({ upcoming: all, disclaimer: buildDisclaimer(), cachedAt: new Date().toISOString() });
    } catch (err) {
        logger.error({ component: 'Sports', err: err.message }, 'GET /upcoming');
        res.status(500).json({ error: 'No data available', disclaimer: buildDisclaimer() });
    }
});

// ═══ GET /api/sports/leagues ═══
router.get('/leagues', (req, res) => {
    res.json({
        leagues: Object.entries(LEAGUES).map(([key, l]) => ({
            key,
            id: l.id,
            name: l.name,
            sport: l.sport,
            icon: l.icon,
        })),
    });
});

// ═══ GET /api/sports/match/:id ═══
router.get('/match/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const data = await fetchTSDB(`/lookupevent.php?id=${id}`);
        const event = data && data.events && data.events[0] ? data.events[0] : null;

        if (!event) {
            return res.status(404).json({ error: 'Match not found', disclaimer: buildDisclaimer() });
        }

        // Fetch last results for both teams to compute form
        const [homeData, awayData] = await Promise.all([
            fetchTSDB(`/eventslast.php?id=${event.idHomeTeam}`),
            fetchTSDB(`/eventslast.php?id=${event.idAwayTeam}`),
        ]);

        const homeForm = formatForm(homeData && homeData.results, event.strHomeTeam);
        const awayForm = formatForm(awayData && awayData.results, event.strAwayTeam);

        // Simple form-based analysis
        const homeWins = (homeForm.match(/W/g) || []).length;
        const awayWins = (awayForm.match(/W/g) || []).length;
        let formAnalysis;
        if (homeWins > awayWins) {
            formAnalysis = `${event.strHomeTeam} in better recent form (${homeForm})`;
        } else if (awayWins > homeWins) {
            formAnalysis = `${event.strAwayTeam} in better recent form (${awayForm})`;
        } else {
            formAnalysis = 'Both teams in similar form — difficult to predict';
        }

        const analysis = [
            `Match: ${event.strHomeTeam} vs ${event.strAwayTeam}`,
            `Competition: ${event.strLeague}`,
            `Date: ${event.dateEvent} ${event.strTime || ''}`,
            `${event.strHomeTeam} form: ${homeForm}`,
            `${event.strAwayTeam} form: ${awayForm}`,
            `Analysis: ${formAnalysis}`,
            buildDisclaimer(),
        ].join('\n');

        res.json({
            match: {
                id: event.idEvent,
                homeTeam: event.strHomeTeam,
                awayTeam: event.strAwayTeam,
                homeLogoUrl: event.strHomeTeamBadge || null,
                awayLogoUrl: event.strAwayTeamBadge || null,
                date: event.dateEvent,
                time: event.strTime,
                league: event.strLeague,
                sport: event.strSport,
                venue: event.strVenue || null,
                homeScore: event.intHomeScore || null,
                awayScore: event.intAwayScore || null,
                status: event.strStatus || null,
                homeForm,
                awayForm,
            },
            analysis,
            disclaimer: buildDisclaimer(),
        });
    } catch (err) {
        logger.error({ component: 'Sports', err: err.message }, `GET /match/${req.params.id}`);
        res.status(500).json({ error: 'No data available', disclaimer: buildDisclaimer() });
    }
});

// ═══ GET /api/sports/team/:name ═══
router.get('/team/:name', async (req, res) => {
    try {
        const name = encodeURIComponent(req.params.name);
        const data = await fetchTSDB(`/searchteams.php?t=${name}`);
        const teams = (data && data.teams) ? data.teams : [];

        if (!teams.length) {
            return res.status(404).json({ error: 'Team not found', disclaimer: buildDisclaimer() });
        }

        const team = teams[0];

        // Fetch last 5 results
        const lastData = await fetchTSDB(`/eventslast.php?id=${team.idTeam}`);
        const lastEvents = (lastData && lastData.results) ? lastData.results : [];
        const form = formatForm(lastEvents, team.strTeam);

        res.json({
            team: {
                id: team.idTeam,
                name: team.strTeam,
                sport: team.strSport,
                league: team.strLeague,
                country: team.strCountry,
                logoUrl: team.strTeamBadge || null,
                stadium: team.strStadium || null,
                description: team.strDescriptionEN ? team.strDescriptionEN.substring(0, MAX_DESCRIPTION_LENGTH) : null,
                form,
                lastResults: lastEvents.slice(-5).map(e => ({
                    date: e.dateEvent,
                    homeTeam: e.strHomeTeam,
                    awayTeam: e.strAwayTeam,
                    score: `${e.intHomeScore} - ${e.intAwayScore}`,
                    league: e.strLeague,
                })),
            },
            disclaimer: buildDisclaimer(),
        });
    } catch (err) {
        logger.error({ component: 'Sports', err: err.message }, `GET /team/${req.params.name}`);
        res.status(500).json({ error: 'No data available', disclaimer: buildDisclaimer() });
    }
});

module.exports = router;
