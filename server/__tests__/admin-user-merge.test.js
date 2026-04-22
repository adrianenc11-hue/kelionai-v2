'use strict';

// F3 — admin duplicate-user detection + merge.
// Regression guards for /api/admin/users/duplicates and
// /api/admin/users/merge. Mirrors the structure of admin.test.js so
// the fixtures (mockDb, JWT signing) stay consistent.

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
  exchangeCode:  jest.fn(),
  fetchUserInfo: jest.fn(),
}));

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const app     = require('../src/index');

beforeEach(() => mockDb._reset());

function adminToken(email = 'admin@test.com') {
  const id = `uid-admin-${Math.random().toString(36).slice(2, 8)}`;
  mockDb._users.set(id, {
    id,
    email,
    name: 'Admin',
    role: 'admin',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
  return jwt.sign(
    { sub: id, email, name: 'Admin' },
    process.env.JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function seedDuplicate(email, { count = 2, shape } = {}) {
  const ids = [];
  for (let i = 0; i < count; i++) {
    const id = `uid-dup-${email}-${i}`;
    const base = {
      id,
      email,
      name: `User ${i}`,
      role: 'user',
      created_at: new Date(Date.now() - (count - i) * 60_000).toISOString(),
      updated_at: new Date().toISOString(),
    };
    mockDb._users.set(id, shape ? { ...base, ...shape(i, id) } : base);
    ids.push(id);
  }
  return ids;
}

describe('Admin — duplicate user listing', () => {
  it('403 for regular users', async () => {
    seedDuplicate('dup@test.com');
    const id = 'uid-regular';
    mockDb._users.set(id, {
      id, email: 'u@test.com', name: 'U', role: 'user',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    const token = jwt.sign({ sub: id, email: 'u@test.com' },
      process.env.JWT_SECRET, { expiresIn: '1h' });
    const r = await request(app)
      .get('/api/admin/users/duplicates')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(403);
  });

  it('200 returns empty list when there are no duplicates', async () => {
    const token = adminToken();
    const r = await request(app)
      .get('/api/admin/users/duplicates')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.groups)).toBe(true);
    expect(r.body.groups).toHaveLength(0);
    expect(r.body.total).toBe(0);
  });

  it('200 groups rows with the same (case-insensitive) email', async () => {
    const token = adminToken();
    // Two rows for the same human, different casing — must still collapse.
    mockDb._users.set('uid-a', {
      id: 'uid-a', email: 'Adrian@Example.COM', name: 'A',
      role: 'user', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    mockDb._users.set('uid-b', {
      id: 'uid-b', email: 'adrian@example.com', name: 'A',
      role: 'user', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    // A third, unrelated user — should not appear in the duplicates list.
    mockDb._users.set('uid-c', {
      id: 'uid-c', email: 'other@example.com', name: 'O',
      role: 'user', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    const r = await request(app)
      .get('/api/admin/users/duplicates')
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    expect(r.body.groups).toHaveLength(1);
    expect(r.body.groups[0].email.toLowerCase()).toBe('adrian@example.com');
    expect(r.body.groups[0].users.map(u => u.id).sort()).toEqual(['uid-a', 'uid-b']);
  });
});

describe('Admin — merge duplicate users', () => {
  it('400 when sourceId or targetId is missing', async () => {
    const token = adminToken();
    const r = await request(app)
      .post('/api/admin/users/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/required/i);
  });

  it('400 when source and target are the same', async () => {
    const token = adminToken();
    const [a] = seedDuplicate('same@test.com', { count: 2 });
    const r = await request(app)
      .post('/api/admin/users/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceId: a, targetId: a });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/must differ/i);
  });

  it('400 when source user does not exist', async () => {
    const token = adminToken();
    const [target] = seedDuplicate('orphan@test.com', { count: 2 });
    const r = await request(app)
      .post('/api/admin/users/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceId: 'uid-missing', targetId: target });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/not found/i);
  });

  it('400 when target user does not exist', async () => {
    const token = adminToken();
    const [src] = seedDuplicate('orphan2@test.com', { count: 2 });
    const r = await request(app)
      .post('/api/admin/users/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceId: src, targetId: 'uid-missing' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/not found/i);
  });

  it('400 when the two users have different emails', async () => {
    const token = adminToken();
    mockDb._users.set('uid-x', {
      id: 'uid-x', email: 'x@test.com', name: 'X',
      role: 'user', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    mockDb._users.set('uid-y', {
      id: 'uid-y', email: 'y@test.com', name: 'Y',
      role: 'user', created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    });
    const r = await request(app)
      .post('/api/admin/users/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceId: 'uid-x', targetId: 'uid-y' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/different email/i);
  });

  it('200 collapses two rows into the target and removes the source', async () => {
    const token = adminToken();
    const [a, b] = seedDuplicate('collapse@test.com', { count: 2 });
    // Give the source a Google ID and some credit so we can verify
    // the merge transferred the non-empty fields to the target.
    const src = mockDb._users.get(a);
    src.google_id = 'google-123';
    src.credits_balance_minutes = 20;
    const tgt = mockDb._users.get(b);
    tgt.credits_balance_minutes = 10;
    const r = await request(app)
      .post('/api/admin/users/merge')
      .set('Authorization', `Bearer ${token}`)
      .send({ sourceId: a, targetId: b });
    expect(r.status).toBe(200);
    expect(r.body.sourceId).toBe(a);
    expect(r.body.targetId).toBe(b);
    expect(r.body.email.toLowerCase()).toBe('collapse@test.com');
    // Source row must be gone.
    expect(mockDb._users.get(a)).toBeUndefined();
    // Target must have absorbed the Google link + credits sum.
    const finalTgt = mockDb._users.get(b);
    expect(finalTgt.google_id).toBe('google-123');
    expect(finalTgt.credits_balance_minutes).toBe(30);
  });
});
