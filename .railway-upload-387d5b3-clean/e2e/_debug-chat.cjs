const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = []; const logs = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', msg => { if (msg.type()==='error' || msg.type()==='warning') logs.push(msg.type() + ': ' + msg.text()); });
  await page.goto('https://kelionai.app/chat', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  const html = await page.content();
  const hasStart = await page.locator('button:has-text("Pornește chat")').count();
  const hasBack  = await page.locator('text=← Înapoi').count();
  const bodyText = await page.textContent('body');
  console.log('url=', page.url());
  console.log('hasStart=', hasStart, 'hasBack=', hasBack);
  console.log('body snippet =', (bodyText||'').slice(0, 300));
  console.log('html length =', html.length);
  console.log('--- errors ---'); errors.forEach(e => console.log(e));
  console.log('--- console logs ---'); logs.forEach(l => console.log(l));
  await page.screenshot({ path: 'e2e/_debug-chat.png', fullPage: true });
  await browser.close();
})();
