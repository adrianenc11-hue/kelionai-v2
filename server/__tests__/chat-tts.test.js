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

const unique = () => `ct_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`;

async function createUser() {
  const r = await request(app).post('/auth/local/register')
    .send({ email: unique(), password: 'ValidPass123!', name: 'CT User' });
  const id = r.body.user.id;
  const token = jwt.sign({ sub: id, email: r.body.user.email, name: 'CT User' },
    process.env.JWT_SECRET, { expiresIn: '1h' });
  return { token };
}

describe('POST /api/chat', () => {
  // /api/chat is SUSPENDED — all AI now goes through Canal B (WebSocket).
  // Route returns 410 Gone.
  it('returns 410 (suspended)',                       async () => { const s=(await request(app).post('/api/chat').send({messages:[]})).status; expect(s).toBe(410); });
  it('returns 410 for authenticated users too',       async () => { const {token}=await createUser(); expect((await request(app).post('/api/chat').set('Authorization',`Bearer ${token}`).send({messages:[{role:'user',content:'hello'}]})).status).toBe(410); });
});

describe('POST /api/tts', () => {
  // /api/tts is now a public endpoint — guests access the Charon voice via
  // the shared 15-min/day IP trial window (see services/trialQuota.js).
  // Adrian: "in mod free nu se aplica vocile". The old hard-401 is gone;
  // we assert only that the request is no longer rejected for auth reasons.
  // Acceptable: 200 (synthesis ok), 400 (body), 429 (trial exhausted),
  // 503 (no TTS provider), 500 (upstream provider key bad).
  it('guests pass soft auth (no 401)',                async () => { const s=(await request(app).post('/api/tts').send({text:'hello'})).status; expect(s).not.toBe(401); expect([200,400,429,500,503]).toContain(s); });
  it('400 empty text',                                async () => { const {token}=await createUser(); expect((await request(app).post('/api/tts').set('Authorization',`Bearer ${token}`).send({text:''})).status).toBe(400); });
  it('400 missing text',                              async () => { const {token}=await createUser(); expect((await request(app).post('/api/tts').set('Authorization',`Bearer ${token}`).send({})).status).toBe(400); });
  it('400 text over 2000 chars',                      async () => { const {token}=await createUser(); expect((await request(app).post('/api/tts').set('Authorization',`Bearer ${token}`).send({text:'a'.repeat(2001)})).status).toBe(400); });
  it('200/503 with valid text',                       async () => { const {token}=await createUser(); const r=await request(app).post('/api/tts').set('Authorization',`Bearer ${token}`).send({text:'Hello world'}); expect([200,503]).toContain(r.status); });
  it('accepts text exactly 2000 chars',               async () => { const {token}=await createUser(); const r=await request(app).post('/api/tts').set('Authorization',`Bearer ${token}`).send({text:'a'.repeat(2000)}); expect([200,503]).toContain(r.status); });
});
