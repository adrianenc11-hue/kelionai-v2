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

const unique = () => `ref_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`;

async function createUser() {
  const email = unique();
  const r = await request(app).post('/auth/local/register')
    .send({ email, password: 'ValidPass123!', name: 'Ref User' });
  const id = r.body.user.id;
  const token = jwt.sign({ sub: id, email: r.body.user.email, name: 'Ref User' },
    process.env.JWT_SECRET, { expiresIn: '1h' });
  return { token, id };
}

describe('Referral system', () => {
  it('401 unauthenticated generate',         async () => { expect((await request(app).post('/api/referral/generate')).status).toBe(401); });
  it('creates 8-char code',                  async () => { const {token}=await createUser(); const r=await request(app).post('/api/referral/generate').set('Authorization',`Bearer ${token}`); expect(r.status).toBe(200); expect(r.body.code).toHaveLength(8); expect(r.body.expires_at).toBeTruthy(); });
  it('valid code returns valid:true',        async () => { const {token}=await createUser(); const {body:{code}}=await request(app).post('/api/referral/generate').set('Authorization',`Bearer ${token}`); const r=await request(app).get(`/api/referral/validate/${code}`).set('Authorization',`Bearer ${token}`); expect(r.status).toBe(200); expect(r.body.valid).toBe(true); });
  it('invalid code returns 404',             async () => { const {token}=await createUser(); const r=await request(app).get('/api/referral/validate/XXXXXXXX').set('Authorization',`Bearer ${token}`); expect(r.status).toBe(404); });
  it('applies code from another user',       async () => { const o=await createUser(); const u=await createUser(); const {body:{code}}=await request(app).post('/api/referral/generate').set('Authorization',`Bearer ${o.token}`); const r=await request(app).post('/api/referral/use').set('Authorization',`Bearer ${u.token}`).send({code}); expect(r.status).toBe(200); expect(r.body.success).toBe(true); });
  it('cannot use own code',                  async () => { const o=await createUser(); const {body:{code}}=await request(app).post('/api/referral/generate').set('Authorization',`Bearer ${o.token}`); expect((await request(app).post('/api/referral/use').set('Authorization',`Bearer ${o.token}`).send({code})).status).toBe(400); });
  it('cannot use same code twice',           async () => { const o=await createUser(); const u1=await createUser(); const u2=await createUser(); const {body:{code}}=await request(app).post('/api/referral/generate').set('Authorization',`Bearer ${o.token}`); await request(app).post('/api/referral/use').set('Authorization',`Bearer ${u1.token}`).send({code}); expect((await request(app).post('/api/referral/use').set('Authorization',`Bearer ${u2.token}`).send({code})).status).toBe(400); });
  it('400 without code',                     async () => { const {token}=await createUser(); expect((await request(app).post('/api/referral/use').set('Authorization',`Bearer ${token}`).send({})).status).toBe(400); });
});
