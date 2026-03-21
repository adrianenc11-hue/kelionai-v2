const fetch = require('node-fetch');
const { spawn } = require('child_process');

process.env.PORT = 3099;
process.env.SENTRY_DSN = '';
process.env.ADMIN_SECRET = 'super-secret-proof';
process.env.WA_ACCESS_TOKEN = 'test-token';
process.env.WA_PHONE_NUMBER_ID = 'test-phone-id';

// Start the server silently so logs don't mix with our proof
const server = spawn('node', ['server/index.js'], {
  env: process.env,
  stdio: 'ignore',
});

console.log('Lansare server local pe portul 3099 pentru teste...\n');

setTimeout(async () => {
  const BASE_URL = `http://localhost:3099`;
  const headers = {
    'Content-Type': 'application/json',
    'x-admin-secret': process.env.ADMIN_SECRET,
  };

  console.log('=== DOVEZI DE FUNCȚIONARE (PROOF OF WORK) ===\n');

  // 1. WhatsApp Send
  console.log('👉 1. Test POST /api/whatsapp/send');
  let res = await fetch(`${BASE_URL}/api/whatsapp/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ to: '40700000000', text: 'Test message for proof' }),
  });
  console.log(`STATUS REQUEST: ${res.status}`);
  console.log(`RĂSPUNS: ${await res.text()}\n`);

  // 2. Media Publish (Mocking a failed publish due to real FB token absence, but route is there)
  console.log('👉 2. Test POST /api/media/publish');
  res = await fetch(`${BASE_URL}/api/media/publish`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ platform: 'all', content: 'Test publish content' }),
  });
  console.log(`STATUS REQUEST: ${res.status}`);
  console.log(`RĂSPUNS: ${await res.text()}\n`);

  // 3. Voice Clone List
  console.log('👉 3. Test GET /api/voice-clone/list');
  res = await fetch(`${BASE_URL}/api/voice-clone/list`, {
    method: 'GET',
    headers,
  });
  console.log(`STATUS REQUEST: ${res.status}`);
  console.log(`RĂSPUNS: ${await res.text()}\n`);

  // 4. Service Worker
  console.log('👉 4. Test GET /sw.js');
  res = await fetch(`${BASE_URL}/sw.js`, { method: 'GET' });
  console.log(`STATUS REQUEST: ${res.status}`);
  const swText = await res.text();
  console.log(`RĂSPUNS (Primele 150 caractere): ${swText.substring(0, 150).replace(/\n/g, ' ')}\n`);

  console.log('=============================================');
  server.kill();
  process.exit(0);
}, 3000);
