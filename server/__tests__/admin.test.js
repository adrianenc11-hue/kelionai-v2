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
  generatePKCE:  jest.fn().mockReturnValue({ codeVerifier:'v', codeChallenge:'c' }),
  buildAuthUrl:  jest.fn().mockReturnValue('https://accounts.google.com/?mocked=1'),
  exchangeCode:  jest.fn(), fetchUserInfo: jest.fn(),
}));

const request = require('supertest');
const jwt     = require('jsonwebtoken');
const app     = require('../src/index');

beforeEach(() => mockDb._reset());

const unique = () => `adm_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`;

async function createUser() {
  const email = unique();
  const r = await request(app).post('/auth/local/register')
    .send({ email, password: 'ValidPass123!', name: 'Test User', acceptTerms: true });
  const id = r.body.user.id;
  const token = jwt.sign({ sub: id, email, name: 'Test User' },
    process.env.JWT_SECRET, { expiresIn: '1h' });
  return { token, id, email };
}

async function createAdmin() {
  const user = await createUser();
  // Promote via mock
  mockDb.updateRole(user.id, 'admin');
  const token = jwt.sign({ sub: user.id, email: user.email, name: 'Admin' },
    process.env.JWT_SECRET, { expiresIn: '1h' });
  return { ...user, token };
}

describe('Admin — access control', () => {
  it('401 unauthenticated',                  async () => { expect((await request(app).get('/api/admin/users')).status).toBe(401); });
  it('403 regular user',                     async () => { const {token}=await createUser(); expect((await request(app).get('/api/admin/users').set('Authorization',`Bearer ${token}`)).status).toBe(403); });
  it('200 for admin',                        async () => { const admin=await createAdmin(); const r=await request(app).get('/api/admin/users').set('Authorization',`Bearer ${admin.token}`); expect(r.status).toBe(200); expect(Array.isArray(r.body.users)).toBe(true); });
});

describe('Admin — user management', () => {
  let admin, user;
  beforeEach(async () => { admin=await createAdmin(); user=await createUser(); });

  it('GET /api/admin/users/:id — returns user',            async () => { const r=await request(app).get(`/api/admin/users/${user.id}`).set('Authorization',`Bearer ${admin.token}`); expect(r.status).toBe(200); expect(r.body.email).toBe(user.email); });
  it('GET /api/admin/users/:id — 404 unknown id',          async () => { expect((await request(app).get('/api/admin/users/nonexistent').set('Authorization',`Bearer ${admin.token}`)).status).toBe(404); });
  it('PUT subscription — updates tier to premium',         async () => { const r=await request(app).put(`/api/admin/users/${user.id}/subscription`).set('Authorization',`Bearer ${admin.token}`).send({subscription_tier:'premium',subscription_status:'active'}); expect(r.status).toBe(200); expect(r.body.subscription_tier).toBe('premium'); });
  it('PUT subscription — 400 invalid tier',                async () => { expect((await request(app).put(`/api/admin/users/${user.id}/subscription`).set('Authorization',`Bearer ${admin.token}`).send({subscription_tier:'invalid'})).status).toBe(400); });
  it('PUT subscription — 400 invalid status',              async () => { expect((await request(app).put(`/api/admin/users/${user.id}/subscription`).set('Authorization',`Bearer ${admin.token}`).send({subscription_status:'invalid'})).status).toBe(400); });
  it('PUT subscription — 404 unknown user',                async () => { expect((await request(app).put('/api/admin/users/nonexistent/subscription').set('Authorization',`Bearer ${admin.token}`).send({subscription_tier:'basic'})).status).toBe(404); });
  it('PUT role — promotes to admin',                       async () => { const r=await request(app).put(`/api/admin/users/${user.id}/role`).set('Authorization',`Bearer ${admin.token}`).send({role:'admin'}); expect(r.status).toBe(200); expect(r.body.role).toBe('admin'); });
  it('PUT role — demotes to user',                         async () => { await request(app).put(`/api/admin/users/${user.id}/role`).set('Authorization',`Bearer ${admin.token}`).send({role:'admin'}); const r=await request(app).put(`/api/admin/users/${user.id}/role`).set('Authorization',`Bearer ${admin.token}`).send({role:'user'}); expect(r.body.role).toBe('user'); });
  it('PUT role — 400 invalid role',                        async () => { expect((await request(app).put(`/api/admin/users/${user.id}/role`).set('Authorization',`Bearer ${admin.token}`).send({role:'superuser'})).status).toBe(400); });
});
