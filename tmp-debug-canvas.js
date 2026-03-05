const { chromium } = require('playwright');
(async () => {
    const browser = await chromium.launch({
        args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist']
    });
    const page = await browser.newPage();

    // Set localStorage BEFORE navigation — exactly like E2E tests
    await page.addInitScript(() => {
        localStorage.setItem('kelion_onboarded', 'true');
    });

    console.log('Navigating with addInitScript kelion_onboarded=true...');
    await page.goto('https://kelionai.app', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);

    console.log('Final URL:', page.url());

    const info = await page.evaluate(() => ({
        url: window.location.href,
        hasCanvas: !!document.getElementById('avatar-canvas'),
        onboarded: localStorage.getItem('kelion_onboarded'),
        hasAuthScreen: !!document.getElementById('auth-screen'),
        hasAppLayout: !!document.getElementById('app-layout'),
    }));

    console.log(JSON.stringify(info, null, 2));
    await browser.close();
})();
