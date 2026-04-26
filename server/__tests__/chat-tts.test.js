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
  it('returns 410 (suspended)', async () => { expect((await request(app).post('/api/chat').send({messages:[]})).status).toBe(410); });
  it('returns 410 for auth users', async () => { const {token}=await createUser(); expect((await request(app).post('/api/chat').set('Authorization',`Bearer ${token}`).send({messages:[{role:'user',content:'hello'}]})).status).toBe(410); });
});

describe('POST /api/tts', () => {
  it('returns 410 (suspended)', async () => { expect((await request(app).post('/api/tts').send({text:'hello'})).status).toBe(410); });
});
