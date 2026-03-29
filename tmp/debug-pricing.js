const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  
  page.on('console', msg => console.log('BROWSER:', msg.text()));
  page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
  
  await page.addInitScript(() => {
    localStorage.setItem('kelion_onboarded', 'true');
  });
  await page.goto('http://localhost:3000/');
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(3000);
  
  // Try creating the alias manually in browser context
  const result = await page.evaluate(() => {
    try {
      const bp = document.getElementById('btn-pricing');
      if (!bp) return 'btn-pricing not found';
      const alias = document.createElement('button');
      alias.id = 'btn-subscriptions';
      alias.textContent = 'Plans';
      alias.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;z-index:99999;pointer-events:auto;';
      alias.addEventListener('click', () => bp.click());
      document.body.appendChild(alias);
      return 'created: ' + !!document.getElementById('btn-subscriptions');
    } catch(e) {
      return 'error: ' + e.message;
    }
  });
  console.log('Manual create result:', result);
  
  // Now check if clicking it opens the modal
  const subsBtn = page.locator('#btn-subscriptions');
  console.log('btn-subscriptions count:', await subsBtn.count());
  
  await browser.close();
})();
