'use strict';

/**
 * Integration tests for GET /auth/google/callback.
 *
 * Google's token-exchange and user-info endpoints are fully mocked so these
 * tests run offline without real credentials.
 */

// Must be set before loading any module that calls require('../config')
process.env.GOOGLE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.SESSION_SECRET = 'test-session-secret-at-least-32-chars';
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars!!';
process.env.NODE_ENV = 'test';
process.env.SUPABASE_URL = 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'mock-service-key-for-tests-only';

const os = require('os');
const path = require('path');
// Unique DB per test file (Jest workers run in separate processes)
process.env.DB_PATH = path.join(os.tmpdir(), `kelion-cb-test-${process.pid}.db`);

// ---------------------------------------------------------------------------
// Mock the DB module
// ---------------------------------------------------------------------------
const mockDb = {
  upsertUser: jest.fn((profile) => Promise.resolve({
    id: 'mock-user-id',
    ...profile,
    role: 'user',
    subscription_tier: 'free',
    subscription_status: 'active',
  })),
  findByGoogleId: jest.fn(() => Promise.resolve(null)),
  findById: jest.fn((id) => Promise.resolve({
    id,
    email: 'me@example.com',
    name: 'Me User',
    role: 'user',
    subscription_tier: 'free',
    subscription_status: 'active',
  })),
};
jest.mock('../src/db', () => mockDb);

// ---------------------------------------------------------------------------
// Mock the Google OAuth utility module so we never call real Google APIs
// ---------------------------------------------------------------------------
jest.mock('../src/utils/google', () => ({
  generateState:  jest.fn().mockReturnValue('fixed-test-state'),
  generatePKCE:   jest.fn().mockReturnValue({
    codeVerifier: 'fixed-code-verifier',
    codeChallenge: 'fixed-code-challenge',
  }),
  buildAuthUrl: jest.fn().mockReturnValue(
    'https://accounts.google.com/o/oauth2/v2/auth?mocked=1'
  ),
  exchangeCode:  jest.fn(),
  fetchUserInfo: jest.fn(),
}));

const request = require('supertest');
const { exchangeCode, fetchUserInfo } = require('../src/utils/google');
const app = require('../src/index');

// Clean up the temp DB after all tests in this file finish
afterAll(() => {
  const fs = require('fs');
  try { fs.unlinkSync(process.env.DB_PATH); } catch (_) { /* ignore */ }
});

// Reset mocks between tests so previous mock implementations don't leak
afterEach(() => {
  exchangeCode.mockReset();
  fetchUserInfo.mockReset();
});

// ---------------------------------------------------------------------------
// Helper: start the OAuth flow and return an agent with the session cookie set
// ---------------------------------------------------------------------------
async function startOAuthFlow(mode = 'web') {
  const agent = request.agent(app);
  const url = mode === 'mobile'
    ? '/auth/google/start?mode=mobile'
    : '/auth/google/start';
  await agent.get(url);
  return agent;
}

// ---------------------------------------------------------------------------
// Happy paths
// ---------------------------------------------------------------------------

describe('GET /auth/google/callback – web mode (happy path)', () => {
  it('redirects to APP_BASE_URL after successful code exchange', async () => {
    const agent = await startOAuthFlow('web');

    exchangeCode.mockResolvedValueOnce({ access_token: 'mock-access-token' });
    fetchUserInfo.mockResolvedValueOnce({
      googleId: 'google-sub-web-1',
      email:    'web@example.com',
      name:     'Web User',
      picture:  'https://example.com/web.jpg',
    });

    const res = await agent.get(
      '/auth/google/callback?code=valid-code&state=fixed-test-state'
    );

    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/kelionai\.app/);
  });

  it('sets a session so /auth/me returns the user after login', async () => {
    const agent = await startOAuthFlow('web');

    exchangeCode.mockResolvedValueOnce({ access_token: 'mock-access-token' });
    fetchUserInfo.mockResolvedValueOnce({
      googleId: 'google-sub-web-2',
      email:    'me@example.com',
      name:     'Me User',
      picture:  null,
    });

    await agent.get(
      '/auth/google/callback?code=valid-code&state=fixed-test-state'
    );

    const meRes = await agent.get('/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.email).toBe('me@example.com');
    expect(meRes.body.name).toBe('Me User');
  });
});

describe('GET /auth/google/callback – mobile mode (happy path)', () => {
  it('returns JSON { token, user } when mode=mobile', async () => {
    const agent = await startOAuthFlow('mobile');

    exchangeCode.mockResolvedValueOnce({ access_token: 'mock-access-token-mobile' });
    fetchUserInfo.mockResolvedValueOnce({
      googleId: 'google-sub-mobile',
      email:    'mobile@example.com',
      name:     'Mobile User',
      picture:  'https://example.com/mobile.jpg',
    });

    const res = await agent.get(
      '/auth/google/callback?code=valid-code&state=fixed-test-state'
    );

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user.email).toBe('mobile@example.com');
    expect(res.body.user.name).toBe('Mobile User');
  });
});

// ---------------------------------------------------------------------------
// Failure cases
// ---------------------------------------------------------------------------

describe('GET /auth/google/callback – failure cases', () => {
  it('returns 400 when the authorization code is missing', async () => {
    const agent = await startOAuthFlow('web');

    // No `code` query param
    const res = await agent.get(
      '/auth/google/callback?state=fixed-test-state'
    );

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/missing/i);
  });

  it('redirects with auth_error when Google token exchange fails (web)', async () => {
    const agent = await startOAuthFlow('web');

    exchangeCode.mockRejectedValueOnce(new Error('Token exchange failed'));

    const res = await agent.get(
      '/auth/google/callback?code=bad-code&state=fixed-test-state'
    );

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('auth_error');
  });

  it('returns 500 JSON when Google token exchange fails (mobile)', async () => {
    const agent = await startOAuthFlow('mobile');

    exchangeCode.mockRejectedValueOnce(new Error('Token exchange failed'));

    const res = await agent.get(
      '/auth/google/callback?code=bad-code&state=fixed-test-state'
    );

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Authentication failed');
  });

  it('redirects with auth_error when Google userinfo returns unverified email', async () => {
    const agent = await startOAuthFlow('web');

    exchangeCode.mockResolvedValueOnce({ access_token: 'mock-access-token' });
    fetchUserInfo.mockRejectedValueOnce(
      new Error('Google account email is not verified')
    );

    const res = await agent.get(
      '/auth/google/callback?code=valid-code&state=fixed-test-state'
    );

    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('auth_error');
  });
});
