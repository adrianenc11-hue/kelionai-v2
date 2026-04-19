const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:29229');
  const ctx = browser.contexts()[0];
  const pages = ctx.pages();
  const page = pages.find(p => p.url().startsWith('https://kelionai.app')) || pages[0];
  await page.bringToFront();
  // Ensure email is adrianenc11
  const email = await page.$('input[type="email"]');
  await email.fill('adrianenc11@gmail.com');
  const pwd = await page.$('input[type="password"]');
  await pwd.fill(process.env.KELION_ADMIN_PASSWORD || '');
  await page.click('button[type="submit"]:has-text("Sign in")');
  await page.waitForTimeout(4000);
  console.log('done');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
