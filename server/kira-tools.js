'use strict';

/**
 * KIRA TOOLS — Advanced capabilities module
 *
 * 3 new tools that close the gap with IDE-level AI agents:
 * 1. JS Sandbox — Execute JavaScript code safely (vm module)
 * 2. Web Scraper — Fetch and extract text from any URL
 * 3. File Workspace — Read/write files in a sandboxed temp directory
 */

const vm = require('vm');
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');
const logger = require('./logger');

// ═══════════════════════════════════════════════════════════════
// 1. JS SANDBOX — Safe code execution with Node's vm module
// ═══════════════════════════════════════════════════════════════

const SANDBOX_TIMEOUT_MS = 5000; // 5 second max execution
const SANDBOX_MAX_OUTPUT = 5000; // 5000 chars max output

/**
 * executeJS
 * @param {*} code
 * @returns {*}
 */
function executeJS(code) {
  const startTime = Date.now();
  const output = [];

  // Create sandboxed context with safe globals
  const sandbox = {
    console: {
      log: (...args) =>
        output.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' ')),
      error: (...args) => output.push('[ERROR] ' + args.map(String).join(' ')),
      warn: (...args) => output.push('[WARN] ' + args.map(String).join(' ')),
      info: (...args) =>
        output.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a, null, 2) : String(a))).join(' ')),
    },
    Math,
    Date,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    JSON,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Map,
    Set,
    RegExp,
    Error,
    Promise,
    setTimeout: (fn, ms) => {
      if (ms > 2000) ms = 2000; // Cap timers
      return setTimeout(fn, ms);
    },
    // Explicitly blocked
    require: undefined,
    process: undefined,
    __dirname: undefined,
    __filename: undefined,
    global: undefined,
    globalThis: undefined,
    fetch: undefined,
    eval: undefined,
    Function: undefined,
  };

  try {
    const context = vm.createContext(sandbox);
    const script = new vm.Script(code, { timeout: SANDBOX_TIMEOUT_MS });
    const result = script.runInContext(context, {
      timeout: SANDBOX_TIMEOUT_MS,
    });

    // Capture return value if no console output
    if (output.length === 0 && result !== undefined) {
      output.push(typeof result === 'object' ? JSON.stringify(result, null, 2) : String(result));
    }

    const elapsed = Date.now() - startTime;
    const outputStr = output.join('\n').slice(0, SANDBOX_MAX_OUTPUT);

    logger.info({ component: 'KiraTools', elapsed, outputLen: outputStr.length }, 'JS sandbox executed');

    return {
      success: true,
      output: outputStr || '(no output)',
      elapsed: `${elapsed}ms`,
      linesExecuted: code.split('\n').length,
    };
  } catch (e) {
    const elapsed = Date.now() - startTime;
    const isTimeout = e.message?.includes('timed out') || e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT';

    logger.warn({ component: 'KiraTools', err: e.message, elapsed }, 'JS sandbox error');

    return {
      success: false,
      error: isTimeout ? `⏱️ Timeout: codul a depășit ${SANDBOX_TIMEOUT_MS / 1000}s` : e.message,
      output: output.join('\n').slice(0, SANDBOX_MAX_OUTPUT) || null,
      elapsed: `${elapsed}ms`,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// 2. WEB SCRAPER — Fetch URL content as clean text
// ═══════════════════════════════════════════════════════════════

const SCRAPE_TIMEOUT_MS = 10000;
const SCRAPE_MAX_CONTENT = 8000; // 8000 chars max

/**
 * scrapeUrl
 * @param {*} url
 * @returns {*}
 */
async function scrapeUrl(url) {
  if (!url) return { success: false, error: 'No URL provided' };

  // Validate URL
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { success: false, error: 'Only HTTP/HTTPS URLs are supported' };
    }
    // Block internal/private IPs
    const host = parsed.hostname;
    if (
      host === 'localhost' ||
      host === process.env.HOST_IP ||
      process.env.HOST_IP ||
      process.env.HOST_IP ||
      process.env.HOST_IP ||
      process.env.HOST_IP ||
      process.env.HOST_IP ||
      process.env.HOST_IP ||
      process.env.HOST_IP ||
      process.env.HOST_IP ||
      process.env.HOST_IP ||
      '127.0.0.1' ||
      host.startsWith('192.168.') ||
      host.startsWith('10.') ||
      host.startsWith('172.')
    ) {
      return { success: false, error: 'Cannot access internal/private URLs' };
    }
  } catch {
    return { success: false, error: 'Invalid URL format' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

    const res = await fetch(url, {
      headers: {
        'User-Agent': `KelionAI/2.5 (Web Scraper; +${process.env.APP_URL || 'https://kelionai.app'})`,
        Accept: 'text/html,application/xhtml+xml,text/plain,application/json',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!res.ok) {
      return {
        success: false,
        error: `HTTP ${res.status}: ${res.statusText}`,
        url,
      };
    }

    const contentType = res.headers.get('content-type') || '';
    const raw = await res.text();

    let content;
    if (contentType.includes('application/json')) {
      // JSON — pretty print
      try {
        content = JSON.stringify(JSON.parse(raw), null, 2);
      } catch {
        content = raw;
      }
    } else if (contentType.includes('text/html')) {
      // HTML → extract text
      content = htmlToText(raw);
    } else {
      // Plain text or other
      content = raw;
    }

    // Trim to max
    const trimmed = content.slice(0, SCRAPE_MAX_CONTENT);
    const wasTrimmed = content.length > SCRAPE_MAX_CONTENT;

    logger.info({ component: 'KiraTools', url, contentLen: trimmed.length }, 'URL scraped');

    return {
      success: true,
      url,
      title: extractTitle(raw),
      content: trimmed,
      contentLength: content.length,
      wasTrimmed,
      contentType: contentType.split(';')[0],
    };
  } catch (e) {
    const isAbort = e.name === 'AbortError';
    logger.warn({ component: 'KiraTools', url, err: e.message }, 'Scrape error');
    return {
      success: false,
      error: isAbort ? `Timeout: pagina nu a răspuns în ${SCRAPE_TIMEOUT_MS / 1000}s` : e.message,
      url,
    };
  }
}

/**
 * Basic HTML to text converter (no dependencies)
 */
function htmlToText(html) {
  // Remove script, style, nav, footer, header
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, '');

  // Convert common elements
  text = text
    .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, '\n## $1\n')
    .replace(/<p[^>]*>(.*?)<\/p>/gi, '\n$1\n')
    .replace(/<li[^>]*>(.*?)<\/li>/gi, '• $1\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .replace(/  +/g, ' ')
    .trim();

  return text;
}

/**
 * extractTitle
 * @param {*} html
 * @returns {*}
 */
function extractTitle(html) {
  const match = html.match(/<title[^>]*>(.*?)<\/title>/i);
  return match ? match[1].replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim() : null;
}

// ═══════════════════════════════════════════════════════════════
// 3. FILE WORKSPACE — Sandboxed file operations in temp directory
// ═══════════════════════════════════════════════════════════════

const WORKSPACE_DIR = path.join(require('os').tmpdir(), 'kira-workspace');
const MAX_FILE_SIZE = 50000; // 50KB max per file
const MAX_FILES = 20;

// Ensure workspace exists
if (!fs.existsSync(WORKSPACE_DIR)) {
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

/**
 * sanitizePath
 * @param {*} filename
 * @returns {*}
 */
function sanitizePath(filename) {
  // Prevent directory traversal
  const clean = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(WORKSPACE_DIR, clean);
}

/**
 * writeFile
 * @param {*} filename
 * @param {*} content
 * @returns {*}
 */
function writeFile(filename, content) {
  try {
    const filePath = sanitizePath(filename);

    // Check limits
    if (content.length > MAX_FILE_SIZE) {
      return {
        success: false,
        error: `File too large: ${content.length} chars (max ${MAX_FILE_SIZE})`,
      };
    }

    const existing = fs.readdirSync(WORKSPACE_DIR);
    if (existing.length >= MAX_FILES && !existing.includes(path.basename(filePath))) {
      return {
        success: false,
        error: `Workspace full: max ${MAX_FILES} files`,
      };
    }

    fs.writeFileSync(filePath, content, 'utf8');

    logger.info(
      {
        component: 'KiraTools',
        file: path.basename(filePath),
        size: content.length,
      },
      'File written'
    );

    return {
      success: true,
      file: path.basename(filePath),
      path: filePath,
      size: content.length,
      action: 'created',
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * readFile
 * @param {*} filename
 * @returns {*}
 */
function readFile(filename) {
  try {
    const filePath = sanitizePath(filename);

    if (!fs.existsSync(filePath)) {
      return { success: false, error: `File not found: ${filename}` };
    }

    const content = fs.readFileSync(filePath, 'utf8');
    return {
      success: true,
      file: path.basename(filePath),
      content: content.slice(0, MAX_FILE_SIZE),
      size: content.length,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * listFiles
 * @returns {*}
 */
function listFiles() {
  try {
    const files = fs.readdirSync(WORKSPACE_DIR).map((f) => {
      const stat = fs.statSync(path.join(WORKSPACE_DIR, f));
      return { name: f, size: stat.size, modified: stat.mtime.toISOString() };
    });
    return {
      success: true,
      files,
      count: files.length,
      workspace: WORKSPACE_DIR,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * deleteFile
 * @param {*} filename
 * @returns {*}
 */
function deleteFile(filename) {
  try {
    const filePath = sanitizePath(filename);
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `File not found: ${filename}` };
    }
    fs.unlinkSync(filePath);
    return { success: true, file: filename, action: 'deleted' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// 4. DEEP BROWSE — Enhanced web browsing with link extraction
// ═══════════════════════════════════════════════════════════════

/**
 * Browse a URL deeply: extract content, links, meta, structured data
 * Equivalent to "real browsing" — fetches page, extracts everything useful
 */
async function deepBrowse(url, options = {}) {
  if (!url) return { success: false, error: 'No URL provided' };

  // Validate URL
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { success: false, error: 'Only HTTP/HTTPS URLs' };
    }
    if (
      [
        'localhost',
        process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          process.env.HOST_IP ||
          '127.0.0.1',
      ].includes(parsed.hostname) ||
      parsed.hostname.startsWith('192.168.') ||
      parsed.hostname.startsWith('10.')
    ) {
      return { success: false, error: 'Cannot access internal URLs' };
    }
  } catch {
    return { success: false, error: 'Invalid URL' };
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5,ro;q=0.3',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!res.ok) return { success: false, error: `HTTP ${res.status}`, url };

    const html = await res.text();
    const contentType = res.headers.get('content-type') || '';

    // Extract everything useful
    const result = {
      success: true,
      url: res.url, // actual URL after redirects
      status: res.status,
      contentType: contentType.split(';')[0],
      title: extractTitle(html),
      meta: extractMeta(html),
      content: htmlToText(html).slice(0, options.maxContent || 10000),
      links: extractLinks(html, res.url).slice(0, 30),
      headings: extractHeadings(html),
      images: extractImages(html, res.url).slice(0, 15),
    };

    logger.info(
      {
        component: 'KiraTools',
        url: res.url,
        contentLen: result.content.length,
        links: result.links.length,
      },
      'Deep browse complete'
    );
    return result;
  } catch (e) {
    return {
      success: false,
      error: e.name === 'AbortError' ? "Timeout: page didn't respond in 12s" : e.message,
      url,
    };
  }
}

/**
 * Browse multiple URLs in parallel
 */
async function browseMultiple(urls, options = {}) {
  if (!urls || urls.length === 0) return { success: false, error: 'No URLs provided' };
  const maxUrls = Math.min(urls.length, 5); // Max 5 parallel
  const results = await Promise.allSettled(urls.slice(0, maxUrls).map((u) => deepBrowse(u, options)));
  return {
    success: true,
    pages: results.map((r, i) => ({
      url: urls[i],
      ...(r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message }),
    })),
    count: results.filter((r) => r.status === 'fulfilled' && r.value?.success).length,
  };
}

// Browse helpers
function extractMeta(html) {
  const meta = {};
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i);
  if (descMatch) meta.description = descMatch[1];
  const kwMatch = html.match(/<meta[^>]*name=["']keywords["'][^>]*content=["']([^"']*)["']/i);
  if (kwMatch) meta.keywords = kwMatch[1];
  const ogTitle = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']*)["']/i);
  if (ogTitle) meta.ogTitle = ogTitle[1];
  const ogDesc = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']*)["']/i);
  if (ogDesc) meta.ogDescription = ogDesc[1];
  const ogImage = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']*)["']/i);
  if (ogImage) meta.ogImage = ogImage[1];
  return meta;
}

/**
 * extractLinks
 * @param {*} html
 * @param {*} baseUrl
 * @returns {*}
 */
function extractLinks(html, baseUrl) {
  const links = [];
  const re = /<a[^>]*href=["']([^"'#]+)["'][^>]*>(.*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && links.length < 50) {
    let href = m[1].trim();
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    if (!text || text.length < 2) continue;
    if (href.startsWith('/')) {
      try {
        href = new URL(href, baseUrl).href;
      } catch {
        continue;
      }
    }
    if (href.startsWith('http')) {
      links.push({ text: text.slice(0, 100), href });
    }
  }
  return links;
}

/**
 * extractHeadings
 * @param {*} html
 * @returns {*}
 */
function extractHeadings(html) {
  const headings = [];
  const re = /<h([1-6])[^>]*>(.*?)<\/h\1>/gi;
  let m;
  while ((m = re.exec(html)) && headings.length < 20) {
    const text = m[2].replace(/<[^>]+>/g, '').trim();
    if (text.length > 2) headings.push({ level: parseInt(m[1]), text: text.slice(0, 100) });
  }
  return headings;
}

/**
 * extractImages
 * @param {*} html
 * @param {*} baseUrl
 * @returns {*}
 */
function extractImages(html, baseUrl) {
  const images = [];
  const re = /<img[^>]*src=["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html)) && images.length < 20) {
    let src = m[1];
    if (src.startsWith('/')) {
      try {
        src = new URL(src, baseUrl).href;
      } catch {
        continue;
      }
    }
    if (src.startsWith('http')) {
      const alt = (m[0].match(/alt=["']([^"']*)["']/i) || [])[1] || '';
      images.push({ src, alt: alt.slice(0, 80) });
    }
  }
  return images;
}

// ═══════════════════════════════════════════════════════════════
// 5. ADMIN TERMINAL — Restricted shell for admin users only
// ═══════════════════════════════════════════════════════════════

const { execSync } = require('child_process');

const TERMINAL_TIMEOUT_MS = 5000;
const TERMINAL_MAX_OUTPUT = 10000;

// Strict whitelist of allowed commands
const ALLOWED_COMMANDS = [
  'node',
  'npm',
  'ls',
  'dir',
  'cat',
  'type',
  'echo',
  'date',
  'uptime',
  'whoami',
  'hostname',
  'pwd',
  'git',
  'env',
  'df',
  'free',
  'ps',
  'head',
  'tail',
  'wc',
  'grep',
  'find',
  'curl',
  'wget',
];

// Blocked patterns (even in args)
const BLOCKED_PATTERNS = [
  /rm\s+-rf/i,
  /del\s+\/[sfq]/i,
  /format\s+/i,
  /mkfs/i,
  /dd\s+if/i,
  />\s*\/dev/i,
  /shutdown/i,
  /reboot/i,
  /halt/i,
  /passwd/i,
  /useradd/i,
  /userdel/i,
  /chmod\s+777/i,
  /chown/i,
  /kill\s+-9/i,
  /killall/i,
  /&&\s*(rm|del|format|shutdown)/i,
  /\|\s*(rm|del|format)/i,
  /eval\s*\(/i,
  /exec\s*\(/i,
  /DROP\s+TABLE/i,
  /DELETE\s+FROM/i,
  /TRUNCATE/i,
  />\s*\/etc/i,
  />\s*\/usr/i,
  />\s*\/bin/i,
];

/**
 * adminTerminal
 * @param {*} command
 * @returns {*}
 */
function adminTerminal(command) {
  if (!command || typeof command !== 'string') {
    return { success: false, error: 'No command provided' };
  }

  const cmd = command.trim();
  if (cmd.length > 500) {
    return { success: false, error: 'Command too long (max 500 chars)' };
  }

  // Extract base command
  const baseCmd = cmd
    .split(/\s+/)[0]
    .toLowerCase()
    .replace(/\.exe$/i, '');

  // Check whitelist
  if (!ALLOWED_COMMANDS.includes(baseCmd)) {
    return {
      success: false,
      error: `Command '${baseCmd}' not allowed. Allowed: ${ALLOWED_COMMANDS.join(', ')}`,
      blocked: true,
    };
  }

  // Check for dangerous patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(cmd)) {
      return {
        success: false,
        error: `Dangerous pattern detected in command`,
        blocked: true,
      };
    }
  }

  try {
    const output = execSync(cmd, {
      timeout: TERMINAL_TIMEOUT_MS,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024, // 1MB
      cwd: process.cwd(),
      env: { ...process.env, TERM: 'dumb' },
    });

    const trimmed = (output || '').slice(0, TERMINAL_MAX_OUTPUT);
    const wasTrimmed = (output || '').length > TERMINAL_MAX_OUTPUT;

    logger.info({ component: 'KiraTools', cmd: baseCmd, outputLen: trimmed.length }, 'Terminal command executed');

    return {
      success: true,
      command: cmd,
      output: trimmed || '(no output)',
      wasTrimmed,
      exitCode: 0,
    };
  } catch (e) {
    const isTimeout = e.killed || e.signal === 'SIGTERM';
    const stderr = (e.stderr || '').slice(0, 2000);
    const stdout = (e.stdout || '').slice(0, 2000);

    return {
      success: false,
      command: cmd,
      error: isTimeout ? `Timeout: command exceeded ${TERMINAL_TIMEOUT_MS / 1000}s` : stderr || e.message,
      output: stdout || null,
      exitCode: e.status || 1,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// 6. GIT OPERATIONS — Git status, log, diff (admin-only)
// ═══════════════════════════════════════════════════════════════

/**
 * gitStatus
 * @returns {*}
 */
function gitStatus() {
  return adminTerminal('git status --short');
}

/**
 * gitLog
 * @param {*} n
 * @returns {*}
 */
function gitLog(n = 15) {
  return adminTerminal(`git log --oneline -${Math.min(n, 50)}`);
}

/**
 * gitDiff
 * @returns {*}
 */
function gitDiff() {
  return adminTerminal('git diff --stat');
}

// ═══════════════════════════════════════════════════════════════
// 7. PROJECT SEARCH — grep + find + tree (admin-only)
// ═══════════════════════════════════════════════════════════════

/**
 * projectSearch
 * @param {*} query
 * @param {*} searchPath
 * @returns {*}
 */
function projectSearch(query, searchPath) {
  if (!query) return { success: false, error: 'No query provided' };
  const safePath = (searchPath || '.').replace(/[;&|`$]/g, '');
  const safeQuery = query.replace(/[;&`$"]/g, '').slice(0, 200);
  // Pipe | is allowed for grep OR patterns (ex:
  return adminTerminal(
    `grep -rn -E --include="*.js" --include="*.html" --include="*.css" --include="*.json" --include="*.md" "${safeQuery}" ${safePath} | head -30`
  );
}

/**
 * projectTree
 * @param {*} dirPath
 * @param {*} depth
 * @returns {*}
 */
function projectTree(dirPath, depth) {
  const safePath = (dirPath || '.').replace(/[;&|`$]/g, '');
  const d = Math.min(depth || 3, 5);
  return adminTerminal(
    `find ${safePath} -maxdepth ${d} -not -path "*/node_modules/*" -not -path "*/.git/*" | head -60`
  );
}

// ═══════════════════════════════════════════════════════════════
// 8. PROJECT FILE READER — Read any project file (admin-only)
// ═══════════════════════════════════════════════════════════════

const PROJECT_READ_MAX = 100000; // 100KB max
const BLOCKED_FILE_PATTERNS = []; // K1 has TOTAL access per Adrian's orders

/**
 * readProjectFile
 * @param {*} filePath
 * @returns {*}
 */
function readProjectFile(filePath) {
  if (!filePath) return { success: false, error: 'No filePath provided' };

  // Security: block sensitive files
  for (const pattern of BLOCKED_FILE_PATTERNS) {
    if (pattern.test(filePath)) {
      return {
        success: false,
        error: `Blocked: cannot read ${filePath} (security)`,
      };
    }
  }

  try {
    const resolved = path.resolve(filePath);
    if (!fs.existsSync(resolved)) return { success: false, error: `File not found: ${filePath}` };

    const stat = fs.statSync(resolved);
    if (stat.isDirectory()) return { success: false, error: 'Path is a directory, not a file' };
    if (stat.size > PROJECT_READ_MAX)
      return {
        success: false,
        error: `File too large: ${stat.size} bytes (max ${PROJECT_READ_MAX})`,
      };

    const content = fs.readFileSync(resolved, 'utf8');
    const lines = content.split('\n');

    return {
      success: true,
      file: path.basename(resolved),
      path: resolved,
      content: content.slice(0, PROJECT_READ_MAX),
      lines: lines.length,
      size: stat.size,
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════
// 9. TEST RUNNER — Run Jest/Playwright tests (admin-only)
// ═══════════════════════════════════════════════════════════════

/**
 * runTests
 * @param {*} suite
 * @returns {*}
 */
function runTests(suite) {
  const cmd =
    suite === 'e2e'
      ? 'npm run test:e2e 2>&1 | tail -40'
      : suite === 'unit'
        ? 'npm run test:unit 2>&1 | tail -40'
        : 'npm test 2>&1 | tail -40';

  try {
    const output = execSync(cmd, {
      timeout: 30000,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      cwd: process.cwd(),
    });
    return {
      success: true,
      suite: suite || 'default',
      output: (output || '').slice(0, 20000),
    };
  } catch (e) {
    return {
      success: false,
      suite: suite || 'default',
      error: e.message,
      output: ((e.stdout || '') + '\n' + (e.stderr || '')).slice(0, 20000),
      exitCode: e.status || 1,
    };
  }
}

// ═══════════════════════════════════════════════════════════════
// 10. PUPPETEER RENDER — Headless Chrome page rendering
// ═══════════════════════════════════════════════════════════════

let _browser = null;

/**
 * renderPage
 * @param {*} url
 * @param {*} options
 * @returns {*}
 */
async function renderPage(url, options = {}) {
  if (!url) return { success: false, error: 'No URL provided' };

  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { success: false, error: 'Only HTTP/HTTPS URLs' };
    }
  } catch {
    return { success: false, error: 'Invalid URL' };
  }

  let puppeteer;
  try {
    puppeteer = require('puppeteer');
  } catch {
    // Fallback: Puppeteer not installed, use deepBrowse
    logger.warn({ component: 'KiraTools' }, 'Puppeteer not installed, falling back to deepBrowse');
    return deepBrowse(url, options);
  }

  try {
    if (!_browser) {
      _browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
        timeout: 15000,
      });
    }

    const page = await _browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
    );

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });

    // Extract content after JS rendering
    const result = await page.evaluate(() => {
      const title = document.title;
      const text = document.body?.innerText?.slice(0, 15000) || '';
      const links = [...document.querySelectorAll('a[href]')].slice(0, 20).map((a) => ({
        text: a.textContent?.trim()?.slice(0, 80),
        href: a.href,
      }));
      const headings = [...document.querySelectorAll('h1,h2,h3')].slice(0, 15).map((h) => ({
        level: parseInt(h.tagName[1]),
        text: h.textContent?.trim()?.slice(0, 100),
      }));
      const metaDesc = document.querySelector('meta[name="description"]')?.content || '';
      return { title, text, links, headings, metaDesc };
    });

    // Optional screenshot
    let screenshot = null;
    if (options.screenshot) {
      const buf = await page.screenshot({
        type: 'jpeg',
        quality: 60,
        fullPage: false,
      });
      screenshot = buf.toString('base64').slice(0, 200000); // max 200KB base64
    }

    await page.close();

    logger.info({ component: 'KiraTools', url, contentLen: result.text.length }, 'Puppeteer page rendered');

    return {
      success: true,
      url,
      title: result.title,
      content: result.text,
      links: result.links,
      headings: result.headings,
      meta: { description: result.metaDesc },
      screenshot,
      engine: 'puppeteer',
    };
  } catch (e) {
    logger.warn({ component: 'KiraTools', url, err: e.message }, 'Puppeteer render failed, falling back to deepBrowse');
    // Fallback to fetch-based
    return deepBrowse(url, options);
  }
}

// ═══════════════════════════════════════════════════════════════
// 11. FULL ARTICLE SCRAPER — Extract full article text from URL
// ═══════════════════════════════════════════════════════════════

/**
 * scrapeFullArticle
 * @param {*} url
 * @returns {*}
 */
async function scrapeFullArticle(url) {
  if (!url) return { success: false, error: 'No URL' };

  try {
    const result = await scrapeUrl(url);
    if (!result.success) return result;

    // Return with larger content limit for full articles
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(url, {
      headers: {
        'User-Agent': `Mozilla/5.0 (compatible; KelionAI/2.5; +${process.env.APP_URL || 'https://kelionai.app'})`,
        Accept: 'text/html',
      },
      signal: controller.signal,
      redirect: 'follow',
    });
    clearTimeout(timeout);

    if (!res.ok) return { success: false, error: `HTTP ${res.status}`, url };

    const html = await res.text();

    // Extract article body (look for <article> tag, or main content area)
    let articleText = '';
    const articleMatch = html.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
    if (articleMatch) {
      articleText = htmlToText(articleMatch[1]);
    } else {
      // Fallback: remove nav/sidebar/footer and use main content
      articleText = htmlToText(html);
    }

    return {
      success: true,
      url,
      title: (html.match(/<title[^>]*>([^<]*)<\/title>/i) || [])[1] || '',
      content: articleText.slice(0, 15000), // 15KB for full articles
      charCount: articleText.length,
    };
  } catch (e) {
    return { success: false, error: e.message, url };
  }
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

/**
 * undefined
 * @returns {*}
 */
module.exports = {
  // JS Sandbox
  executeJS,

  // Web Scraper
  scrapeUrl,
  scrapeFullArticle,
  htmlToText,

  // Deep Browse
  deepBrowse,
  browseMultiple,

  // Puppeteer Render
  renderPage,

  // File Workspace
  writeFile,
  readFile,
  listFiles,
  deleteFile,

  // Project File Reader
  readProjectFile,

  // Admin Terminal
  adminTerminal,
  ALLOWED_COMMANDS,

  // Git Operations
  gitStatus,
  gitLog,
  gitDiff,

  // Project Search
  projectSearch,
  projectTree,

  // Test Runner
  runTests,

  // Constants
  WORKSPACE_DIR,
  SANDBOX_TIMEOUT_MS,
  SCRAPE_MAX_CONTENT,
};
