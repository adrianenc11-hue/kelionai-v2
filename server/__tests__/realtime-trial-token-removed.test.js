/**
 * Audit M2 — regression guard: the legacy /api/realtime/trial-token
 * endpoint (mounted directly on `app` in server/src/index.js, ahead of
 * the realtime router) has been removed. It bypassed the shared
 * 15-min/day trial quota, duplicated the canonical mint logic, and
 * leaked memory via an un-GC'd per-IP Map. Guests now mint realtime
 * tokens through /api/realtime/token — gated by chatLimiter and the
 * shared trial window. This test asserts the shadow path is gone so a
 * future revert is caught in CI.
 */

'use strict';

process.env.NODE_ENV       = 'test';
process.env.JWT_SECRET     = 'test-jwt-secret-at-least-32-chars!!';
process.env.SESSION_SECRET = 'test-session-secret-32chars-longx';
process.env.DB_PATH        = '/tmp/noop.db';

const { createMockDb } = require('./helpers/mockDb');
const mockDb = createMockDb();
jest.mock('../src/db', () => mockDb);
jest.mock('../src/utils/google', () => ({
  generateState: jest.fn().mockReturnValue('s'),
  generatePKCE:  jest.fn().mockReturnValue({ codeVerifier: 'v', codeChallenge: 'c' }),
  buildAuthUrl:  jest.fn().mockReturnValue('https://accounts.google.com/?mocked=1'),
  exchangeCode:  jest.fn(), fetchUserInfo: jest.fn(),
}));

const request = require('supertest');
const app = require('../src/index');

describe('audit M2 — legacy /api/realtime/trial-token is removed', () => {
  it('GET returns 404', async () => {
    const res = await request(app).get('/api/realtime/trial-token');
    expect(res.status).toBe(404);
  });

  it('POST returns 404 (no longer routed)', async () => {
    const res = await request(app).post('/api/realtime/trial-token').send({});
    expect(res.status).toBe(404);
  });

  it('canonical /api/realtime/token still serves guests (503 w/o OPENAI_API_KEY is fine)', async () => {
    // We don't configure OPENAI_API_KEY in tests, so the router returns
    // a structured 503 rather than a 404 — that's enough to prove the
    // canonical path is live and the removal didn't take it down with it.
    const res = await request(app).get('/api/realtime/token');
    expect([200, 503]).toContain(res.status);
  });
});
