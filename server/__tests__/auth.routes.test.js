'use strict';

/**
 * Integration tests for the /auth/* endpoints.
 * Uses supertest to make HTTP requests against the Express app without
 * needing a real Google OAuth server.
 */

process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-chars';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!';
process.env.NODE_ENV = 'test';
process.env.PORT = '0'; // random port
process.env.DB_PATH = ':memory:'; // not used by supertest directly

const request = require('supertest');

// We need to patch better-sqlite3 to use an in-memory DB for tests
// and avoid file-system side-effects. We do this by setting DB_PATH to
// a temp file, relying on the db module's own mkdirp logic.
const os = require('os');
const path = require('path');
process.env.DB_PATH = path.join(os.tmpdir(), `kelion-test-${process.pid}.db`);

const app = require('../src/index');

afterAll(() => {
  // Clean up test DB
  const fs = require('fs');
  try { fs.unlinkSync(process.env.DB_PATH); } catch (_) {}
});

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('GET /auth/me', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns 401 with an invalid Bearer token', async () => {
    const res = await request(app)
      .get('/auth/me')
      .set('Authorization', 'Bearer invalidtoken');
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('returns 200 even without an active session', async () => {
    const res = await request(app).post('/auth/logout');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Logged out successfully');
  });
});

describe('GET /auth/google/start', () => {
  it('redirects to Google (302)', async () => {
    const res = await request(app).get('/auth/google/start');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('accounts.google.com');
  });

  it('sets a session cookie', async () => {
    const res = await request(app).get('/auth/google/start');
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    expect(cookies.some((c) => c.startsWith('oauth_state'))).toBe(true);
    expect(cookies.some((c) => c.startsWith('oauth_verifier'))).toBe(true);
  });

  it('redirects to Google with required params for mobile mode', async () => {
    const res = await request(app).get('/auth/google/start?mode=mobile');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.location);
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('response_type')).toBe('code');
  });
});

describe('GET /auth/google/callback', () => {
  it('returns 400 when state is missing', async () => {
    const res = await request(app).get('/auth/google/callback?code=abc');
    expect(res.status).toBe(400);
  });

  it('returns 400 when state does not match', async () => {
    const res = await request(app).get('/auth/google/callback?code=abc&state=wrong');
    expect(res.status).toBe(400);
  });

  it('redirects to app on Google error', async () => {
    const res = await request(app).get('/auth/google/callback?error=access_denied');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('auth_error');
  });
});

describe('GET /nonexistent', () => {
  it('returns 404', async () => {
    const res = await request(app).get('/nonexistent');
    expect(res.status).toBe(404);
  });
});
