'use strict';

const request = require('supertest');

let app;
beforeAll(() => {
    app = require('../server/index');
});

describe('GET /api/legal/terms', () => {
    test('returns 200 with terms of service JSON', async () => {
        const res = await request(app).get('/api/legal/terms');
        expect(res.status).toBe(200);
        expect(res.body.title).toContain('Termeni');
        expect(res.body.version).toBe('1.0');
        expect(res.body.sections).toBeInstanceOf(Array);
        expect(res.body.sections.length).toBeGreaterThan(0);
    });

    test('each section has title and content fields', async () => {
        const res = await request(app).get('/api/legal/terms');
        for (const section of res.body.sections) {
            expect(section.title).toBeDefined();
            expect(section.content).toBeDefined();
        }
    });
});

describe('GET /api/legal/privacy', () => {
    test('returns 200 with privacy policy JSON', async () => {
        const res = await request(app).get('/api/legal/privacy');
        expect(res.status).toBe(200);
        expect(res.body.title).toContain('Confidențialitate');
        expect(res.body.version).toBe('1.0');
        expect(res.body.sections).toBeInstanceOf(Array);
        expect(res.body.sections.length).toBeGreaterThan(0);
    });

    test('includes effectiveDate field', async () => {
        const res = await request(app).get('/api/legal/privacy');
        expect(res.body.effectiveDate).toBeDefined();
    });
});

describe('GDPR endpoints require authentication', () => {
    test('GET /api/legal/gdpr/export returns 401 without auth', async () => {
        const res = await request(app).get('/api/legal/gdpr/export');
        expect([401, 503]).toContain(res.status);
    });

    test('DELETE /api/legal/gdpr/delete returns 401 without auth', async () => {
        const res = await request(app).delete('/api/legal/gdpr/delete');
        expect([401, 503]).toContain(res.status);
    });

    test('POST /api/legal/gdpr/consent returns 401 without auth', async () => {
        const res = await request(app).post('/api/legal/gdpr/consent').send({ type: 'memory', granted: true });
        expect([401, 503]).toContain(res.status);
    });
});
