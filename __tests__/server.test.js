'use strict';

const request = require('supertest');

let app;
beforeAll(() => {
    app = require('../server/index');
});

describe('GET /health', () => {
    test('returns 200 with status ok', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(typeof res.body.uptime).toBe('number');
        expect(typeof res.body.timestamp).toBe('string');
    });
});

describe('GET /api/health', () => {
    test('returns 200 with valid brain status', async () => {
        const res = await request(app).get('/api/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('online');
        expect(['healthy', 'stressed', 'degraded']).toContain(res.body.brain);
    });
});

describe('GET / (smoke test)', () => {
    test('serves index.html with 200', async () => {
        const res = await request(app).get('/');
        expect(res.status).toBe(200);
    });
});

describe('GET /nonexistent-route', () => {
    test('catch-all serves index.html with 200', async () => {
        const res = await request(app).get('/some/unknown/path');
        expect(res.status).toBe(200);
    });
});

describe('Security Headers', () => {
    test('responses include helmet security headers', async () => {
        const res = await request(app).get('/health');
        expect(res.headers['x-content-type-options']).toBe('nosniff');
        expect(res.headers['x-frame-options']).toBeDefined();
    });
});

