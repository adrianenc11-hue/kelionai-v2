'use strict';

const request = require('supertest');

let app;
const ADMIN_SECRET = 'test-admin-secret-news';

beforeAll(() => {
    process.env.ADMIN_SECRET_KEY = ADMIN_SECRET;
    app = require('../server/index');
});

describe('GET /api/news/latest (admin only)', () => {
    test('returns 401 without admin auth', async () => {
        const res = await request(app).get('/api/news/latest');
        expect(res.status).toBe(401);
    });

    test('returns 200 with articles array when authenticated', async () => {
        const res = await request(app)
            .get('/api/news/latest')
            .set('x-admin-secret', ADMIN_SECRET);
        expect(res.status).toBe(200);
        expect(res.body.articles).toBeInstanceOf(Array);
        expect(typeof res.body.total).toBe('number');
    });

    test('accepts category query parameter', async () => {
        const res = await request(app)
            .get('/api/news/latest')
            .query({ category: 'general' })
            .set('x-admin-secret', ADMIN_SECRET);
        expect(res.status).toBe(200);
        expect(res.body.articles).toBeInstanceOf(Array);
    });
});

describe('GET /api/news/breaking (admin only)', () => {
    test('returns 401 without admin auth', async () => {
        const res = await request(app).get('/api/news/breaking');
        expect(res.status).toBe(401);
    });

    test('returns 200 with breaking articles when authenticated', async () => {
        const res = await request(app)
            .get('/api/news/breaking')
            .set('x-admin-secret', ADMIN_SECRET);
        expect(res.status).toBe(200);
        expect(res.body.articles).toBeInstanceOf(Array);
        expect(typeof res.body.total).toBe('number');
    });
});

describe('GET /api/news/schedule (admin only)', () => {
    test('returns 401 without admin auth', async () => {
        const res = await request(app).get('/api/news/schedule');
        expect(res.status).toBe(401);
    });

    test('returns 200 with schedule info when authenticated', async () => {
        const res = await request(app)
            .get('/api/news/schedule')
            .set('x-admin-secret', ADMIN_SECRET);
        expect(res.status).toBe(200);
        expect(res.body.schedule).toBeInstanceOf(Array);
        expect(res.body.cacheSize).toBeDefined();
    });

    test('schedule contains all 3 expected hours', async () => {
        const res = await request(app)
            .get('/api/news/schedule')
            .set('x-admin-secret', ADMIN_SECRET);
        const hours = res.body.schedule.map(s => s.roHour);
        expect(hours).toContain(5);
        expect(hours).toContain(12);
        expect(hours).toContain(18);
    });
});

describe('POST /api/news/config (admin only)', () => {
    test('returns 401 without admin auth', async () => {
        const res = await request(app).post('/api/news/config').send({});
        expect(res.status).toBe(401);
    });

    test('returns 200 with success when authenticated', async () => {
        const res = await request(app)
            .post('/api/news/config')
            .set('x-admin-secret', ADMIN_SECRET)
            .send({ interval: 30 });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });
});
