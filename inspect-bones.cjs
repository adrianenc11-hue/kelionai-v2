const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:29229');
  const ctx = browser.contexts()[0];
  const page = ctx.pages().find(p => p.url().includes('localhost:4173')) || await ctx.newPage();
  await page.goto('http://localhost:4173/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(6000);
  const result = await page.evaluate(() => {
    const bones = window.__KELION_BONES;
    if (!bones) return 'NO BONES ON WINDOW';
    const out = {};
    for (const k of Object.keys(bones)) {
      if (/arm|Arm|shoulder|Shoulder/.test(k)) {
        const b = bones[k];
        out[k] = {
          x: +b.rotation.x.toFixed(3),
          y: +b.rotation.y.toFixed(3),
          z: +b.rotation.z.toFixed(3),
        };
      }
    }
    return out;
  });
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
})();
