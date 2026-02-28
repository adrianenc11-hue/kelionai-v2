'use strict';

const express = require('express');
const crypto = require('crypto');
const request = require('supertest');
const {
    calculateRSI,
    calculateMACD,
    calculateBollingerBands,
    calculateEMA,
    calculateEMACrossover,
    calculateFibonacci,
    analyzeVolume,
    analyzeSentiment,
    calculateConfluence,
} = require('../server/trading');

const ADMIN_SECRET = 'test-admin-secret-trading';

// Minimal app that mounts only the trading router with adminAuth middleware.
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

    const tradingRouter = require('../server/trading');
    app.use('/api/trading', adminAuth, tradingRouter);
    return app;
}

let app;

beforeAll(() => {
    app = buildTestApp();
});

afterAll(() => {
    delete process.env.ADMIN_SECRET_KEY;
});

// ─── calculateEMA ─────────────────────────────────────────────

describe('calculateEMA', () => {
    test('returns array of same length as input', () => {
        const prices = Array.from({ length: 20 }, (_, i) => 100 + i);
        const result = calculateEMA(prices, 10);
        expect(result).toHaveLength(prices.length);
    });

    test('EMA of constant price array returns all same values', () => {
        const prices = Array(20).fill(100);
        const result = calculateEMA(prices, 10);
        result.forEach(v => expect(v).toBeCloseTo(100, 5));
    });

    test('returns empty array when prices shorter than period', () => {
        const result = calculateEMA([100, 101], 10);
        expect(result).toHaveLength(0);
    });
});

// ─── calculateRSI ─────────────────────────────────────────────

describe('calculateRSI', () => {
    test('returns value between 0 and 100 with known inputs', () => {
        const prices = [44, 44.34, 44.09, 43.61, 44.33, 44.83, 45.1, 45.15, 43.61, 44.33, 44.83, 45.1, 45.15, 43.61, 44.33];
        const { value } = calculateRSI(prices, 14);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
    });

    test('all gains → RSI should be ~100', () => {
        const prices = Array.from({ length: 20 }, (_, i) => 100 + i);
        const { value } = calculateRSI(prices, 14);
        expect(value).toBeCloseTo(100, 0);
    });

    test('all losses → RSI should be ~0', () => {
        const prices = Array.from({ length: 20 }, (_, i) => 200 - i);
        const { value } = calculateRSI(prices, 14);
        expect(value).toBeCloseTo(0, 0);
    });

    test('mixed prices → returns numeric between 0 and 100', () => {
        const prices = [100, 102, 101, 103, 100, 99, 101, 104, 102, 103, 105, 104, 106, 107, 105, 108];
        const { value } = calculateRSI(prices, 14);
        expect(typeof value).toBe('number');
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(100);
    });
});

// ─── calculateMACD ────────────────────────────────────────────

describe('calculateMACD', () => {
    test('returns object with macd, signal, histogram properties', () => {
        const prices = Array.from({ length: 40 }, (_, i) => 100 + Math.sin(i) * 5);
        const result = calculateMACD(prices);
        expect(result).toHaveProperty('macd');
        expect(result).toHaveProperty('signal');
        expect(result).toHaveProperty('histogram');
    });

    test('histogram is a number with enough prices', () => {
        const prices = Array.from({ length: 40 }, (_, i) => 100 + i * 0.5);
        const { histogram } = calculateMACD(prices);
        expect(typeof histogram).toBe('number');
    });
});

// ─── calculateBollingerBands ──────────────────────────────────

describe('calculateBollingerBands', () => {
    test('returns { middle, upper, lower, signal }', () => {
        const prices = Array.from({ length: 25 }, (_, i) => 100 + i);
        const result = calculateBollingerBands(prices);
        expect(result).toHaveProperty('middle');
        expect(result).toHaveProperty('upper');
        expect(result).toHaveProperty('lower');
        expect(result).toHaveProperty('signal');
    });

    test('upper > middle > lower for varying prices', () => {
        const prices = Array.from({ length: 25 }, (_, i) => 100 + Math.sin(i) * 10);
        const { upper, middle, lower } = calculateBollingerBands(prices);
        expect(upper).toBeGreaterThan(middle);
        expect(middle).toBeGreaterThan(lower);
    });

    test('constant price array → bands equal the price', () => {
        const prices = Array(20).fill(50);
        const { middle, upper, lower } = calculateBollingerBands(prices);
        expect(middle).toBeCloseTo(50, 2);
        expect(upper).toBeCloseTo(50, 2);
        expect(lower).toBeCloseTo(50, 2);
    });
});

// ─── calculateFibonacci ───────────────────────────────────────

describe('calculateFibonacci', () => {
    test("returns { levels } with keys '23.6', '38.2', '50', '61.8', '78.6'", () => {
        const { levels } = calculateFibonacci(100, 0);
        expect(Object.keys(levels)).toContain('23.6');
        expect(Object.keys(levels)).toContain('38.2');
        expect(Object.keys(levels)).toContain('50');
        expect(Object.keys(levels)).toContain('61.8');
        expect(Object.keys(levels)).toContain('78.6');
    });

    test('high=100, low=0: 50% level equals 50', () => {
        const { levels } = calculateFibonacci(100, 0);
        expect(levels['50']).toBeCloseTo(50, 2);
    });

    test('high=100, low=0: 38.2% level ≈ 61.8', () => {
        const { levels } = calculateFibonacci(100, 0);
        expect(levels['38.2']).toBeCloseTo(61.8, 1);
    });
});

// ─── analyzeSentiment ─────────────────────────────────────────

describe('analyzeSentiment', () => {
    test('bullish text → score > 0', () => {
        const { score } = analyzeSentiment('Bitcoin rally surge bullish breakout buy');
        expect(score).toBeGreaterThan(0);
    });

    test('bearish text → score < 0', () => {
        const { score } = analyzeSentiment('market crash bearish drop sell fear panic');
        expect(score).toBeLessThan(0);
    });

    test('empty string → score 0 (neutral)', () => {
        const { score } = analyzeSentiment('');
        expect(score).toBeCloseTo(0, 5);
    });
});

// ─── calculateConfluence ──────────────────────────────────────

describe('calculateConfluence', () => {
    test('returns { signal, confidence }', () => {
        const result = calculateConfluence({ rsi: { signal: 'BUY' } });
        expect(result).toHaveProperty('signal');
        expect(result).toHaveProperty('confidence');
    });

    test('confidence is between 0 and 100', () => {
        const result = calculateConfluence({
            rsi:       { signal: 'BUY' },
            macd:      { crossSignal: 'BUY' },
            bollinger: { signal: 'HOLD' },
        });
        expect(result.confidence).toBeGreaterThanOrEqual(0);
        expect(result.confidence).toBeLessThanOrEqual(100);
    });

    test('all BUY signals → signal is BUY or STRONG BUY', () => {
        const signals = {
            rsi:       { signal: 'BUY' },
            macd:      { crossSignal: 'BUY' },
            bollinger: { signal: 'BUY' },
            ema:       { signal: 'BUY' },
            fibonacci: { signal: 'BUY' },
            volume:    { signal: 'BUY' },
            sentiment: { label: 'bullish' },
        };
        const { signal } = calculateConfluence(signals);
        expect(['BUY', 'STRONG BUY']).toContain(signal);
    });

    test('all SELL signals → signal is SELL or STRONG SELL', () => {
        const signals = {
            rsi:       { signal: 'SELL' },
            macd:      { crossSignal: 'SELL' },
            bollinger: { signal: 'SELL' },
            ema:       { signal: 'SELL' },
            fibonacci: { signal: 'SELL' },
            volume:    { signal: 'SELL' },
            sentiment: { label: 'bearish' },
        };
        const { signal } = calculateConfluence(signals);
        expect(['SELL', 'STRONG SELL']).toContain(signal);
    });
});

// ─── API endpoint tests ───────────────────────────────────────

const TRADING_ENDPOINTS = [
    'GET /api/trading/status',
    'GET /api/trading/analysis',
    'GET /api/trading/signals',
    'GET /api/trading/portfolio',
    'GET /api/trading/risk',
    'GET /api/trading/correlation',
    'GET /api/trading/alerts',
];

describe('Trading API — 401 without admin secret', () => {
    test.each(TRADING_ENDPOINTS)('%s returns 401', async (label) => {
        const [, path] = label.split(' ');
        const res = await request(app).get(path);
        expect(res.status).toBe(401);
    });
});

describe('GET /api/trading/status (admin only)', () => {
    test('returns 200 with active, version, disclaimer when authenticated', async () => {
        const res = await request(app)
            .get('/api/trading/status')
            .set('x-admin-secret', ADMIN_SECRET);
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('active');
        expect(res.body).toHaveProperty('version');
        expect(res.body).toHaveProperty('disclaimer');
    });
});
