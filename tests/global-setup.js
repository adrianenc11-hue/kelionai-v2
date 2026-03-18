// global-setup.js — Wake up Railway server BEFORE any tests run
const http = require('https');

module.exports = async function globalSetup() {
  const BASE = process.env.BASE_URL || process.env.APP_URL || 'https://kelionai.app';
  const MAX_WAIT = 120_000; // 2 min max
  const RETRY_MS = 3_000;
  const start = Date.now();
  let attempts = 0;

  console.log(`\n🔥 Warming up server: ${BASE}/api/health ...`);

  while (Date.now() - start < MAX_WAIT) {
    attempts++;
    try {
      const ok = await new Promise((resolve) => {
        const req = http.get(`${BASE}/api/health`, { timeout: 10000 }, (res) => {
          resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
        req.on('timeout', () => { req.destroy(); resolve(false); });
      });

      if (ok) {
        // Double-tap: hit the main page too so all assets are cached
        await new Promise((resolve) => {
          const req2 = http.get(BASE, { timeout: 10000 }, () => resolve());
          req2.on('error', () => resolve());
          req2.on('timeout', () => { req2.destroy(); resolve(); });
        });

        console.log(`✅ Server UP after ${attempts} attempts (${Date.now() - start}ms)`);
        console.log(`✅ Main page pre-loaded\n`);
        return;
      }
      console.log(`   ⏳ Attempt ${attempts}: not ready, retrying in ${RETRY_MS / 1000}s...`);
    } catch {
      console.log(`   ⏳ Attempt ${attempts}: error, retrying...`);
    }
    await new Promise(r => setTimeout(r, RETRY_MS));
  }

  console.warn(`⚠️ Server not responding after ${MAX_WAIT / 1000}s — tests may fail\n`);
};
