// ═══════════════════════════════════════════════════════════════
// KelionAI — BRAIN ENGINE v4.0
// GEMINI TOOL CALLING — No more 5-layer pipeline
// Gemini decides which tools to call, executes them, responds directly
// ═══════════════════════════════════════════════════════════════
"use strict";

const logger = require("./logger");
const { MODELS } = require("./config/models");
const { buildSystemPrompt, buildNewbornPrompt } = require("./persona");
const { getPatternsText, recordUserInteraction, getProactiveSuggestion } = require("./k1-meta-learning");
const { selfEvaluate, getQualityHints } = require("./k1-performance");
const vm = require("vm");

// ── Tool Definitions for Gemini (functionDeclarations format) ──
// Converter: transforms existing input_schema to Gemini parameters format
function toGeminiTools(defs) {
  return defs.map((d) => ({
    name: d.name,
    description: d.description,
    parameters: d.input_schema,
  }));
}

// ── Tool Definitions (shared format — converted at API call time) ──
const TOOL_DEFINITIONS = [
  {
    name: "show_in_monitor",
    description: "Display any HTML content (Leaflet map with markers, data table, chart, flight tracker, etc.) in the monitor panel. Use this to create rich visual displays. Generate the complete self-contained HTML with inline JS/CSS.",
    input_schema: {
      type: "object",
      properties: {
        html: { type: "string", description: "Complete self-contained HTML to display in monitor (with inline styles and scripts)" },
        title: { type: "string", description: "Optional title for the display" },
      },
      required: ["html"],
    },
  },
  {
    name: "recall_tool",
    description: "Search the shared tool registry (Supabase) for a tool that can handle a specific task. Always try this FIRST before searching the web for a new API.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Keywords describing the task (e.g. 'flight tracking', 'currency exchange', 'earthquake data')" },
      },
      required: ["query"],
    },
  },
  {
    name: "discover_and_save_tool",
    description: "When no existing tool can handle a task: search the web for a free public API, test it, and save it permanently to the shared tool registry so all users benefit. Use this when recall_tool returns nothing.",
    input_schema: {
      type: "object",
      properties: {
        task_description: { type: "string", description: "What the tool needs to do (e.g. 'get real-time flight positions')" },
        api_endpoint: { type: "string", description: "The discovered API endpoint URL" },
        method: { type: "string", enum: ["GET", "POST"], description: "HTTP method" },
        params_schema: { type: "object", description: "Parameters the tool accepts" },
        tool_name: { type: "string", description: "Short snake_case name for the tool" },
      },
      required: ["task_description", "api_endpoint", "tool_name"],
    },
  },
  {
    name: "call_saved_tool",
    description: "Execute a tool from the shared registry with specific parameters to get real live data.",
    input_schema: {
      type: "object",
      properties: {
        tool_name: { type: "string", description: "Name of the saved tool to call" },
        params: { type: "object", description: "Parameters to pass to the tool endpoint" },
      },
      required: ["tool_name"],
    },
  },
  {

    name: "search_web",
    description:
      "Search the internet for current, real-time information. Use for news, facts, prices, events, people, anything requiring up-to-date data.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The search query in the user's language",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "get_weather",
    description: "Get current weather and forecast for a city or GPS coordinates.",
    input_schema: {
      type: "object",
      properties: {
        city: {
          type: "string",
          description: "City name, e.g. 'București', 'London'",
        },
        lat: {
          type: "number",
          description: "Latitude (optional, for GPS-based weather)",
        },
        lon: {
          type: "number",
          description: "Longitude (optional, for GPS-based weather)",
        },
      },
      required: ["city"],
    },
  },
  {
    name: "generate_image",
    description: "Generate an image from a text description using AI (DALL-E).",
    input_schema: {
      type: "object",
      properties: {
        prompt: {
          type: "string",
          description:
            "Detailed description of the image to generate, in English",
        },
      },
      required: ["prompt"],
    },
  },
  {
    name: "play_radio",
    description:
      "Play a live radio station. Available: Kiss FM, Europa FM, Radio ZU, Digi FM, Magic FM, Rock FM, Pro FM, Virgin Radio, Gold FM, Radio Guerrilla, Romantic FM, BBC, CNN, Jazz FM, Classical, Chill, Lo-Fi, Dance, Electronica, Ambient.",
    input_schema: {
      type: "object",
      properties: {
        station: {
          type: "string",
          description:
            "Station name like 'Kiss FM', 'Europa FM', 'Jazz FM', 'Lo-fi'",
        },
      },
      required: ["station"],
    },
  },
  {
    name: "play_video",
    description:
      "Search and play a video (YouTube, Netflix, etc.) on the user's screen.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "What to search for, e.g. 'relaxing music', 'cat videos'",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "open_website",
    description: "Open a website or web page on the user's screen/monitor.",
    input_schema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Full URL or search term to navigate to",
        },
      },
      required: ["url"],
    },
  },
  {
    name: "get_news",
    description: "Get latest news articles, optionally filtered by topic.",
    input_schema: {
      type: "object",
      properties: {
        topic: {
          type: "string",
          description:
            "News topic: 'general', 'tech', 'business', 'sports', 'science', 'health'",
        },
      },
      required: ["topic"],
    },
  },
  {
    name: "check_system_health",
    description:
      "Check the health status of all KelionAI systems, APIs, and services.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "show_map",
    description: "Show a location or navigation route on Google Maps. For navigation, provide origin and destination. For a simple location, provide just place.",
    input_schema: {
      type: "object",
      properties: {
        place: { type: "string", description: "Place name or address (for showing a location)" },
        origin: { type: "string", description: "Starting point for navigation (e.g. 'my location', 'Constanta')" },
        destination: { type: "string", description: "Destination for navigation (e.g. 'Bucharest')" },
        mode: { type: "string", enum: ["driving", "walking", "bicycling", "transit"], description: "Travel mode (default: driving)" },
      },
      required: [],
    },
  },
  {
    name: "recall_memory",
    description:
      "Recall what you remember about the user from past conversations.",
    input_schema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "car_diagnostic",
    description: "Vehicle OBD-II diagnostic tool. Read trouble codes, check engine status, view live data from the car's computer.",
    input_schema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["read_codes", "clear_codes", "live_data", "vehicle_info", "emissions_check"], description: "Diagnostic action" },
        vehicle: { type: "string", description: "Vehicle make/model/year" },
      },
      required: ["action"],
    },
  },
  {
    name: "financial_calculator",
    description: "Financial calculator: loan payments, interest, ROI, currency conversion, tax estimation, savings projections.",
    input_schema: {
      type: "object",
      properties: {
        calculation: { type: "string", enum: ["loan", "interest", "roi", "currency", "tax", "savings", "mortgage"], description: "Type of calculation" },
        params: { type: "object", description: "Calculation parameters (amount, rate, period, currency, etc.)" },
      },
      required: ["calculation"],
    },
  },
  // ═══ GMAIL API (REAL EMAIL) ═════════════════════════════════
  {
    name: "list_emails",
    description: "List recent emails from user's Gmail inbox. Shows sender, subject, date, and preview. Requires Gmail OAuth2 connection.",
    input_schema: {
      type: "object",
      properties: {
        maxResults: { type: "number", description: "Number of emails to list (default 10, max 20)" },
        query: { type: "string", description: "Gmail search query (e.g. 'from:boss@company.com', 'is:unread', 'subject:invoice')" },
      },
      required: [],
    },
  },
  {
    name: "read_email",
    description: "Read the full content of a specific email by its ID. Returns full body, attachments info, and headers.",
    input_schema: {
      type: "object",
      properties: {
        emailId: { type: "string", description: "Gmail message ID (from list_emails)" },
      },
      required: ["emailId"],
    },
  },
  {
    name: "draft_reply",
    description: "Create a draft reply to an email. The AI composes the reply based on context, but it is NOT sent automatically — saved as draft for user review.",
    input_schema: {
      type: "object",
      properties: {
        emailId: { type: "string", description: "ID of email to reply to" },
        body: { type: "string", description: "Reply body text" },
        tone: { type: "string", enum: ["formal", "friendly", "professional", "brief"], description: "Tone of the reply" },
      },
      required: ["emailId", "body"],
    },
  },
  {
    name: "send_email",
    description: "Send an email via Gmail. Requires explicit user confirmation before sending. The email is first shown to user for approval.",
    input_schema: {
      type: "object",
      properties: {
        to: { type: "string", description: "Recipient email address" },
        subject: { type: "string", description: "Email subject" },
        body: { type: "string", description: "Email body (plain text or HTML)" },
        replyToId: { type: "string", description: "If replying, the original email ID" },
      },
      required: ["to", "subject", "body"],
    },
  },
  // ═══ SELF-INTROSPECTION TOOLS ═══════════════════════════════
  {
    name: "read_own_source",
    description: "Read your own source code files. Use this when the user asks you to analyze, explain, or improve your own code. You can read server files, client JS, HTML, CSS. Returns file content (max 500 lines).",
    input_schema: {
      type: "object",
      properties: {
        filepath: {
          type: "string",
          description: "Relative path from project root, e.g. 'server/brain-v5.js', 'app/js/avatar.js', 'app/index.html', 'server/routes/translate.js'",
        },
        startLine: { type: "number", description: "Optional start line (1-indexed)" },
        endLine: { type: "number", description: "Optional end line (1-indexed, max 500 lines range)" },
      },
      required: ["filepath"],
    },
  },
  {
    name: "propose_code_edit",
    description: "Propose a code edit to your own source. The edit is NOT applied automatically — it's saved as a proposal for the admin to review and approve. Use this when the user asks you to fix a bug, add a feature, or improve your own code.",
    input_schema: {
      type: "object",
      properties: {
        filepath: { type: "string", description: "File to edit (relative path)" },
        description: { type: "string", description: "What this edit does and why" },
        original_code: { type: "string", description: "The exact code to replace (must match)" },
        new_code: { type: "string", description: "The replacement code" },
        priority: { type: "string", enum: ["low", "medium", "high", "critical"], description: "How urgent is this change" },
      },
      required: ["filepath", "description", "original_code", "new_code"],
    },
  },
  // ═══ HEADLESS BROWSER ═══════════════════════════════════════
  {
    name: "browse_page",
    description: "Browse a real webpage with headless Puppeteer. Navigates to URL, can extract text content, take screenshots, or query CSS selectors. Use when you need to actually READ a web page, not just search.",
    input_schema: {
      type: "object",
      properties: {
        url: { type: "string", description: "Full URL to navigate to (https://...)" },
        action: {
          type: "string",
          enum: ["extract_text", "screenshot", "query_selector", "extract_links"],
          description: "What to do on the page",
        },
        selector: { type: "string", description: "CSS selector (only for query_selector action)" },
        waitMs: { type: "number", description: "Wait time in ms after page load (default 2000, max 10000)" },
      },
      required: ["url", "action"],
    },
  },
  // ═══ CODE SANDBOX ═══════════════════════════════════════════
  {
    name: "run_code_sandbox",
    description: "Execute JavaScript code in a safe isolated sandbox. Use to test code, run calculations, validate logic, or demonstrate algorithms. Has access to Math, JSON, Date, Array, Object, String, Number, RegExp. No network, no filesystem, timeout 10s.",
    input_schema: {
      type: "object",
      properties: {
        code: { type: "string", description: "JavaScript code to execute" },
        description: { type: "string", description: "What this code does (for logging)" },
      },
      required: ["code"],
    },
  },
  // ═══ MULTI-TURN PLANNING ════════════════════════════════════
  {
    name: "task_plan",
    description: "Manage persistent task plans that survive across messages. Use to break complex problems into steps, track progress, and maintain context across multi-turn conversations.",
    input_schema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["create", "update", "complete_step", "get_active", "list_all"],
          description: "What to do with the task plan",
        },
        title: { type: "string", description: "Task title (for create)" },
        steps: {
          type: "array",
          items: { type: "string" },
          description: "List of steps (for create)",
        },
        plan_id: { type: "string", description: "Plan ID (for update/complete_step)" },
        step_index: { type: "number", description: "Step index to mark complete (0-based)" },
        notes: { type: "string", description: "Additional notes or context" },
      },
      required: ["action"],
    },
  },
  // ═══ TERMINAL ACCESS ════════════════════════════════════════
  {
    name: "run_terminal",
    description: "Execute a shell command on the server. Only whitelisted safe commands are allowed: git, npm, ls, cat, grep, find, wc, head, tail, echo, pwd, df, free, uptime. Use for checking git status, running tests, viewing files, searching code. Max 30s timeout.",
    input_schema: {
      type: "object",
      properties: {
        command: { type: "string", description: "Shell command to execute (must start with a whitelisted command)" },
        cwd: { type: "string", description: "Working directory relative to project root (default: project root)" },
      },
      required: ["command"],
    },
  },
  // ═══ MULTI-FILE AWARENESS ═══════════════════════════════════
  {
    name: "list_directory",
    description: "List files and directories in your own project. Shows file names, sizes, and types. Use to understand project structure, find files, or see what files exist.",
    input_schema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative path from project root (default: '.')" },
        maxDepth: { type: "number", description: "Max depth for recursive listing (default: 2, max: 4)" },
      },
      required: [],
    },
  },
  {
    name: "search_own_code",
    description: "Search through your own source code using grep. Find functions, variables, patterns, bugs, or any text across all project files. Returns matching lines with file paths and line numbers.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Text or regex pattern to search for" },
        path: { type: "string", description: "Subdirectory to search in (default: whole project)" },
        filePattern: { type: "string", description: "File pattern filter, e.g. '*.js' or '*.css'" },
        caseSensitive: { type: "boolean", description: "Case sensitive search (default: false)" },
      },
      required: ["query"],
    },
  },
];

// ── Tool executor: maps tool names to brain methods ──
async function executeTool(brain, toolName, toolInput, userId) {
  try {
    switch (toolName) {
      case "search_web":
        return await brain._search(toolInput.query);
      case "recall_tool":
        return await brain._recallTool(toolInput.query);
      case "discover_and_save_tool":
        return await brain._discoverAndSaveTool(toolInput);
      case "call_saved_tool":
        return await brain._callSavedTool(toolInput.tool_name, toolInput.params || {});
      case "get_weather":
        return await brain._weather(toolInput.city, toolInput.lat, toolInput.lon);

      case "generate_image":
        return await brain._imagine(toolInput.prompt);
      case "play_radio":
        return await brain._radio(toolInput.station);
      case "play_video":
        return await brain._video(toolInput.query);
      case "open_website":
        return brain._webNav
          ? await brain._webNav(toolInput.url)
          : await brain._openURL(toolInput.url);
      case "get_news":
        return await brain._newsAction(toolInput.topic || "general");
      case "check_system_health":
        return await brain._healthCheck();
      // ═══ ELECTRONIC & DEFECTOSCOPY ═══
      // ═══ MEDICAL TOOLS ═══
      // ═══ OSCILLOSCOPE & SPECTROMETER & ENGINEERING ═══
      // ═══ OFFICE / SECRETARY TOOLS ═══
      case "send_email": {
        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey)
          return { error: "Email not configured. Set RESEND_API_KEY in .env" };
        if (toolInput.action === "draft") {
          return {
            status: "draft",
            to: toolInput.to,
            subject: toolInput.subject,
            body: toolInput.body,
            cc: toolInput.cc || null,
            message: "Draft ready. Say 'send' to send it.",
          };
        }
        try {
          const emailBody = {
            from: process.env.EMAIL_FROM || process.env.ADMIN_EMAIL || "",
            to: toolInput.to.split(",").map((e) => e.trim()),
            subject: toolInput.subject,
            html: toolInput.body,
          };
          if (toolInput.cc)
            emailBody.cc = toolInput.cc.split(",").map((e) => e.trim());
          const r = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(emailBody),
          });
          const result = await r.json();
          if (!r.ok)
            return {
              error: result.message || "Email failed",
              status: r.status,
            };
          return {
            status: "sent",
            id: result.id,
            to: toolInput.to,
            subject: toolInput.subject,
          };
        } catch (emailErr) {
          return { error: emailErr.message };
        }
      }
      // ═══ DRAWING & MS OFFICE TOOLS ═══
      // ═══ CAMERA / VISION / R&D INSPECTION ═══
      // ═══ EDUCATION / TEACHING TOOLS ═══
      // ═══ LEGAL ═══
      // ═══ FINANCE ═══
      case "financial_calculator": {
        try {
          const params = JSON.parse(toolInput.parameters);
          const calc = toolInput.calculation;
          let result = {};
          if (calc === "loan" || calc === "mortgage") {
            const P = params.amount || 100000;
            const r = (params.rate || 5) / 100 / 12;
            const n = (params.years || 30) * 12;
            const monthly =
              (P * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1);
            result = {
              monthly_payment: monthly.toFixed(2),
              total_paid: (monthly * n).toFixed(2),
              total_interest: (monthly * n - P).toFixed(2),
              currency: params.currency || "RON",
            };
          } else if (calc === "compound_interest") {
            const A =
              (params.principal || 10000) *
              Math.pow(1 + (params.rate || 5) / 100, params.years || 10);
            result = {
              final_amount: A.toFixed(2),
              profit: (A - (params.principal || 10000)).toFixed(2),
            };
          } else if (calc === "salary_net") {
            const gross = params.amount || 5000;
            const cas = gross * 0.25;
            const cass = gross * 0.1;
            const tax = (gross - cas - cass) * 0.1;
            result = {
              gross,
              cas: cas.toFixed(0),
              cass: cass.toFixed(0),
              tax: tax.toFixed(0),
              net: (gross - cas - cass - tax).toFixed(0),
              currency: "RON",
            };
          } else {
            result = {
              instruction: `Calculate ${calc} with parameters: ${JSON.stringify(params)}`,
            };
          }
          return result;
        } catch (e) {
          return { error: "Invalid parameters: " + e.message };
        }
      }
      // ═══ AUTOMOTIVE ═══
      case "car_diagnostic": {
        if (toolInput.action === "decode_obd" && toolInput.code) {
          return await brain._search(
            `OBD-II code ${toolInput.code} meaning cause fix ${toolInput.car || ""}`,
          );
        }
        if (toolInput.action === "diagnose_symptom") {
          return await brain._search(
            `car ${toolInput.car || ""} ${toolInput.symptom} cause diagnosis fix`,
          );
        }
        if (
          toolInput.action === "maintenance" ||
          toolInput.action === "specs"
        ) {
          return await brain._search(
            `${toolInput.car || "car"} ${toolInput.action} schedule specifications`,
          );
        }
        return await brain._search(
          `${toolInput.car || "car"} ${toolInput.action} ${toolInput.symptom || toolInput.code || ""}`,
        );
      }
      // ═══ CYBERSECURITY ═══
      // ═══ ARCHITECTURE ═══
      // ═══ MARKETING ═══
      // ═══ HEALTH ═══
      // ═══ COOKING ═══
      // ═══ MUSIC ═══
      // ═══ 3D PRINTING ═══
      // ═══ AGRICULTURE ═══
      // ═══ MONITOR DISPLAY ═══
      case "show_in_monitor": {
        const html = toolInput.html || toolInput.content;
        if (!html || html.length < 10) return { error: 'html content required' };
        return { monitorHTML: html, type: 'html', success: true };
      }
      // ═══ SELF-INTROSPECTION ═══
      case "read_own_source": {
        const fs = require('fs');
        const pathMod = require('path');
        const fp = (toolInput.filepath || '').replace(/\.\./g, '').replace(/\\/g, '/');
        // Whitelist: only allow safe directories
        const allowed = ['server/', 'app/', 'package.json', '.github/'];
        const blocked = ['.env', 'node_modules', '.git/', 'secret'];
        if (!allowed.some(a => fp.startsWith(a) || fp === a)) {
          return { error: `Access denied: only server/, app/, .github/ files allowed` };
        }
        if (blocked.some(b => fp.includes(b))) {
          return { error: `Access denied: ${fp} is a protected file` };
        }
        const fullPath = pathMod.resolve(__dirname, '..', fp);
        if (!fs.existsSync(fullPath)) return { error: `File not found: ${fp}` };
        const stat = fs.statSync(fullPath);
        if (stat.size > 500000) return { error: `File too large: ${(stat.size/1024).toFixed(0)}KB` };
        const content = fs.readFileSync(fullPath, 'utf8');
        const lines = content.split('\n');
        const start = Math.max(1, toolInput.startLine || 1);
        const end = Math.min(lines.length, toolInput.endLine || start + 499);
        if (end - start > 500) return { error: 'Max 500 lines per read' };
        const slice = lines.slice(start - 1, end);
        return {
          filepath: fp,
          totalLines: lines.length,
          showing: `${start}-${end}`,
          content: slice.map((l, i) => `${start + i}: ${l}`).join('\n'),
        };
      }

      case "propose_code_edit": {
        const { filepath, description, original_code, new_code, priority } = toolInput;
        const proposal = {
          filepath, description, original_code, new_code,
          priority: priority || 'medium',
          proposed_at: new Date().toISOString(),
          status: 'pending',
        };
        // Save to Supabase
        if (brain.supabase) {
          try {
            await brain.supabase.from('brain_memory').insert({
              user_id: userId || null,
              memory_type: 'code_proposal',
              content: `[${priority || 'medium'}] ${filepath}: ${description}`,
              context: proposal,
              importance: priority === 'critical' ? 10 : priority === 'high' ? 8 : 5,
            });
          } catch (e) {
            logger.warn({ component: 'SelfIntrospect' }, `Supabase save failed: ${e.message}`);
          }
        }
        logger.info({ component: 'SelfIntrospect', filepath, priority }, 'Code edit proposed');
        return {
          success: true,
          message: `Proposed edit to ${filepath}: ${description}. Saved for admin review.`,
          proposal,
        };
      }

      // ═══ HEADLESS BROWSER (Puppeteer) ═══
      case "browse_page": {
        const puppeteer = require('puppeteer');
        const pageUrl = (toolInput.url || '').trim();
        if (!pageUrl.startsWith('http://') && !pageUrl.startsWith('https://')) {
          return { error: 'URL must start with http:// or https://' };
        }
        // Block dangerous URLs
        if (/localhost|127\.0\.0|192\.168|10\.\d|\.env|\.git/i.test(pageUrl)) {
          return { error: 'Access denied: local/internal URLs not allowed' };
        }
        let browser;
        try {
          browser = await puppeteer.launch({
            headless: 'new',
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            timeout: 15000,
          });
          const page = await browser.newPage();
          await page.setUserAgent('KelionAI-Browser/1.0');
          await page.setViewport({ width: 1280, height: 800 });
          await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
          const waitMs = Math.min(toolInput.waitMs || 2000, 10000);
          await new Promise(r => setTimeout(r, waitMs));

          let result = {};
          const action = toolInput.action || 'extract_text';

          if (action === 'extract_text') {
            const text = await page.evaluate(() => {
              // Remove scripts, styles, nav, footer
              document.querySelectorAll('script,style,nav,footer,header,.cookie-banner').forEach(e => e.remove());
              return document.body?.innerText || '';
            });
            result = { url: pageUrl, text: text.substring(0, 5000), chars: text.length };
          } else if (action === 'screenshot') {
            const buf = await page.screenshot({ type: 'jpeg', quality: 60, fullPage: false });
            result = { url: pageUrl, screenshot_base64: buf.toString('base64').substring(0, 50000), format: 'jpeg' };
          } else if (action === 'query_selector') {
            const sel = toolInput.selector || 'body';
            const elements = await page.evaluate((s) => {
              const els = document.querySelectorAll(s);
              return Array.from(els).slice(0, 20).map(e => ({
                tag: e.tagName, text: (e.innerText || '').substring(0, 200),
                href: e.href || null, src: e.src || null,
              }));
            }, sel);
            result = { url: pageUrl, selector: sel, found: elements.length, elements };
          } else if (action === 'extract_links') {
            const links = await page.evaluate(() => {
              return Array.from(document.querySelectorAll('a[href]')).slice(0, 50).map(a => ({
                text: (a.innerText || '').trim().substring(0, 100), href: a.href,
              }));
            });
            result = { url: pageUrl, links_count: links.length, links };
          }

          await browser.close();
          logger.info({ component: 'Browse', url: pageUrl, action }, 'Page browsed successfully');
          return result;
        } catch (e) {
          if (browser) try { await browser.close(); } catch (_) {}
          return { error: `Browse failed: ${e.message}`, url: pageUrl };
        }
      }

      // ═══ CODE SANDBOX (vm module) ═══
      case "run_code_sandbox": {
        const vm = require('vm');
        const code = toolInput.code || '';
        if (!code.trim()) return { error: 'No code provided' };
        if (code.length > 10000) return { error: 'Code too long (max 10000 chars)' };

        const logs = [];
        const sandbox = {
          console: { log: (...a) => logs.push(a.map(String).join(' ')), error: (...a) => logs.push('ERROR: ' + a.map(String).join(' ')), warn: (...a) => logs.push('WARN: ' + a.map(String).join(' ')) },
          Math, JSON, Date, Array, Object, String, Number, RegExp, Boolean, Map, Set,
          parseInt, parseFloat, isNaN, isFinite, encodeURIComponent, decodeURIComponent,
          setTimeout: (fn, ms) => { if (ms > 5000) ms = 5000; return setTimeout(fn, ms); },
          clearTimeout,
          result: undefined,
        };

        try {
          const script = new vm.Script(`result = (function() { ${code} })()`, { timeout: 10000 });
          const ctx = vm.createContext(sandbox);
          script.runInContext(ctx, { timeout: 10000 });

          logger.info({ component: 'Sandbox', desc: toolInput.description }, 'Code executed');
          return {
            success: true,
            result: sandbox.result !== undefined ? String(sandbox.result).substring(0, 5000) : null,
            console_output: logs.slice(0, 100),
            description: toolInput.description || 'Code execution',
          };
        } catch (e) {
          return {
            success: false,
            error: e.message,
            console_output: logs.slice(0, 50),
          };
        }
      }

      // ═══ MULTI-TURN TASK PLANNING ═══
      case "task_plan": {
        const action = toolInput.action;
        if (!brain.supabase) return { error: 'Supabase not available for task planning' };

        if (action === 'create') {
          const steps = (toolInput.steps || []).map((s, i) => ({ index: i, text: s, done: false }));
          const plan = {
            title: toolInput.title || 'Untitled Plan',
            steps,
            status: 'active',
            created_at: new Date().toISOString(),
            notes: toolInput.notes || '',
          };
          const { data, error } = await brain.supabase.from('brain_memory').insert({
            user_id: userId || null,
            memory_type: 'task_plan',
            content: `[PLAN] ${plan.title} (${steps.length} steps)`,
            context: plan,
            importance: 8,
          }).select('id').single();
          if (error) return { error: `Create failed: ${error.message}` };
          return { success: true, plan_id: data?.id, plan };
        }

        if (action === 'complete_step') {
          const { data, error } = await brain.supabase.from('brain_memory')
            .select('id, context').eq('id', toolInput.plan_id).single();
          if (error || !data) return { error: 'Plan not found' };
          const plan = data.context;
          const idx = toolInput.step_index;
          if (plan.steps && plan.steps[idx]) {
            plan.steps[idx].done = true;
            plan.steps[idx].completed_at = new Date().toISOString();
          }
          if (toolInput.notes) plan.notes = (plan.notes || '') + '\n' + toolInput.notes;
          const allDone = plan.steps?.every(s => s.done);
          if (allDone) plan.status = 'completed';
          await brain.supabase.from('brain_memory').update({ context: plan,
            content: `[PLAN${allDone ? ' ✅' : ''}] ${plan.title} (${plan.steps.filter(s=>s.done).length}/${plan.steps.length} done)`,
          }).eq('id', toolInput.plan_id);
          return { success: true, plan, completed: allDone };
        }

        if (action === 'get_active') {
          const { data } = await brain.supabase.from('brain_memory')
            .select('id, content, context, created_at')
            .eq('memory_type', 'task_plan')
            .eq('user_id', userId || '')
            .order('created_at', { ascending: false })
            .limit(5);
          const active = (data || []).filter(d => d.context?.status === 'active');
          return { plans: active.map(p => ({ id: p.id, title: p.context?.title, steps: p.context?.steps, created: p.created_at })) };
        }

        if (action === 'list_all') {
          const { data } = await brain.supabase.from('brain_memory')
            .select('id, content, context, created_at')
            .eq('memory_type', 'task_plan')
            .order('created_at', { ascending: false })
            .limit(20);
          return { plans: (data || []).map(p => ({ id: p.id, title: p.context?.title, status: p.context?.status, steps_done: p.context?.steps?.filter(s=>s.done).length, steps_total: p.context?.steps?.length, created: p.created_at })) };
        }

        if (action === 'update') {
          const { data, error } = await brain.supabase.from('brain_memory')
            .select('id, context').eq('id', toolInput.plan_id).single();
          if (error || !data) return { error: 'Plan not found' };
          const plan = data.context;
          if (toolInput.notes) plan.notes = (plan.notes || '') + '\n' + toolInput.notes;
          if (toolInput.title) plan.title = toolInput.title;
          if (toolInput.steps) plan.steps = toolInput.steps.map((s, i) => ({ index: i, text: s, done: plan.steps?.[i]?.done || false }));
          await brain.supabase.from('brain_memory').update({ context: plan, content: `[PLAN] ${plan.title}` }).eq('id', toolInput.plan_id);
          return { success: true, plan };
        }

        return { error: `Unknown task_plan action: ${action}` };
      }

      // ═══ TERMINAL ACCESS ═══
      case "run_terminal": {
        const { execSync } = require('child_process');
        const pathMod = require('path');
        const cmd = (toolInput.command || '').trim();
        if (!cmd) return { error: 'No command provided' };

        // Whitelist first word
        const firstWord = cmd.split(/\s+/)[0].replace(/[^a-zA-Z0-9_-]/g, '');
        const allowed = ['git','npm','npx','ls','dir','cat','grep','find','wc','head','tail','echo','pwd','df','free','uptime','node','which','env'];
        const blocked = ['rm','del','kill','reboot','shutdown','format','mkfs','dd','wget','curl','>','|','&&','||','sudo','chmod','chown'];

        if (!allowed.includes(firstWord)) {
          return { error: `Command '${firstWord}' not whitelisted. Allowed: ${allowed.join(', ')}` };
        }
        if (blocked.some(b => cmd.includes(b))) {
          return { error: `Command contains blocked operator/keyword` };
        }

        const projectRoot = pathMod.resolve(__dirname, '..');
        const cwd = toolInput.cwd ? pathMod.resolve(projectRoot, toolInput.cwd.replace(/\.\./g, '')) : projectRoot;

        try {
          const output = execSync(cmd, {
            cwd,
            timeout: 30000,
            maxBuffer: 1024 * 1024,
            encoding: 'utf8',
            env: { ...process.env, PAGER: 'cat' },
          });
          logger.info({ component: 'Terminal', cmd: cmd.substring(0, 100) }, 'Command executed');
          return { success: true, command: cmd, output: (output || '').substring(0, 5000) };
        } catch (e) {
          return { success: false, command: cmd, error: e.message.substring(0, 2000), stderr: (e.stderr || '').substring(0, 2000) };
        }
      }

      // ═══ LIST DIRECTORY ═══
      case "list_directory": {
        const fs = require('fs');
        const pathMod = require('path');
        const projectRoot = pathMod.resolve(__dirname, '..');
        const relPath = (toolInput.path || '.').replace(/\.\./g, '');
        const fullPath = pathMod.resolve(projectRoot, relPath);
        const maxDepth = Math.min(toolInput.maxDepth || 2, 4);

        if (!fs.existsSync(fullPath)) return { error: `Path not found: ${relPath}` };

        function listDir(dir, depth, prefix) {
          if (depth > maxDepth) return [];
          const items = [];
          try {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const e of entries) {
              if (e.name.startsWith('.') || e.name === 'node_modules') continue;
              const rel = pathMod.relative(projectRoot, pathMod.join(dir, e.name));
              if (e.isDirectory()) {
                items.push({ path: rel, type: 'dir' });
                if (depth < maxDepth) items.push(...listDir(pathMod.join(dir, e.name), depth + 1, rel));
              } else {
                const stat = fs.statSync(pathMod.join(dir, e.name));
                items.push({ path: rel, type: 'file', size: stat.size, ext: pathMod.extname(e.name) });
              }
            }
          } catch (_) {}
          return items;
        }

        const items = listDir(fullPath, 1, relPath);
        return { path: relPath, total: items.length, items: items.slice(0, 200) };
      }

      // ═══ SEARCH OWN CODE ═══
      case "search_own_code": {
        const { execSync } = require('child_process');
        const pathMod = require('path');
        const query = (toolInput.query || '').trim();
        if (!query) return { error: 'No search query' };
        if (query.length > 200) return { error: 'Query too long (max 200 chars)' };

        const projectRoot = pathMod.resolve(__dirname, '..');
        const searchPath = toolInput.path ? pathMod.resolve(projectRoot, (toolInput.path || '').replace(/\.\./g, '')) : projectRoot;

        const flags = toolInput.caseSensitive ? '-rn' : '-rin';
        let includeFlag = '';
        if (toolInput.filePattern) {
          includeFlag = ` --include="${toolInput.filePattern.replace(/[^a-zA-Z0-9.*_-]/g, '')}"`;
        }

        try {
          const cmd = `grep ${flags}${includeFlag} --exclude-dir=node_modules --exclude-dir=.git -l "${query.replace(/"/g, '\\"')}" .`;
          const output = execSync(cmd, { cwd: searchPath, timeout: 10000, maxBuffer: 512 * 1024, encoding: 'utf8' });
          const files = output.trim().split('\n').filter(Boolean).slice(0, 30);

          // Get matching lines from top 10 files
          const results = [];
          for (const file of files.slice(0, 10)) {
            try {
              const lineCmd = `grep ${flags}${includeFlag} "${query.replace(/"/g, '\\"')}" "${file}"`;
              const lines = execSync(lineCmd, { cwd: searchPath, timeout: 5000, encoding: 'utf8' });
              const matches = lines.trim().split('\n').slice(0, 5).map(l => {
                const m = l.match(/^(\d+):(.*)/);
                return m ? { line: parseInt(m[1]), text: m[2].trim().substring(0, 150) } : { text: l.substring(0, 150) };
              });
              results.push({ file: file.replace('./', ''), matches });
            } catch (_) {}
          }

          return { query, files_found: files.length, results };
        } catch (e) {
          if (e.status === 1) return { query, files_found: 0, results: [], message: 'No matches found' };
          return { error: `Search failed: ${e.message.substring(0, 200)}` };
        }
      }

      // ═══ MAP + NAVIGATION ═══
      case "show_map": {
        const key = process.env.GOOGLE_MAPS_KEY || '';
        const hasValidKey = key && key.startsWith('AIza'); // Real Google API keys start with AIza
        let mapUrl;
        if (!hasValidKey) {
          // No valid key — use OpenStreetMap with geocoding
          const place = toolInput.place || toolInput.destination || toolInput.origin || 'Romania';
          try {
            const geoR = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(place)}&limit=1`, {
              headers: { 'User-Agent': 'KelionAI/1.0' }
            });
            if (geoR.ok) {
              const geoData = await geoR.json();
              if (geoData[0]) {
                const lat = parseFloat(geoData[0].lat);
                const lng = parseFloat(geoData[0].lon);
                const bbox = `${lng-0.05},${lat-0.05},${lng+0.05},${lat+0.05}`;
                mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`;
              }
            }
          } catch (_) { /* fallback below */ }
          if (!mapUrl) mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=-30,25,45,75&layer=mapnik`;
        } else if (toolInput.origin && toolInput.destination) {
          const mode = toolInput.mode || 'driving';
          mapUrl = `https://www.google.com/maps/embed/v1/directions?key=${key}&origin=${encodeURIComponent(toolInput.origin)}&destination=${encodeURIComponent(toolInput.destination)}&mode=${mode}`;
        } else {
          const place = toolInput.place || toolInput.destination || 'Romania';
          mapUrl = `https://www.google.com/maps/embed/v1/place?key=${key}&q=${encodeURIComponent(place)}`;
        }
        return { monitorHTML: `<iframe src="${mapUrl}" style="width:100%;height:100%;border:0" allowfullscreen></iframe>`, type: 'html', success: true };
      }
      // ═══ MEMORY ═══
      case "recall_memory":
        return brain._memory ? await brain._memory() : { memories: [] };

      // ═══ GMAIL API ═══
      case "list_emails":
      case "read_email":
      case "draft_reply": {
        // Gmail OAuth2 integration — requires setup
        const gmailRoute = require('./routes/gmail');
        if (!gmailRoute || !gmailRoute[toolName]) {
          return { error: 'Gmail not configured. Admin must set up Google OAuth2 credentials (GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET) and the user must connect their Gmail account.' };
        }
        return await gmailRoute[toolName](toolInput, userId, brain.supabase);
      }

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (e) {
    logger.warn(
      { component: "BrainV4", tool: toolName, err: e.message },
      `Tool ${toolName} failed`,
    );
    brain.recordError(toolName, e.message);
    return { error: e.message };
  }
}

// ── Extract monitor data from tool results ──
function extractMonitor(toolResults) {
  for (const r of toolResults) {
    if (r.result && typeof r.result === "object") {
      if (r.result.mapHTML)
        return { content: r.result.mapHTML, type: 'html' }; // iframe embed direct
      if (r.result.monitorURL)
        return { content: r.result.monitorURL, type: "url" };
      if (r.result.mapURL) return { content: r.result.mapURL, type: "map" };

      if (r.result.imageUrl)
        return { content: r.result.imageUrl, type: "image" };
      if (r.result.radioURL || r.result.streamUrl)
        return {
          content: r.result.radioURL || r.result.streamUrl,
          type: "radio",
        };
      if (r.result.videoURL || r.result.youtubeURL)
        return {
          content: r.result.videoURL || r.result.youtubeURL,
          type: "video",
        };
    }
  }
  return { content: null, type: null };
}

// ═══════════════════════════════════════════════════════════════
// MAIN: thinkV4 — Gemini Tool Calling loop
// ═══════════════════════════════════════════════════════════════
async function thinkV4(
  brain,
  message,
  avatar,
  history,
  language,
  userId,
  conversationId,
  mediaData = {},
  isAdmin = false,
) {
  brain.conversationCount++;
  const startTime = Date.now();
  brain._currentMediaData = mediaData || {};

  try {
    // Agent logging removed — was hardcoded to localhost:7257
    // ── 1. Quota check ──
    const quota = await brain.checkQuota(userId);
    if (!quota.allowed) {
      const upgradeMsg =
        language === "ro"
          ? `Ai atins limita de ${quota.limit} mesaje/lună pe planul ${quota.plan.toUpperCase()}. Upgradeează pentru mai multe mesaje! 🚀`
          : `You've reached your ${quota.limit} messages/month limit on ${quota.plan.toUpperCase()}. Upgrade for more! 🚀`;
      return {
        enrichedMessage: upgradeMsg,
        toolsUsed: [],
        monitor: { content: null, type: null },
        analysis: { complexity: "simple", language },
        thinkTime: Date.now() - startTime,
        confidence: 1.0,
      };
    }

    // ── 2. Load memory + profile (parallel) ──
    const [memories, visualMem, audioMem, facts, profile] = await Promise.all([
      brain.loadMemory(userId, "text", 20, message),
      brain.loadMemory(userId, "visual", 5, message),
      brain.loadMemory(userId, "audio", 5, message),
      brain.loadFacts(userId, 20),
      brain._loadProfileCached(userId),
    ]);
    const memoryContext = brain.buildMemoryContext(
      memories,
      visualMem,
      audioMem,
      facts,
    );
    const profileContext = profile ? profile.toContextString() : "";

    // ── 3. Emotion detection (fast, no AI needed) ──
    const lower = message.toLowerCase();
    let emotionalTone = "neutral";
    let emotionHint = "";
    for (const [emo, { pattern, responseHint }] of Object.entries(
      brain.constructor.EMOTION_MAP || {},
    )) {
      if (pattern.test(lower)) {
        emotionalTone = emo;
        emotionHint = responseHint || "";
        break;
      }
    }
    const frustration = brain.constructor.detectFrustration
      ? brain.constructor.detectFrustration(message)
      : 0;
    if (frustration > 0.6) {
      emotionHint =
        "User is very frustrated. Be patient, acknowledge the issue, provide solutions quickly.";
    }

    // ── 3b. Context switch detection ──
    const topicKeywords = {
      trading: /\b(trade|trading|buy|sell|BTC|ETH|crypto|piață|preț|analiză|signal|RSI|MACD|invest|portofoliu|acțiuni|bursă|forex)\b/i,
      coding: /\b(code|coding|bug|error|function|deploy|API|server|git|commit|script|database|program)\b/i,
      news: /\b(news|știri|știre|politic|război|eveniment|actual|azi|ieri|breaking)\b/i,
      weather: /\b(vreme|meteo|weather|ploaie|soare|temperatură|grad|frig|cald)\b/i,
      music: /\b(muzică|music|song|cântec|artist|album|concert|playlist)\b/i,
      personal: /\b(eu|mine|viața|familie|sănătate|hobby|plan|sentiment|gândesc|simt)\b/i,
    };
    let currentTopic = "general";
    for (const [topic, pattern] of Object.entries(topicKeywords)) {
      if (pattern.test(message)) { currentTopic = topic; break; }
    }
    // Static var to track previous topic across calls
    if (!brain._lastTopic) brain._lastTopic = "general";
    let contextSwitchHint = "";
    if (brain._lastTopic !== currentTopic && brain._lastTopic !== "general" && currentTopic !== "general") {
      contextSwitchHint = `\n[CONTEXT SWITCH] Userul a trecut de la ${brain._lastTopic} la ${currentTopic}. Ajustează-ți tonul și cunoștințele.`;
    }
    brain._lastTopic = currentTopic;

    // ── 4. Build system prompt with FULL context ──
    const geoBlock = mediaData.geo
      ? `\n[USER LOCATION] Lat: ${mediaData.geo.lat}, Lng: ${mediaData.geo.lng}${mediaData.geo.accuracy ? ` (accuracy: ${Math.round(mediaData.geo.accuracy)}m)` : ""}. Use this for weather, nearby places, and location-aware responses.`
      : "";
    const memoryBlock = [profileContext, memoryContext]
      .filter(Boolean)
      .join(" || ");
    const emotionBlock = emotionHint
      ? `\n[EMOTIONAL CONTEXT] User mood: ${emotionalTone}. ${emotionHint}`
      : "";
    const now = new Date();
    const dateTimeBlock = `\n[CURRENT DATE & TIME] ${now.toLocaleDateString("ro-RO", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}, ora ${now.toLocaleTimeString("ro-RO", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Bucharest" })} (Romania). Folosește MEREU aceste date când userul întreabă de zi, dată sau oră.`;
    const patternsBlock = getPatternsText();
    const qualityHints = getQualityHints();
    const proactiveHint = getProactiveSuggestion();
    const focusBlock = `
[MAXIMUM FOCUS DIRECTIVE]
You MUST read and analyze EVERY SINGLE WORD of the user's message before responding.
Rules:
1. NEVER give generic answers. Every response must directly address what the user SPECIFICALLY asked.
2. If the user asks multiple things, address EACH point individually.
3. Provide PROFESSIONAL, EXPERT-LEVEL solutions — not surface-level advice.
4. Be thorough and complete — do not cut answers short.
5. If unsure, use your tools (web_search, code execution) to verify before answering.
6. Stay 100% focused on the user's topic — do not drift to unrelated subjects.
7. Think step by step for complex questions before answering.
8. Cite sources when possible. Verify facts with tools.
9. Give actionable, practical solutions — not theoretical fluff.
10. Respond in the user's language with native fluency.
`;
    const systemPrompt = process.env.NEWBORN_MODE === "true"
      ? buildNewbornPrompt(memoryBlock + patternsBlock + qualityHints + contextSwitchHint + proactiveHint + focusBlock)
      : buildSystemPrompt(
          avatar,
          language,
          memoryBlock + emotionBlock + geoBlock + dateTimeBlock + patternsBlock + qualityHints + contextSwitchHint + proactiveHint + focusBlock,
          "",
          null,
        );

    // ── 5. Prepare messages for Gemini ──
    // Full conversation context — 50 messages for maximum attention
    const recentHistory = (history || []).slice(-50).map((h) => ({
      role: h.role === "user" ? "user" : "model",
      parts: [
        {
          text:
            typeof h.content === "string"
              ? h.content
              : JSON.stringify(h.content),
        },
      ],
    }));

    // Handle vision: if image is provided, add it to the message
    const userParts = [];
    if (mediaData.imageBase64) {
      userParts.push({
        inlineData: {
          mimeType: mediaData.imageMimeType || "image/jpeg",
          data: mediaData.imageBase64,
        },
      });
      // Auto-camera: add accessibility hint for concise descriptions
      if (mediaData.isAutoCamera) {
        userParts.push({
          text: "[AUTO-CAMERA] Aceasta e imagine automată de la camera utilizatorului. " +
                "Regulă: NU descrie toată camera/scena. Fii SCURT (1-2 propoziții). " +
                "Menționează DOAR: persoane (culori exacte de haine), pericole, text vizibil. " +
                "Dacă nu e nimic nou de spus, nu comenta imaginea deloc — răspunde normal la mesaj.",
        });
      }
    }
    userParts.push({ text: message });

    const geminiMessages = [
      ...recentHistory,
      { role: "user", parts: userParts },
    ];

    // ── 6. CALL GEMINI WITH TOOLS ──
    // First call: Gemini decides what tools to use
    const toolsUsed = [];
    const toolResults = [];
    let finalResponse = "";
    let totalTokens = 0;
    const MAX_TOOL_ROUNDS = 3; // Prevent infinite loops

    let currentMessages = geminiMessages;

    // ── Set media data so tool handlers can access uploaded images ──
    brain._currentMediaData = mediaData || {};

    const geminiApiKey =
      process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
    if (!geminiApiKey) {
      // Agent logging removed — was hardcoded to localhost:7257
      throw new Error("GOOGLE_AI_KEY not configured — cannot call Gemini API");
    }

    const geminiModel = MODELS.GEMINI_CHAT;
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${geminiModel}:generateContent?key=${geminiApiKey}`;
    const geminiTools = [
      { functionDeclarations: toGeminiTools(TOOL_DEFINITIONS) },
    ];

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const geminiBody = {
        contents: currentMessages,
        tools: geminiTools,
        toolConfig: { functionCallingConfig: { mode: 'ANY' } }, // Forteaza tool calling — nu raspunde din memorie proprie
        systemInstruction: { parts: [{ text: systemPrompt }] },
        generationConfig: {
          maxOutputTokens: 8192,
          temperature: 0.6,
        },
      };


      const r = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(geminiBody),
      });

      if (!r.ok) {
        const errText = await r.text().catch(() => "unknown");
        throw new Error(`Gemini API ${r.status}: ${errText.substring(0, 200)}`);
      }

      const response = await r.json();
      totalTokens +=
        (response.usageMetadata?.promptTokenCount || 0) +
        (response.usageMetadata?.candidatesTokenCount || 0);

      const candidate = response.candidates?.[0];
      if (!candidate?.content?.parts) {
        // No content — check for safety block or empty response
        const blockReason =
          candidate?.finishReason || response.promptFeedback?.blockReason;
        if (blockReason)
          logger.warn(
            { component: "BrainV4", blockReason },
            "Gemini blocked response",
          );
        break;
      }

      const parts = candidate.content.parts;

      // Check if Gemini wants to use tools (functionCall parts)
      const functionCalls = parts.filter((p) => p.functionCall);
      if (functionCalls.length === 0) {
        // No tool calls — extract text response
        finalResponse = parts
          .filter((p) => p.text)
          .map((p) => p.text)
          .join("\n");
        break;
      }

      // Execute all requested tools in parallel
      const toolPromises = functionCalls.map(async (fc) => {
        const result = await executeTool(
          brain,
          fc.functionCall.name,
          fc.functionCall.args || {},
          userId,
        );
        toolsUsed.push(fc.functionCall.name);
        toolResults.push({ name: fc.functionCall.name, result });
        brain.toolStats[fc.functionCall.name] =
          (brain.toolStats[fc.functionCall.name] || 0) + 1;
        return {
          functionResponse: {
            name: fc.functionCall.name,
            response:
              typeof result === "string"
                ? { result }
                : JSON.parse(
                    JSON.stringify(result, (_, v) =>
                      typeof v === "string" ? v.substring(0, 4000) : v,
                    ),
                  ),
          },
        };
      });

      const toolResponseParts = await Promise.all(toolPromises);

      // Add model response + tool results to conversation
      currentMessages = [
        ...currentMessages,
        { role: "model", parts: candidate.content.parts },
        { role: "user", parts: toolResponseParts },
      ];
    }

    // ── 7. Post-processing ──
    const thinkTime = Date.now() - startTime;

    // Save memory (async, non-blocking)
    brain
      .saveMemory(
        userId,
        "text",
        message,
        { response: finalResponse.substring(0, 200) },
        5,
      )
      .catch(() => {});
    brain.learnFromConversation(userId, message, finalResponse).catch(() => {});
    if (profile) {
      profile.updateFromConversation(message, language, {
        emotionalTone,
        topics: [],
      });
      profile.save(brain.supabaseAdmin).catch(() => {});
    }

    // Track usage
    brain.incrementUsage(userId, toolsUsed.length, totalTokens).catch(() => {});

    // Confidence
    let confidence = 0.7;
    if (toolsUsed.length > 0) confidence += 0.15;
    if (toolsUsed.length > 2) confidence += 0.1;
    confidence = Math.min(1.0, confidence);

    // ── Multi-AI Consensus for complex/critical queries ──
    // Triggers when: query used 2+ tools OR frustration is high OR no tools verified data
    let consensusEngine = null;
    const isComplex = toolsUsed.length >= 2 || frustration >= 3;
    const needsVerification = toolsUsed.length === 0 && message.length > 80;
    if (
      (isComplex || needsVerification) &&
      typeof brain.multiAIConsensus === "function"
    ) {
      try {
        const consensusResult = await brain.multiAIConsensus(
          `Verify and improve this answer if needed. User question: "${message.substring(0, 300)}"\nCurrent answer: "${finalResponse.substring(0, 500)}"\nProvide ONLY the improved answer text, nothing else.`,
          800,
        );
        if (consensusResult && consensusResult.text) {
          consensusEngine = consensusResult.engine;
          if (consensusResult.consensus)
            confidence = Math.min(1.0, confidence + 0.1);
          // Use consensus answer only if it's substantially different and longer
          if (consensusResult.text.length > finalResponse.length * 1.3) {
            finalResponse = consensusResult.text;
            logger.info(
              { component: "BrainV4", engine: consensusEngine },
              "🤝 Consensus answer used",
            );
          }
        }
      } catch (e) {
        logger.warn(
          { component: "BrainV4", err: e.message },
          "Consensus check failed (non-blocking)",
        );
      }
    }

    logger.info(
      {
        component: "BrainV4",
        tools: toolsUsed,
        rounds: toolResults.length,
        thinkTime,
        tokens: totalTokens,
      },
      `🧠 V4 Think: ${toolsUsed.length} tools | ${thinkTime}ms | ${totalTokens} tokens`,
    );

    // Agent logging removed — was hardcoded to localhost:7257
    // ── Self-evaluate response quality ──
    try {
      const evalDomain = toolsUsed.includes("trading_analysis") ? "trading"
        : toolsUsed.includes("web_search") ? "research"
        : toolsUsed.includes("code_execute") ? "coding"
        : "general";
      selfEvaluate(message, finalResponse, evalDomain);
      recordUserInteraction({ domain: evalDomain, userMessage: message });
    } catch (_) { /* non-blocking */ }

    return {
      enrichedMessage: finalResponse,
      enrichedContext: finalResponse,
      toolsUsed,
      monitor: extractMonitor(toolResults),
      analysis: {
        complexity: toolsUsed.length > 1 ? "complex" : "simple",
        emotionalTone,
        language: language || "ro",
        topics: [],
        isEmotional: emotionalTone !== "neutral",
        frustrationLevel: frustration,
      },
      chainOfThought: null, // Gemini does it internally
      compressedHistory: recentHistory,
      failedTools: toolResults
        .filter((r) => r.result?.error)
        .map((r) => r.name),
      thinkTime,
      confidence,
      sourceTags:
        toolsUsed.length > 0
          ? ["VERIFIED", ...toolsUsed.map((t) => `SOURCE:${t}`)]
          : ["ASSUMPTION"],
      agent: "v4-gemini-tools",
      profileLoaded: !!profile,
    };
  } catch (e) {
    const thinkTime = Date.now() - startTime;
    brain.recordError("thinkV4", e.message);
    logger.error(
      { component: "BrainV4", err: e.message, thinkTime },
      `🧠 V4 Think failed: ${e.message}`,
    );
    // Agent logging removed — was hardcoded to localhost:7257


    // FALLBACK to v3 think
    logger.info({ component: "BrainV4" }, "⚠️ Falling back to v3 think");
    try {
      return await brain.think(
        message,
        avatar,
        history,
        language,
        userId,
        conversationId,
        mediaData,
        isAdmin,
      );
    } catch (e2) {
      // Agent logging removed — was hardcoded to localhost:7257
      return {
        enrichedMessage:
          (language === "ro"
            ? "Îmi pare rău, am întâmpinat o problemă tehnică și nu pot răspunde acum. Te rog să încerci din nou. 🔧"
            : "I'm sorry, I encountered a technical issue and can't respond right now. Please try again. 🔧"),
        toolsUsed: [],
        monitor: { content: null, type: null },
        analysis: {
          complexity: "simple",
          language: language || "ro",
          emotionalTone: "neutral",
          topics: [],
        },
        chainOfThought: null,
        compressedHistory: history || [],
        failedTools: [],
        thinkTime,
        confidence: 0,
        agent: "error-fallback",
        error: `V4: ${e.message} | V3: ${e2.message}`,
      };
    }
  }
}

module.exports = { thinkV4, TOOL_DEFINITIONS, executeTool };
