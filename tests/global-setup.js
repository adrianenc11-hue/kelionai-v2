// global-setup.js — Wake up server BEFORE any tests run

module.exports = async function globalSetup() {
  const BASE = process.env.BASE_URL || process.env.APP_URL || 'https://kelionai.app';
  const MAX_WAIT = 60_000; // 1 min max
  const RETRY_MS = 2_000;
  const start = Date.now();
  let attempts = 0;

  console.log(`\n🔥 Warming up server: ${BASE} ...`);

  // First try the main page (no rate limiting)
  while (Date.now() - start < MAX_WAIT) {
    attempts++;
    try {
      // Use main page instead of /api/health to avoid rate limiting
      const response = await fetch(BASE, { signal: AbortSignal.timeout(10000) });
      // 200, 301, 302, 304, 401, 403, 404, 429 all mean server is UP
      if (response.status < 500) {
        console.log(`✅ Server UP after ${attempts} attempts (${Date.now() - start}ms) — status ${response.status}`);
        return;
      }
      console.log(`   ⏳ Attempt ${attempts}: status ${response.status}, retrying...`);
    } catch (e) {
      // ECONNREFUSED = server not started yet
      if (e.message && e.message.includes('ECONNREFUSED')) {
        console.log(`   ⏳ Attempt ${attempts}: server not ready (${e.message}), retrying...`);
      } else {
        // Any other error (timeout, DNS) — server might be up
        console.log(`   ⏳ Attempt ${attempts}: ${e.message} — continuing anyway`);
        return;
      }
    }
    await new Promise((r) => setTimeout(r, RETRY_MS));
  }

  console.warn(`⚠️ Server not responding after ${MAX_WAIT / 1000}s — proceeding with tests anyway\n`);
};
