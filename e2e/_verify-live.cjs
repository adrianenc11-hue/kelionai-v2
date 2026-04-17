'use strict';

// Headless verification of the production site after Kira removal.
// Runs a sequence of explicit checks on https://kelionai.app and prints
// one line per check with an explicit PASS/FAIL verdict.

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const BASE = 'https://kelionai.app';

(async () => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const logPath  = path.join(__dirname, `_proof-${stamp}.txt`);
  const shotDir  = __dirname;
  const results = [];
  const log = s => { results.push(s); console.log(s); };

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();

  function check(name, ok, detail) {
    const tag = ok ? 'PASS' : 'FAIL';
    log(`[${tag}] ${name}${detail ? '  —  ' + detail : ''}`);
    return ok;
  }

  log('=== KelionAI live verification after Kira removal ===');
  log('Base: ' + BASE);
  log('Time: ' + new Date().toISOString());
  log('');

  // ---- 1. Landing page ----
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });
  await page.screenshot({ path: path.join(shotDir, `_proof-${stamp}-01-landing.png`), fullPage: true });

  const html = await page.content();
  check('Landing 200 + title present',
    /<title>[^<]+<\/title>/.test(html),
    'title matched');

  const kiraButton = await page.locator('button:has-text("Kira")').count();
  check('Landing has NO Kira button', kiraButton === 0, `count=${kiraButton}`);

  const kelionH1 = await page.locator('h1:has-text("Kelion")').count();
  check('Landing has Kelion heading', kelionH1 > 0, `count=${kelionH1}`);

  const aiVision = await page.getByText('AI Vision', { exact: false }).count();
  check('Landing has NO "AI Vision" feature', aiVision === 0, `count=${aiVision}`);

  const startChatBtn = await page.locator('button:has-text("Pornește chat")').count();
  check('Landing has Romanian Pornește chat button', startChatBtn > 0, `count=${startChatBtn}`);

  const roHero = await page.getByText('ASISTENTUL TĂU AI', { exact: false }).count();
  check('Landing hero is in Romanian', roHero > 0, `count=${roHero}`);

  const roTagline = await page.getByText('Inteligent, empatic', { exact: false }).count();
  check('Landing tagline is in Romanian', roTagline > 0, `count=${roTagline}`);

  const englishLeft = await page.getByText('YOUR AI ASSISTANT', { exact: false }).count();
  check('Landing has NO English hero left', englishLeft === 0, `count=${englishLeft}`);

  // ---- 2. Legacy /chat/kira redirects to /chat ----
  await page.goto(`${BASE}/chat/kira`, { waitUntil: 'networkidle', timeout: 30000 });
  const redirected = page.url() === `${BASE}/chat`;
  check('/chat/kira redirects to /chat', redirected, 'final=' + page.url());
  await page.screenshot({ path: path.join(shotDir, `_proof-${stamp}-02-chat-kira-redirect.png`), fullPage: true });

  // ---- 3. /chat page loads ----
  await page.goto(`${BASE}/chat`, { waitUntil: 'networkidle', timeout: 30000 });
  const chatStart = await page.locator('button:has-text("Pornește chat")').count();
  check('/chat page has Romanian Pornește chat button', chatStart > 0, `count=${chatStart}`);
  const backBtn = await page.locator('text=← Înapoi').count();
  check('/chat page has Romanian Înapoi button', backBtn > 0, `count=${backBtn}`);
  await page.screenshot({ path: path.join(shotDir, `_proof-${stamp}-03-chat.png`), fullPage: true });

  // ---- 4. /chat/kelion also redirects (legacy) ----
  await page.goto(`${BASE}/chat/kelion`, { waitUntil: 'networkidle', timeout: 30000 });
  check('/chat/kelion redirects to /chat', page.url() === `${BASE}/chat`, 'final=' + page.url());

  // ---- 5. Production /health ----
  const healthResp = await page.request.get(BASE + '/health');
  const health = await healthResp.json();
  log('\n/health = ' + JSON.stringify(health));
  check('/health returns ok', health.status === 'ok');
  check('/health ai_provider=gemini', health.services.ai_provider === 'gemini');
  check('/health gemini=configured', health.services.gemini === 'configured');
  check('/health database=connected', health.services.database === 'connected');

  // ---- 6. /api/realtime/token  (without auth → 401) ----
  const rt = await page.request.get(BASE + '/api/realtime/token');
  check('/api/realtime/token requires auth', rt.status() === 401, 'status=' + rt.status());

  // ---- 7. Kira model GLB is NOT served (SPA fallback returns HTML, not binary) ----
  const kiraGlb = await page.request.get(BASE + '/kira-rpm_54d82b66.glb');
  const kiraCt  = kiraGlb.headers()['content-type'] || '';
  check('Kira GLB no longer served (content-type != model/gltf-binary)',
    !kiraCt.startsWith('model/'),
    'status=' + kiraGlb.status() + ' content-type=' + kiraCt);

  // ---- 8. Kelion GLB still served as binary model ----
  const kelionGlb = await page.request.get(BASE + '/kelion-rpm_e27cb94d.glb');
  const kelionCt  = kelionGlb.headers()['content-type'] || '';
  check('Kelion GLB still served as binary model',
    kelionGlb.status() === 200 && kelionCt.startsWith('model/'),
    'status=' + kelionGlb.status() + ' content-type=' + kelionCt);

  // ---- 9. VoiceChat bundle sanity checks ----
  const landingHtml = await (await page.request.get(BASE + '/')).text();
  // Main bundle is where the lazy-loaded VoiceChat chunk URL is referenced.
  const indexMatch = landingHtml.match(/index-[A-Za-z0-9_-]+\.js/);
  let mainBundleText = '';
  if (indexMatch) {
    mainBundleText = await (await page.request.get(BASE + '/assets/' + indexMatch[0])).text();
  }
  const vcMatch = mainBundleText.match(/VoiceChat-[A-Za-z0-9_-]+\.js/);
  if (vcMatch) {
    const bundleUrl = BASE + '/assets/' + vcMatch[0];
    const bundleText = await (await page.request.get(bundleUrl)).text();
    check('VoiceChat bundle has no Kira references',
      !/\bkira\b/i.test(bundleText),
      'bundle=' + vcMatch[0] + ', size=' + bundleText.length);
    check('VoiceChat bundle requests video+audio (camera with mic)',
      /video\s*:\s*\{/.test(bundleText) && /getUserMedia/.test(bundleText),
      'size=' + bundleText.length);
    check('VoiceChat bundle has strict language rules (no "default to Romanian")',
      /Language rules/.test(bundleText) && !/default to Romanian/i.test(bundleText),
      'has Language rules=' + /Language rules/.test(bundleText));
  } else {
    check('Could not locate VoiceChat chunk in main bundle', false, 'main=' + (indexMatch?.[0]||'?'));
  }

  // ---- Summary ----
  const passes = results.filter(s => s.startsWith('[PASS]')).length;
  const fails  = results.filter(s => s.startsWith('[FAIL]')).length;
  log('\n=== SUMMARY ===');
  log(`PASS: ${passes}`);
  log(`FAIL: ${fails}`);
  log(`Log:  ${logPath}`);
  log(`Screenshots: _proof-${stamp}-*.png`);

  await browser.close();
  fs.writeFileSync(logPath, results.join('\n'));
  process.exit(fails > 0 ? 1 : 0);
})().catch(err => {
  console.error('Script error:', err);
  process.exit(2);
});
