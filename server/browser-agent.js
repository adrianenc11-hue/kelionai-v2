/**
 * KelionAI — Browser Agent (Computer Use — Tier 0)
 *
 * AI controls a headless browser to:
 * - Navigate websites
 * - Fill forms
 * - Take screenshots
 * - Extract data
 * - Automate web tasks
 *
 * Uses Puppeteer (or falls back to fetch-based scraping)
 * Sandboxed: no access to local filesystem, limited to web navigation
 */
"use strict";

const logger = require("./logger");

let puppeteer = null;
let browserInstance = null;

// Try to load Puppeteer (optional dependency)
try {
  puppeteer = require("puppeteer");
  logger.info(
    { component: "BrowserAgent" },
    "🌐 Puppeteer available — full Computer Use enabled",
  );
} catch {
  logger.info(
    { component: "BrowserAgent" },
    "🌐 Puppeteer not installed — using fetch-based fallback",
  );
}

const MAX_PAGES = 5; // Max concurrent pages
const PAGE_TIMEOUT = 30000; // 30s per page action
const activePagesMap = new Map(); // sessionId → page

// ═══ BROWSER LIFECYCLE ═══

async function getBrowser() {
  if (!puppeteer) return null;
  if (browserInstance && browserInstance.isConnected()) return browserInstance;

  try {
    browserInstance = await puppeteer.launch({
      headless: "new",
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-first-run",
        "--no-zygote",
        "--single-process",
        "--disable-extensions",
      ],
    });
    logger.info({ component: "BrowserAgent" }, "🌐 Browser launched");
    return browserInstance;
  } catch (e) {
    logger.error(
      { component: "BrowserAgent", err: e.message },
      "Browser launch failed",
    );
    return null;
  }
}

async function closeBrowser() {
  if (browserInstance) {
    try {
      await browserInstance.close();
    } catch { /* ignored */ }
    browserInstance = null;
  }
}

// ═══ CORE ACTIONS ═══

/**
 * Navigate to URL and return page content + screenshot
 */
async function navigate(url, options = {}) {
  const browser = await getBrowser();

  // Fallback: fetch-based scraping if no Puppeteer
  if (!browser) {
    return await fetchFallback(url);
  }

  let page = null;
  try {
    page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    );

    // Block unnecessary resources for speed
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const type = req.resourceType();
      if (
        ["image", "stylesheet", "font", "media"].includes(type) &&
        !options.loadMedia
      ) {
        req.abort();
      } else {
        req.continue();
      }
    });

    await page.goto(url, {
      waitUntil: options.waitUntil || "domcontentloaded",
      timeout: PAGE_TIMEOUT,
    });

    // Wait for dynamic content
    if (options.waitForSelector) {
      await page
        .waitForSelector(options.waitForSelector, { timeout: 10000 })
        .catch(() => {});
    }

    // Extract content
    const title = await page.title();
    const content = await page.evaluate(() => {
      // Get main text content, clean of scripts/styles
      const clone = document.body.cloneNode(true);
      clone
        .querySelectorAll("script, style, noscript, iframe")
        .forEach((el) => el.remove());
      return clone.innerText.substring(0, 5000);
    });

    // Take screenshot
    let screenshot = null;
    if (options.screenshot !== false) {
      screenshot = await page.screenshot({
        encoding: "base64",
        type: "jpeg",
        quality: 60,
        fullPage: false,
      });
    }

    // Get links
    const links = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("a[href]"))
        .slice(0, 20)
        .map((a) => ({
          text: a.innerText.trim().substring(0, 80),
          href: a.href,
        }))
        .filter((l) => l.text && l.href.startsWith("http"));
    });

    // Get forms
    const forms = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("form"))
        .slice(0, 5)
        .map((f) => ({
          action: f.action,
          method: f.method,
          inputs: Array.from(f.querySelectorAll("input, select, textarea"))
            .slice(0, 10)
            .map((inp) => ({
              type: inp.type || "text",
              name: inp.name,
              placeholder: inp.placeholder,
              id: inp.id,
            })),
        }));
    });

    // Store page for follow-up actions
    const sessionId = `page_${Date.now()}`;
    if (activePagesMap.size < MAX_PAGES) {
      activePagesMap.set(sessionId, page);
      // Auto-close after 5 minutes
      setTimeout(
        () => {
          const p = activePagesMap.get(sessionId);
          if (p) {
            p.close().catch(() => {});
            activePagesMap.delete(sessionId);
          }
        },
        5 * 60 * 1000,
      );
    } else {
      await page.close();
    }

    logger.info(
      { component: "BrowserAgent", url, title },
      `🌐 Navigated: ${title}`,
    );

    return {
      success: true,
      sessionId,
      url,
      title,
      content: content.substring(0, 3000),
      screenshot: screenshot ? `data:image/jpeg;base64,${screenshot}` : null,
      links,
      forms,
      engine: "puppeteer",
    };
  } catch (e) {
    if (page) await page.close().catch(() => {});
    logger.error(
      { component: "BrowserAgent", url, err: e.message },
      "Navigation failed",
    );
    // Fallback to fetch
    return await fetchFallback(url);
  }
}

/**
 * Click on element in existing page session
 */
async function click(sessionId, selector) {
  const page = activePagesMap.get(sessionId);
  if (!page)
    return { success: false, error: "Session expired. Navigate again." };

  try {
    await page.click(selector);
    await page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 })
      .catch(() => {});

    const title = await page.title();
    const content = await page.evaluate(() => {
      const clone = document.body.cloneNode(true);
      clone.querySelectorAll("script, style").forEach((el) => el.remove());
      return clone.innerText.substring(0, 3000);
    });
    const screenshot = await page.screenshot({
      encoding: "base64",
      type: "jpeg",
      quality: 60,
    });

    return {
      success: true,
      title,
      content,
      screenshot: `data:image/jpeg;base64,${screenshot}`,
      url: page.url(),
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Type text into input field
 */
async function type(sessionId, selector, text) {
  const page = activePagesMap.get(sessionId);
  if (!page) return { success: false, error: "Session expired" };

  try {
    await page.type(selector, text, { delay: 50 });
    return { success: true, typed: text, selector };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Submit a form
 */
async function submitForm(sessionId, formSelector, data = {}) {
  const page = activePagesMap.get(sessionId);
  if (!page) return { success: false, error: "Session expired" };

  try {
    // Fill fields
    for (const [name, value] of Object.entries(data)) {
      try {
        await page.type(`[name="${name}"]`, value, { delay: 30 });
      } catch {
        try {
          await page.type(`#${name}`, value, { delay: 30 });
        } catch { /* ignored */ }
      }
    }

    // Submit
    if (formSelector) {
      await page.click(`${formSelector} [type="submit"]`).catch(async () => {
        await page.keyboard.press("Enter");
      });
    } else {
      await page.keyboard.press("Enter");
    }

    await page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 10000 })
      .catch(() => {});

    const title = await page.title();
    const content = await page.evaluate(() =>
      document.body.innerText.substring(0, 3000),
    );
    const screenshot = await page.screenshot({
      encoding: "base64",
      type: "jpeg",
      quality: 60,
    });

    return {
      success: true,
      title,
      content,
      url: page.url(),
      screenshot: `data:image/jpeg;base64,${screenshot}`,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Take screenshot of current page
 */
async function screenshot(sessionId) {
  const page = activePagesMap.get(sessionId);
  if (!page) return { success: false, error: "Session expired" };

  try {
    const img = await page.screenshot({
      encoding: "base64",
      type: "jpeg",
      quality: 70,
      fullPage: true,
    });
    return {
      success: true,
      screenshot: `data:image/jpeg;base64,${img}`,
      url: page.url(),
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Extract structured data from page
 */
async function extract(sessionId, selectors = {}) {
  const page = activePagesMap.get(sessionId);
  if (!page) return { success: false, error: "Session expired" };

  try {
    const data = await page.evaluate((sels) => {
      const result = {};
      for (const [key, selector] of Object.entries(sels)) {
        const el = document.querySelector(selector);
        result[key] = el ? el.innerText.trim() : null;
      }
      return result;
    }, selectors);

    return { success: true, data };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ═══ FETCH FALLBACK (when Puppeteer not available) ═══
async function fetchFallback(url) {
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();

    // Basic HTML to text extraction
    const textContent = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .substring(0, 3000);

    // Extract title
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].trim() : url;

    // Extract links
    const linkRegex = /<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([^<]*)<\/a>/gi;
    const links = [];
    let match;
    while ((match = linkRegex.exec(html)) && links.length < 15) {
      if (match[2].trim())
        links.push({ href: match[1], text: match[2].trim().substring(0, 80) });
    }

    return {
      success: true,
      sessionId: null,
      url,
      title,
      content: textContent,
      screenshot: null,
      links,
      forms: [],
      engine: "fetch-fallback",
    };
  } catch (e) {
    return { success: false, error: e.message, engine: "fetch-fallback" };
  }
}

// ═══ CLEANUP ═══
function cleanup() {
  for (const [id, page] of activePagesMap.entries()) {
    page.close().catch(() => {});
    activePagesMap.delete(id);
  }
  closeBrowser();
}

module.exports = {
  navigate,
  click,
  type,
  submitForm,
  screenshot,
  extract,
  cleanup,
  fetchFallback,
  isFullMode: () => !!puppeteer,
};
