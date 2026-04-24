'use strict';

/**
 * Tests for the Stripe payouts service that backs the admin "Payouts"
 * tab. We mock global fetch and assert:
 *   - getPayoutSnapshot aggregates balance + account + payouts
 *   - currency bucket picker prefers EUR > GBP > USD > first
 *   - triggerInstantPayout POSTs method=instant with an idempotency
 *     key, forwards amount + currency, and surfaces Stripe errors.
 */

const originalEnv = { ...process.env };

function load() {
  jest.resetModules();
  return require('../src/services/payouts');
}

function mockFetchSequence(responses) {
  const calls = [];
  global.fetch = jest.fn(async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected fetch to ${url}`);
    return {
      ok: next.ok !== false,
      status: next.status || 200,
      json: async () => next.body || {},
      text: async () => JSON.stringify(next.body || {}),
    };
  });
  return calls;
}

beforeEach(() => {
  process.env = { ...originalEnv };
  process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
  delete global.fetch;
});

afterAll(() => {
  process.env = originalEnv;
});

describe('payouts.getPayoutSnapshot', () => {
  test('returns unconfigured shape when STRIPE_SECRET_KEY is missing', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const svc = load();
    const snap = await svc.getPayoutSnapshot();
    expect(snap.configured).toBe(false);
    expect(snap.balance).toBeNull();
    expect(snap.recentPayouts).toEqual([]);
    expect(snap.errors).toEqual([
      expect.objectContaining({ source: 'config' }),
    ]);
  });

  test('aggregates /balance, /account, /payouts into a single snapshot', async () => {
    const calls = mockFetchSequence([
      {
        body: {
          available: [{ amount: 1234, currency: 'eur' }],
          pending: [{ amount: 567, currency: 'eur' }],
          instant_available: [{ amount: 800, currency: 'eur' }],
        },
      },
      {
        body: {
          external_accounts: {
            data: [{
              object: 'card',
              brand: 'visa',
              last4: '4242',
              country: 'GB',
              currency: 'eur',
            }],
          },
          settings: {
            payouts: { schedule: { interval: 'daily', delay_days: 2 } },
          },
        },
      },
      {
        body: {
          data: [{
            id: 'po_123',
            amount: 500,
            currency: 'eur',
            status: 'in_transit',
            method: 'instant',
            arrival_date: 1234567890,
            created: 1234567800,
          }],
        },
      },
    ]);
    const svc = load();
    const snap = await svc.getPayoutSnapshot();
    expect(snap.configured).toBe(true);
    expect(snap.errors).toEqual([]);
    expect(snap.balance.available.display).toBe('12.34 EUR');
    expect(snap.balance.pending.display).toBe('5.67 EUR');
    expect(snap.balance.instantAvailable.amount).toBe(800);
    expect(snap.instantEligible).toBe(true);
    expect(snap.destination).toMatchObject({
      type: 'card',
      brand: 'visa',
      last4: '4242',
      country: 'GB',
    });
    expect(snap.schedule).toEqual({
      interval: 'daily',
      delayDays: 2,
      monthlyAnchor: null,
      weeklyAnchor: null,
    });
    expect(snap.recentPayouts).toHaveLength(1);
    expect(snap.recentPayouts[0]).toMatchObject({
      id: 'po_123',
      method: 'instant',
      display: '5.00 EUR',
    });
    // /balance, /account, /payouts?limit=10 — exactly three calls in
    // that order with Authorization bearer.
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe('https://api.stripe.com/v1/balance');
    expect(calls[2].url).toBe('https://api.stripe.com/v1/payouts?limit=10');
    expect(calls[0].opts.headers.Authorization).toBe('Bearer sk_test_dummy');
  });

  test('records partial failures instead of throwing', async () => {
    mockFetchSequence([
      { body: { available: [{ amount: 100, currency: 'eur' }], pending: [], instant_available: [] } },
      { ok: false, status: 500, body: { error: { message: 'boom' } } },
      { ok: false, status: 403, body: { error: { message: 'no perms' } } },
    ]);
    const svc = load();
    const snap = await svc.getPayoutSnapshot();
    expect(snap.balance.available.amount).toBe(100);
    expect(snap.errors.map((e) => e.source).sort()).toEqual(['account', 'payouts']);
    expect(snap.instantEligible).toBe(false);
  });
});

describe('payouts._pickBucket', () => {
  test('prefers EUR, then GBP, then USD, else first', () => {
    const svc = load();
    expect(svc._pickBucket([
      { amount: 1, currency: 'usd' },
      { amount: 2, currency: 'eur' },
      { amount: 3, currency: 'gbp' },
    ])).toEqual({ amount: 2, currency: 'eur' });
    expect(svc._pickBucket([
      { amount: 1, currency: 'usd' },
      { amount: 3, currency: 'gbp' },
    ])).toEqual({ amount: 3, currency: 'gbp' });
    expect(svc._pickBucket([{ amount: 5, currency: 'USD' }]))
      .toEqual({ amount: 5, currency: 'usd' });
    expect(svc._pickBucket([])).toEqual({ amount: 0, currency: 'eur' });
  });
});

describe('payouts.triggerInstantPayout', () => {
  test('POSTs method=instant with amount + currency + idempotency key', async () => {
    const calls = mockFetchSequence([
      {
        body: {
          id: 'po_456',
          amount: 5000,
          currency: 'eur',
          status: 'in_transit',
          method: 'instant',
          arrival_date: 1234567890,
          created: 1234567800,
        },
      },
    ]);
    const svc = load();
    const out = await svc.triggerInstantPayout({
      amountCents: 5000,
      currency: 'EUR',
      description: 'test payout',
    });
    expect(out).toMatchObject({
      id: 'po_456',
      method: 'instant',
      display: '50.00 EUR',
    });
    expect(calls[0].url).toBe('https://api.stripe.com/v1/payouts');
    expect(calls[0].opts.method).toBe('POST');
    expect(calls[0].opts.headers['Idempotency-Key']).toMatch(/^kelion-instant-payout-eur-\d{12}-5000$/);
    expect(calls[0].opts.body).toContain('method=instant');
    expect(calls[0].opts.body).toContain('amount=5000');
    expect(calls[0].opts.body).toContain('currency=eur');
    expect(calls[0].opts.body).toContain('description=test+payout');
  });

  test('omits amount when caller passes none (Stripe pays out full balance)', async () => {
    const calls = mockFetchSequence([
      { body: { id: 'po_789', amount: 0, currency: 'eur', status: 'pending', method: 'instant' } },
    ]);
    const svc = load();
    await svc.triggerInstantPayout({});
    expect(calls[0].opts.body).not.toContain('amount=');
    expect(calls[0].opts.body).toContain('method=instant');
    expect(calls[0].opts.headers['Idempotency-Key']).toMatch(/-all$/);
  });

  test('rejects with Stripe error message when API returns 400', async () => {
    mockFetchSequence([
      {
        ok: false, status: 400,
        body: { error: { message: 'External account does not support instant payouts', code: 'instant_payouts_unsupported' } },
      },
    ]);
    const svc = load();
    await expect(svc.triggerInstantPayout({ amountCents: 1000 }))
      .rejects.toMatchObject({
        message: 'External account does not support instant payouts',
        status: 400,
        stripe: { code: 'instant_payouts_unsupported' },
      });
  });

  test('throws not-configured when STRIPE_SECRET_KEY is missing', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const svc = load();
    await expect(svc.triggerInstantPayout({})).rejects.toMatchObject({
      code: 'not-configured',
    });
  });
});
