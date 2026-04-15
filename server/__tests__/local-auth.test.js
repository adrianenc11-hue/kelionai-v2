'use strict';

process.env.NODE_ENV       = 'test';
process.env.JWT_SECRET     = 'test-jwt-secret-at-least-32-chars!!';
process.env.SESSION_SECRET = 'test-session-secret-32chars-longx';
process.env.DB_PATH        = '/tmp/noop.db';

const { createMockDb } = require('./helpers/mockDb');
const mockDb = createMockDb();
jest.mock('../src/db', () => mockDb);
jest.mock('../src/utils/google', () => ({
  generateState: jest.fn().mockReturnValue('state'),
  generatePKCE:  jest.fn().mockReturnValue({ codeVerifier: 'v', codeChallenge: 'c' }),
  buildAuthUrl:  jest.fn().mockReturnValue('https://accounts.google.com/?mocked=1'),
  exchangeCode:  jest.fn(),
  fetchUserInfo: jest.fn(),
}));

const request = require('supertest');
const app     = require('../src/index');

beforeEach(() => mockDb._reset());

const unique = () => `la_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`;

async function reg(overrides = {}) {
  return request(app).post('/auth/local/register').send(
    { email: unique(), password: 'ValidPass123!', name: 'Test User', ...overrides }
  );
}

describe('POST /auth/local/register', () => {
  it('201 + cookie on success',         async () => { const r=await reg(); expect(r.status).toBe(201); expect(r.headers['set-cookie']?.some(c=>c.includes('kelion.token'))).toBe(true); });
  it('400 missing email',               async () => { expect((await reg({email:undefined})).status).toBe(400); });
  it('400 missing password',            async () => { expect((await reg({password:undefined})).status).toBe(400); });
  it('400 missing name',                async () => { expect((await reg({name:undefined})).status).toBe(400); });
  it('400 invalid email format',        async () => { const r=await reg({email:'bad-email'}); expect(r.status).toBe(400); expect(r.body.error).toMatch(/email/i); });
  it('400 password too short',          async () => { const r=await reg({password:'abc'}); expect(r.status).toBe(400); expect(r.body.error).toMatch(/password/i); });
  it('400 name too short',              async () => { expect((await reg({name:'X'})).status).toBe(400); });
  it('409 on duplicate email',          async () => { const e=unique(); await reg({email:e}); expect((await reg({email:e})).status).toBe(409); });
  it('sets HttpOnly cookie',            async () => { const r=await reg(); expect(r.headers['set-cookie']?.some(c=>c.includes('kelion.token')&&c.includes('HttpOnly'))).toBe(true); });
  it('role defaults to user',           async () => { const r=await reg(); expect(r.body.user.role).toBe('user'); });
  it('returns JWT token in body',      async () => { const r=await reg(); expect(r.body.token).toBeTruthy(); expect(typeof r.body.token).toBe('string'); });
});

describe('POST /auth/local/login', () => {
  it('200 + cookie for valid creds',    async () => { const e=unique(); await reg({email:e}); const r=await request(app).post('/auth/local/login').send({email:e,password:'ValidPass123!'}); expect(r.status).toBe(200); expect(r.headers['set-cookie']?.some(c=>c.includes('kelion.token'))).toBe(true); });
  it('401 wrong password',              async () => { const e=unique(); await reg({email:e}); expect((await request(app).post('/auth/local/login').send({email:e,password:'WrongPass!'})).status).toBe(401); });
  it('401 non-existent user',           async () => { expect((await request(app).post('/auth/local/login').send({email:'nobody@x.com',password:'ValidPass123!'})).status).toBe(401); });
  it('400 missing email',               async () => { expect((await request(app).post('/auth/local/login').send({password:'ValidPass123!'})).status).toBe(400); });
  it('400 missing password',            async () => { expect((await request(app).post('/auth/local/login').send({email:'a@b.com'})).status).toBe(400); });
  it('sets HttpOnly cookie on login',   async () => { const e=unique(); await reg({email:e}); const r=await request(app).post('/auth/local/login').send({email:e,password:'ValidPass123!'}); expect(r.headers['set-cookie']?.some(c=>c.includes('kelion.token'))).toBe(true); });
});

const jwt = require('jsonwebtoken');

describe('Authenticated flow', () => {
  let token;
  beforeEach(async () => {
    const r = await reg({ name: 'Flow User' });
    const userId = r.body.user.id;
    token = jwt.sign({ sub: userId, email: r.body.user.email, name: 'Flow User' },
      process.env.JWT_SECRET, { expiresIn: '1h' });
  });

  it('GET /api/users/me — returns profile',          async () => { const r=await request(app).get('/api/users/me').set('Authorization',`Bearer ${token}`); expect(r.status).toBe(200); expect(r.body.subscription_tier).toBe('free'); });
  it('PUT /api/users/me — updates name',             async () => { const r=await request(app).put('/api/users/me').set('Authorization',`Bearer ${token}`).send({name:'New Name'}); expect(r.status).toBe(200); expect(r.body.name).toBe('New Name'); });
  it('PUT /api/users/me — 400 empty name',           async () => { expect((await request(app).put('/api/users/me').set('Authorization',`Bearer ${token}`).send({name:'   '})).status).toBe(400); });
  it('POST /auth/logout — 200',                      async () => { const r=await request(app).post('/auth/logout').set('Authorization',`Bearer ${token}`); expect(r.status).toBe(200); });
  it('GET /api/admin/users — 403 for regular user',  async () => { expect((await request(app).get('/api/admin/users').set('Authorization',`Bearer ${token}`)).status).toBe(403); });
});
