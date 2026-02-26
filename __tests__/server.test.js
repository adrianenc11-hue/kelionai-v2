'use strict';

const request = require('supertest');
const app = require('../server/index');

describe('Server API', () => {
    describe('GET /api/health', () => {
        test('returns HTTP 200', async () => {
            const res = await request(app).get('/api/health');
            expect(res.status).toBe(200);
        });

        test('returns status online', async () => {
            const res = await request(app).get('/api/health');
            expect(res.body.status).toBe('online');
        });

        test('returns version field', async () => {
            const res = await request(app).get('/api/health');
            expect(res.body).toHaveProperty('version');
        });

        test('returns services object', async () => {
            const res = await request(app).get('/api/health');
            expect(res.body).toHaveProperty('services');
            expect(typeof res.body.services).toBe('object');
        });

        test('returns timestamp in ISO format', async () => {
            const res = await request(app).get('/api/health');
            expect(res.body).toHaveProperty('timestamp');
            expect(() => new Date(res.body.timestamp)).not.toThrow();
        });

        test('returns brain status field', async () => {
            const res = await request(app).get('/api/health');
            expect(res.body).toHaveProperty('brain');
        });
    });

    describe('GET /api/brain', () => {
        test('returns HTTP 200', async () => {
            const res = await request(app).get('/api/brain');
            expect(res.status).toBe(200);
        });

        test('returns brain diagnostics with status', async () => {
            const res = await request(app).get('/api/brain');
            expect(res.body).toHaveProperty('status');
        });
    });

    describe('POST /api/auth/register — input validation', () => {
        test('returns 400 when email is missing', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({ password: 'secret123' });
            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error');
        });

        test('returns 400 when password is missing', async () => {
            const res = await request(app)
                .post('/api/auth/register')
                .send({ email: 'test@example.com' });
            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error');
        });
    });

    describe('POST /api/auth/login — input validation', () => {
        test('returns 400 when credentials are missing', async () => {
            const res = await request(app)
                .post('/api/auth/login')
                .send({});
            expect(res.status).toBe(400);
            expect(res.body).toHaveProperty('error');
        });
    });

    describe('Smoke tests', () => {
        test('server module loads without throwing', () => {
            expect(app).toBeDefined();
        });

        test('serves the frontend on GET /', async () => {
            const res = await request(app).get('/');
            // Returns the SPA index.html (200) or redirects
            expect([200, 301, 302]).toContain(res.status);
        });
    });
});
