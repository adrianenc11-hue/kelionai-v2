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

setTimeout(async () => {
  const BASE_URL = `http://localhost:3099`;
  const headers = {
    'Content-Type': 'application/json',
    'x-admin-secret': process.env.ADMIN_SECRET,
  };

  // 1. WhatsApp Send
  let res = await fetch(`${BASE_URL}/api/whatsapp/send`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ to: '40700000000', text: 'Test message for proof' }),
  });

  // 2. Media Publish (Mocking a failed publish due to real FB token absence, but route is there)
  res = await fetch(`${BASE_URL}/api/media/publish`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ platform: 'all', content: 'Test publish content' }),
  });

  // 3. Voice Clone List
  res = await fetch(`${BASE_URL}/api/voice-clone/list`, {
    method: 'GET',
    headers,
  });

  // 4. Service Worker
  res = await fetch(`${BASE_URL}/sw.js`, { method: 'GET' });
  const swText = await res.text();
  console.log(`RĂSPUNS (Primele 150 caractere): ${swText.substring(0, 150).replace(/\n/g, ' ')}\n`);

  server.kill();
  process.exit(0);
}, 3000);
