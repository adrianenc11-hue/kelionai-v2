'use strict';

/**
 * Tests for /api/users/me, /api/admin/users/*, /api/subscription/plans, /api/payments/*
 */

process.env.GOOGLE_CLIENT_ID     = 'test-client-id';
process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
process.env.SESSION_SECRET       = 'test-session-secret-at-least-32-chars';
process.env.JWT_SECRET           = 'test-jwt-secret-at-least-32-chars!!';
process.env.NODE_ENV             = 'test';
process.env.SUPABASE_URL         = 'https://mock.supabase.co';
process.env.SUPABASE_SERVICE_KEY = 'mock-service-key-for-tests-only';
process.env.ADMIN_EMAILS         = 'admin@example.com';
process.env.STRIPE_SECRET_KEY    = ''; // Ensure Stripe is not configured for tests

const os   = require('os');
const path = require('path');
process.env.DB_PATH = path.join(os.tmpdir(), `kelion-api-test-${process.pid}.db`);

// ---------------------------------------------------------------------------
// In-memory DB mock - replaces Supabase with a simple Map
// ---------------------------------------------------------------------------
const _users = new Map();
let _idCounter = 1;

const mockDb = {
  upsertUser: jest.fn(({ googleId, email, name, picture }) => {
    // Check if user exists by open_id (googleId)
    for (const [id, u] of _users) {
      if (u.open_id === googleId || u.email === email) {
        return Promise.resolve(u);
      }
    }
    const id = _idCounter++;
    const user = {
      id,
      open_id: googleId,
      email,
      name,
      picture: picture || null,
      role: email === 'admin@example.com' ? 'admin' : 'user',
      subscription_tier: 'free',
      subscription_status: 'active',
      created_at: new Date().toISOString(),
    };
    _users.set(id, user);
    return Promise.resolve(user);
  }),
  findById: jest.fn((id) => {
    return Promise.resolve(_users.get(Number(id)) || null);
  }),
  findByGoogleId: jest.fn((googleId) => {
    for (const u of _users.values()) {
      if (u.open_id === googleId) return Promise.resolve(u);
    }
    return Promise.resolve(null);
  }),
  findByEmail: jest.fn((email) => {
    for (const u of _users.values()) {
      if (u.email === email) return Promise.resolve(u);
    }
    return Promise.resolve(null);
  }),
  updateUser: jest.fn((id, fields) => {
    const user = _users.get(Number(id));
    if (!user) return Promise.resolve(null);
    Object.assign(user, fields);
    return Promise.resolve(user);
  }),
  updateSubscription: jest.fn((id, tier, status) => {
    const user = _users.get(Number(id));
    if (!user) return Promise.resolve(null);
    user.subscription_tier = tier;
    user.subscription_status = status;
    return Promise.resolve(user);
  }),
  getAllUsers: jest.fn(() => {
    return Promise.resolve(Array.from(_users.values()));
  }),
  getUsage: jest.fn(() => {
    return Promise.resolve({ today: 0, month: 0, limit: 10 });
  }),
  incrementUsage: jest.fn(() => Promise.resolve()),
  insertUser: jest.fn(({ email, password_hash, name }) => {
    const id = _idCounter++;
    const user = {
      id,
      open_id: `local-${email}`,
      email,
      name: name || email.split('@')[0],
      password_hash,
      picture: null,
      role: 'user',
      subscription_tier: 'free',
      subscription_status: 'active',
      created_at: new Date().toISOString(),
    };
    _users.set(id, user);
    return Promise.resolve(user);
  }),
  createReferralCode: jest.fn(() => Promise.resolve({ code: 'TEST123' })),
  getReferralCode: jest.fn(() => Promise.resolve(null)),
  useReferralCode: jest.fn(() => Promise.resolve(null)),
};

jest.mock('../src/db', () => mockDb);

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

afterAll(() => {
  _users.clear();
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

async function seedUser(overrides = {}) {
  return mockDb.upsertUser({
    googleId: `google-${Date.now()}-${Math.random()}`,
    email:    `user-${Date.now()}@example.com`,
    name:     'Test User',
    picture:  null,
    ...overrides,
  });
}

async function seedAdmin() {
  return mockDb.upsertUser({
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
    const user  = await seedUser();
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
    const user  = await seedUser();
    const token = makeToken(user);

    const res = await request(app)
      .put('/api/users/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Updated Name' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Name');
  });

  it('returns 400 when name is missing', async () => {
    const user  = await seedUser();
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
    const user  = await seedUser();
    const token = makeToken(user);

    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(403);
  });

  it('returns user list for admin', async () => {
    const admin = await seedAdmin();
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
    const admin = await seedAdmin();
    const user  = await seedUser();
    const token = makeToken(admin);

    const res = await request(app)
      .put(`/api/admin/users/${user.id}/subscription`)
      .set('Authorization', `Bearer ${token}`)
      .send({ subscription_tier: 'premium', subscription_status: 'active' });

    expect(res.status).toBe(200);
    expect(res.body.subscription_tier).toBe('premium');
  });

  it('returns 400 for invalid tier', async () => {
    const admin = await seedAdmin();
    const token = makeToken(admin);
    const user  = await seedUser();

    const res = await request(app)
      .put(`/api/admin/users/${user.id}/subscription`)
      .set('Authorization', `Bearer ${token}`)
      .send({ subscription_tier: 'invalid-tier' });

    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown user id', async () => {
    const admin = await seedAdmin();
    const token = makeToken(admin);

    const res = await request(app)
      .put('/api/admin/users/99999/subscription')
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
    const user  = await seedUser();
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
    const user  = await seedUser();
    const token = makeToken(user);

    const res = await request(app)
      .post('/api/payments/create-checkout-session')
      .set('Authorization', `Bearer ${token}`)
      .send({ planId: 'basic' });

    expect(res.status).toBe(503);
  });
});
