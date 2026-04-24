'use strict';

// PR E5 — unit tests for admin user-management endpoints + ban cache.

process.env.NODE_ENV       = 'test';
process.env.JWT_SECRET     = 'test-jwt-secret-at-least-32-chars!!';
process.env.SESSION_SECRET = 'test-session-secret-32chars-longx';
process.env.DB_PATH        = '/tmp/noop.db';

const { createMockDb } = require('./helpers/mockDb');
const mockDb = createMockDb();
jest.mock('../src/db', () => mockDb);
jest.mock('../src/utils/google', () => ({
  generateState: jest.fn().mockReturnValue('s'),
  generatePKCE:  jest.fn().mockReturnValue({ codeVerifier:'v', codeChallenge:'c' }),
  buildAuthUrl:  jest.fn().mockReturnValue('https://accounts.google.com/?mocked=1'),
  exchangeCode:  jest.fn(), fetchUserInfo: jest.fn(),
}));

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const app     = require('../src/index');
const banCache = require('../src/services/banCache');

beforeEach(() => {
  mockDb._reset();
  banCache._clearAllForTests();
});

const unique = () => `e5_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`;

async function createUser() {
  const email = unique();
  const r = await request(app).post('/auth/local/register')
    .send({ email, password: 'ValidPass123!', name: 'E5 User' });
  const id = r.body.user.id;
  const token = jwt.sign({ sub: id, email, name: 'E5 User' },
    process.env.JWT_SECRET, { expiresIn: '1h' });
  return { token, id, email };
}

async function createAdmin() {
  const user = await createUser();
  mockDb.updateRole(user.id, 'admin');
  const token = jwt.sign({ sub: user.id, email: user.email, name: 'Admin', role: 'admin' },
    process.env.JWT_SECRET, { expiresIn: '1h' });
  return { ...user, token };
}

describe('Admin — user list filters', () => {
  it('filters by q (email substring)', async () => {
    const admin = await createAdmin();
    const u1 = await createUser();
    mockDb._users.get(u1.id).email = 'banana@test.com';
    const r = await request(app).get('/api/admin/users?q=banana')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(r.status).toBe(200);
    expect(r.body.users.every((u) => u.email.includes('banana'))).toBe(true);
  });

  it('filters by status=banned', async () => {
    const admin = await createAdmin();
    const u1 = await createUser();
    const u2 = await createUser();
    mockDb._users.get(u1.id).banned = 1;
    const r = await request(app).get('/api/admin/users?status=banned')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(r.status).toBe(200);
    const ids = r.body.users.map((u) => u.id);
    expect(ids).toContain(u1.id);
    expect(ids).not.toContain(u2.id);
  });

  it('filters by status=admin', async () => {
    const admin = await createAdmin();
    await createUser();
    const r = await request(app).get('/api/admin/users?status=admin')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(r.status).toBe(200);
    expect(r.body.users.every((u) => u.role === 'admin')).toBe(true);
  });
});

describe('Admin — ban / unban', () => {
  it('POST /users/:id/ban with banned=true flips the bit', async () => {
    const admin = await createAdmin();
    const user = await createUser();
    const r = await request(app).post(`/api/admin/users/${user.id}/ban`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ banned: true, reason: 'spam' });
    expect(r.status).toBe(200);
    expect(r.body.banned).toBe(true);
    expect(r.body.banned_reason).toBe('spam');
    expect(mockDb._users.get(user.id).banned).toBe(1);
  });

  it('POST /users/:id/ban with banned=false clears the bit', async () => {
    const admin = await createAdmin();
    const user = await createUser();
    mockDb._users.get(user.id).banned = 1;
    mockDb._users.get(user.id).banned_reason = 'old';
    const r = await request(app).post(`/api/admin/users/${user.id}/ban`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ banned: false });
    expect(r.status).toBe(200);
    expect(r.body.banned).toBe(false);
    expect(mockDb._users.get(user.id).banned).toBe(0);
    expect(mockDb._users.get(user.id).banned_reason).toBeNull();
  });

  it('refuses to ban self', async () => {
    const admin = await createAdmin();
    const r = await request(app).post(`/api/admin/users/${admin.id}/ban`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ banned: true });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/yourself/i);
  });

  it('refuses to ban another admin', async () => {
    const admin = await createAdmin();
    const other = await createAdmin();
    const r = await request(app).post(`/api/admin/users/${other.id}/ban`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ banned: true });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/admin/i);
  });

  it('404 unknown user', async () => {
    const admin = await createAdmin();
    const r = await request(app).post('/api/admin/users/nonexistent/ban')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ banned: true });
    expect(r.status).toBe(404);
  });
});

describe('Admin — ban cache + middleware enforcement', () => {
  it('banned user gets 403 on subsequent authed request', async () => {
    const admin = await createAdmin();
    const user = await createUser();
    // Precondition: user can hit an authed route.
    const okReq = await request(app).get('/api/credits/balance')
      .set('Authorization', `Bearer ${user.token}`);
    expect(okReq.status).not.toBe(403);

    // Admin bans.
    await request(app).post(`/api/admin/users/${user.id}/ban`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ banned: true, reason: 'test' });

    // User's next authed request is rejected.
    const blocked = await request(app).get('/api/credits/balance')
      .set('Authorization', `Bearer ${user.token}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toMatch(/suspendat|ban/i);
  });

  it('unban clears the 403', async () => {
    const admin = await createAdmin();
    const user = await createUser();
    await request(app).post(`/api/admin/users/${user.id}/ban`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ banned: true });
    const blocked = await request(app).get('/api/credits/balance')
      .set('Authorization', `Bearer ${user.token}`);
    expect(blocked.status).toBe(403);

    await request(app).post(`/api/admin/users/${user.id}/ban`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ banned: false });
    const ok = await request(app).get('/api/credits/balance')
      .set('Authorization', `Bearer ${user.token}`);
    expect(ok.status).not.toBe(403);
  });
});

describe('Admin — user history', () => {
  it('GET /users/:id/history returns recent ledger', async () => {
    const admin = await createAdmin();
    const user = await createUser();
    mockDb.addCreditsTransaction({ userId: user.id, deltaMinutes: 10, kind: 'admin_grant', note: 'promo' });
    const r = await request(app).get(`/api/admin/users/${user.id}/history`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(r.status).toBe(200);
    expect(r.body.rows.length).toBe(1);
    expect(r.body.rows[0].kind).toBe('admin_grant');
  });

  it('404 unknown user', async () => {
    const admin = await createAdmin();
    const r = await request(app).get('/api/admin/users/nonexistent/history')
      .set('Authorization', `Bearer ${admin.token}`);
    expect(r.status).toBe(404);
  });
});

describe('Admin — credit grant via user route', () => {
  it('adds minutes + returns new balance', async () => {
    const admin = await createAdmin();
    const user = await createUser();
    const r = await request(app).post(`/api/admin/users/${user.id}/credits/grant`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ minutes: 15, note: 'comp' });
    expect(r.status).toBe(200);
    expect(r.body.deltaMinutes).toBe(15);
    expect(r.body.balance).toBe(15);
  });

  it('400 when minutes is zero', async () => {
    const admin = await createAdmin();
    const user = await createUser();
    const r = await request(app).post(`/api/admin/users/${user.id}/credits/grant`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ minutes: 0 });
    expect(r.status).toBe(400);
  });
});

describe('Admin — reset password', () => {
  it('clears password_hash + passkey credentials', async () => {
    const admin = await createAdmin();
    const user = await createUser();
    mockDb._users.get(user.id).password_hash = 'existing';
    mockDb._users.get(user.id).passkey_credentials = '[{"fake":true}]';
    const r = await request(app).post(`/api/admin/users/${user.id}/reset-password`)
      .set('Authorization', `Bearer ${admin.token}`);
    expect(r.status).toBe(200);
    expect(mockDb._users.get(user.id).password_hash).toBeNull();
    expect(mockDb._users.get(user.id).passkey_credentials).toBe('[]');
  });
});

describe('banCache — unit', () => {
  it('invalidate() forces re-read on next resolveBanStatus', async () => {
    const user = await createUser();
    // First call populates cache with banned=false.
    const initial = await banCache.resolveBanStatus(user.id);
    expect(initial.banned).toBe(false);

    // Mutate DB directly (simulating an admin ban).
    mockDb._users.get(user.id).banned = 1;
    mockDb._users.get(user.id).banned_reason = 'bad';

    // Without invalidation we still get the cached false.
    const cached = await banCache.resolveBanStatus(user.id);
    expect(cached.banned).toBe(false);

    banCache.invalidate(user.id);
    const fresh = await banCache.resolveBanStatus(user.id);
    expect(fresh.banned).toBe(true);
    expect(fresh.reason).toBe('bad');
  });

  it('null/undefined user id returns not banned', async () => {
    expect((await banCache.resolveBanStatus(null)).banned).toBe(false);
    expect((await banCache.resolveBanStatus(undefined)).banned).toBe(false);
  });

  it('isBanned() works synchronously on a loaded user row', () => {
    expect(banCache.isBanned(null)).toBe(false);
    expect(banCache.isBanned({ banned: 0 })).toBe(false);
    expect(banCache.isBanned({ banned: 1 })).toBe(true);
  });
});
