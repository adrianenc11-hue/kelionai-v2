const fetch = require('node-fetch');

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'dev-stealth-key';
const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

const headers = {
  'Content-Type': 'application/json',
  'x-admin-secret': ADMIN_SECRET,
  Authorization: `Bearer temp-token`, // Falsifying a token format, we want to see if routes exist, not necessarily full success.
};

async function testEndpoint(name, method, path, body = null) {
  console.log(`\nTesting: ${name} -> ${method} ${path}`);
  try {
    const opts = { method, headers };
    if (body) Object.assign(opts, { body: JSON.stringify(body) });

    const res = await fetch(`${BASE_URL}${path}`, opts);
    const contentType = res.headers.get('content-type');

    let data;
    if (contentType && contentType.includes('application/json')) {
      data = await res.json();
    } else {
      data = await res.text();
    }

    console.log(`Status: ${res.status}`);
    console.log(`Response:`, typeof data === 'string' ? data.slice(0, 100) : data);

    if (res.status !== 404) {
      console.log(`✅ SUCCESS: Endpoint '${path}' exists!`);
    } else {
      console.log(`❌ FAILED: Endpoint '${path}' returned 404 Not Found.`);
    }
  } catch (err) {
    console.error(`❌ ERROR fetching ${path}:`, err.message);
  }
}

async function runAll() {
  console.log("Starting tests for 'missing' items in IMPLEMENTATION_STATUS.md...\n");

  // 1. SMS Send POST (removed endpoint)
  await testEndpoint('SMS Send', 'POST', '/api/sms/send', {
    to: '123456789',
    text: 'Hello test',
  });

  // 2. Media Publish POST
  await testEndpoint(
    'Media Publish',
    'POST',
    '/api/media/publish',
    { platform: 'all', content: 'Test publish' } // might fail auth, but won't be 404
  );

  // 3. Voice Clone List GET
  await testEndpoint('Voice Clone List', 'GET', '/api/voice-clone/list');

  // 4. Service Worker GET
  await testEndpoint('Service Worker (sw.js)', 'GET', '/sw.js');

  console.log(`\nTests finished.`);
}

runAll();
