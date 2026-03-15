const fetch = require('node-fetch');

const ADMIN_SECRET = process.env.ADMIN_SECRET || 'dev-stealth-key';
const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

const headers = {
  'Content-Type': 'application/json',
  'x-admin-secret': ADMIN_SECRET,
  Authorization: `Bearer ${process.env.BEARER_TOKEN}`,
};

/**
 * testEndpoint
 * @param {*} name
 * @param {*} method
 * @param {*} path
 * @param {*} body
 * @returns {*}
 */
async function testEndpoint(name, method, path, body = null) {
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

    if (res.status !== 404) {
    } else {
    }
  } catch (err) {
    console.error(`❌ ERROR fetching ${path}:`, err.message);
  }
}

/**
 * runAll
 * @returns {*}
 */
async function runAll() {
  // 1. WhatsApp send POST
  await testEndpoint('WhatsApp Send', 'POST', '/api/whatsapp/send', {
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
}

runAll();
