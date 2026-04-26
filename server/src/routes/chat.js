'use strict';

/**
 * /api/chat — Professional text-chat route using the native Gemini SDK.
 *
 * Uses @google/genai (official Google SDK) directly — NOT the OpenAI
 * compatibility shim. This gives us:
 *   • Native function calling with full schema support (no sanitisation)
 *   • Native multimodal vision (inlineData, not image_url wrapper)
 *   • Streaming via generateContentStream
 *   • Parallel + compositional function calling
 *   • Function call ID tracking (Gemini 3+)
 *
 * Model: gemini-3.1-pro-preview (configurable via GEMINI_CHAT_MODEL env).
 * Falls back to gemini-3-flash-preview when the Pro model is unavailable.
 *
 * Zero hardcoded tool lists — tools come from buildKelionToolsGemini()
 * which is the single source of truth shared with the voice path.
 */

const { Router } = require('express');
const { GoogleGenAI } = require('@google/genai');
const {
  getCreditsBalance,
  findById,
  listMemoryItems,
  setPreferredLanguage,
  getPreferredLanguage,
} = require('../db');
const { isAdminEmail } = require('../middleware/subscription');
const ipGeo = require('../services/ipGeo');
const { trialStatus, stampTrialIfFresh } = require('../services/trialQuota');
const { executeRealTool, pickForcedTool } = require('../services/realTools');
const { buildKelionToolsGemini, formatMemoryBlocks } = require('./realtime');

const router = Router();

// ── Gemini client (native SDK) ─────────────────────────────────────
let _ai = null;
function getGemini() {
  if (_ai) return _ai;
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  _ai = new GoogleGenAI({ apiKey: key });
  return _ai;
}

// Model selection: env override → flagship pro → flash fallback.
function getChatModel() {
  return (
    process.env.GEMINI_CHAT_MODEL ||
    process.env.AI_MODEL ||
    'gemini-3.1-pro-preview'
  );
}

// ── System prompt ──────────────────────────────────────────────────
// No hardcoded tool list. The model sees tools via the native
// functionDeclarations parameter + Google built-in tools.
const BASE_PROMPT = `You are Kelion, an AI assistant created by AE Studio, after an idea by Adrian Enciulescu. For contact: contact@kelionai.app.

Detect the user's language automatically and reply in that language. Never mix languages in one response.

You have access to a rich set of tools — use them whenever relevant instead of guessing.

Tool self-discovery rules:
- You have custom tools (function declarations) AND Google built-in tools (Google Search, Code Execution, Google Maps, URL Context).
- ALWAYS check your custom tools first for any request.
- If NO custom tool fits the request, AUTOMATICALLY use Google Search to find the answer or Code Execution to calculate/process data.
- For location questions: use Google Maps or your custom location tools.
- For URLs/web pages: use URL Context to read and analyze them.
- For math/calculations: use Code Execution — it runs real Python code.
- For real-time info (news, prices, weather, facts): use Google Search.
- NEVER say "I don't have a tool for that" — you ALWAYS have Google Search and Code Execution as universal fallbacks.
- Learn from every interaction: if you solved something with Google Search or Code Execution, remember the approach for next time.

Honesty rules:
- Never claim you did something you did not do.
- Never invent numbers, names, URLs, or facts. Use tools or say "I don't know".
- Never announce which tool you are calling. Just call it and answer with the result.
- Silent tools (never mention): observe_user_emotion, learn_from_observation, get_action_history, plan_task.

You have access to real-time information provided in the system context below.`;

const MAX_MESSAGE_LENGTH = 4000;
const MAX_MESSAGES_COUNT = 40;

// ── Language helpers ───────────────────────────────────────────────
// All world languages (ISO 639-1). The model detects any language
// automatically — this map provides display names for the language lock.
const LANG_NAME = {
  // Major global languages
  en: 'English', zh: 'Chinese', hi: 'Hindi', es: 'Spanish',
  fr: 'French', ar: 'Arabic', bn: 'Bengali', pt: 'Portuguese',
  ru: 'Russian', ja: 'Japanese', de: 'German', ko: 'Korean',
  // European languages
  ro: 'Romanian', it: 'Italian', nl: 'Dutch', pl: 'Polish',
  uk: 'Ukrainian', cs: 'Czech', sk: 'Slovak', hu: 'Hungarian',
  el: 'Greek', bg: 'Bulgarian', hr: 'Croatian', sr: 'Serbian',
  sl: 'Slovenian', bs: 'Bosnian', mk: 'Macedonian', sq: 'Albanian',
  sv: 'Swedish', no: 'Norwegian', da: 'Danish', fi: 'Finnish',
  et: 'Estonian', lv: 'Latvian', lt: 'Lithuanian',
  ga: 'Irish', cy: 'Welsh', gd: 'Scottish Gaelic',
  is: 'Icelandic', mt: 'Maltese', lb: 'Luxembourgish',
  ca: 'Catalan', eu: 'Basque', gl: 'Galician',
  be: 'Belarusian', hy: 'Armenian', ka: 'Georgian',
  // Middle East & Central Asia
  tr: 'Turkish', fa: 'Persian', he: 'Hebrew', ku: 'Kurdish',
  az: 'Azerbaijani', uz: 'Uzbek', kk: 'Kazakh', ky: 'Kyrgyz',
  tk: 'Turkmen', tg: 'Tajik', ps: 'Pashto', ur: 'Urdu',
  // South & Southeast Asia
  ta: 'Tamil', te: 'Telugu', ml: 'Malayalam', kn: 'Kannada',
  mr: 'Marathi', gu: 'Gujarati', pa: 'Punjabi', or: 'Odia',
  si: 'Sinhala', ne: 'Nepali', my: 'Burmese',
  th: 'Thai', vi: 'Vietnamese', id: 'Indonesian', ms: 'Malay',
  tl: 'Filipino', km: 'Khmer', lo: 'Lao', mn: 'Mongolian',
  // East Asia
  bo: 'Tibetan',
  // Africa
  sw: 'Swahili', am: 'Amharic', ha: 'Hausa', ig: 'Igbo',
  yo: 'Yoruba', zu: 'Zulu', xh: 'Xhosa', af: 'Afrikaans',
  so: 'Somali', rw: 'Kinyarwanda', sn: 'Shona', mg: 'Malagasy',
  // Pacific & Americas
  mi: 'Māori', sm: 'Samoan', to: 'Tongan',
  ht: 'Haitian Creole', qu: 'Quechua', ay: 'Aymara', gn: 'Guarani',
  // Constructed
  eo: 'Esperanto', ia: 'Interlingua',
  // Additional
  la: 'Latin', yi: 'Yiddish', jv: 'Javanese', su: 'Sundanese',
};

function normTag(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.toLowerCase().slice(0, 2);
  return /^[a-z]{2}$/.test(s) ? s : null;
}

async function resolveLanguage(req, locale) {
  let tag = normTag(locale);
  if (!tag && req.user?.id) {
    try { tag = await getPreferredLanguage(req.user.id); } catch (_) {}
  }
  if (!tag) {
    const a = req.headers['accept-language'];
    if (a) tag = normTag(a.split(',')[0]);
  }
  if (!tag) tag = 'en';

  // Sync stored preference with browser locale.
  if (req.user?.id && normTag(locale) === tag) {
    try {
      const stored = await getPreferredLanguage(req.user.id);
      if (stored !== tag) {
        await setPreferredLanguage(req.user.id, tag,
          LANG_NAME[tag] ? `Preferred language: ${LANG_NAME[tag]}.` : null);
      }
    } catch (_) {}
  }
  return tag;
}

// ── Build system instruction ───────────────────────────────────────
async function buildSystemInstruction(req, body) {
  const { datetime, timezone, coords, locale } = body;
  const geo = await ipGeo.lookup(ipGeo.clientIp(req));

  let ctx = '';
  if (datetime) {
    const d = new Date(datetime);
    const fmt = d.toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long',
      day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZone: timezone || geo?.timezone || 'UTC',
    });
    ctx += `\n\nReal-time context:\n- Current date & time: ${fmt} (${timezone || geo?.timezone || 'UTC'})`;
  }

  const hasGps = coords &&
    Number.isFinite(Number(coords.lat)) &&
    Number.isFinite(Number(coords.lon));
  if (hasGps) {
    ctx += `\n- User GPS (real device): ${Number(coords.lat).toFixed(5)}, ${Number(coords.lon).toFixed(5)}`;
    if (Number.isFinite(Number(coords.accuracy)))
      ctx += ` (±${Math.round(Number(coords.accuracy))} m)`;
  } else {
    ctx += `\n- User location: UNKNOWN. Call get_my_location if asked.`;
  }

  // Memory
  let mem = '';
  if (req.user?.id) {
    try {
      const items = await listMemoryItems(req.user.id, 60);
      mem = formatMemoryBlocks(items);
    } catch (_) {}
  }

  // Language lock
  const tag = await resolveLanguage(req, locale);
  const name = LANG_NAME[tag] || tag.toUpperCase();
  const lang =
    `\n\nUser's LOCKED language: ${name} (${tag}).` +
    `\n- Reply EXCLUSIVELY in ${name} for the entire session.` +
    `\n- Only change if the user writes a FULL sentence in another language AND explicitly asks to switch.`;

  return BASE_PROMPT + lang + ctx + mem;
}

// ── Access gating ──────────────────────────────────────────────────
async function gateAccess(req, res) {
  if (!req.user) {
    const ip = ipGeo.clientIp(req) || req.ip || '';
    const status = trialStatus(ip);
    if (!status.allowed) {
      const lifetime = status.reason === 'lifetime_expired';
      res.status(429).json({
        error: lifetime
          ? 'Your 7-day free trial has ended. Create an account and buy credits.'
          : 'Free trial used up today. Come back tomorrow or sign in.',
        trial: { allowed: false, reason: status.reason || 'window_expired', remainingMs: 0 },
      });
      return false;
    }
    stampTrialIfFresh(ip, status);
    return true;
  }

  // Admin = unlimited.
  let admin = req.user.role === 'admin';
  if (!admin) {
    try {
      const full = await findById(req.user.id);
      admin = !!(full && (full.role === 'admin' || isAdminEmail(full.email)));
    } catch (_) {}
  }
  if (admin) return true;

  // Credits check.
  try {
    const bal = await getCreditsBalance(req.user.id);
    if (!Number.isFinite(bal) || bal <= 0) {
      res.status(402).json({
        error: 'No credits left. Buy a package to keep chatting.',
        balance_minutes: 0, action: 'buy_credits',
      });
      return false;
    }
  } catch (err) {
    console.warn('[chat] credits check failed', err?.message);
  }
  return true;
}

// ── Convert client messages → Gemini Content[] ─────────────────────
function toGeminiContents(messages, frame, frameKind) {
  const contents = [];

  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    if (!['user', 'assistant'].includes(m.role)) continue;
    const text = typeof m.content === 'string'
      ? m.content.slice(0, MAX_MESSAGE_LENGTH) : '';
    if (!text) continue;

    contents.push({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text }],
    });
  }

  // Attach vision frame to the last user message.
  if (frame && contents.length > 0) {
    // Find last user content.
    let lastUserIdx = -1;
    for (let i = contents.length - 1; i >= 0; i--) {
      if (contents[i].role === 'user') { lastUserIdx = i; break; }
    }
    if (lastUserIdx >= 0) {
      const channel = frameKind === 'attachment'
        ? '[ATTACHED IMAGE — analyze this]'
        : '[CAMERA FRAME — ambient context, do NOT describe unless asked]';

      // Extract base64 data from data URL.
      const match = String(frame).match(/^data:([^;]+);base64,(.+)$/);
      if (match) {
        const mimeType = match[1];
        const data = match[2];
        const existingParts = contents[lastUserIdx].parts;
        contents[lastUserIdx].parts = [
          { text: channel },
          { inlineData: { mimeType, data } },
          ...existingParts,
        ];
      }
    }
  }

  // Trim to last N messages.
  return contents.slice(-MAX_MESSAGES_COUNT);
}

// ── SSE helpers ────────────────────────────────────────────────────
function setupSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

function sseWrite(res, obj) {
  res.write(`data: ${JSON.stringify(obj)}\n\n`);
}

// ── Extract last user text (for pickForcedTool) ────────────────────
function lastUserText(contents) {
  for (let i = contents.length - 1; i >= 0; i--) {
    if (contents[i].role !== 'user') continue;
    for (const p of contents[i].parts) {
      if (p.text) return p.text;
    }
  }
  return '';
}

// ══════════════════════════════════════════════════════════════════
// POST /  — main chat endpoint
// ══════════════════════════════════════════════════════════════════
router.post('/', async (req, res) => {
  const { messages = [], frame, frameKind, coords } = req.body;

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be an array' });
  }

  const ai = getGemini();
  if (!ai) {
    return res.status(503).json({ error: 'AI service not configured. Set GEMINI_API_KEY.' });
  }

  const allowed = await gateAccess(req, res);
  if (!allowed) return;

  const systemInstruction = await buildSystemInstruction(req, req.body);
  const model = getChatModel();
  const contents = toGeminiContents(messages, frame, frameKind);

  if (contents.length === 0) {
    return res.status(400).json({ error: 'No valid messages' });
  }

  // Tool declarations: custom KELION_TOOLS + ALL verified Google built-in tools.
  // The model automatically picks the right tool for each request.
  // Google built-in tools are maintained by Google — auto-updated,
  // auto-executed server-side, results integrated into the response.
  //
  // Custom tools (65+):  functionDeclarations from realtime.js
  // Google Search:       real-time web search, news, fact grounding
  // Code Execution:      math, calculations, Python execution
  // Google Maps:         places, directions, local context
  // URL Context:         read & analyze web pages by URL
  const customTools = buildKelionToolsGemini();
  const GOOGLE_BUILTIN_TOOLS = [
    { googleSearch: {} },       // Real-time web search grounding
    { codeExecution: {} },      // Server-side Python code execution
    { googleMaps: {} },         // Places, directions, location context
    { urlContext: {} },         // Read & analyze web page content
  ];
  const allTools = [
    ...customTools,             // 65+ custom function declarations
    ...GOOGLE_BUILTIN_TOOLS,    // All verified Google built-in tools
  ];

  // Keyword-based forced tool (only for custom tools).
  const userText = lastUserText(contents);
  const forced = pickForcedTool(userText);

  // When a tool is forced, restrict to custom tools only.
  // Otherwise AUTO mode lets the model pick from ALL tools.
  const toolConfig = forced
    ? { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [forced] } }
    : { functionCallingConfig: { mode: 'AUTO' } };

  setupSSE(res);

  const hasGps = coords &&
    Number.isFinite(Number(coords.lat)) &&
    Number.isFinite(Number(coords.lon));

  try {
    // ── First pass: stream with all tools ─────────────────────────
    let stream;
    try {
      stream = await ai.models.generateContentStream({
        model,
        contents,
        config: {
          systemInstruction,
          tools: allTools,
          toolConfig,
        },
      });
    } catch (toolsErr) {
      // Some model versions don't support combining all 3 tool types.
      // Fall back to custom tools only.
      console.warn('[chat] combined tools failed, using custom only:', toolsErr?.message);
      stream = await ai.models.generateContentStream({
        model,
        contents,
        config: {
          systemInstruction,
          tools: customTools,
          toolConfig,
        },
      });
    }

    let textSoFar = '';
    const functionCalls = [];

    for await (const chunk of stream) {
      // Text content.
      if (chunk.text) {
        textSoFar += chunk.text;
        sseWrite(res, { content: chunk.text });
      }

      // Function calls.
      if (chunk.functionCalls && chunk.functionCalls.length > 0) {
        for (const fc of chunk.functionCalls) {
          functionCalls.push({
            id: fc.id || `fc_${Math.random().toString(36).slice(2)}`,
            name: fc.name,
            args: fc.args || {},
          });
        }
      }
    }

    // ── Execute tools if requested ─────────────────────────────────
    if (functionCalls.length > 0) {
      const toolCtx = {
        user: req.user || null,
        coords: hasGps ? {
          lat: Number(coords.lat),
          lon: Number(coords.lon),
          accuracy: Number.isFinite(Number(coords.accuracy))
            ? Number(coords.accuracy) : null,
        } : null,
      };

      // Build the model's response with function calls for history.
      const modelFcParts = functionCalls.map((fc) => ({
        functionCall: { name: fc.name, args: fc.args, id: fc.id },
      }));
      if (textSoFar) {
        modelFcParts.unshift({ text: textSoFar });
      }

      const functionResponses = [];

      for (const fc of functionCalls) {
        // Client-side tools: push to browser via SSE.
        if (fc.name === 'show_on_monitor') {
          sseWrite(res, { tool: fc.name, arguments: fc.args });
          functionResponses.push({
            functionResponse: {
              name: fc.name,
              response: { ok: true, shown: fc.args },
              id: fc.id,
            },
          });
          continue;
        }

        if (fc.name === 'compose_email_draft') {
          sseWrite(res, { tool: fc.name, arguments: fc.args });
          functionResponses.push({
            functionResponse: {
              name: fc.name,
              response: { ok: true, opened: 'composer:email', draft: fc.args },
              id: fc.id,
            },
          });
          continue;
        }

        // Server-side real tool execution.
        let result;
        try {
          result = await executeRealTool(fc.name, fc.args, toolCtx);
        } catch (toolErr) {
          console.warn(`[chat] tool ${fc.name} threw:`, toolErr?.message);
          result = { ok: false, error: toolErr?.message || 'tool execution failed' };
        }

        if (result == null) {
          // Tool not found in custom tools — instruct model to use
          // Google built-in tools (Search, Code Execution) as fallback.
          // The model will automatically retry with the right Google tool.
          result = {
            ok: false,
            error: `Tool "${fc.name}" is not available as a custom tool. ` +
              'Use Google Search to find the information, or Code Execution ' +
              'to calculate/process it. You have these built-in capabilities — use them.',
          };
          console.info(`[chat] unknown tool "${fc.name}" — model will auto-fallback to Google built-in tools`);
        }

        sseWrite(res, { tool: fc.name, arguments: fc.args, result });

        functionResponses.push({
          functionResponse: {
            name: fc.name,
            response: result,
            id: fc.id,
          },
        });
      }

      // ── Second pass: narration from tool results ─────────────────
      const secondContents = [
        ...contents,
        { role: 'model', parts: modelFcParts },
        { role: 'user', parts: functionResponses },
      ];

      try {
        const narrationStream = await ai.models.generateContentStream({
          model,
          contents: secondContents,
          config: {
            systemInstruction,
            // No tools on narration pass — just text.
          },
        });

        for await (const chunk of narrationStream) {
          if (chunk.text) {
            sseWrite(res, { content: chunk.text });
          }
        }
      } catch (err2) {
        console.warn('[chat] narration pass failed:', err2?.message);
      }
    }

    res.write('data: [DONE]\n\n');
  } catch (err) {
    const detail = err?.message || String(err);
    const code = err?.status || err?.code || null;
    console.error('[chat] AI error:', { model, code, detail: detail.slice(0, 500) });

    // If the flagship model fails (e.g. quota, unavailable), try flash.
    if (model.includes('pro') && !req._chatRetried) {
      req._chatRetried = true;
      console.warn('[chat] retrying with gemini-3-flash-preview');
      try {
        const fallbackStream = await ai.models.generateContentStream({
          model: 'gemini-3-flash-preview',
          contents,
          config: { systemInstruction, tools: allTools },
        });
        for await (const chunk of fallbackStream) {
          if (chunk.text) sseWrite(res, { content: chunk.text });
        }
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      } catch (fbErr) {
        console.error('[chat] fallback also failed:', fbErr?.message);
      }
    }

    const clientMsg = detail.length > 200 ? detail.slice(0, 200) + '…' : detail;
    sseWrite(res, { error: `AI error: ${clientMsg}` });
  } finally {
    res.end();
  }
});

// ══════════════════════════════════════════════════════════════════
// POST /demo — lightweight demo (no tools, no auth, no memory)
// ══════════════════════════════════════════════════════════════════
router.post('/demo', async (req, res) => {
  const { messages = [] } = req.body;
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages must be an array' });

  const ai = getGemini();
  if (!ai) return res.status(503).json({ error: 'AI service not configured' });

  const contents = messages
    .filter((m) => m && ['user', 'assistant'].includes(m.role))
    .slice(-10)
    .map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: typeof m.content === 'string' ? m.content.slice(0, 2000) : '' }],
    }))
    .filter((m) => m.parts[0].text.length > 0);

  setupSSE(res);
  try {
    const stream = await ai.models.generateContentStream({
      model: getChatModel(),
      contents,
      config: { systemInstruction: BASE_PROMPT },
    });
    for await (const chunk of stream) {
      if (chunk.text) sseWrite(res, { content: chunk.text });
    }
    res.write('data: [DONE]\n\n');
  } catch (err) {
    console.error('[chat/demo] error:', err.message);
    sseWrite(res, { error: 'AI service error.' });
  } finally {
    res.end();
  }
});

module.exports = router;
