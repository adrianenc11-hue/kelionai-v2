'use strict';

// Unit tests for the PR E2 auto-topup service. The service itself is
// pure — given a list of provider cards + env config, decide whether
// to POST to Stripe. We fake the global fetch so we can assert it
// gets called with the right shape without hitting real Stripe.

describe('autoTopup service (PR E2)', () => {
  let autoTopup;
  let originalFetch;
  let originalEnv;
  let fetchCalls;

  const OK_FETCH_RESPONSE = () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: 'pi_test_123', status: 'succeeded' }),
    text: async () => '',
  });

  beforeEach(() => {
    jest.resetModules();
    originalFetch = global.fetch;
    fetchCalls = [];
    global.fetch = jest.fn(async (url, opts) => {
      fetchCalls.push({ url: String(url), opts });
      return OK_FETCH_RESPONSE();
    });
    originalEnv = {
      STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
      OWNER_STRIPE_CUSTOMER_ID: process.env.OWNER_STRIPE_CUSTOMER_ID,
      OWNER_STRIPE_PAYMENT_METHOD_ID: process.env.OWNER_STRIPE_PAYMENT_METHOD_ID,
      AUTO_TOPUP_THRESHOLD: process.env.AUTO_TOPUP_THRESHOLD,
      AUTO_TOPUP_AMOUNT_EUR: process.env.AUTO_TOPUP_AMOUNT_EUR,
      AUTO_TOPUP_CURRENCY: process.env.AUTO_TOPUP_CURRENCY,
      AUTO_TOPUP_COOLDOWN_MS: process.env.AUTO_TOPUP_COOLDOWN_MS,
      AUTO_TOPUP_ENABLED: process.env.AUTO_TOPUP_ENABLED,
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      ALERT_WEBHOOK_URL: process.env.ALERT_WEBHOOK_URL,
    };
    // Silence email side-effects — we only assert Stripe dispatch.
    delete process.env.RESEND_API_KEY;
    delete process.env.ALERT_WEBHOOK_URL;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  function load() {
    autoTopup = require('../src/services/autoTopup');
    if (typeof autoTopup._resetForTests === 'function') autoTopup._resetForTests();
    return autoTopup;
  }

  function eleven(card) {
    return {
      id: 'elevenlabs',
      name: 'ElevenLabs',
      kind: undefined,
      status: 'low',
      balance: card.remaining,
      balanceDisplay: `${card.remaining.toLocaleString()} / ${card.limit.toLocaleString()} chars`,
      ...card.overrides,
    };
  }

  test('no-op when customer/payment method not configured', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    delete process.env.OWNER_STRIPE_CUSTOMER_ID;
    delete process.env.OWNER_STRIPE_PAYMENT_METHOD_ID;
    const svc = load();
    const out = await svc.checkAndTrigger([eleven({ remaining: 500, limit: 10000 })]);
    expect(out.configured).toBe(false);
    expect(out.triggered).toHaveLength(0);
    expect(out.skipped[0]).toMatchObject({ reason: 'not-configured' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('no-op when AUTO_TOPUP_ENABLED=false even if configured', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.OWNER_STRIPE_CUSTOMER_ID = 'cus_X';
    process.env.OWNER_STRIPE_PAYMENT_METHOD_ID = 'pm_X';
    process.env.AUTO_TOPUP_ENABLED = 'false';
    const svc = load();
    const out = await svc.checkAndTrigger([eleven({ remaining: 500, limit: 10000 })]);
    expect(out.triggered).toHaveLength(0);
    expect(out.skipped[0]).toMatchObject({ reason: 'disabled' });
  });

  test('skips above-threshold providers', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.OWNER_STRIPE_CUSTOMER_ID = 'cus_X';
    process.env.OWNER_STRIPE_PAYMENT_METHOD_ID = 'pm_X';
    process.env.AUTO_TOPUP_THRESHOLD = '0.2';
    const svc = load();
    const out = await svc.checkAndTrigger([
      eleven({ remaining: 9000, limit: 10000 }), // 90% — fine
    ]);
    expect(out.triggered).toHaveLength(0);
    expect(out.skipped[0]).toMatchObject({ reason: 'above-threshold' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('triggers Stripe PaymentIntent when below threshold', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.OWNER_STRIPE_CUSTOMER_ID = 'cus_X';
    process.env.OWNER_STRIPE_PAYMENT_METHOD_ID = 'pm_Y';
    process.env.AUTO_TOPUP_THRESHOLD = '0.2';
    process.env.AUTO_TOPUP_AMOUNT_EUR = '20';
    process.env.AUTO_TOPUP_CURRENCY = 'eur';
    const svc = load();
    const out = await svc.checkAndTrigger([
      eleven({ remaining: 500, limit: 10000 }), // 5% — below threshold
    ]);
    expect(out.triggered).toHaveLength(1);
    expect(out.triggered[0].status).toBe('ok');
    expect(out.triggered[0].paymentIntentId).toBe('pi_test_123');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const call = fetchCalls[0];
    expect(call.url).toBe('https://api.stripe.com/v1/payment_intents');
    expect(call.opts.method).toBe('POST');
    expect(call.opts.headers['Authorization']).toBe('Bearer sk_test_dummy');
    expect(call.opts.headers['Idempotency-Key']).toMatch(/^kelion-autotopup-elevenlabs-\d{4}-\d{2}-\d{2}$/);
    const form = new URLSearchParams(call.opts.body);
    expect(form.get('amount')).toBe('2000');
    expect(form.get('currency')).toBe('eur');
    expect(form.get('customer')).toBe('cus_X');
    expect(form.get('payment_method')).toBe('pm_Y');
    expect(form.get('confirm')).toBe('true');
    expect(form.get('off_session')).toBe('true');
  });

  test('cooldown prevents a second charge within the window', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.OWNER_STRIPE_CUSTOMER_ID = 'cus_X';
    process.env.OWNER_STRIPE_PAYMENT_METHOD_ID = 'pm_Y';
    process.env.AUTO_TOPUP_THRESHOLD = '0.2';
    process.env.AUTO_TOPUP_COOLDOWN_MS = '60000';
    const svc = load();
    const card = eleven({ remaining: 500, limit: 10000 });
    const first = await svc.checkAndTrigger([card]);
    expect(first.triggered).toHaveLength(1);
    const second = await svc.checkAndTrigger([card]);
    expect(second.triggered).toHaveLength(0);
    expect(second.skipped[0]).toMatchObject({ reason: 'cooldown' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('records error entry when Stripe returns 402', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.OWNER_STRIPE_CUSTOMER_ID = 'cus_X';
    process.env.OWNER_STRIPE_PAYMENT_METHOD_ID = 'pm_Y';
    process.env.AUTO_TOPUP_THRESHOLD = '0.2';
    global.fetch = jest.fn(async () => ({
      ok: false,
      status: 402,
      json: async () => ({ error: { message: 'card_declined' } }),
      text: async () => 'card_declined',
    }));
    const svc = load();
    const out = await svc.checkAndTrigger([eleven({ remaining: 500, limit: 10000 })]);
    expect(out.triggered).toHaveLength(0);
    expect(out.errors).toHaveLength(1);
    expect(out.errors[0]).toMatchObject({ id: 'elevenlabs', status: 'error' });
    expect(out.errors[0].error).toContain('card_declined');
  });

  test('ignores revenue cards and unconfigured providers', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.OWNER_STRIPE_CUSTOMER_ID = 'cus_X';
    process.env.OWNER_STRIPE_PAYMENT_METHOD_ID = 'pm_Y';
    const svc = load();
    const out = await svc.checkAndTrigger([
      { id: 'stripe', name: 'Stripe', kind: 'revenue', status: 'ok', balance: 100, balanceDisplay: '100 € available' },
      { id: 'groq', name: 'Groq', status: 'unconfigured', balance: null, balanceDisplay: 'Check in Groq console' },
      { id: 'openai', name: 'OpenAI', status: 'ok', balance: null, balanceDisplay: 'Check in billing' },
    ]);
    expect(out.triggered).toHaveLength(0);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test('getStatus mirrors config + history', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_dummy';
    process.env.OWNER_STRIPE_CUSTOMER_ID = 'cus_X';
    process.env.OWNER_STRIPE_PAYMENT_METHOD_ID = 'pm_Y';
    process.env.AUTO_TOPUP_THRESHOLD = '0.15';
    process.env.AUTO_TOPUP_AMOUNT_EUR = '25';
    const svc = load();
    await svc.checkAndTrigger([eleven({ remaining: 500, limit: 10000 })]);
    const s = svc.getStatus();
    expect(s.configured).toBe(true);
    expect(s.threshold).toBeCloseTo(0.15);
    expect(s.amountEur).toBe(25);
    expect(s.history.elevenlabs).toBeTruthy();
    expect(s.history.elevenlabs.status).toBe('ok');
  });
});
