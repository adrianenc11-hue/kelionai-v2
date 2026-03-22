const https = require('https');

const endpoints = [
  { path: '/api/health', method: 'GET', name: 'Health Check' },
  { path: '/api/chat', method: 'POST', name: 'Chat (Text)', body: { message: 'test' } },
  { path: '/api/auth/check', method: 'GET', name: 'Auth Check' },
  { path: '/api/admin/stats', method: 'GET', name: 'Admin Stats', headers: { 'x-admin-secret': 'kAI-adm1n-s3cr3t-2026-pr0d' } },
  { path: '/api/admin/brain-chat', method: 'POST', name: 'Brain Chat', body: { message: 'ping', sessionId: 'test' }, headers: { 'x-admin-secret': 'kAI-adm1n-s3cr3t-2026-pr0d' } },
  { path: '/api/voice/tts', method: 'POST', name: 'Voice TTS', body: { text: 'Test', voice: 'kelion' } },
  { path: '/api/admin/users', method: 'GET', name: 'Admin Users', headers: { 'x-admin-secret': 'kAI-adm1n-s3cr3t-2026-pr0d' } },
  { path: '/api/admin/costs', method: 'GET', name: 'Admin Costs', headers: { 'x-admin-secret': 'kAI-adm1n-s3cr3t-2026-pr0d' } },
  { path: '/api/news', method: 'GET', name: 'News Feed' },
  { path: '/api/referral/stats', method: 'GET', name: 'Referral Stats' },
];

async function probe(ep) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'kelionai.app',
      port: 443,
      path: ep.path,
      method: ep.method,
      headers: { 'Content-Type': 'application/json', ...(ep.headers || {}) },
    };
    const body = ep.body ? JSON.stringify(ep.body) : null;
    if (body) options.headers['Content-Length'] = Buffer.byteLength(body);

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        const status = res.statusCode;
        const ok = status >= 200 && status < 400;
        const preview = data.substring(0, 120);
        console.log(`${ok ? '✅' : '❌'} [${status}] ${ep.name} (${ep.path}): ${preview}`);
        resolve();
      });
    });
    req.on('error', (e) => {
      console.log(`❌ [ERR] ${ep.name} (${ep.path}): ${e.message}`);
      resolve();
    });
    if (body) req.write(body);
    req.end();
  });
}

(async () => {
  for (const ep of endpoints) {
    await probe(ep);
  }
})();
