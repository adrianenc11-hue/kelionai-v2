'use strict';

process.env.NODE_ENV          = 'test';
process.env.JWT_SECRET        = 'test-jwt-secret-at-least-32-chars!!';
process.env.SESSION_SECRET    = 'test-session-secret-32chars-longx';
process.env.DB_PATH           = '/tmp/noop.db';
process.env.STRIPE_SECRET_KEY = ''; // Ensure Stripe is not configured for this test suite

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

const unique = () => `sub_${Date.now()}_${Math.random().toString(36).slice(2)}@test.com`;

async function createUser() {
  const r = await request(app).post('/auth/local/register')
    .send({ email: unique(), password: 'ValidPass123!', name: 'Sub User' });
  const id = r.body.user.id;
  const token = jwt.sign({ sub: id, email: r.body.user.email, name: 'Sub User' },
    process.env.JWT_SECRET, { expiresIn: '1h' });
  return { token, id };
}

describe('GET /api/subscription/plans', () => {
  it('200 without auth',                     async () => { expect((await request(app).get('/api/subscription/plans')).status).toBe(200); });
  it('returns array of plans',               async () => { const r=await request(app).get('/api/subscription/plans'); expect(Array.isArray(r.body.plans)).toBe(true); });
  it('has exactly 4 plans',                  async () => { const r=await request(app).get('/api/subscription/plans'); expect(r.body.plans).toHaveLength(4); });
  it('free plan — price 0, dailyLimit 10',   async () => { const r=await request(app).get('/api/subscription/plans'); const f=r.body.plans.find(p=>p.id==='free'); expect(f.price).toBe(0); expect(f.dailyLimit).toBe(10); });
  it('basic plan — $9.99/month',             async () => { const r=await request(app).get('/api/subscription/plans'); const b=r.body.plans.find(p=>p.id==='basic'); expect(b.price).toBe(9.99); expect(b.interval).toBe('month'); });
  it('enterprise — null dailyLimit',         async () => { const r=await request(app).get('/api/subscription/plans'); expect(r.body.plans.find(p=>p.id==='enterprise').dailyLimit).toBeNull(); });
  it('all plans have features array',        async () => { const r=await request(app).get('/api/subscription/plans'); r.body.plans.forEach(p=>expect(Array.isArray(p.features)).toBe(true)); });
});

describe('New user defaults', () => {
  it('tier=free, status=active, usage=0',    async () => { const {token}=await createUser(); const r=await request(app).get('/api/users/me').set('Authorization',`Bearer ${token}`); expect(r.body.subscription_tier).toBe('free'); expect(r.body.subscription_status).toBe('active'); expect(r.body.usage.today).toBe(0); expect(r.body.usage.daily_limit).toBe(10); });
});

describe('POST /api/payments/create-checkout-session', () => {
  it('401 unauthenticated',                  async () => { expect((await request(app).post('/api/payments/create-checkout-session').send({planId:'basic'})).status).toBe(401); });
  it('400 for free plan',                    async () => { const {token}=await createUser(); expect((await request(app).post('/api/payments/create-checkout-session').set('Authorization',`Bearer ${token}`).send({planId:'free'})).status).toBe(400); });
  it('400 for invalid plan',                 async () => { const {token}=await createUser(); expect((await request(app).post('/api/payments/create-checkout-session').set('Authorization',`Bearer ${token}`).send({planId:'xxx'})).status).toBe(400); });
  it('503 when Stripe not configured',       async () => { const {token}=await createUser(); expect((await request(app).post('/api/payments/create-checkout-session').set('Authorization',`Bearer ${token}`).send({planId:'basic'})).status).toBe(503); });
});

describe('GET /api/payments/history', () => {
  it('401 unauthenticated',                  async () => { expect((await request(app).get('/api/payments/history')).status).toBe(401); });
  it('empty array for new user',             async () => { const {token}=await createUser(); const r=await request(app).get('/api/payments/history').set('Authorization',`Bearer ${token}`); expect(r.status).toBe(200); expect(r.body.payments).toHaveLength(0); });
});
