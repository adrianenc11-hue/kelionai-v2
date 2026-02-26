'use strict';

const request = require('supertest');
const { getStats } = require('../server/messenger');

let app;
beforeAll(() => {
    app = require('../server/index');
});

describe('getStats()', () => {
    test('returns an object with numeric messagesReceived and repliesSent', () => {
        const stats = getStats();
        expect(typeof stats.messagesReceived).toBe('number');
        expect(typeof stats.repliesSent).toBe('number');
        expect(typeof stats.activeSenders).toBe('number');
    });

    test('initial counts start at 0', () => {
        const stats = getStats();
        expect(stats.messagesReceived).toBeGreaterThanOrEqual(0);
        expect(stats.repliesSent).toBeGreaterThanOrEqual(0);
        expect(stats.activeSenders).toBeGreaterThanOrEqual(0);
    });
});

describe('GET /api/messenger/webhook (verification)', () => {
    test('returns 403 when verify token is missing', async () => {
        const res = await request(app).get('/api/messenger/webhook');
        expect(res.status).toBe(403);
    });

    test('returns 403 when verify token does not match', async () => {
        process.env.FB_VERIFY_TOKEN = 'correct-token';
        const res = await request(app)
            .get('/api/messenger/webhook')
            .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-token', 'hub.challenge': 'abc123' });
        expect(res.status).toBe(403);
    });

    test('returns 200 with challenge when verify token matches', async () => {
        process.env.FB_VERIFY_TOKEN = 'test-verify-token';
        const res = await request(app)
            .get('/api/messenger/webhook')
            .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify-token', 'hub.challenge': 'challenge_abc' });
        expect(res.status).toBe(200);
        expect(res.text).toBe('challenge_abc');
    });
});

describe('POST /api/messenger/webhook', () => {
    test('always returns 200 (Facebook requirement)', async () => {
        const res = await request(app)
            .post('/api/messenger/webhook')
            .set('Content-Type', 'application/json')
            .send({ object: 'page', entry: [] });
        expect(res.status).toBe(200);
    });
});
