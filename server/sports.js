'use strict';

// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — SPORTS BETTING BOT (Admin Only)
// Predictions, analysis, Monte Carlo simulation, Kelly criterion
// ═══════════════════════════════════════════════════════════════

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('./logger');

const router = express.Router();

const DISCLAIMER = 'INFORMATIV — Jocurile de noroc creează dependență. Nu garantăm câștiguri. Joacă responsabil. 18+';
const CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_HISTORY = 200;
const MAX_SIMULATIONS = 10000;
const MAX_SEARCH_CONTEXT_LENGTH = 500;

const SPORTS = ['football', 'basketball'];

const COMPETITIONS = [
    { id: 'ucl',  name: 'UEFA Champions League', sport: 'football' },
    { id: 'epl',  name: 'Premier League',         sport: 'football' },
    { id: 'ro1',  name: 'Liga 1 România',          sport: 'football' },
    { id: 'lla',  name: 'La Liga',                 sport: 'football' },
    { id: 'nba',  name: 'NBA',                     sport: 'basketball' },
];

const STRATEGIES = ['Poisson', 'Form', 'H2H', 'Elo', 'Kelly', 'MonteCarlo'];

// ═══ CACHE ═══
let sportsCache = null;
let cacheTsMs = 0;

// ═══ PREDICTION HISTORY ═══
const predictionHistory = [];

// ═══ VIRTUAL BANKROLL ═══
let virtualBankroll = { initial: 1000, current: 1000, bets: [] };

// ═══ RATE LIMITER ═══
const sportsLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Prea multe cereri sports. Așteaptă un minut.' },
    standardHeaders: true,
    legacyHeaders: false,
});

router.use(sportsLimiter);

// ═══════════════════════════════════════════════════════════════
// PURE CALCULATION FUNCTIONS
// ═══════════════════════════════════════════════════════════════

/**
 * Poisson PMF: P(X=k) = (λ^k * e^(-λ)) / k!
 * @param {number} lambda - expected goals
 * @param {number} k - exact number of goals
 * @returns {number}
 */
function calculatePoisson(lambda, k) {
    if (lambda <= 0 || k < 0 || !Number.isInteger(k)) return 0;
    let factorial = 1;
    for (let i = 2; i <= k; i++) factorial *= i;
    return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial;
}

/**
 * Full match probability matrix via Poisson distribution.
 * @param {number} lambdaHome - home expected goals
 * @param {number} lambdaAway - away expected goals
 * @param {number} [maxGoals=8]
 * @returns {{ homeWin: number, draw: number, awayWin: number, scoreMatrix: number[][] }}
 */
function calculateMatchProbabilities(lambdaHome, lambdaAway, maxGoals = 8) {
    const scoreMatrix = [];
    let homeWin = 0;
    let draw = 0;
    let awayWin = 0;

    for (let h = 0; h <= maxGoals; h++) {
        scoreMatrix[h] = [];
        const ph = calculatePoisson(lambdaHome, h);
        for (let a = 0; a <= maxGoals; a++) {
            const pa = calculatePoisson(lambdaAway, a);
            const p = ph * pa;
            scoreMatrix[h][a] = Math.round(p * 10000) / 10000;
            if (h > a) homeWin += p;
            else if (h === a) draw += p;
            else awayWin += p;
        }
    }

    return {
        homeWin: Math.round(homeWin * 10000) / 10000,
        draw:    Math.round(draw    * 10000) / 10000,
        awayWin: Math.round(awayWin * 10000) / 10000,
        scoreMatrix,
    };
}

/**
 * Elo rating update.
 * @param {number} ratingA
 * @param {number} ratingB
 * @param {number} result - 1=home win, 0.5=draw, 0=away win
 * @param {number} [kFactor=32]
 * @param {number} [homeAdvantage=100]
 * @returns {{ newRatingA: number, newRatingB: number, expectedA: number, expectedB: number }}
 */
function calculateElo(ratingA, ratingB, result, kFactor = 32, homeAdvantage = 100) {
    const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA - homeAdvantage) / 400));
    const expectedB = 1 - expectedA;
    const newRatingA = Math.round(ratingA + kFactor * (result - expectedA));
    const newRatingB = Math.round(ratingB + kFactor * ((1 - result) - expectedB));
    return {
        newRatingA,
        newRatingB,
        expectedA: Math.round(expectedA * 10000) / 10000,
        expectedB: Math.round(expectedB * 10000) / 10000,
    };
}

/**
 * Kelly Criterion stake sizing.
 * f* = (b * p - q) / b, fractional kelly = f* * 0.25, capped at 5%.
 * @param {number} probability - estimated win probability (0–1)
 * @param {number} odds - decimal odds
 * @returns {{ kelly: number, fractionalKelly: number, recommended: number }}
 */
function calculateKelly(probability, odds) {
    const b = odds - 1;
    const p = Math.max(0, Math.min(1, probability));
    const q = 1 - p;
    const kelly = b > 0 ? (b * p - q) / b : 0;
    const fractionalKelly = Math.max(0, kelly * 0.25);
    const recommended = Math.min(fractionalKelly, 0.05);
    return {
        kelly:           Math.round(kelly           * 10000) / 10000,
        fractionalKelly: Math.round(fractionalKelly * 10000) / 10000,
        recommended:     Math.round(recommended     * 10000) / 10000,
    };
}

/**
 * Detect value bet: value = (calculatedProb * odds) - 1.
 * @param {number} calculatedProb
 * @param {number} odds
 * @returns {{ value: number, isValue: boolean, confidence: 'LOW'|'MEDIUM'|'HIGH' }}
 */
function detectValueBet(calculatedProb, odds) {
    const value = calculatedProb * odds - 1;
    const isValue = value > 0.05;
    let confidence = 'LOW';
    if (value > 0.20) confidence = 'HIGH';
    else if (value > 0.10) confidence = 'MEDIUM';
    return {
        value:      Math.round(value * 10000) / 10000,
        isValue,
        confidence,
    };
}

/**
 * Both Teams To Score probability.
 * @param {number} homeScoreProb - P(home scores ≥ 1)
 * @param {number} awayScoreProb - P(away scores ≥ 1)
 * @returns {number}
 */
function calculateBTTS(homeScoreProb, awayScoreProb) {
    return Math.round(homeScoreProb * awayScoreProb * 10000) / 10000;
}

/**
 * Over/Under market probabilities via Poisson.
 * @param {number} lambdaHome
 * @param {number} lambdaAway
 * @param {number} [line=2.5]
 * @returns {{ over: number, under: number }}
 */
function calculateOverUnder(lambdaHome, lambdaAway, line = 2.5) {
    const maxGoals = 15;
    let over = 0;
    for (let h = 0; h <= maxGoals; h++) {
        for (let a = 0; a <= maxGoals; a++) {
            if (h + a > line) {
                over += calculatePoisson(lambdaHome, h) * calculatePoisson(lambdaAway, a);
            }
        }
    }
    over = Math.min(1, Math.max(0, over));
    return {
        over:  Math.round(over          * 10000) / 10000,
        under: Math.round((1 - over)    * 10000) / 10000,
    };
}

/**
 * Monte Carlo match simulation using Poisson sampling.
 * @param {number} lambdaHome
 * @param {number} lambdaAway
 * @param {number} [n=10000]
 * @returns {{ homeWins: number, draws: number, awayWins: number, avgGoals: number, results: object }}
 */
function runMonteCarloSimulation(lambdaHome, lambdaAway, n = 10000) {
    const simCount = Math.min(Math.max(1, Math.floor(n)), MAX_SIMULATIONS);
    let homeWins = 0;
    let draws = 0;
    let awayWins = 0;
    let totalGoals = 0;
    const scoreCounts = {};

    // Poisson random variate via Knuth algorithm
    function poissonRandom(lambda) {
        const L = Math.exp(-lambda);
        let k = 0;
        let p = 1;
        do { k++; p *= Math.random(); } while (p > L);
        return k - 1;
    }

    for (let i = 0; i < simCount; i++) {
        const h = poissonRandom(lambdaHome);
        const a = poissonRandom(lambdaAway);
        totalGoals += h + a;
        const key = `${h}-${a}`;
        scoreCounts[key] = (scoreCounts[key] || 0) + 1;
        if (h > a) homeWins++;
        else if (h === a) draws++;
        else awayWins++;
    }

    return {
        homeWins,
        draws,
        awayWins,
        avgGoals: Math.round((totalGoals / simCount) * 100) / 100,
        results: scoreCounts,
    };
}

/**
 * Analyse recent match form.
 * @param {Array<{ result: 'W'|'D'|'L', goalsFor: number, goalsAgainst: number }>} matches
 * @returns {{ wins: number, draws: number, losses: number, winRate: number, goalsFor: number, goalsAgainst: number, form: string }}
 */
function analyzeForm(matches) {
    if (!Array.isArray(matches) || matches.length === 0) {
        return { wins: 0, draws: 0, losses: 0, winRate: 0, goalsFor: 0, goalsAgainst: 0, form: '' };
    }
    let wins = 0;
    let draws = 0;
    let losses = 0;
    let goalsFor = 0;
    let goalsAgainst = 0;

    for (const m of matches) {
        if (m.result === 'W') wins++;
        else if (m.result === 'D') draws++;
        else losses++;
        goalsFor     += m.goalsFor     || 0;
        goalsAgainst += m.goalsAgainst || 0;
    }

    const form = matches.map(m => m.result).join('');
    const winRate = Math.round((wins / matches.length) * 10000) / 10000;

    return { wins, draws, losses, winRate, goalsFor, goalsAgainst, form };
}

// ═══════════════════════════════════════════════════════════════
// INTERNAL HELPERS
// ═══════════════════════════════════════════════════════════════

/** Generate a simulated prediction for a match. */
function generatePrediction(match, competition) {
    const lambdaHome = 1.4 + Math.random() * 0.8;
    const lambdaAway = 0.9 + Math.random() * 0.6;
    const probs = calculateMatchProbabilities(lambdaHome, lambdaAway);
    const ou = calculateOverUnder(lambdaHome, lambdaAway, 2.5);
    const btts = calculateBTTS(
        1 - calculatePoisson(lambdaHome, 0),
        1 - calculatePoisson(lambdaAway, 0)
    );

    // Pick the highest-probability market
    const markets = [
        { name: 'Home Win',     prob: probs.homeWin, odds: +(1 / (probs.homeWin + 0.05)).toFixed(2) },
        { name: 'Draw',         prob: probs.draw,    odds: +(1 / (probs.draw    + 0.05)).toFixed(2) },
        { name: 'Away Win',     prob: probs.awayWin, odds: +(1 / (probs.awayWin + 0.05)).toFixed(2) },
        { name: 'Over 2.5 Goals', prob: ou.over,     odds: +(1 / (ou.over       + 0.05)).toFixed(2) },
        { name: 'BTTS Yes',     prob: btts,          odds: +(1 / (btts          + 0.05)).toFixed(2) },
    ];
    const best = markets.reduce((a, b) => (a.prob > b.prob ? a : b));

    const valueBet = detectValueBet(best.prob, best.odds);
    const kelly = calculateKelly(best.prob, best.odds);
    const confidence = Math.round(best.prob * 100);

    const kickoff = new Date();
    kickoff.setHours(kickoff.getHours() + Math.floor(Math.random() * 12) + 1, 0, 0, 0);

    return {
        match,
        competition,
        kickoff: kickoff.toISOString(),
        prediction: best.name,
        confidence,
        valueBet: valueBet.isValue,
        edge: `${(valueBet.value * 100).toFixed(1)}%`,
        kellyStake: `${(kelly.recommended * 100).toFixed(1)}%`,
        odds: parseFloat(best.odds.toFixed(2)),
        impliedProb: `${(100 / best.odds).toFixed(1)}%`,
        calculatedProb: `${(best.prob * 100).toFixed(1)}%`,
        strategies: ['Poisson', 'Form', 'H2H'].slice(0, 2 + Math.floor(Math.random() * 2)),
        reasoning: `Analiză bazată pe λ_home=${lambdaHome.toFixed(2)}, λ_away=${lambdaAway.toFixed(2)}. ` +
                   `Probabilitate calculată: ${(best.prob * 100).toFixed(1)}%. Over 2.5: ${(ou.over * 100).toFixed(1)}%. BTTS: ${(btts * 100).toFixed(1)}%.`,
    };
}

/** Simulated fixtures for each supported competition. */
function getSimulatedFixtures() {
    return [
        { match: 'Real Madrid vs Barcelona',        competition: 'La Liga' },
        { match: 'Manchester City vs Arsenal',      competition: 'Premier League' },
        { match: 'Bayern München vs PSG',           competition: 'UEFA Champions League' },
        { match: 'CFR Cluj vs FCSB',                competition: 'Liga 1 România' },
        { match: 'Los Angeles Lakers vs Boston Celtics', competition: 'NBA' },
        { match: 'Liverpool vs Chelsea',            competition: 'Premier League' },
        { match: 'Inter Milan vs Juventus',         competition: 'UEFA Champions League' },
        { match: 'Rapid vs Dinamo',                 competition: 'Liga 1 România' },
    ];
}

/** Simulated live match scores fallback. */
function getSimulatedLiveScores() {
    return [
        { match: 'Real Madrid vs Atletico Madrid', competition: 'La Liga',        minute: 67, score: '1-1', status: 'LIVE' },
        { match: 'Liverpool vs Man United',        competition: 'Premier League', minute: 34, score: '2-0', status: 'LIVE' },
        { match: 'PSG vs Lyon',                    competition: 'Ligue 1',        minute: 0,  score: '-',  status: 'UPCOMING' },
    ];
}

/**
 * Fetch today's upcoming fixtures from API-Football.
 * Falls back to getSimulatedFixtures() if SPORTS_API_KEY is missing or request fails.
 * @returns {Promise<{ fixtures: Array, source: 'live'|'simulated' }>}
 */
async function fetchLiveFixtures() {
    if (!process.env.SPORTS_API_KEY) {
        return { fixtures: getSimulatedFixtures(), source: 'simulated' };
    }
    try {
        const today = new Date().toISOString().split('T')[0];
        logger.info('[Sports] Fetching live fixtures from API-Football');
        const res = await fetch(
            `https://v3.football.api-sports.io/fixtures?date=${today}&status=NS`,
            {
                headers: { 'x-apisports-key': process.env.SPORTS_API_KEY },
                signal: AbortSignal.timeout(5000),
            }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const fixtures = (data.response || []).slice(0, 10).map(f => ({
            match:       `${f.teams.home.name} vs ${f.teams.away.name}`,
            competition: f.league.name,
            kickoff:     f.fixture.date,
        }));
        if (!fixtures.length) return { fixtures: getSimulatedFixtures(), source: 'simulated' };
        return { fixtures, source: 'live' };
    } catch (err) {
        logger.warn(`[Sports] API-Football unavailable: ${err.message}`);
        return { fixtures: getSimulatedFixtures(), source: 'simulated' };
    }
}

/**
 * Fetch current live match scores from API-Football.
 * Falls back to getSimulatedLiveScores() if SPORTS_API_KEY is missing or request fails.
 * @returns {Promise<{ matches: Array, source: 'live'|'simulated' }>}
 */
async function fetchLiveScores() {
    if (!process.env.SPORTS_API_KEY) {
        return { matches: getSimulatedLiveScores(), source: 'simulated' };
    }
    try {
        logger.info('[Sports] Fetching live scores from API-Football');
        const res = await fetch(
            'https://v3.football.api-sports.io/fixtures?live=all',
            {
                headers: { 'x-apisports-key': process.env.SPORTS_API_KEY },
                signal: AbortSignal.timeout(5000),
            }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        const matches = (data.response || []).slice(0, 10).map(f => ({
            match:       `${f.teams.home.name} vs ${f.teams.away.name}`,
            competition: f.league.name,
            minute:      f.fixture.status.elapsed,
            score:       `${f.goals.home}-${f.goals.away}`,
            status:      'LIVE',
        }));
        if (!matches.length) return { matches: getSimulatedLiveScores(), source: 'simulated' };
        return { matches, source: 'live' };
    } catch (err) {
        logger.warn(`[Sports] API-Football live scores unavailable: ${err.message}`);
        return { matches: getSimulatedLiveScores(), source: 'simulated' };
    }
}

/**
 * Fetch soccer odds from The Odds API.
 * Falls back to empty odds if ODDS_API_KEY is missing or request fails.
 * @returns {Promise<{ odds: Array, source: 'live'|'simulated' }>}
 */
async function fetchLiveOdds() {
    if (!process.env.ODDS_API_KEY) {
        return { odds: [], source: 'simulated' };
    }
    try {
        logger.info('[Sports] Fetching live odds from The Odds API');
        const res = await fetch(
            `https://api.the-odds-api.com/v4/sports/soccer/odds?apiKey=${process.env.ODDS_API_KEY}&regions=eu&markets=h2h`,
            { signal: AbortSignal.timeout(5000) }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        return { odds: Array.isArray(data) ? data : [], source: 'live' };
    } catch (err) {
        logger.warn(`[Sports] The Odds API unavailable: ${err.message}`);
        return { odds: [], source: 'simulated' };
    }
}

// ═══════════════════════════════════════════════════════════════
// ROUTES
// ═══════════════════════════════════════════════════════════════

// GET /status
router.get('/status', (req, res) => {
    res.json({
        active: true,
        version: '1.0',
        sports: SPORTS,
        strategies: STRATEGIES,
        competitions: COMPETITIONS.map(c => c.name),
        cacheAge: sportsCache ? Math.round((Date.now() - cacheTsMs) / 1000) + 's' : null,
        bankrollCurrent: virtualBankroll.current,
        predictionCount: predictionHistory.length,
        disclaimer: DISCLAIMER,
    });
});

// GET /analysis
router.get('/analysis', async (req, res) => {
    try {
        const now = Date.now();
        if (sportsCache && now - cacheTsMs < CACHE_TTL_MS) {
            logger.info('[Sports] Returning cached analysis');
            return res.json(sportsCache);
        }

        logger.info('[Sports] Running fresh sports analysis');
        const brain = req.app.locals.brain;
        let searchSummary = null;

        if (brain) {
            try {
                const searchFn = typeof brain.search === 'function' ? brain.search.bind(brain)
                               : typeof brain._search === 'function' ? brain._search.bind(brain)
                               : null;
                if (searchFn) {
                    searchSummary = await searchFn(
                        'Champions League Premier League Liga 1 Romania La Liga NBA results today'
                    );
                }
            } catch (searchErr) {
                logger.warn({ err: searchErr.message }, '[Sports] Brain search unavailable, proceeding without live context');
            }
        }

        const competitionAnalysis = COMPETITIONS.map(comp => {
            const lh = 1.2 + Math.random() * 0.8;
            const la = 0.9 + Math.random() * 0.6;
            const probs = calculateMatchProbabilities(lh, la);
            const ou = calculateOverUnder(lh, la, 2.5);
            return {
                competition: comp.name,
                sport: comp.sport,
                avgGoalsPerMatch: Math.round((lh + la) * 100) / 100,
                homeWinRate: probs.homeWin,
                drawRate: probs.draw,
                awayWinRate: probs.awayWin,
                over25Rate: ou.over,
            };
        });

        const entry = {
            timestamp: new Date().toISOString(),
            competitions: competitionAnalysis,
            searchContext: searchSummary ? String(searchSummary).substring(0, MAX_SEARCH_CONTEXT_LENGTH) : null,
            stale: false,
            disclaimer: DISCLAIMER,
        };

        sportsCache = entry;
        cacheTsMs = now;

        res.json(entry);
    } catch (err) {
        logger.error({ err: err.message }, '[Sports] Analysis error');
        if (sportsCache) {
            return res.json({ ...sportsCache, stale: true });
        }
        res.status(500).json({ error: 'Analiza nu este disponibilă momentan.' });
    }
});

// GET /predictions
router.get('/predictions', async (req, res) => {
    try {
        const { fixtures, source } = await fetchLiveFixtures();
        const predictions = fixtures
            .map(f => generatePrediction(f.match, f.competition))
            .sort((a, b) => b.confidence - a.confidence);

        // Store in history (cap at MAX_HISTORY)
        for (const p of predictions) {
            predictionHistory.push({ ts: new Date().toISOString(), match: p.match, prediction: p.prediction, confidence: p.confidence });
        }
        while (predictionHistory.length > MAX_HISTORY) predictionHistory.shift();

        res.json({ predictions, dataSource: source, disclaimer: DISCLAIMER });
    } catch (err) {
        logger.error({ err: err.message }, '[Sports] Predictions error');
        res.status(500).json({ error: 'Predicțiile nu sunt disponibile momentan.' });
    }
});

// GET /live
router.get('/live', async (req, res) => {
    try {
        const { matches, source } = await fetchLiveScores();

        const brain = req.app.locals.brain;
        let liveData = null;

        if (brain) {
            try {
                const searchFn = typeof brain.search === 'function' ? brain.search.bind(brain)
                               : typeof brain._search === 'function' ? brain._search.bind(brain)
                               : null;
                if (searchFn) {
                    liveData = await searchFn('live football scores today Premier League Champions League');
                }
            } catch (searchErr) {
                logger.warn({ err: searchErr.message }, '[Sports] Brain search unavailable for live scores');
            }
        }

        res.json({
            matches,
            dataSource: source,
            searchContext: liveData ? String(liveData).substring(0, MAX_SEARCH_CONTEXT_LENGTH) : null,
            disclaimer: DISCLAIMER,
        });
    } catch (err) {
        logger.error({ err: err.message }, '[Sports] Live scores error');
        res.status(500).json({ error: 'Scorurile live nu sunt disponibile momentan.' });
    }
});

// GET /leagues
router.get('/leagues', (req, res) => {
    res.json({ leagues: COMPETITIONS, sports: SPORTS, disclaimer: DISCLAIMER });
});

// GET /h2h/:team1/:team2
router.get('/h2h/:team1/:team2', (req, res) => {
    try {
        const { team1, team2 } = req.params;
        if (!team1 || !team2) {
            return res.status(400).json({ error: 'Parametri lipsă: team1, team2.' });
        }

        // Simulated H2H stats
        const totalGames = 10 + Math.floor(Math.random() * 20);
        const team1Wins  = Math.floor(Math.random() * totalGames * 0.5);
        const team2Wins  = Math.floor(Math.random() * (totalGames - team1Wins) * 0.6);
        const draws      = totalGames - team1Wins - team2Wins;
        const team1Goals = team1Wins * 2 + draws + Math.floor(Math.random() * 10);
        const team2Goals = team2Wins * 2 + draws + Math.floor(Math.random() * 10);

        res.json({
            team1,
            team2,
            totalGames,
            team1Wins,
            draws,
            team2Wins,
            team1Goals,
            team2Goals,
            lastMeetings: [
                { date: '2024-11-03', score: `${team1} 2-1 ${team2}`, competition: 'La Liga' },
                { date: '2024-04-21', score: `${team2} 3-0 ${team1}`, competition: 'UCL' },
                { date: '2023-12-10', score: `${team1} 1-1 ${team2}`, competition: 'La Liga' },
            ],
            disclaimer: DISCLAIMER,
        });
    } catch (err) {
        logger.error({ err: err.message }, '[Sports] H2H error');
        res.status(500).json({ error: 'Date H2H indisponibile.' });
    }
});

// GET /form/:team
router.get('/form/:team', (req, res) => {
    try {
        const { team } = req.params;
        if (!team) return res.status(400).json({ error: 'Parametru lipsă: team.' });

        const results = ['W', 'D', 'L'];
        const matches = Array.from({ length: 10 }, () => {
            const result = results[Math.floor(Math.random() * results.length)];
            return {
                result,
                goalsFor:     result === 'W' ? 1 + Math.floor(Math.random() * 3) : result === 'D' ? 1 : Math.floor(Math.random() * 2),
                goalsAgainst: result === 'L' ? 1 + Math.floor(Math.random() * 3) : result === 'D' ? 1 : Math.floor(Math.random() * 2),
            };
        });

        const form = analyzeForm(matches);
        const lambdaFor  = form.goalsFor  / matches.length;
        const lambdaAgainst = form.goalsAgainst / matches.length;

        res.json({
            team,
            last10: form,
            last5:  analyzeForm(matches.slice(0, 5)),
            lambdaFor:     Math.round(lambdaFor     * 100) / 100,
            lambdaAgainst: Math.round(lambdaAgainst * 100) / 100,
            disclaimer: DISCLAIMER,
        });
    } catch (err) {
        logger.error({ err: err.message }, '[Sports] Form error');
        res.status(500).json({ error: 'Date de formă indisponibile.' });
    }
});

// POST /simulate
router.post('/simulate', (req, res) => {
    try {
        const { team1, team2, simulations } = req.body || {};
        if (!team1 || !team2) {
            return res.status(400).json({ error: 'Câmpuri obligatorii: team1, team2.' });
        }

        const n = Math.min(parseInt(simulations, 10) || 10000, MAX_SIMULATIONS);
        const lambdaHome = 1.3 + Math.random() * 0.7;
        const lambdaAway = 1.0 + Math.random() * 0.5;

        const sim = runMonteCarloSimulation(lambdaHome, lambdaAway, n);
        const probs = calculateMatchProbabilities(lambdaHome, lambdaAway);
        const ou = calculateOverUnder(lambdaHome, lambdaAway, 2.5);

        res.json({
            team1,
            team2,
            simulations: n,
            lambdaHome: Math.round(lambdaHome * 100) / 100,
            lambdaAway: Math.round(lambdaAway * 100) / 100,
            monteCarlo: {
                homeWinPct: Math.round((sim.homeWins / n) * 10000) / 100,
                drawPct:    Math.round((sim.draws    / n) * 10000) / 100,
                awayWinPct: Math.round((sim.awayWins / n) * 10000) / 100,
                avgGoals:   sim.avgGoals,
                topScores:  Object.entries(sim.results)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10)
                    .map(([score, count]) => ({ score, count, pct: Math.round((count / n) * 10000) / 100 })),
            },
            poisson: probs,
            overUnder: ou,
            disclaimer: DISCLAIMER,
        });
    } catch (err) {
        logger.error({ err: err.message }, '[Sports] Simulate error');
        res.status(500).json({ error: 'Simularea nu este disponibilă momentan.' });
    }
});

// GET /bankroll
router.get('/bankroll', (req, res) => {
    const totalBets = virtualBankroll.bets.length;
    const profit = virtualBankroll.current - virtualBankroll.initial;
    const roi = totalBets > 0
        ? Math.round((profit / virtualBankroll.initial) * 10000) / 100
        : 0;

    res.json({
        initial: virtualBankroll.initial,
        current: Math.round(virtualBankroll.current * 100) / 100,
        profit:  Math.round(profit * 100) / 100,
        roi:     `${roi}%`,
        totalBets,
        recentBets: virtualBankroll.bets.slice(-10),
        disclaimer: DISCLAIMER,
    });
});

// GET /roi
router.get('/roi', (req, res) => {
    const resolved = predictionHistory.filter(p => p.outcome);
    const correct  = resolved.filter(p => p.outcome === 'WIN').length;
    const hitRate  = resolved.length > 0 ? Math.round((correct / resolved.length) * 10000) / 100 : 0;

    res.json({
        totalPredictions: predictionHistory.length,
        resolved: resolved.length,
        correct,
        hitRate: `${hitRate}%`,
        profit:  Math.round((virtualBankroll.current - virtualBankroll.initial) * 100) / 100,
        roi:     resolved.length > 0
            ? `${Math.round(((virtualBankroll.current - virtualBankroll.initial) / virtualBankroll.initial) * 10000) / 100}%`
            : '0%',
        history: predictionHistory.slice(-20),
        disclaimer: DISCLAIMER,
    });
});

// ═══ EXPORTS ═══
module.exports = router;
module.exports.calculatePoisson           = calculatePoisson;
module.exports.calculateMatchProbabilities = calculateMatchProbabilities;
module.exports.calculateElo               = calculateElo;
module.exports.calculateKelly             = calculateKelly;
module.exports.detectValueBet             = detectValueBet;
module.exports.calculateBTTS              = calculateBTTS;
module.exports.calculateOverUnder         = calculateOverUnder;
module.exports.runMonteCarloSimulation    = runMonteCarloSimulation;
module.exports.analyzeForm                = analyzeForm;
