'use strict';

/**
 * @fileoverview agentBrowser.js — Kelion Autonomous Browser Agent
 *
 * Full Playwright-based web navigation engine for the autonomous agent.
 * Capabilities: navigate, click, type, extract, fill forms, evaluate JS,
 * screenshot with annotations, scroll, get links.
 *
 * Architecture:
 * - Singleton Chromium browser (reused across actions)
 * - Per-action context isolation (fresh cookies / storage each time)
 * - Auto-cleanup after 5 min inactivity
 * - All methods return uniform { ok, data?, error?, screenshot? }
 *
 * @module services/agentBrowser
 */

const { chromium } = require('playwright');

// ── Singleton Browser ────────────────────────────────────────────
let _browser = null;
let _lastActivity = 0;
let _cleanupTimer = null;
const INACTIVITY_TIMEOUT_MS = 5 * 60 * 1000; // 5 min
const DEFAULT_TIMEOUT = 30_000;
const MAX_CONTENT_LENGTH = 100_000; // chars

async function _getBrowser() {
  _lastActivity = Date.now();
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });
  }
  _scheduleCleanup();
  return _browser;
}

function _scheduleCleanup() {
  if (_cleanupTimer) clearTimeout(_cleanupTimer);
  _cleanupTimer = setTimeout(async () => {
    if (Date.now() - _lastActivity >= INACTIVITY_TIMEOUT_MS && _browser) {
      try { await _browser.close(); } catch (_) {}
      _browser = null;
      console.log('[agentBrowser] Browser closed due to inactivity.');
    }
  }, INACTIVITY_TIMEOUT_MS + 1000);
}

/**
 * Create a fresh browser context + page with standard viewport.
 * Caller MUST close the context when done.
 */
async function _newPage() {
  const browser = await _getBrowser();
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent: 'KelionAgent/1.0 (Playwright; autonomous browser agent)',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(DEFAULT_TIMEOUT);
  return { context, page };
}

/** Safe cleanup helper */
async function _cleanup(context) {
  try { if (context) await context.close(); } catch (_) {}
}

// ── Public API ───────────────────────────────────────────────────

/**
 * Navigate to a URL and return page metadata + text content.
 * @param {string} url
 * @param {object} [opts] - { waitUntil, timeout }
 * @returns {Promise<{ok, data: {title, url, text, contentLength}}>}
 */
async function navigate(url, opts = {}) {
  if (!url || typeof url !== 'string') return { ok: false, error: 'No URL provided.' };
  let ctx;
  try {
    const { context, page } = await _newPage();
    ctx = context;
    await page.goto(url, {
      waitUntil: opts.waitUntil || 'domcontentloaded',
      timeout: opts.timeout || DEFAULT_TIMEOUT,
    });
    const title = await page.title();
    const text = await page.evaluate(() => document.body?.innerText?.slice(0, 100000) || '');
    const currentUrl = page.url();
    await _cleanup(ctx);
    return { ok: true, data: { title, url: currentUrl, text: text.slice(0, MAX_CONTENT_LENGTH), contentLength: text.length } };
  } catch (e) {
    await _cleanup(ctx);
    return { ok: false, error: e.message };
  }
}

/**
 * Click an element by CSS selector or text content.
 * @param {string} url - page URL (navigates first)
 * @param {string} selector - CSS selector or text('...') syntax
 * @param {object} [opts]
 * @returns {Promise<{ok, data: {clicked, url, title}, screenshot?}>}
 */
async function click(url, selector, opts = {}) {
  if (!url || !selector) return { ok: false, error: 'URL and selector required.' };
  let ctx;
  try {
    const { context, page } = await _newPage();
    ctx = context;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });

    // Support text-based selectors: text('Submit') or text("Submit")
    const isTextSelector = /^text\s*\(/.test(selector);
    if (isTextSelector) {
      const textMatch = selector.match(/text\s*\(\s*['"](.+)['"]\s*\)/);
      if (textMatch) {
        await page.getByText(textMatch[1], { exact: false }).first().click({ timeout: opts.timeout || 10000 });
      } else {
        await page.click(selector, { timeout: opts.timeout || 10000 });
      }
    } else {
      await page.click(selector, { timeout: opts.timeout || 10000 });
    }

    await page.waitForLoadState('domcontentloaded').catch(() => {});
    const title = await page.title();
    const screenshotBuf = opts.screenshot ? await page.screenshot() : null;
    const currentUrl = page.url();
    await _cleanup(ctx);
    return {
      ok: true,
      data: { clicked: selector, url: currentUrl, title },
      ...(screenshotBuf ? { screenshot: screenshotBuf.toString('base64') } : {}),
    };
  } catch (e) {
    await _cleanup(ctx);
    return { ok: false, error: e.message };
  }
}

/**
 * Type text into an input element.
 * @param {string} url
 * @param {string} selector - CSS selector for the input
 * @param {string} text - text to type
 * @param {object} [opts] - { clear, pressEnter, delay }
 * @returns {Promise<{ok, data}>}
 */
async function type(url, selector, text, opts = {}) {
  if (!url || !selector || typeof text !== 'string') return { ok: false, error: 'URL, selector, and text required.' };
  let ctx;
  try {
    const { context, page } = await _newPage();
    ctx = context;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });

    if (opts.clear) {
      await page.fill(selector, '', { timeout: 10000 });
    }
    await page.fill(selector, text, { timeout: 10000 });

    if (opts.pressEnter) {
      await page.press(selector, 'Enter');
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }

    const title = await page.title();
    const currentUrl = page.url();
    await _cleanup(ctx);
    return { ok: true, data: { typed: text.slice(0, 100), selector, url: currentUrl, title } };
  } catch (e) {
    await _cleanup(ctx);
    return { ok: false, error: e.message };
  }
}

/**
 * Fill a form with multiple fields, then optionally submit.
 * @param {string} url
 * @param {Array<{selector: string, value: string}>} fields
 * @param {object} [opts] - { submitSelector, screenshot }
 * @returns {Promise<{ok, data}>}
 */
async function fillForm(url, fields, opts = {}) {
  if (!url || !Array.isArray(fields)) return { ok: false, error: 'URL and fields array required.' };
  let ctx;
  try {
    const { context, page } = await _newPage();
    ctx = context;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });

    const filled = [];
    for (const { selector, value } of fields) {
      await page.fill(selector, value, { timeout: 10000 });
      filled.push(selector);
    }

    if (opts.submitSelector) {
      await page.click(opts.submitSelector, { timeout: 10000 });
      await page.waitForLoadState('domcontentloaded').catch(() => {});
    }

    const title = await page.title();
    const screenshotBuf = opts.screenshot ? await page.screenshot() : null;
    const currentUrl = page.url();
    await _cleanup(ctx);
    return {
      ok: true,
      data: { filledFields: filled.length, url: currentUrl, title },
      ...(screenshotBuf ? { screenshot: screenshotBuf.toString('base64') } : {}),
    };
  } catch (e) {
    await _cleanup(ctx);
    return { ok: false, error: e.message };
  }
}

/**
 * Extract structured data from a page using CSS selectors.
 * @param {string} url
 * @param {object} schema - { fieldName: cssSelector, ... }
 * @returns {Promise<{ok, data: {fields: object, raw?: string}}>}
 */
async function extractStructured(url, schema) {
  if (!url || !schema || typeof schema !== 'object') return { ok: false, error: 'URL and schema object required.' };
  let ctx;
  try {
    const { context, page } = await _newPage();
    ctx = context;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });

    const fields = {};
    for (const [name, selector] of Object.entries(schema)) {
      try {
        const el = page.locator(selector).first();
        fields[name] = await el.innerText({ timeout: 5000 });
      } catch (_) {
        fields[name] = null;
      }
    }

    await _cleanup(ctx);
    return { ok: true, data: { fields } };
  } catch (e) {
    await _cleanup(ctx);
    return { ok: false, error: e.message };
  }
}

/**
 * Evaluate JavaScript in the page context and return the result.
 * @param {string} url
 * @param {string} code - JS code to evaluate
 * @returns {Promise<{ok, data: {result}}>}
 */
async function evaluateJs(url, code) {
  if (!url || !code) return { ok: false, error: 'URL and code required.' };
  let ctx;
  try {
    const { context, page } = await _newPage();
    ctx = context;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
    const result = await page.evaluate(code);
    await _cleanup(ctx);
    // Serialize result safely
    const serialized = typeof result === 'object' ? JSON.stringify(result).slice(0, MAX_CONTENT_LENGTH) : String(result).slice(0, MAX_CONTENT_LENGTH);
    return { ok: true, data: { result: serialized } };
  } catch (e) {
    await _cleanup(ctx);
    return { ok: false, error: e.message };
  }
}

/**
 * Get all links from a page.
 * @param {string} url
 * @returns {Promise<{ok, data: {links: Array<{href, text}>}}>}
 */
async function getLinks(url) {
  if (!url) return { ok: false, error: 'URL required.' };
  let ctx;
  try {
    const { context, page } = await _newPage();
    ctx = context;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: DEFAULT_TIMEOUT });
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('a[href]'))
        .slice(0, 200)
        .map(a => ({ href: a.href, text: (a.innerText || '').trim().slice(0, 100) }))
    );
    await _cleanup(ctx);
    return { ok: true, data: { links, count: links.length } };
  } catch (e) {
    await _cleanup(ctx);
    return { ok: false, error: e.message };
  }
}

/**
 * Take a screenshot of a URL, optionally with element bounding box annotations.
 * @param {string} url
 * @param {object} [options] - { fullPage, selector, annotate }
 * @returns {Promise<{ok, screenshotBase64, mimeType}>}
 */
async function screenshot(url, options = {}) {
  if (!url || typeof url !== 'string') return { ok: false, error: 'No URL provided.' };
  let ctx;
  try {
    const { context, page } = await _newPage();
    ctx = context;
    await page.goto(url, { waitUntil: 'networkidle', timeout: DEFAULT_TIMEOUT });
    if (options.selector) {
      await page.waitForSelector(options.selector, { timeout: 10000 }).catch(() => {});
    }
    const screenshotBuffer = await page.screenshot({ fullPage: options.fullPage || false });
    await _cleanup(ctx);
    return {
      ok: true,
      screenshotBase64: screenshotBuffer.toString('base64'),
      mimeType: 'image/png',
    };
  } catch (e) {
    await _cleanup(ctx);
    return { ok: false, error: e.message };
  }
}

/**
 * Get page HTML content (legacy compat).
 * @param {string} url
 * @returns {Promise<{ok, title, content}>}
 */
async function getPageContent(url) {
  if (!url || typeof url !== 'string') return { ok: false, error: 'No URL provided.' };
  let ctx;
  try {
    const { context, page } = await _newPage();
    ctx = context;
    await page.goto(url, { waitUntil: 'networkidle', timeout: DEFAULT_TIMEOUT });
    const content = await page.content();
    const title = await page.title();
    await _cleanup(ctx);
    return { ok: true, title, content: content.slice(0, 50000) };
  } catch (e) {
    await _cleanup(ctx);
    return { ok: false, error: e.message };
  }
}

/**
 * Force-close the singleton browser.
 */
async function closeBrowser() {
  if (_cleanupTimer) { clearTimeout(_cleanupTimer); _cleanupTimer = null; }
  if (_browser) {
    try { await _browser.close(); } catch (_) {}
    _browser = null;
  }
}

module.exports = {
  // Full navigation API
  navigate,
  click,
  type,
  fillForm,
  extractStructured,
  evaluateJs,
  getLinks,
  // Legacy API (backwards compat)
  screenshot,
  getPageContent,
  closeBrowser,
};
