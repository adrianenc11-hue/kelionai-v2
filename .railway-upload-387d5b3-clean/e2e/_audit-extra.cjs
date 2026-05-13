'use strict';
// Extra probes for endpoints not covered by the main audits.

const BASE = 'https://kelionai.app';

async function json(method, path, headers = {}, body = null) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  let b = null; try { b = await r.json(); } catch (_) { try { b = await r.text(); } catch (__) {} }
  return { status: r.status, body: b };
}

async function raw(method, path, headers = {}, body = null) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await r.text();
  return { status: r.status, text: txt };
}

(async () => {
  console.log('=== EXTRA PROBES of', BASE, '===\n');

  // 1. /health
  const h = await json('GET', '/health');
  console.log('[health]', h.status, JSON.stringify(h.body).slice(0, 400));

  // 2. /api/avatars (public)
  const av = await json('GET', '/api/avatars');
  console.log('[avatars]', av.status, Array.isArray(av.body) ? ('count=' + av.body.length + ' ids=' + av.body.map(a=>a.id||a.name).join(',')) : JSON.stringify(av.body).slice(0, 200));

  // 3. register to get a token for protected probes
  const email = `extra_${Date.now()}_${Math.random().toString(36).slice(2,5)}@example.com`;
  const reg = await json('POST', '/auth/local/register', {}, { email, password: 'Test1234!', name: 'Extra Probe' });
  console.log('[register]', reg.status);
  if (reg.status !== 201 || !reg.body?.token) { console.log('cannot continue without token'); process.exit(1); }
  const token = reg.body.token;
  const auth = { Authorization: 'Bearer ' + token };

  // 4. /api/subscription/status
  const ss = await json('GET', '/api/subscription/status', auth);
  console.log('[subscription/status]', ss.status, JSON.stringify(ss.body).slice(0, 400));

  // 5. /api/payments/history
  const ph = await json('GET', '/api/payments/history', auth);
  console.log('[payments/history]', ph.status, JSON.stringify(ph.body).slice(0, 400));

  // 6. /api/tts sample
  const tts = await raw('POST', '/api/tts', auth, { text: 'Hello, this is a test.', voice: 'alloy' });
  console.log('[tts]', tts.status, 'body-length=' + tts.text.length, 'preview=' + tts.text.slice(0, 200).replace(/[^ -~]/g, '.'));

  // 7. raw chat response (why is it empty?)
  console.log('\n--- /api/chat RAW stream ---');
  const r = await fetch(BASE + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth },
    body: JSON.stringify({
      messages: [{ role: 'user', content: 'Spune salut intr-un cuvant.' }],
      avatar: 'kelion',
      datetime: new Date().toISOString(),
      timezone: 'Europe/Bucharest',
    }),
  });
  console.log('status:', r.status, 'content-type:', r.headers.get('content-type'));
  const body = await r.text();
  console.log('body-length:', body.length);
  console.log('body-preview (first 1200 chars):');
  console.log(body.slice(0, 1200));

  // 8. chat with other avatars
  console.log('\n--- /api/chat with different avatars ---');
  for (const av of ['kelion', 'aria', 'lex']) {
    const rr = await fetch(BASE + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'hi' }],
        avatar: av,
        datetime: new Date().toISOString(),
        timezone: 'Europe/Bucharest',
      }),
    });
    const txt = await rr.text();
    // extract any 'content' payload
    let content = '';
    for (const line of txt.split('\n')) {
      const m = line.match(/^data:\s*(.+)$/);
      if (!m) continue;
      if (m[1].trim() === '[DONE]') continue;
      try { const o = JSON.parse(m[1]); if (o.content) content += o.content; if (o.error) content = '[ERROR] ' + o.error; } catch (_) {}
    }
    console.log(`  avatar=${av}: status=${rr.status} len=${txt.length} content="${content.slice(0, 100)}"`);
  }

  // 9. /auth/me deeper (does subscription.active matter?)
  const me = await json('GET', '/auth/me', auth);
  console.log('\n[auth/me full]', me.status, JSON.stringify(me.body).slice(0, 800));

  // 10. try subscription/limits
  const lim = await json('GET', '/api/subscription/limits', auth);
  console.log('[subscription/limits]', lim.status, JSON.stringify(lim.body).slice(0, 400));
})().catch(e => { console.error('script error:', e); process.exit(2); });
