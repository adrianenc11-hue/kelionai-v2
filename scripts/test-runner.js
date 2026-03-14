const fetch = require('node-fetch');
process.env.PORT = 3077;
process.env.SENTRY_DSN = ''; // disable sentry to avoid crashes
process.env.ADMIN_SECRET = 'test-secret';

// Start server
require('../server/index.js');

setTimeout(async () => {
  const BASE_URL = `http://localhost:${process.env.PORT}`;
  const headers = {
    'Content-Type': 'application/json',
    'x-admin-secret': process.env.ADMIN_SECRET,
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
      const text = await res.text();

      if (res.status !== 404) {
      } else {
      }
    } catch (err) {
      console.error(`❌ ERROR:`, err.message);
    }
  }

  await testEndpoint('WhatsApp Send', 'POST', '/api/whatsapp/send', {
    to: '123',
    text: 'hi',
  });
  await testEndpoint('Media Publish', 'POST', '/api/media/publish', {
    platform: 'all',
    content: 'test',
  });
  await testEndpoint('Voice Clone List', 'GET', '/api/voice-clone/list');
  await testEndpoint('Service Worker', 'GET', '/sw.js');

  process.exit(0);
}, 2000);
