'use strict';

/**
 * Tests for /api/users/me, /api/admin/users/*, /api/subscription/plans, /api/payments/*
 */

process.env.GOOGLE_CLIENT_ID     = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.SESSION_SECRET       = 'test-session-secret-at-least-32-chars';
process.env.JWT_SECRET           = 'test-jwt-secret-at-least-32-chars!!';
process.env.NODE_ENV             = 'test';
process.env.ADMIN_EMAILS         = 'admin@example.com';

const os   = require('os');
const path = require('path');
process.env.DB_PATH = path.join(os.tmpdir(), `kelion-api-test-${process.pid}.db`);

jest.mock('../src/utils/google', () => ({
  generateState:  jest.fn().mockReturnValue('fixed-test-state'),
  generatePKCE:   jest.fn().mockReturnValue({
    codeVerifier: 'fixed-code-verifier',
    codeChallenge: 'fixed-code-challenge',
  }),
  buildAuthUrl: jest.fn().mockReturnValue('https://accounts.google.com/o/oauth2/v2/auth?mocked=1'),
  exchangeCode:  jest.fn(),
  fetchUserInfo: jest.fn(),
}));

const request       = require('supertest');
const jwt           = require('jsonwebtoken');
const { exchangeCode, fetchUserInfo } = require('../src/utils/google');
const app           = require('../src/index');
const { upsertUser } = require('../src/db');

afterAll(() => {
  const fs = require('fs');
  try { fs.unlinkSync(process.env.DB_PATH); } catch (_) {}
});

afterEach(() => {
  exchangeCode.mockReset();
  fetchUserInfo.mockReset();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, name: user.name },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function seedUser(overrides = {}) {
  return upsertUser({
    googleId: `google-${Date.now()}-${Math.random()}`,
    email:    `user-${Date.now()}@example.com`,
    name:     'Test User',
    picture:  null,
    ...overrides,
  });
}

function seedAdmin() {
  return upsertUser({
    googleId: 'google-admin',
    email:    'admin@example.com',
    name:     'Admin User',
    picture:  null,
  });
}

// ---------------------------------------------------------------------------
// GET /api/subscription/plans
// ---------------------------------------------------------------------------

describe('GET /api/subscription/plans', () => {
  it('returns list of plans without auth', async () => {
    const res = await request(app).get('/api/subscription/plans');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.plans)).toBe(true);
    expect(res.body.plans.length).toBeGreaterThanOrEqual(4);
    const ids = res.body.plans.map((p) => p.id);
    expect(ids).toContain('free');
    expect(ids).toContain('basic');
    expect(ids).toContain('premium');
    expect(ids).toContain('enterprise');
  });

  it('enterprise plan has null dailyLimit', async () => {
    const res = await request(app).get('/api/subscription/plans');
    const enterprise = res.body.plans.find((p) => p.id === 'enterprise');
    expect(enterprise.dailyLimit).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// GET /api/users/me
// ---------------------------------------------------------------------------

describe('GET /api/users/me', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/users/me');
    expect(res.status).toBe(401);
  });

  it('returns user profile with usage info when authenticated', async () => {
    const user  = seedUser();
    const token = makeToken(user);

    const res = await request(app)
      .get('/api/users/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.email).toBe(user.email);
    expect(res.body.subscription_tier).toBe('free');
    expect(res.body.usage).toBeDefined();
    expect(typeof res.body.usage.today).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// PUT /api/users/me
// ---------------------------------------------------------------------------

describe('PUT /api/users/me', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).put('/api/users/me').send({ name: 'New' });
    expect(res.status).toBe(401);
  });

  it('updates the user name', async () => {
    const user  = seedUser();
    const token = makeToken(user);

    const res = await request(app)
      .put('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Name' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Name');
  });

  it('returns 400 when name is missing', async () => {
    const user  = seedUser();
    const token = makeToken(user);

    const res = await request(app)
      .put('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/users
// ---------------------------------------------------------------------------

describe('GET /api/admin/users', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });

  it('returns 403 when non-admin is authenticated', async () => {
    const user  = seedUser();
    const token = makeToken(user);

    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('returns user list for admin', async () => {
    const admin = seedAdmin();
    const token = makeToken(admin);

    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PUT /api/admin/users/:id/subscription
// ---------------------------------------------------------------------------

describe('PUT /api/admin/users/:id/subscription', () => {
  it('updates subscription tier as admin', async () => {
    const admin = seedAdmin();
    const user  = seedUser();
    const token = makeToken(admin);

    const res = await request(app)
      .put(`/api/admin/users/${user.id}/subscription`)
      .set('Authorization', `Bearer ${token}`)
      .send({ subscription_tier: 'premium', subscription_status: 'active' });

    expect(res.status).toBe(200);
    expect(res.body.subscription_tier).toBe('premium');
  });

  it('returns 400 for invalid tier', async () => {
    const admin = seedAdmin();
    const token = makeToken(admin);
    const user  = seedUser();

    const res = await request(app)
      .put(`/api/admin/users/${user.id}/subscription`)
      .set('Authorization', `Bearer ${token}`)
      .send({ subscription_tier: 'invalid-tier' });

    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown user id', async () => {
    const admin = seedAdmin();
    const token = makeToken(admin);

    const res = await request(app)
      .put('/api/admin/users/nonexistent-id/subscription')
      .set('Authorization', `Bearer ${token}`)
      .send({ subscription_tier: 'basic' });

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /api/payments/history
// ---------------------------------------------------------------------------

describe('GET /api/payments/history', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await request(app).get('/api/payments/history');
    expect(res.status).toBe(401);
  });

  it('returns empty history when authenticated', async () => {
    const user  = seedUser();
    const token = makeToken(user);

    const res = await request(app)
      .get('/api/payments/history')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.payments)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST /api/payments/create-checkout-session
// ---------------------------------------------------------------------------

describe('POST /api/payments/create-checkout-session', () => {
  it('returns 503 when Stripe is not configured', async () => {
    const user  = seedUser();
    const token = makeToken(user);

    const res = await request(app)
      .post('/api/payments/create-checkout-session')
      .set('Authorization', `Bearer ${token}`)
      .send({ planId: 'basic' });

    expect(res.status).toBe(503);
  });
});
