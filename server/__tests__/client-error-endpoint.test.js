/**
 * Audit H4 — POST /api/diag/client-error and GET /api/diag/process.
 *
 * These are the telemetry sink (`POST`) and the dashboard
 * (`GET`) that together make client- and server-side uncaught
 * errors visible.
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

beforeEach(() => mockDb._reset());

describe('POST /api/diag/client-error', () => {
  it('accepts a well-formed unhandledrejection payload and returns 204', async () => {
    // Clear any counters from earlier tests in this suite.
    if (app.locals) app.locals.clientErrorStats = undefined;

    const res = await request(app)
      .post('/api/diag/client-error')
      .send({
        kind: 'unhandledrejection',
        message: 'TypeError: x is not a function',
        stack: 'TypeError: x is not a function\n    at foo (app.js:42:5)',
        url: 'https://kelion.app/',
        userAgent: 'Mozilla/5.0 (Test)',
        at: Date.now(),
      });
    expect(res.status).toBe(204);
    expect(app.locals.clientErrorStats.total).toBe(1);
    expect(app.locals.clientErrorStats.byKind.unhandledrejection).toBe(1);
    expect(app.locals.clientErrorStats.lastReason).toMatch(/TypeError/);
  });

  it('coerces unknown kind to "unknown"', async () => {
    if (app.locals) app.locals.clientErrorStats = undefined;

    const res = await request(app)
      .post('/api/diag/client-error')
      .send({ kind: 'hax0r', message: 'meh' });
    expect(res.status).toBe(204);
    expect(app.locals.clientErrorStats.byKind.unknown).toBe(1);
    expect(app.locals.clientErrorStats.byKind.hax0r).toBeUndefined();
  });

  it('fills in "(no message)" when message is missing or empty', async () => {
    if (app.locals) app.locals.clientErrorStats = undefined;

    const res = await request(app)
      .post('/api/diag/client-error')
      .send({ kind: 'error' });
    expect(res.status).toBe(204);
    expect(app.locals.clientErrorStats.lastReason).toBe('(no message)');
  });

  it('truncates oversized message + stack to protect log size', async () => {
    if (app.locals) app.locals.clientErrorStats = undefined;

    const hugeMessage = 'A'.repeat(5000);
    const hugeStack   = 'B'.repeat(10000);
    const res = await request(app)
      .post('/api/diag/client-error')
      .send({ kind: 'error', message: hugeMessage, stack: hugeStack });
    expect(res.status).toBe(204);
    // Internal state doesn't expose stack; message cap is 1000 chars
    // ≈ 1000 A's + suffix marker.
    expect(app.locals.clientErrorStats.lastReason.length).toBeLessThanOrEqual(1100);
    expect(app.locals.clientErrorStats.lastReason).toMatch(/truncated-server/);
  });

  it('rejects non-finite lineno/colno silently (type-safety)', async () => {
    if (app.locals) app.locals.clientErrorStats = undefined;

    const res = await request(app)
      .post('/api/diag/client-error')
      .send({
        kind: 'error',
        message: 'x',
        lineno: 'not-a-number',
        colno: NaN,
      });
    expect(res.status).toBe(204);
    // still counted
    expect(app.locals.clientErrorStats.total).toBe(1);
  });

  it('increments counters across multiple posts', async () => {
    if (app.locals) app.locals.clientErrorStats = undefined;

    for (let i = 0; i < 5; i++) {
      await request(app)
        .post('/api/diag/client-error')
        .send({ kind: 'error', message: `e${i}` });
    }
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post('/api/diag/client-error')
        .send({ kind: 'unhandledrejection', message: `r${i}` });
    }
    expect(app.locals.clientErrorStats.total).toBe(8);
    expect(app.locals.clientErrorStats.byKind.error).toBe(5);
    expect(app.locals.clientErrorStats.byKind.unhandledrejection).toBe(3);
  });
});

describe('GET /api/diag/process', () => {
  it('returns live process counters + client-error counters', async () => {
    // Prime one client error so the bucket exists.
    await request(app)
      .post('/api/diag/client-error')
      .send({ kind: 'error', message: 'probe' });

    const res = await request(app).get('/api/diag/process');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('now');
    expect(res.body).toHaveProperty('uptimeSeconds');
    expect(res.body).toHaveProperty('memoryMB');
    expect(res.body).toHaveProperty('pid');
    expect(res.body).toHaveProperty('node');
    expect(res.body.processHandlers).toBeDefined();
    expect(res.body.clientErrors).toBeDefined();
    expect(res.body.clientErrors.total).toBeGreaterThanOrEqual(1);
    expect(res.body.clientErrors.byKind).toHaveProperty('error');
  });
});
