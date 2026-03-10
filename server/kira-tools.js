"use strict";

/**
 * KIRA TOOLS — Advanced capabilities module
 * 
 * 3 new tools that close the gap with IDE-level AI agents:
 * 1. JS Sandbox — Execute JavaScript code safely (vm module)
 * 2. Web Scraper — Fetch and extract text from any URL
 * 3. File Workspace — Read/write files in a sandboxed temp directory
 */

const vm = require("vm");
const fs = require("fs");
const path = require("path");
const fetch = require("node-fetch");
const logger = require("./logger");

// ═══════════════════════════════════════════════════════════════
// 1. JS SANDBOX — Safe code execution with Node's vm module
// ═══════════════════════════════════════════════════════════════

const SANDBOX_TIMEOUT_MS = 5000;  // 5 second max execution
const SANDBOX_MAX_OUTPUT = 5000;  // 5000 chars max output

function executeJS(code) {
    const startTime = Date.now();
    const output = [];

    // Create sandboxed context with safe globals
    const sandbox = {
        console: {
            log: (...args) => output.push(args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ")),
            error: (...args) => output.push("[ERROR] " + args.map(String).join(" ")),
            warn: (...args) => output.push("[WARN] " + args.map(String).join(" ")),
            info: (...args) => output.push(args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ")),
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
        const result = script.runInContext(context, { timeout: SANDBOX_TIMEOUT_MS });

        // Capture return value if no console output
        if (output.length === 0 && result !== undefined) {
            output.push(typeof result === "object" ? JSON.stringify(result, null, 2) : String(result));
        }

        const elapsed = Date.now() - startTime;
        const outputStr = output.join("\n").slice(0, SANDBOX_MAX_OUTPUT);

        logger.info({ component: "KiraTools", elapsed, outputLen: outputStr.length }, "JS sandbox executed");

        return {
            success: true,
            output: outputStr || "(no output)",
            elapsed: `${elapsed}ms`,
            linesExecuted: code.split("\n").length,
        };
    } catch (e) {
        const elapsed = Date.now() - startTime;
        const isTimeout = e.message?.includes("timed out") || e.code === "ERR_SCRIPT_EXECUTION_TIMEOUT";

        logger.warn({ component: "KiraTools", err: e.message, elapsed }, "JS sandbox error");

        return {
            success: false,
            error: isTimeout ? `⏱️ Timeout: codul a depășit ${SANDBOX_TIMEOUT_MS / 1000}s` : e.message,
            output: output.join("\n").slice(0, SANDBOX_MAX_OUTPUT) || null,
            elapsed: `${elapsed}ms`,
        };
    }
}

// ═══════════════════════════════════════════════════════════════
// 2. WEB SCRAPER — Fetch URL content as clean text
// ═══════════════════════════════════════════════════════════════

const SCRAPE_TIMEOUT_MS = 10000;
const SCRAPE_MAX_CONTENT = 8000; // 8000 chars max

async function scrapeUrl(url) {
    if (!url) return { success: false, error: "No URL provided" };

    // Validate URL
    try {
        const parsed = new URL(url);
        if (!["http:", "https:"].includes(parsed.protocol)) {
            return { success: false, error: "Only HTTP/HTTPS URLs are supported" };
        }
        // Block internal/private IPs
        const host = parsed.hostname;
        if (host === "localhost" || host === "127.0.0.1" || host.startsWith("192.168.") || host.startsWith("10.") || host.startsWith("172.")) {
            return { success: false, error: "Cannot access internal/private URLs" };
        }
    } catch {
        return { success: false, error: "Invalid URL format" };
    }

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), SCRAPE_TIMEOUT_MS);

        const res = await fetch(url, {
            headers: {
                "User-Agent": "KelionAI/2.5 (Web Scraper; +https://kelionai.app)",
                "Accept": "text/html,application/xhtml+xml,text/plain,application/json",
            },
            signal: controller.signal,
            redirect: "follow",
        });
        clearTimeout(timeout);

        if (!res.ok) {
            return { success: false, error: `HTTP ${res.status}: ${res.statusText}`, url };
        }

        const contentType = res.headers.get("content-type") || "";
        const raw = await res.text();

        let content;
        if (contentType.includes("application/json")) {
            // JSON — pretty print
            try {
                content = JSON.stringify(JSON.parse(raw), null, 2);
            } catch {
                content = raw;
            }
        } else if (contentType.includes("text/html")) {
            // HTML → extract text
            content = htmlToText(raw);
        } else {
            // Plain text or other
            content = raw;
        }

        // Trim to max
        const trimmed = content.slice(0, SCRAPE_MAX_CONTENT);
        const wasTrimmed = content.length > SCRAPE_MAX_CONTENT;

        logger.info({ component: "KiraTools", url, contentLen: trimmed.length }, "URL scraped");

        return {
            success: true,
            url,
            title: extractTitle(raw),
            content: trimmed,
            contentLength: content.length,
            wasTrimmed,
            contentType: contentType.split(";")[0],
        };
    } catch (e) {
        const isAbort = e.name === "AbortError";
        logger.warn({ component: "KiraTools", url, err: e.message }, "Scrape error");
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
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")
        .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "")
        .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, "");

    // Convert common elements
    text = text
        .replace(/<h[1-6][^>]*>(.*?)<\/h[1-6]>/gi, "\n## $1\n")
        .replace(/<p[^>]*>(.*?)<\/p>/gi, "\n$1\n")
        .replace(/<li[^>]*>(.*?)<\/li>/gi, "• $1\n")
        .replace(/<br\s*\/?>/gi, "\n")
        .replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, "$2 ($1)")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\n{3,}/g, "\n\n")
        .replace(/  +/g, " ")
        .trim();

    return text;
}

function extractTitle(html) {
    const match = html.match(/<title[^>]*>(.*?)<\/title>/i);
    return match ? match[1].replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim() : null;
}

// ═══════════════════════════════════════════════════════════════
// 3. FILE WORKSPACE — Sandboxed file operations in temp directory
// ═══════════════════════════════════════════════════════════════

const WORKSPACE_DIR = path.join(require("os").tmpdir(), "kira-workspace");
const MAX_FILE_SIZE = 50000; // 50KB max per file
const MAX_FILES = 20;

// Ensure workspace exists
if (!fs.existsSync(WORKSPACE_DIR)) {
    fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
}

function sanitizePath(filename) {
    // Prevent directory traversal
    const clean = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
    return path.join(WORKSPACE_DIR, clean);
}

function writeFile(filename, content) {
    try {
        const filePath = sanitizePath(filename);

        // Check limits
        if (content.length > MAX_FILE_SIZE) {
            return { success: false, error: `File too large: ${content.length} chars (max ${MAX_FILE_SIZE})` };
        }

        const existing = fs.readdirSync(WORKSPACE_DIR);
        if (existing.length >= MAX_FILES && !existing.includes(path.basename(filePath))) {
            return { success: false, error: `Workspace full: max ${MAX_FILES} files` };
        }

        fs.writeFileSync(filePath, content, "utf8");

        logger.info({ component: "KiraTools", file: path.basename(filePath), size: content.length }, "File written");

        return {
            success: true,
            file: path.basename(filePath),
            path: filePath,
            size: content.length,
            action: "created",
        };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function readFile(filename) {
    try {
        const filePath = sanitizePath(filename);

        if (!fs.existsSync(filePath)) {
            return { success: false, error: `File not found: ${filename}` };
        }

        const content = fs.readFileSync(filePath, "utf8");
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

function listFiles() {
    try {
        const files = fs.readdirSync(WORKSPACE_DIR).map(f => {
            const stat = fs.statSync(path.join(WORKSPACE_DIR, f));
            return { name: f, size: stat.size, modified: stat.mtime.toISOString() };
        });
        return { success: true, files, count: files.length, workspace: WORKSPACE_DIR };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

function deleteFile(filename) {
    try {
        const filePath = sanitizePath(filename);
        if (!fs.existsSync(filePath)) {
            return { success: false, error: `File not found: ${filename}` };
        }
        fs.unlinkSync(filePath);
        return { success: true, file: filename, action: "deleted" };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// ═══════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════

module.exports = {
    // JS Sandbox
    executeJS,

    // Web Scraper  
    scrapeUrl,
    htmlToText,

    // File Workspace
    writeFile,
    readFile,
    listFiles,
    deleteFile,

    // Constants
    WORKSPACE_DIR,
    SANDBOX_TIMEOUT_MS,
    SCRAPE_MAX_CONTENT,
};
