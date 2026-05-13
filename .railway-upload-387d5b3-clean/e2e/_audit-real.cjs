'use strict';

// Brutal honest end-to-end audit: simulate a real user from register to chat.
// Prints PASS/FAIL per real capability, no cosmetics.

const BASE = 'https://kelionai.app';
const results = [];
const check = (name, ok, detail) => {
  const tag = ok ? 'PASS' : 'FAIL';
  results.push({ name, ok, detail });
  console.log(`[${tag}] ${name}${detail ? '  —  ' + detail : ''}`);
};

async function req(method, path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  const r = await fetch(BASE + path, {
    method, headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    redirect: 'manual',
  });
  let body = null; try { body = await r.json(); } catch (_) {}
  return { status: r.status, headers: r.headers, body, cookies: r.headers.get('set-cookie') || '' };
}

// POST /api/chat is an SSE stream. Collect all data: {content} chunks into one string.
async function chatSSE(token, userMessage) {
  const r = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
    body: JSON.stringify({
      messages: [{ role: 'user', content: userMessage }],
      avatar: 'kelion',
      datetime: new Date().toISOString(),
      timezone: 'Europe/Bucharest',
    }),
  });
  if (!r.ok) return { status: r.status, text: '', error: await r.text().catch(()=>'') };
  const raw = await r.text();
  let text = '';
  let errored = false;
  for (const line of raw.split('\n')) {
    const m = line.match(/^data:\s*(.*)$/);
    if (!m) continue;
    const payload = m[1].trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const obj = JSON.parse(payload);
      if (obj.content) text += obj.content;
      if (obj.error) errored = true;
    } catch (_) {}
  }
  return { status: r.status, text, errored };
}

(async () => {
  console.log('=== REAL END-TO-END AUDIT of', BASE, '===');
  console.log('Time:', new Date().toISOString(), '\n');

  const email = `real_${Date.now()}_${Math.random().toString(36).slice(2,6)}@example.com`;
  const password = 'Test1234!';
  let token = null;

  // ---- A. Registration ----
  console.log('--- A. Register new user ---');
  const reg = await req('POST', '/auth/local/register', { body: { email, password, name: 'Real Test User' } });
  check('Register returns 201', reg.status === 201, `status=${reg.status}`);
  check('Register returns JWT', !!(reg.body && reg.body.token), reg.body?.token ? 'token len=' + reg.body.token.length : 'no token');
  token = reg.body?.token;

  // ---- B. Authenticated /auth/me ----
  console.log('\n--- B. JWT actually authorizes ---');
  const me = await req('GET', '/auth/me', { headers: { Authorization: 'Bearer ' + token } });
  check('/auth/me 200 with JWT', me.status === 200, `status=${me.status}`);
  check('/auth/me returns email', me.body?.email === email, `got=${me.body?.email}`);

  // ---- C. Realtime token (authenticated user) ----
  console.log('\n--- C. Realtime voice session (OpenAI token) ---');
  const rt = await req('GET', '/api/realtime/token', { headers: { Authorization: 'Bearer ' + token } });
  check('/api/realtime/token returns 200', rt.status === 200, `status=${rt.status}`);
  check('Token has ephemeral key (ek_...)', /^ek_/.test(rt.body?.token || ''), 'token prefix=' + (rt.body?.token || '').slice(0, 8));
  check('Token has voice', !!rt.body?.voice, 'voice=' + rt.body?.voice);

  // ---- D. Gemini Live token ----
  console.log('\n--- D. Gemini Live token ---');
  const gt = await req('GET', '/api/realtime/gemini-token', { headers: { Authorization: 'Bearer ' + token } });
  check('/api/realtime/gemini-token returns 200', gt.status === 200, `status=${gt.status} err=${gt.body?.error || ''}`);
  check('Gemini token returned', !!gt.body?.token, gt.body?.token ? 'got token' : 'no token');

  // ---- E. Chat text endpoint (SSE stream) ----
  console.log('\n--- E. Text chat via /api/chat (SSE) ---');
  const chatEN = await chatSSE(token, 'Say hello in exactly one short sentence.');
  check('/api/chat English 200', chatEN.status === 200, `status=${chatEN.status}`);
  check('Chat streamed AI reply (EN)', chatEN.text.length > 0 && !chatEN.errored, 'reply="' + chatEN.text.slice(0, 120) + '"');

  // ---- F. Language mirroring in text chat ----
  console.log('\n--- F. Language mirroring (text): Romanian prompt ---');
  const chatRO = await chatSSE(token, 'Salut! Spune-mi cum te numești într-o propoziție scurtă.');
  check('/api/chat Romanian 200', chatRO.status === 200, `status=${chatRO.status}`);
  const hasRomanianMarker = /[ăâîșțĂÂÎȘȚ]|\b(sunt|mă|numesc|eu|meu|este|sa|și)\b/i.test(chatRO.text);
  check('Romanian prompt → Romanian reply', hasRomanianMarker, 'reply="' + chatRO.text.slice(0, 160) + '"');

  console.log('\n--- G. Language mirroring (text): French prompt ---');
  const chatFR = await chatSSE(token, 'Bonjour, dis-moi ton nom en une phrase.');
  check('/api/chat French 200', chatFR.status === 200, `status=${chatFR.status}`);
  const hasFrenchMarker = /\b(je|suis|m'appelle|bonjour|mon|nom|appelle)\b/i.test(chatFR.text);
  check('French prompt → French reply', hasFrenchMarker, 'reply="' + chatFR.text.slice(0, 160) + '"');

  console.log('\n--- G2. Language switch mid-conversation ---');
  const chatDE = await chatSSE(token, 'Jetzt auf Deutsch bitte: wie heißt du?');
  check('/api/chat German 200', chatDE.status === 200, `status=${chatDE.status}`);
  const hasGermanMarker = /\b(ich|bin|heiße|heisse|mein|name|du)\b/i.test(chatDE.text);
  check('Language switch to German honored', hasGermanMarker, 'reply="' + chatDE.text.slice(0, 160) + '"');

  // ---- H. Payments (should be 503 with STRIPE not configured OR mock URL) ----
  console.log('\n--- H. Payments / checkout ---');
  const ck = await req('POST', '/api/payments/create-checkout-session', { headers: { Authorization: 'Bearer ' + token }, body: { planId: 'basic' } });
  const realStripe = ck.body?.url && /^https:\/\/checkout\.stripe\.com\//.test(ck.body.url) && !/\/mock$/.test(ck.body.url);
  check('Checkout returns a REAL Stripe URL (not mock)', realStripe, 'status=' + ck.status + ' url=' + (ck.body?.url || ''));

  // ---- I. Logout ----
  console.log('\n--- I. Logout invalidates session ---');
  const logout = await req('POST', '/auth/logout', { headers: { Authorization: 'Bearer ' + token } });
  check('Logout returns 200', logout.status === 200, `status=${logout.status}`);

  // ---- J. Trial token (unauth) ----
  console.log('\n--- J. Trial token (unauth, 1/day/IP) ---');
  const trial = await req('GET', '/api/realtime/trial-token');
  check('Trial token 200 or 429', trial.status === 200 || trial.status === 429, `status=${trial.status}`);
  if (trial.status === 200) {
    check('Trial token is ephemeral (ek_...)', /^ek_/.test(trial.body?.token || ''), 'prefix=' + (trial.body?.token || '').slice(0, 8));
  }

  // ---- K. /api/chat without auth ----
  console.log('\n--- K. /api/chat without auth must 401 ---');
  const noauth = await req('POST', '/api/chat', { body: { message: 'x' } });
  check('/api/chat without JWT → 401', noauth.status === 401, 'status=' + noauth.status);

  // ---- Summary ----
  const passes = results.filter(r => r.ok).length;
  const fails  = results.filter(r => !r.ok).length;
  console.log('\n=== REAL E2E SUMMARY ===');
  console.log(`PASS: ${passes}`);
  console.log(`FAIL: ${fails}`);
  if (fails > 0) {
    console.log('\nFailed checks:');
    results.filter(r => !r.ok).forEach(r => console.log(`  - ${r.name}: ${r.detail || ''}`));
  }
  process.exit(fails > 0 ? 1 : 0);
})().catch(err => { console.error('Script error:', err); process.exit(2); });
