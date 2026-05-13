'use strict';

const { chromium } = require('playwright');

let browserInstance = null;

async function getBrowser() {
  if (!browserInstance) {
    browserInstance = await chromium.launch({ headless: true });
  }
  return browserInstance;
}

async function screenshot(url, options = {}) {
  if (!url || typeof url !== 'string') return { ok: false, error: 'No URL provided.' };
  try {
    const browser = await getBrowser();
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    if (options.selector) {
      await page.waitForSelector(options.selector, { timeout: 10000 }).catch((e) => {
        console.warn('[agentBrowser] waitForSelector failed:', e && e.message);
      });
    }
    const screenshotBuffer = await page.screenshot({ fullPage: options.fullPage || false });
    await context.close();
    return {
      ok: true,
      screenshotBase64: screenshotBuffer.toString('base64'),
      mimeType: 'image/png',
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function getPageContent(url) {
  if (!url || typeof url !== 'string') return { ok: false, error: 'No URL provided.' };
  try {
    const browser = await getBrowser();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    const content = await page.content();
    const title = await page.title();
    await context.close();
    return { ok: true, title, content: content.slice(0, 50000) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function closeBrowser() {
  if (browserInstance) {
    await browserInstance.close();
    browserInstance = null;
  }
}

module.exports = { screenshot, getPageContent, closeBrowser };
