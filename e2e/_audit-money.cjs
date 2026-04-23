'use strict';
// Live audit of subscription + payment + trial-token endpoints.
const { request } = require('playwright');
const BASE = 'https://kelionai.app';
const email = `money_${Date.now()}_${Math.random().toString(36).slice(2,6)}@example.com`;
const password = 'Money-' + Math.random().toString(36).slice(2, 10) + '!';

(async () => {
  const ctx = await request.newContext({ baseURL: BASE });
  const results = [];
  const check = (name, ok, detail) => {
    const tag = ok ? 'PASS' : 'FAIL';
    results.push({ name, ok });
    console.log(`[${tag}] ${name}${detail ? '  —  ' + detail : ''}`);
  };

  // 1. Public plans list
  let r = await ctx.get('/api/subscription/plans');
  const plansBody = await r.json().catch(() => ({}));
  check('/api/subscription/plans returns 200', r.status() === 200, `status=${r.status()}`);
  check('Plans list is a non-empty array',
    Array.isArray(plansBody.plans) && plansBody.plans.length > 0,
    `count=${plansBody?.plans?.length}`);
  if (Array.isArray(plansBody.plans)) {
    console.log('    plans: ' + plansBody.plans.map(p => `${p.id}($${p.price})`).join(', '));
  }

  // 2. Register a fresh user
  r = await ctx.post('/auth/local/register', {
    data: { email, password, name: 'Money Audit' },
    headers: { 'content-type': 'application/json' },
  });
  check('Register audit user', r.status() === 200 || r.status() === 201, `status=${r.status()}`);

  // 3. Create checkout session for the cheapest paid plan
  const paidPlan = (plansBody.plans || []).find(p => p.price > 0);
  r = await ctx.post('/api/payments/create-checkout-session', {
    data: { planId: paidPlan?.id || 'basic' },
    headers: { 'content-type': 'application/json' },
  });
  const csBody = await r.json().catch(() => ({}));
  const url = csBody?.url || '';
  const isMock = url.includes('/mock');
  const isRealStripe = /^https:\/\/checkout\.stripe\.com\/(c|pay)\//.test(url) && !isMock;
  console.log('    checkout-session response: ' + JSON.stringify(csBody).slice(0, 200));
  check('Checkout session responds 200 or 503',
    r.status() === 200 || r.status() === 503,
    `status=${r.status()}`);
  if (r.status() === 200) {
    check('Checkout URL is a REAL Stripe URL (not mock)',
      isRealStripe,
      isMock ? 'WARNING: mock URL in production — Stripe NOT really integrated' : `url=${url.slice(0,80)}`);
  } else {
    check('Checkout URL blocked because STRIPE_SECRET_KEY missing',
      csBody.error && /not configured/i.test(csBody.error), `error=${csBody.error}`);
  }

  // 4. Payments history
  r = await ctx.get('/api/payments/history');
  const hist = await r.json().catch(() => ({}));
  check('/api/payments/history returns 200', r.status() === 200);
  check('Payments history is an array', Array.isArray(hist.payments), `typeof=${typeof hist.payments}`);

  // 5. Wrong planId -> 400
  r = await ctx.post('/api/payments/create-checkout-session', {
    data: { planId: 'nosuch' },
    headers: { 'content-type': 'application/json' },
  });
  check('Checkout with invalid planId returns 400', r.status() === 400, `status=${r.status()}`);

  // 6. Free plan checkout -> 400
  r = await ctx.post('/api/payments/create-checkout-session', {
    data: { planId: 'free' },
    headers: { 'content-type': 'application/json' },
  });
  check('Checkout for "free" plan returns 400', r.status() === 400, `status=${r.status()}`);

  // 7. /api/realtime/trial-token: removed in audit M2. The legacy shadow
  // endpoint bypassed the shared 15-min/day trial quota and duplicated
  // /api/realtime/token. Assert it's gone so a future revert is caught.
  const ctxAnon = await request.newContext({ baseURL: BASE });
  r = await ctxAnon.get('/api/realtime/trial-token');
  check('Legacy trial-token endpoint returns 404 (audit M2)', r.status() === 404, `status=${r.status()}`);
  await ctxAnon.dispose();

  // 8. /api/realtime/token requires auth
  const ctxNoAuth = await request.newContext({ baseURL: BASE });
  r = await ctxNoAuth.get('/api/realtime/token');
  check('/api/realtime/token (no auth) returns 401', r.status() === 401, `status=${r.status()}`);
  await ctxNoAuth.dispose();

  // 9. /api/realtime/token with auth returns 200 or 503 (gemini live has its own flow)
  r = await ctx.get('/api/realtime/token');
  check('/api/realtime/token (auth) returns 200/500/503',
    [200, 500, 503].includes(r.status()),
    `status=${r.status()}`);

  const pass = results.filter(x => x.ok).length;
  const fail = results.filter(x => !x.ok).length;
  console.log(`\n=== MONEY AUDIT: ${pass} PASS / ${fail} FAIL ===`);
  await ctx.dispose();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('audit error:', e); process.exit(2); });
