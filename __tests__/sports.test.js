'use strict';

const express = require('express');
const crypto = require('crypto');
const request = require('supertest');
const {
    calculatePoisson,
    calculateMatchProbabilities,
    calculateElo,
    calculateKelly,
    detectValueBet,
    calculateBTTS,
    calculateOverUnder,
    runMonteCarloSimulation,
    analyzeForm,
} = require('../server/sports');

const ADMIN_SECRET = 'test-admin-secret-sports';

// Minimal app that mounts only the sports router with adminAuth middleware.
function buildTestApp() {
    process.env.ADMIN_SECRET_KEY = ADMIN_SECRET;
    const app = express();
    app.use(express.json());

    function adminAuth(req, res, next) {
        const secret = req.headers['x-admin-secret'];
        const expected = process.env.ADMIN_SECRET_KEY;
        if (!secret || !expected) return res.status(401).json({ error: 'Unauthorized' });
        try {
            const sb = Buffer.from(secret);
            const eb = Buffer.from(expected);
            if (sb.length !== eb.length || !crypto.timingSafeEqual(sb, eb)) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
        } catch (_) {
            return res.status(401).json({ error: 'Unauthorized' });
        }
        next();
    }

    const sportsRouter = require('../server/sports');
    app.use('/api/sports', adminAuth, sportsRouter);
    return app;
}

let app;

beforeAll(() => {
    app = buildTestApp();
});

afterAll(() => {
    delete process.env.ADMIN_SECRET_KEY;
});

// ─── calculatePoisson ─────────────────────────────────────────

describe('calculatePoisson', () => {
    test('P(0 goals, λ=1) ≈ 0.368', () => {
        expect(calculatePoisson(1, 0)).toBeCloseTo(0.368, 2);
    });

    test('P(1 goal, λ=1) ≈ 0.368', () => {
        expect(calculatePoisson(1, 1)).toBeCloseTo(0.368, 2);
    });

    test('P(2 goals, λ=1) ≈ 0.184', () => {
        expect(calculatePoisson(1, 2)).toBeCloseTo(0.184, 2);
    });

    test('all probabilities are between 0 and 1', () => {
        [0, 1, 2, 3, 4, 5].forEach(k => {
            const p = calculatePoisson(2, k);
            expect(p).toBeGreaterThanOrEqual(0);
            expect(p).toBeLessThanOrEqual(1);
        });
    });
});

// ─── calculateMatchProbabilities ──────────────────────────────

describe('calculateMatchProbabilities', () => {
    test('homeWin + draw + awayWin sums to ~1.0', () => {
        const { homeWin, draw, awayWin } = calculateMatchProbabilities(1.5, 1.2);
        expect(homeWin + draw + awayWin).toBeCloseTo(1.0, 1);
    });

    test('lambdaHome=2, lambdaAway=1 → homeWin > awayWin', () => {
        const { homeWin, awayWin } = calculateMatchProbabilities(2, 1);
        expect(homeWin).toBeGreaterThan(awayWin);
    });
});

// ─── calculateElo ─────────────────────────────────────────────

describe('calculateElo', () => {
    test('returns { newRatingA, newRatingB }', () => {
        const result = calculateElo(1500, 1500, 1);
        expect(result).toHaveProperty('newRatingA');
        expect(result).toHaveProperty('newRatingB');
    });

    test('A wins with equal ratings → A gains points, B loses points', () => {
        const { newRatingA, newRatingB } = calculateElo(1500, 1500, 1, 32, 0);
        expect(newRatingA).toBeGreaterThan(1500);
        expect(newRatingB).toBeLessThan(1500);
    });

    test('total rating change ≈ K factor', () => {
        const kFactor = 32;
        const { newRatingA, newRatingB } = calculateElo(1500, 1500, 1, kFactor, 0);
        const totalChange = Math.abs(newRatingA - 1500) + Math.abs(newRatingB - 1500);
        expect(totalChange).toBeGreaterThan(0);
        expect(totalChange).toBeLessThanOrEqual(kFactor * 2);
    });
});

// ─── calculateKelly ───────────────────────────────────────────

describe('calculateKelly', () => {
    test('positive edge → positive fractionalKelly', () => {
        const { fractionalKelly } = calculateKelly(0.6, 2.0);
        expect(fractionalKelly).toBeGreaterThan(0);
    });

    test('zero probability → fractionalKelly is 0', () => {
        const { fractionalKelly } = calculateKelly(0, 2.0);
        expect(fractionalKelly).toBe(0);
    });

    test('fractionalKelly (recommended) is capped at 5%', () => {
        const { recommended } = calculateKelly(0.9, 10.0);
        expect(recommended).toBeLessThanOrEqual(0.05);
    });
});

// ─── detectValueBet ───────────────────────────────────────────

describe('detectValueBet', () => {
    test('odds=2.0, probability=0.6 → value≈0.2, isValue=true', () => {
        const { value, isValue } = detectValueBet(0.6, 2.0);
        expect(value).toBeCloseTo(0.2, 2);
        expect(isValue).toBe(true);
    });

    test('odds=2.0, probability=0.65 → value>0.2, confidence=HIGH', () => {
        const { value, isValue, confidence } = detectValueBet(0.65, 2.0);
        expect(value).toBeGreaterThan(0.2);
        expect(isValue).toBe(true);
        expect(confidence).toBe('HIGH');
    });

    test('odds=2.0, probability=0.4 → value≈-0.2, isValue=false', () => {
        const { value, isValue } = detectValueBet(0.4, 2.0);
        expect(value).toBeCloseTo(-0.2, 2);
        expect(isValue).toBe(false);
    });
});

// ─── calculateBTTS ────────────────────────────────────────────

describe('calculateBTTS', () => {
    test('returns value between 0 and 1', () => {
        const result = calculateBTTS(0.7, 0.6);
        expect(result).toBeGreaterThanOrEqual(0);
        expect(result).toBeLessThanOrEqual(1);
    });

    test('homeProb=0.8, awayProb=0.7 → BTTS ≈ 0.56', () => {
        expect(calculateBTTS(0.8, 0.7)).toBeCloseTo(0.56, 2);
    });
});

// ─── calculateOverUnder ───────────────────────────────────────

describe('calculateOverUnder', () => {
    test('over + under ≈ 1.0', () => {
        const { over, under } = calculateOverUnder(1.5, 1.2);
        expect(over + under).toBeCloseTo(1.0, 1);
    });

    test('high lambdas → over probability is higher', () => {
        const { over, under } = calculateOverUnder(3.0, 2.5);
        expect(over).toBeGreaterThan(under);
    });
});

// ─── runMonteCarloSimulation ──────────────────────────────────

describe('runMonteCarloSimulation', () => {
    test('returns { homeWins, draws, awayWins }', () => {
        const result = runMonteCarloSimulation(1.5, 1.2, 100);
        expect(result).toHaveProperty('homeWins');
        expect(result).toHaveProperty('draws');
        expect(result).toHaveProperty('awayWins');
    });

    test('homeWins + draws + awayWins === n', () => {
        const n = 500;
        const { homeWins, draws, awayWins } = runMonteCarloSimulation(1.5, 1.2, n);
        expect(homeWins + draws + awayWins).toBe(n);
    });

    test('lambdaHome=3, lambdaAway=0.5 → homeWins > awayWins', () => {
        const { homeWins, awayWins } = runMonteCarloSimulation(3, 0.5, 1000);
        expect(homeWins).toBeGreaterThan(awayWins);
    });
});

// ─── analyzeForm ──────────────────────────────────────────────

describe('analyzeForm', () => {
    const matches = [
        { result: 'W', goalsFor: 2, goalsAgainst: 1 },
        { result: 'D', goalsFor: 1, goalsAgainst: 1 },
        { result: 'L', goalsFor: 0, goalsAgainst: 2 },
        { result: 'W', goalsFor: 3, goalsAgainst: 0 },
    ];

    test('W/D/L counts are correct', () => {
        const { wins, draws, losses } = analyzeForm(matches);
        expect(wins).toBe(2);
        expect(draws).toBe(1);
        expect(losses).toBe(1);
    });

    test('winRate is between 0 and 1', () => {
        const { winRate } = analyzeForm(matches);
        expect(winRate).toBeGreaterThanOrEqual(0);
        expect(winRate).toBeLessThanOrEqual(1);
    });
});

// ─── API endpoint tests ───────────────────────────────────────

const SPORTS_ENDPOINTS = [
    'GET /api/sports/status',
    'GET /api/sports/analysis',
    'GET /api/sports/predictions',
    'GET /api/sports/live',
    'GET /api/sports/leagues',
];

describe('Sports API — 401 without admin secret', () => {
    test.each(SPORTS_ENDPOINTS)('%s returns 401', async (label) => {
        const [, path] = label.split(' ');
        const res = await request(app).get(path);
        expect(res.status).toBe(401);
    });
});

describe('GET /api/sports/status (admin only)', () => {
    test('returns 200 with active, version, disclaimer when authenticated', async () => {
        const res = await request(app)
            .get('/api/sports/status')
            .set('x-admin-secret', ADMIN_SECRET);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('active');
        expect(res.body).toHaveProperty('version');
        expect(res.body).toHaveProperty('disclaimer');
    });
});
