const { chromium } = require('playwright-core');
const fs = require('fs');
const path = require('path');
const certPath = path.join(__dirname, '..', 'server', 'dev-cert', 'cert.pem');
const hasCert = fs.existsSync(certPath);
const baseURL = hasCert ? 'https://localhost:3443' : 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-gl=swiftshader',
      '--disable-gpu',
      '--disable-gpu-compositing',
      '--disable-software-rasterizer',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--js-flags=--max-old-space-size=512',
      '--ignore-certificate-errors',
    ]
  });
  // Match Playwright config: Desktop Chrome viewport = 1280x720
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    baseURL,
    viewport: { width: 1280, height: 720 },
    permissions: ['microphone'],
  });
  const page = await context.newPage();

  // EXACT same as test beforeEach
  await page.addInitScript(() => {
    localStorage.setItem('kelion_onboarded', 'true');
  });
  await page.goto('/');
  await page.waitForLoadState('networkidle', { timeout: 10000 }).catch(() => {});

  // Dismiss auth screen — EXACT same as test beforeEach
  try {
    const authScreen = page.locator('#auth-screen');
    const isAuthVisible = await authScreen.isVisible().catch(() => false);
    console.log('1. Auth screen visible:', isAuthVisible);
    if (isAuthVisible) {
      const authGuest = page.locator('#auth-guest');
      const guestVisible = await authGuest.isVisible().catch(() => false);
      console.log('2. Guest button visible:', guestVisible);
      if (guestVisible) {
        await authGuest.click({ timeout: 3000 }).catch((e) => console.log('   Guest click error:', e.message));
      }
      await authScreen.waitFor({ state: 'hidden', timeout: 5000 }).catch(async () => {
        console.log('3. Auth screen did NOT become hidden, forcing display:none');
        await page.evaluate(() => {
          const el = document.getElementById('auth-screen');
          if (el) el.style.display = 'none';
        }).catch(() => {});
      });
    }
  } catch (_e) {
    console.log('Auth dismiss error:', _e.message);
  }

  // Now check exactly what test 20 checks
  console.log('\n--- Test 20 check ---');
  const appState = await page.evaluate(() => {
    const app = document.getElementById('app-layout');
    const btn = document.getElementById('btn-pricing');
    return {
      appLayout: app ? { hidden: app.classList.contains('hidden'), vis: window.getComputedStyle(app).visibility } : 'missing',
      btnPricing: btn ? {
        display: window.getComputedStyle(btn).display,
        vis: window.getComputedStyle(btn).visibility,
        rect: btn.getBoundingClientRect(),
        parentHidden: btn.closest('.hidden') ? btn.closest('.hidden').id : 'none'
      } : 'missing'
    };
  });
  console.log('App/Button state:', JSON.stringify(appState, null, 2));

  // EXACT same as test 20
  const exists = await page.locator('#btn-pricing').isVisible({ timeout: 10000 }).catch((e) => {
    console.log('isVisible error:', e.message);
    return false;
  });
  console.log('btn-pricing isVisible({timeout:10000}):', exists);

  await page.screenshot({ path: 'test-results/debug-pricing-btn.png', fullPage: true });
  console.log('Screenshot: test-results/debug-pricing-btn.png');

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
