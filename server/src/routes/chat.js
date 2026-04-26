'use strict';

const { Router } = require('express');
const { getAI, getDefaultChatModel } = require('../utils/openai');
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
const { buildKelionToolsChatCompletions, formatMemoryBlocks } = require('./realtime');

const router = Router();

// ── System prompt ──────────────────────────────────────────────────
// No hardcoded tool list — the model sees the tools via the `tools`
// parameter of the Chat Completions API.  Keeping them in the prompt
// text caused desync whenever a tool was added/removed in realtime.js.
const BASE_PROMPT = `You are Kelion, an AI assistant created by AE Studio, after an idea by Adrian Enciulescu. For contact: contact@kelionai.app.

Detect the user's language automatically and reply in that language. Never mix languages in one response.

You have access to tools — use them whenever relevant instead of guessing.

Honesty rules:
- Never claim you did something you did not do.
- Never invent numbers, names, URLs, or facts. Use tools or say "I don't know".
- Never announce which tool you are calling. Just call it and answer with the result.
- Silent tools (never mention): observe_user_emotion, learn_from_observation, get_action_history, plan_task.

You have access to real-time information provided in the system context below.`;

// ── Tool catalog ───────────────────────────────────────────────────
// Single source of truth: realtime.js owns KELION_TOOLS and the
// adapter converts to OpenAI Chat Completions shape (Devin Review PR
// #133 — one copy, no drift between text/voice).
//
// Gemini's OpenAI-compat endpoint rejects schemas with features it
// doesn't support (nested objects in array items, certain enum
// positions).  We sanitise the schema recursively so the request
// never 400s on schema validation.
function sanitiseProperties(props) {
  if (!props || typeof props !== 'object') return {};
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    const clean = { type: v.type || 'string' };
    if (v.description) clean.description = v.description;
    if (v.enum) clean.enum = v.enum;
    // Flatten array items to simple types — Gemini rejects nested
    // object schemas inside array items via the compat endpoint.
    if (v.type === 'array') {
      if (v.items && v.items.type === 'object') {
        clean.type = 'string';
        clean.description = (clean.description || '') +
          ' (JSON array of objects as a string)';
      } else {
        clean.items = v.items ? { type: v.items.type || 'string' } : { type: 'string' };
      }
    }
    // Skip nested object properties — flatten to JSON string.
    if (v.type === 'object') {
      clean.type = 'string';
      clean.description = (clean.description || '') +
        ' (JSON object as a string)';
    }
    out[k] = clean;
  }
  return out;
}

function buildSafeTools() {
  try {
    const raw = buildKelionToolsChatCompletions();
    return raw.map((t) => {
      const fn = t.function || {};
      const params = fn.parameters || {};
      return {
        type: 'function',
        function: {
          name: fn.name,
          description: fn.description || '',
          parameters: {
            type: 'object',
            properties: sanitiseProperties(params.properties),
            required: Array.isArray(params.required) ? params.required : [],
          },
        },
      };
    });
  } catch (err) {
    console.error('[chat] buildSafeTools failed:', err && err.message);
    return [];
  }
}

const CHAT_TOOLS = buildSafeTools();

const MAX_MESSAGE_LENGTH = 4000;
const MAX_MESSAGES_COUNT = 40;

// ── Language helpers ───────────────────────────────────────────────
// Adrian 2026-04-25: "default engleza e obligat sa detecteze limba
// user si o va folosi permanent cit e logat".
const LANG_NAME_BY_TAG = {
  ro: 'Romanian', en: 'English', fr: 'French', es: 'Spanish',
  it: 'Italian', de: 'German', pt: 'Portuguese', ru: 'Russian',
  nl: 'Dutch', pl: 'Polish', tr: 'Turkish', uk: 'Ukrainian',
  hu: 'Hungarian', cs: 'Czech', el: 'Greek', sv: 'Swedish',
  no: 'Norwegian', fi: 'Finnish', da: 'Danish',
};

function normalizeLocaleTag(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const short = raw.toLowerCase().slice(0, 2);
  if (!/^[a-z]{2}$/.test(short)) return null;
  return short;
}

function languageNameForTag(short) {
  if (!short) return null;
  return LANG_NAME_BY_TAG[short] || short.toUpperCase();
}

// ── Resolve locked language ────────────────────────────────────────
// Priority: browser locale → stored preference → Accept-Language → 'en'.
async function resolveLanguage(req, locale) {
  let tag = normalizeLocaleTag(locale);

  if (!tag && req.user && (Number.isFinite(req.user.id) || typeof req.user.id === 'string')) {
    try { tag = await getPreferredLanguage(req.user.id); }
    catch (err) { console.warn('[chat] read preferred_language failed', err && err.message); }
  }

  if (!tag) {
    const accept = req.headers['accept-language'];
    if (accept && typeof accept === 'string') {
      tag = normalizeLocaleTag(accept.split(',')[0]);
    }
  }

  if (!tag) tag = 'en';

  // Keep stored preference in sync with the active browser locale.
  if (
    req.user &&
    (Number.isFinite(req.user.id) || typeof req.user.id === 'string') &&
    normalizeLocaleTag(locale) === tag
  ) {
    try {
      const stored = await getPreferredLanguage(req.user.id);
      if (stored !== tag) {
        const langName = languageNameForTag(tag);
        await setPreferredLanguage(
          req.user.id, tag,
          langName ? `Preferred language: ${langName}.` : null,
        );
      }
    } catch (err) { console.warn('[chat] sync preferred_language failed', err && err.message); }
  }

  return tag;
}

// ── Build the full system prompt ───────────────────────────────────
async function buildSystemPrompt(req, body) {
  const { datetime, timezone, coords, locale } = body;

  // Geolocation (IP is ONLY for timezone fallback — never for "where am I").
  const geo = await ipGeo.lookup(ipGeo.clientIp(req));

  // Real-time context
  let ctx = '';
  if (datetime) {
    const d = new Date(datetime);
    const formatted = d.toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long',
      day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZone: timezone || geo?.timezone || 'UTC',
    });
    ctx += `\n\nReal-time context:\n- Current date & time: ${formatted} (${timezone || geo?.timezone || 'UTC'})`;
  }

  const hasGps = coords && Number.isFinite(Number(coords.lat)) && Number.isFinite(Number(coords.lon));
  if (hasGps) {
    ctx += `\n- User GPS coordinates (real device GPS): ${Number(coords.lat).toFixed(5)}, ${Number(coords.lon).toFixed(5)}`;
    if (Number.isFinite(Number(coords.accuracy))) {
      ctx += ` (±${Math.round(Number(coords.accuracy))} m)`;
    }
  } else {
    ctx += `\n- User location: UNKNOWN. The device has not shared GPS yet. If the user asks where they are, asks for "the weather here", or any location-dependent question, call get_my_location FIRST. If get_my_location returns no coords, ask the user to tap the screen and allow location access — never invent a city, never use IP geolocation.`;
  }

  // Memory
  let memorySection = '';
  if (req.user && (Number.isFinite(req.user.id) || typeof req.user.id === 'string')) {
    try {
      const items = await listMemoryItems(req.user.id, 60);
      memorySection = formatMemoryBlocks(items);
    } catch (err) { console.warn('[chat] memory load failed', err && err.message); }
  }

  // Language lock
  const lockedTag = await resolveLanguage(req, locale);
  const lockedName = languageNameForTag(lockedTag) || 'English';
  const langBlock =
    `\n\nUser's LOCKED language: ${lockedName} (${lockedTag}).` +
    `\n- Reply EXCLUSIVELY in ${lockedName} for the entire session.` +
    `\n- This overrides every other language rule. Never silently default to English.` +
    `\n- Single English / loanword tokens ("ok", "stop", "wow", brand names) DO NOT count as a language switch — keep replying in ${lockedName}.` +
    `\n- Only change language if the user writes a FULL sentence in another language AND explicitly asks you to switch ("vorbește în engleză", "speak French", "passa all'italiano"). Otherwise stay locked.`;

  return BASE_PROMPT + langBlock + ctx + memorySection;
}

// ── Access gating ──────────────────────────────────────────────────
// Mirrors /api/realtime: guest → 15-min/day trial, signed-in → credits, admin → unlimited.
async function gateAccess(req, res) {
  const isGuest = !req.user;

  if (isGuest) {
    const ip = ipGeo.clientIp(req) || req.ip || '';
    const status = trialStatus(ip);
    if (!status.allowed) {
      const isLifetime = status.reason === 'lifetime_expired';
      res.status(429).json({
        error: isLifetime
          ? 'Your 7-day free trial has ended. Please create an account and buy credits to keep chatting with Kelion.'
          : 'Free trial for today is used up. Come back tomorrow or sign in to continue.',
        trial: {
          allowed: false,
          reason: status.reason || 'window_expired',
          remainingMs: 0,
          ...(status.nextWindowMs != null ? { nextWindowMs: status.nextWindowMs } : {}),
        },
      });
      return false;
    }
    stampTrialIfFresh(ip, status);
    return true;
  }

  // Signed-in: check admin status.
  let isAdmin = req.user.role === 'admin';
  if (!isAdmin) {
    try {
      const full = await findById(req.user.id);
      isAdmin = Boolean(full && (full.role === 'admin' || isAdminEmail(full.email)));
    } catch (_) { /* DB glitch — treat as non-admin */ }
  }
  if (isAdmin) return true;

  // Non-admin needs credits > 0.
  try {
    const balance = await getCreditsBalance(req.user.id);
    if (!Number.isFinite(balance) || balance <= 0) {
      res.status(402).json({
        error: 'No credits left. Buy a package to keep chatting with Kelion.',
        balance_minutes: 0,
        action: 'buy_credits',
      });
      return false;
    }
  } catch (err) {
    // DB glitch — fail open so transient outage doesn't kill paying users.
    console.warn('[chat] credits-balance lookup failed', err && err.message);
  }

  return true;
}

// ── Sanitise inbound messages ──────────────────────────────────────
function sanitiseMessages(messages) {
  return messages
    .filter((m) => m && typeof m === 'object' && ['user', 'assistant'].includes(m.role))
    .slice(-MAX_MESSAGES_COUNT)
    .map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content.slice(0, MAX_MESSAGE_LENGTH) : '',
    }))
    .filter((m) => m.content.length > 0);
}

// ── Attach vision frame to the last user message ───────────────────
function attachFrame(sanitized, frame, frameKind) {
  if (!frame || sanitized.length === 0) return;
  const visionChannel = frameKind === 'attachment' ? 'attachment' : 'camera';
  const lastUserIdx = [...sanitized].map((m) => m.role).lastIndexOf('user');
  if (lastUserIdx === -1) return;

  const channelLabel = visionChannel === 'attachment'
    ? '[ATTACHED FILE — image the user explicitly uploaded for you to analyze; answer about THIS]'
    : '[CAMERA FRAME — ambient context; do NOT describe unless the user explicitly asked about the camera/room]';
  const userText = sanitized[lastUserIdx].content;

  sanitized[lastUserIdx] = {
    role: 'user',
    content: [
      { type: 'text', text: channelLabel },
      { type: 'image_url', image_url: { url: frame, detail: 'low' } },
      { type: 'text', text: userText },
    ],
  };
}

// ── Extract last user text (for tool forcing) ──────────────────────
function getLastUserText(sanitized) {
  for (let i = sanitized.length - 1; i >= 0; i--) {
    const m = sanitized[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    if (Array.isArray(m.content)) {
      const t = m.content.find((p) => p && p.type === 'text');
      if (t && typeof t.text === 'string') return t.text;
    }
  }
  return '';
}

// ── SSE streaming helper ───────────────────────────────────────────
function setupSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

// ── Stream one chat completion pass ────────────────────────────────
async function streamOnce(ai, model, msgs, res, opts = {}) {
  const body = {
    model,
    stream: true,
    messages: msgs,
  };

  // Only include tools when we have a valid catalog and the caller
  // wants them.  The second (narration) pass runs tool-free.
  if (opts.tools && opts.tools.length > 0) {
    body.tools = opts.tools;
    body.tool_choice = opts.toolChoice || 'auto';
  }

  const stream = await ai.chat.completions.create(body);
  let textSoFar = '';
  const toolAcc = {};
  let finishReason = null;

  for await (const chunk of stream) {
    const choice = chunk.choices && chunk.choices[0];
    if (!choice) continue;
    const delta = choice.delta || {};

    if (delta.content) {
      textSoFar += delta.content;
      res.write(`data: ${JSON.stringify({ content: delta.content })}\n\n`);
    }

    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = typeof tc.index === 'number' ? tc.index : 0;
        if (!toolAcc[idx]) toolAcc[idx] = { id: '', name: '', args: '' };
        if (tc.id) toolAcc[idx].id = tc.id;
        if (tc.function?.name) toolAcc[idx].name = tc.function.name;
        if (tc.function?.arguments) toolAcc[idx].args += tc.function.arguments;
      }
    }

    if (choice.finish_reason) finishReason = choice.finish_reason;
  }

  return { text: textSoFar, toolCalls: Object.values(toolAcc), finishReason };
}

// ── Execute tool calls & build second-pass messages ────────────────
async function processToolCalls(toolCalls, req, coords, hasClientGps, res) {
  const toolCallsForHistory = toolCalls.map((t) => ({
    id: t.id || `call_${Math.random().toString(36).slice(2)}`,
    type: 'function',
    function: { name: t.name, arguments: t.args || '{}' },
  }));

  const toolMessages = [];

  for (let i = 0; i < toolCalls.length; i++) {
    const t = toolCalls[i];
    const tool_call_id = toolCallsForHistory[i].id;
    let parsed = {};
    try { parsed = JSON.parse(t.args || '{}'); } catch (_) { /* ignore */ }

    // Client-side tools: forward to browser.
    if (t.name === 'show_on_monitor') {
      res.write(`data: ${JSON.stringify({ tool: t.name, arguments: parsed })}\n\n`);
      toolMessages.push({
        role: 'tool', tool_call_id,
        content: JSON.stringify({ ok: true, shown: parsed }),
      });
      continue;
    }

    if (t.name === 'compose_email_draft') {
      res.write(`data: ${JSON.stringify({ tool: t.name, arguments: parsed })}\n\n`);
      toolMessages.push({
        role: 'tool', tool_call_id,
        content: JSON.stringify({ ok: true, opened: 'composer:email', draft: parsed }),
      });
      continue;
    }

    // Server-side real tools.
    const ctx = {
      user: req.user || null,
      coords: hasClientGps ? {
        lat: Number(coords.lat),
        lon: Number(coords.lon),
        accuracy: Number.isFinite(Number(coords.accuracy)) ? Number(coords.accuracy) : null,
      } : null,
    };

    const result = await executeRealTool(t.name, parsed, ctx);
    if (result != null) {
      res.write(`data: ${JSON.stringify({ tool: t.name, arguments: parsed, result })}\n\n`);
      toolMessages.push({
        role: 'tool', tool_call_id,
        content: JSON.stringify(result).slice(0, 8000),
      });
      continue;
    }

    toolMessages.push({
      role: 'tool', tool_call_id,
      content: JSON.stringify({ ok: false, error: 'unknown tool' }),
    });
  }

  return { toolCallsForHistory, toolMessages };
}

// ══════════════════════════════════════════════════════════════════
// POST /  — main chat endpoint
// ══════════════════════════════════════════════════════════════════
router.post('/', async (req, res) => {
  const { messages = [], frame, frameKind, coords } = req.body;

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be an array' });
  }

  const ai = getAI();
  if (!ai) {
    return res.status(503).json({ error: 'AI service not configured. Set GEMINI_API_KEY.' });
  }

  // Access gating (trial / credits / admin).
  const allowed = await gateAccess(req, res);
  if (!allowed) return; // gateAccess already sent the response.

  // Build system prompt from real data.
  const systemPrompt = await buildSystemPrompt(req, req.body);
  const model = getDefaultChatModel();

  // Sanitise & prepare messages.
  const sanitized = sanitiseMessages(messages);
  attachFrame(sanitized, frame, frameKind);

  // Keyword-based tool forcing.
  const lastUserText = getLastUserText(sanitized);
  const forcedTool = pickForcedTool(lastUserText);

  // Set up SSE.
  setupSSE(res);

  const hasClientGps = coords && Number.isFinite(Number(coords.lat)) && Number.isFinite(Number(coords.lon));

  try {
    const firstMsgs = [{ role: 'system', content: systemPrompt }, ...sanitized];
    const firstOpts = {
      tools: CHAT_TOOLS,
      ...(forcedTool
        ? { toolChoice: { type: 'function', function: { name: forcedTool } } }
        : {}),
    };

    let first;
    try {
      first = await streamOnce(ai, model, firstMsgs, res, firstOpts);
    } catch (toolErr) {
      // If the request fails with tools (schema rejected by Gemini),
      // retry WITHOUT tools so the user at least gets a text response.
      const errMsg = toolErr?.error?.message || toolErr?.message || '';
      console.warn('[chat] tools-enabled call failed, retrying without tools:', errMsg);
      first = await streamOnce(ai, model, firstMsgs, res, {});
    }

    // Handle tool calls (finish_reason 'tool_calls' or 'stop' for forced tools).
    if (first.toolCalls.length > 0 && (first.finishReason === 'tool_calls' || first.finishReason === 'stop')) {
      const { toolCallsForHistory, toolMessages } = await processToolCalls(
        first.toolCalls, req, coords, hasClientGps, res,
      );

      const secondMsgs = [
        ...firstMsgs,
        {
          role: 'assistant',
          content: first.text || '',
          tool_calls: toolCallsForHistory,
        },
        ...toolMessages,
      ];

      // Second pass: narration — no tools, free prose.
      try {
        await streamOnce(ai, model, secondMsgs, res, {});
      } catch (err2) {
        const detail = err2?.error?.message || err2?.message || String(err2);
        console.warn('[chat] second pass failed:', detail);
        // Don't re-throw — the tool results were already streamed.
      }
    }

    res.write('data: [DONE]\n\n');
  } catch (err) {
    const detail = err?.error?.message || err?.message || String(err);
    const status = err?.status || err?.response?.status || null;
    console.error('[chat] AI error:', { model, status, detail, stack: err?.stack?.slice?.(0, 500) });
    const clientMsg = detail.length > 200 ? detail.slice(0, 200) + '…' : detail;
    res.write(`data: ${JSON.stringify({ error: `AI error: ${clientMsg}` })}\n\n`);
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

  const ai = getAI();
  if (!ai) return res.status(503).json({ error: 'AI service not configured' });

  const sanitized = messages
    .filter((m) => m && typeof m === 'object' && ['user', 'assistant'].includes(m.role))
    .slice(-10)
    .map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content.slice(0, 2000) : '' }))
    .filter((m) => m.content.length > 0);

  const model = getDefaultChatModel();

  setupSSE(res);

  try {
    const stream = await ai.chat.completions.create({
      model,
      stream: true,
      messages: [{ role: 'system', content: BASE_PROMPT }, ...sanitized],
    });
    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
  } catch (err) {
    console.error('[chat/demo] error:', err.message);
    res.write(`data: ${JSON.stringify({ error: 'AI service error.' })}\n\n`);
  } finally {
    res.end();
  }
});

module.exports = router;
