'use strict';

const request = require('supertest');

let app;
beforeAll(() => {
    process.env.ADMIN_SECRET_KEY = 'test-admin-secret';
    app = require('../server/index');
});

const adminHeaders = { 'x-admin-secret': 'test-admin-secret' };

describe('Trading Router — Auth', () => {
    test('GET /api/trading/markets without admin key returns 401', async () => {
        const res = await request(app).get('/api/trading/markets');
        expect(res.status).toBe(401);
        expect(res.body.error).toBe('Unauthorized');
    });

    test('GET /api/trading/markets with wrong key returns 401', async () => {
        const res = await request(app).get('/api/trading/markets').set('x-admin-secret', 'wrong');
        expect(res.status).toBe(401);
    });

    test('GET /api/trading/markets with correct key returns 200', async () => {
        const res = await request(app).get('/api/trading/markets').set(adminHeaders);
        expect(res.status).toBe(200);
        expect(res.body.markets).toBeDefined();
        expect(res.body.disclaimer).toBeDefined();
    });
});

describe('Trading Router — Markets', () => {
    test('markets response contains expected categories', async () => {
        const res = await request(app).get('/api/trading/markets').set(adminHeaders);
        const { markets } = res.body;
        expect(markets.crypto).toBeInstanceOf(Array);
        expect(markets.forex).toBeInstanceOf(Array);
        expect(markets.stocks).toBeInstanceOf(Array);
        expect(markets.indices).toBeInstanceOf(Array);
        expect(markets.commodities).toBeInstanceOf(Array);
    });

    test('markets disclaimer always present', async () => {
        const res = await request(app).get('/api/trading/markets').set(adminHeaders);
        expect(res.body.disclaimer).toContain('NOT financial advice');
    });
});

describe('Trading Router — Watchlist', () => {
    test('GET /api/trading/watchlist returns default symbols', async () => {
        const res = await request(app).get('/api/trading/watchlist').set(adminHeaders);
        expect(res.status).toBe(200);
        expect(res.body.watchlist).toBeInstanceOf(Array);
        expect(res.body.watchlist).toContain('BTC');
        expect(res.body.watchlist).toContain('ETH');
    });

    test('POST /api/trading/watchlist adds a symbol', async () => {
        const res = await request(app)
            .post('/api/trading/watchlist')
            .set(adminHeaders)
            .send({ symbol: 'DOGE' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.watchlist).toContain('DOGE');
    });

    test('POST /api/trading/watchlist with missing symbol returns 400', async () => {
        const res = await request(app)
            .post('/api/trading/watchlist')
            .set(adminHeaders)
            .send({});
        expect(res.status).toBe(400);
        expect(res.body.error).toBeDefined();
    });

    test('POST /api/trading/watchlist with empty symbol returns 400', async () => {
        const res = await request(app)
            .post('/api/trading/watchlist')
            .set(adminHeaders)
            .send({ symbol: '   ' });
        expect(res.status).toBe(400);
    });

    test('POST /api/trading/watchlist with too-long symbol returns 400', async () => {
        const res = await request(app)
            .post('/api/trading/watchlist')
            .set(adminHeaders)
            .send({ symbol: 'A'.repeat(21) });
        expect(res.status).toBe(400);
    });

    test('DELETE /api/trading/watchlist/:symbol removes symbol', async () => {
        // First add it
        await request(app).post('/api/trading/watchlist').set(adminHeaders).send({ symbol: 'REMOVE_ME' });
        const del = await request(app).delete('/api/trading/watchlist/REMOVE_ME').set(adminHeaders);
        expect(del.status).toBe(200);
        expect(del.body.watchlist).not.toContain('REMOVE_ME');
    });

    test('watchlist disclaimer always present', async () => {
        const res = await request(app).get('/api/trading/watchlist').set(adminHeaders);
        expect(res.body.disclaimer).toContain('NOT financial advice');
    });
});

describe('Trading Router — Analysis', () => {
    test('GET /api/trading/analysis/:symbol returns proper structure', async () => {
        const res = await request(app).get('/api/trading/analysis/BTC').set(adminHeaders);
        expect(res.status).toBe(200);
        expect(res.body.symbol).toBe('BTC');
        expect(res.body.disclaimer).toBeDefined();
        expect(res.body.disclaimer).toContain('NOT financial advice');
        // price may be null if external API unavailable in test env
        expect('price' in res.body).toBe(true);
        expect('analysis' in res.body).toBe(true);
    });

    test('GET /api/trading/analysis/:symbol normalises symbol to uppercase', async () => {
        const res = await request(app).get('/api/trading/analysis/btc').set(adminHeaders);
        expect(res.status).toBe(200);
        expect(res.body.symbol).toBe('BTC');
    });

    test('analysis response when data unavailable has safe fallback', async () => {
        // Use an unknown symbol that will always fail external fetch
        const res = await request(app).get('/api/trading/analysis/ZZZNONSYMBOL123').set(adminHeaders);
        expect(res.status).toBe(200);
        expect(res.body.price).toBeNull();
        expect(res.body.analysis).toBe('Data unavailable');
        expect(res.body.disclaimer).toBeDefined();
    });
});

describe('Trading Router — News', () => {
    test('GET /api/trading/news/:symbol returns valid structure without API key', async () => {
        const origTavily = process.env.TAVILY_API_KEY;
        delete process.env.TAVILY_API_KEY;
        try {
            const res = await request(app).get('/api/trading/news/BTC').set(adminHeaders);
            expect(res.status).toBe(200);
            expect(res.body.symbol).toBe('BTC');
            expect(res.body.news).toBeInstanceOf(Array);
            expect(res.body.disclaimer).toBeDefined();
        } finally {
            if (origTavily !== undefined) process.env.TAVILY_API_KEY = origTavily;
        }
    });
});
