'use strict';
// Live audit of full login flow: register -> login -> me -> logout -> me.
// Uses a temporary random email and asserts each step.
const { request } = require('playwright');

const BASE = 'https://kelionai.app';
const email = `audit_${Date.now()}_${Math.random().toString(36).slice(2,6)}@example.com`;
const password = 'Audit-Password-' + Math.random().toString(36).slice(2, 10) + '!';

(async () => {
  const ctx = await request.newContext({ baseURL: BASE });
  const results = [];
  const check = (name, ok, detail) => {
    const tag = ok ? 'PASS' : 'FAIL';
    results.push({ name, ok });
    console.log(`[${tag}] ${name}${detail ? '  —  ' + detail : ''}`);
  };

  // 1. /auth/me without cookie -> 401
  let r = await ctx.get('/auth/me');
  check('/auth/me unauthenticated returns 401', r.status() === 401, `status=${r.status()}`);

  // 2. Register
  r = await ctx.post('/auth/local/register', {
    data: { email, password, name: 'Audit User' },
    headers: { 'content-type': 'application/json' },
  });
  const regBody = await r.json().catch(() => ({}));
  check('/auth/local/register 200/201', r.status() === 200 || r.status() === 201, `status=${r.status()} body=${JSON.stringify(regBody).slice(0,120)}`);
  check('Register returns user.id + email', regBody?.user?.email === email,
    `got id=${regBody?.user?.id} email=${regBody?.user?.email}`);

  // 3. /auth/me with registration cookie -> 200
  r = await ctx.get('/auth/me');
  const meAfterReg = await r.json().catch(() => ({}));
  check('/auth/me after register returns 200', r.status() === 200, `status=${r.status()}`);
  check('/auth/me after register has email', meAfterReg?.email === email, `email=${meAfterReg?.email}`);

  // 4. Logout
  r = await ctx.post('/auth/logout', { headers: { 'content-type': 'application/json' } });
  check('/auth/logout 200', r.status() === 200, `status=${r.status()}`);

  // 5. /auth/me after logout -> 401
  r = await ctx.get('/auth/me');
  check('/auth/me after logout returns 401', r.status() === 401, `status=${r.status()}`);

  // 6. Login with same creds
  r = await ctx.post('/auth/local/login', {
    data: { email, password },
    headers: { 'content-type': 'application/json' },
  });
  const loginBody = await r.json().catch(() => ({}));
  check('/auth/local/login 200', r.status() === 200, `status=${r.status()}`);
  check('Login returns same user', loginBody?.user?.email === email, `email=${loginBody?.user?.email}`);

  // 7. /auth/me after login -> 200
  r = await ctx.get('/auth/me');
  const meAfterLogin = await r.json().catch(() => ({}));
  check('/auth/me after login returns 200', r.status() === 200);
  check('/auth/me after login has same email', meAfterLogin?.email === email);

  // 8. Wrong password -> 401
  r = await ctx.post('/auth/local/login', {
    data: { email, password: 'WRONG-' + password },
    headers: { 'content-type': 'application/json' },
  });
  check('Login with wrong password returns 401', r.status() === 401, `status=${r.status()}`);

  // 9. Google OAuth start -> 302 to accounts.google.com
  const gs = await ctx.get('/auth/google/start', { maxRedirects: 0 }).catch(e => ({ status: () => 302, headers: () => ({}) }));
  const loc = gs.headers ? gs.headers()['location'] || '' : '';
  check('/auth/google/start redirects to accounts.google.com',
    gs.status() === 302 && loc.startsWith('https://accounts.google.com/'),
    `status=${gs.status()} loc=${loc.slice(0,80)}`);
  check('Google redirect has our redirect_uri',
    loc.includes(encodeURIComponent(BASE + '/auth/google/callback')),
    'ok');

  // Summary
  const pass = results.filter(x => x.ok).length;
  const fail = results.filter(x => !x.ok).length;
  console.log(`\n=== AUTH AUDIT: ${pass} PASS / ${fail} FAIL ===`);
  console.log(`Test email used: ${email}`);
  await ctx.dispose();
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => { console.error('audit error:', e); process.exit(2); });
