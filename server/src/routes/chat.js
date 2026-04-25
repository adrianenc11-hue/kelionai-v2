'use strict';

const { Router } = require('express');
const { getAI, getDefaultChatModel } = require('../utils/openai');
const { getCreditsBalance, findById, listMemoryItems, setPreferredLanguage, getPreferredLanguage } = require('../db');
const { isAdminEmail } = require('../middleware/subscription');
const ipGeo = require('../services/ipGeo');
const { trialStatus, stampTrialIfFresh } = require('../services/trialQuota');
const { executeRealTool, pickForcedTool } = require('../services/realTools');
const { buildKelionToolsChatCompletions, formatMemoryBlocks } = require('./realtime');

const router = Router();

const BASE_PROMPT = `You are Kelion, an AI assistant created by AE Studio, after an idea by Adrian Enciulescu. For contact: contact@kelionai.app.

Detect the user's language automatically and reply in that language. Never mix languages in one response.

Tools you MUST use when relevant (never guess when a tool fits):
- show_on_monitor(kind, query, title?) — display maps, weather, video, images, web pages, or play audio on the monitor.
- compose_email_draft(to, subject, body, cc?, bcc?, reply_to?) — open the email composer.
- play_radio(query?, country?, language?, tag?) — find and play a live radio station, then call show_on_monitor with kind='audio'.
- calculate(expression) — deterministic math.
- get_weather(city or lat/lon, days) — real weather data.
- web_search(query, limit) — live web search.
- translate(text, to, from) — translation.

Honesty rules:
- Never claim you did something you did not do.
- Never invent numbers, names, URLs, or facts. Use tools or say "I don't know".
- Never announce which tool you are calling. Just call it and answer with the result.
- Silent tools (never mention): observe_user_emotion, learn_from_observation, get_action_history, plan_task.

You have access to real-time information provided in the system context below.`;

// Single source of truth for the tool catalog: realtime.js owns KELION_TOOLS
// and the adapter below converts it to OpenAI Chat Completions shape. Kept in
// realtime.js because the voice transports also consume it — keeping it in
// one place (Devin Review ask on PR #133) avoids drift between text/voice.
const CHAT_TOOLS = buildKelionToolsChatCompletions();

const MAX_MESSAGE_LENGTH = 4000;
const MAX_MESSAGES_COUNT = 40;

// Adrian 2026-04-25: "default engleza e obligat sa detecteze limba user si o
// va folosi permanent cit e logat". Once we know the user's language (from
// their browser locale on the client, or their stored preference for signed-in
// users), every reply must stay in that language for the rest of the session.
// No silent revert to English on ambiguous turns. The mapping below covers the
// languages we have explicit native-language voice prompts for; anything else
// passes through as the BCP-47 short tag and the model is instructed to reply
// in that language anyway.
const LANG_NAME_BY_TAG = {
  ro: 'Romanian',
  en: 'English',
  fr: 'French',
  es: 'Spanish',
  it: 'Italian',
  de: 'German',
  pt: 'Portuguese',
  ru: 'Russian',
  nl: 'Dutch',
  pl: 'Polish',
  tr: 'Turkish',
  uk: 'Ukrainian',
  hu: 'Hungarian',
  cs: 'Czech',
  el: 'Greek',
  sv: 'Swedish',
  no: 'Norwegian',
  fi: 'Finnish',
  da: 'Danish',
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

router.post('/', async (req, res) => {
  const { messages = [], avatar = 'kelion', frame, frameKind, datetime, timezone, coords, locale } = req.body;
  // `frameKind` disambiguates the two visual channels:
  //   - 'attachment' → user explicitly uploaded an image; describe / analyze
  //     it freely.
  //   - 'camera'     → passive webcam frame; silent-vision rules apply.
  //   - undefined    → legacy clients; default to 'camera' (safer — keeps
  //     the model from over-narrating).
  const visionChannel = frameKind === 'attachment' ? 'attachment' : 'camera';

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be an array' });
  }

  const ai = getAI();
  if (!ai) {
    return res.status(503).json({ error: 'AI service not configured. Set GEMINI_API_KEY or OPENAI_API_KEY.' });
  }

  // Gating matrix (mirrors /api/realtime):
  //   - guest (no JWT):          15-min/day IP window, 7-day lifetime cap
  //   - signed-in non-admin:     credits balance > 0 (402 if not)
  //   - admin:                   unlimited, never gated
  //
  // Adrian: "daca ti-ai facut user nu trebuie sa functioneze daca nu ai
  // cumparat credit. Functioneaza free fara credit 15 min/zi, maxim 1
  // saptamina. Dupa ce iti faci user nu functioneaza, da mesaj ca trebuie
  // cumparat credit". Text chat goes through the same gate as voice now.
  const isGuest = !req.user;
  if (isGuest) {
    const ip = ipGeo.clientIp(req) || req.ip || '';
    const status = trialStatus(ip);
    if (!status.allowed) {
      // Two reasons the guest trial denies:
      //   - window_expired: 15-min daily chunk used up, come back tomorrow
      //   - lifetime_expired: 7 days of free access consumed, must sign up
      // We surface `reason` so the client can swap the error message from
      // "try again tomorrow" to "create an account to keep talking".
      const isLifetime = status.reason === 'lifetime_expired';
      const body = {
        error: isLifetime
          ? 'Your 7-day free trial has ended. Please create an account and buy credits to keep chatting with Kelion.'
          : 'Free trial for today is used up. Come back tomorrow or sign in to continue.',
        trial: {
          allowed: false,
          reason:  status.reason || 'window_expired',
          remainingMs: 0,
          ...(status.nextWindowMs != null ? { nextWindowMs: status.nextWindowMs } : {}),
        },
      };
      return res.status(429).json(body);
    }
    // Stamp on the first text message — this is what kicks off the 15-min
    // countdown for text-first users (who may never press Tap-to-talk).
    stampTrialIfFresh(ip, status);
  } else {
    // Signed-in users: admin is unlimited, everyone else needs credits > 0.
    // We skip the DB admin-email lookup when the JWT already claims the
    // `admin` role (fast path for the vast majority of admin requests).
    let isAdmin = req.user.role === 'admin';
    if (!isAdmin) {
      try {
        const full = await findById(req.user.id);
        isAdmin = Boolean(
          full && (full.role === 'admin' || isAdminEmail(full.email))
        );
      } catch (_) { /* DB glitch — treat as non-admin; credit gate still runs */ }
    }
    if (!isAdmin) {
      try {
        const balance = await getCreditsBalance(req.user.id);
        if (!Number.isFinite(balance) || balance <= 0) {
          return res.status(402).json({
            error: 'No credits left. Buy a package to keep chatting with Kelion.',
            balance_minutes: 0,
            action: 'buy_credits',
          });
        }
      } catch (err) {
        // DB glitch — fail open so a transient outage doesn't kill paying
        // users' text chat. The /api/credits/consume heartbeat on voice
        // sessions is the second line of defense.
        console.warn('[chat] credits-balance lookup failed', err && err.message);
      }
    }
  }

  // IP-based geolocation is used ONLY for timezone fallback when the
  // client doesn't supply one — never for the user's "where am I"
  // answer. Adrian: "permanent trebuie sa foloseasca coordonatele gps
  // reale ale aparatului". Putting an IP-derived city into the system
  // prompt makes Kelion confidently lie about location (often the wrong
  // city, sometimes the wrong country when the user is on a VPN). We
  // surface "location unknown" instead and let the model ask the user
  // to enable location.
  const geo = await ipGeo.lookup(ipGeo.clientIp(req));

  // Build real-time context for system prompt
  let realtimeContext = '';
  if (datetime) {
    const d = new Date(datetime);
    const formatted = d.toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long',
      day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZone: timezone || geo?.timezone || 'UTC',
    });
    realtimeContext += `\n\nReal-time context:\n- Current date & time: ${formatted} (${timezone || geo?.timezone || 'UTC'})`;
  }
  const hasClientGps = coords && Number.isFinite(Number(coords.lat)) && Number.isFinite(Number(coords.lon));
  if (hasClientGps) {
    realtimeContext += `\n- User GPS coordinates (real device GPS): ${Number(coords.lat).toFixed(5)}, ${Number(coords.lon).toFixed(5)}`;
    if (Number.isFinite(Number(coords.accuracy))) {
      realtimeContext += ` (±${Math.round(Number(coords.accuracy))} m)`;
    }
  } else {
    realtimeContext += `\n- User location: UNKNOWN. The device has not shared GPS yet. If the user asks where they are, asks for "the weather here", or any location-dependent question, call get_my_location FIRST. If get_my_location returns no coords, ask the user to tap the screen and allow location access — never invent a city, never use IP geolocation.`;
  }

  // Long-term memory injection — mirrors the realtime (voice) path at
  // server/src/routes/realtime.js so text chat and voice chat share the
  // same durable facts about the signed-in user. Without this, Kelion
  // would forget the user's name, preferences, and ongoing projects the
  // instant they switched from voice to typing. Guests have no memory
  // row; we silently skip the lookup.
  // Audit M9 — share the self/other partitioning with the voice path
  // via formatMemoryBlocks. See server/src/routes/realtime.js for the
  // rationale; the short version is "don't let facts about Ioana land
  // on Adrian's profile section".
  let memorySection = '';
  if (req.user && (Number.isFinite(req.user.id) || typeof req.user.id === 'string')) {
    try {
      const memoryItems = await listMemoryItems(req.user.id, 60);
      memorySection = formatMemoryBlocks(memoryItems);
    } catch (err) {
      console.warn('[chat] memory load failed', err && err.message);
    }
  }

  // Locked-language resolution. Priority — current browser ALWAYS wins so a
  // user travelling between devices sees the language of the device they are
  // on right now, not whatever was stamped on their account at first login.
  //   1. Browser locale forwarded by the client on every chat request
  //      (`req.body.locale`, e.g. "ro-RO").
  //   2. The user's stored `preferred_language` (signed-in users only) —
  //      used as a fallback when the client did not send a locale.
  //   3. Accept-Language header.
  //   4. "en" — explicit final fallback.
  //
  // For signed-in users: keep their stored preferred_language in sync with
  // the active browser. If the browser locale differs from what's stored,
  // overwrite — Adrian's case (preferred_language='en' stamped at first
  // Google sign-in, but his actual browser is ro-RO). This is the
  // permanent fix for "default engleza e obligat sa detecteze limba user".
  let lockedLangTag = normalizeLocaleTag(locale);
  if (!lockedLangTag && req.user && (Number.isFinite(req.user.id) || typeof req.user.id === 'string')) {
    try {
      lockedLangTag = await getPreferredLanguage(req.user.id);
    } catch (err) {
      console.warn('[chat] read preferred_language failed', err && err.message);
    }
  }
  if (!lockedLangTag) {
    const accept = req.headers['accept-language'];
    if (accept && typeof accept === 'string') {
      lockedLangTag = normalizeLocaleTag(accept.split(',')[0]);
    }
  }
  if (!lockedLangTag) lockedLangTag = 'en';

  if (
    req.user &&
    (Number.isFinite(req.user.id) || typeof req.user.id === 'string') &&
    normalizeLocaleTag(locale) === lockedLangTag
  ) {
    try {
      const stored = await getPreferredLanguage(req.user.id);
      if (stored !== lockedLangTag) {
        const langName = languageNameForTag(lockedLangTag);
        await setPreferredLanguage(
          req.user.id,
          lockedLangTag,
          langName ? `Preferred language: ${langName}.` : null
        );
      }
    } catch (err) {
      console.warn('[chat] sync preferred_language failed', err && err.message);
    }
  }

  const lockedLangName = languageNameForTag(lockedLangTag) || 'English';
  const lockedLangBlock =
    `\n\nUser's LOCKED language: ${lockedLangName} (${lockedLangTag}).` +
    `\n- Reply EXCLUSIVELY in ${lockedLangName} for the entire session.` +
    `\n- This overrides every other language rule. Never silently default to English.` +
    `\n- Single English / loanword tokens ("ok", "stop", "wow", brand names) DO NOT count as a language switch — keep replying in ${lockedLangName}.` +
    `\n- Only change language if the user writes a FULL sentence in another language AND explicitly asks you to switch ("vorbește în engleză", "speak French", "passa all'italiano"). Otherwise stay locked.`;

  const systemPrompt = BASE_PROMPT + lockedLangBlock + realtimeContext + memorySection;
  const model = getDefaultChatModel();

  // Sanitize message history
  const sanitized = messages
    .filter(m => m && typeof m === 'object' && ['user', 'assistant'].includes(m.role))
    .slice(-MAX_MESSAGES_COUNT)
    .map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content.slice(0, MAX_MESSAGE_LENGTH) : '' }))
    .filter(m => m.content.length > 0);

  // If a frame is provided, attach it to the last user message as a vision
  // input. We prepend an explicit channel label so the model can apply the
  // right policy from the persona — describe attachments freely, stay
  // silent on ambient camera frames. Without the label the two channels
  // were indistinguishable to the model and it would describe whichever
  // image was richer (typically the camera), even when the user had
  // attached a separate file. See PR #213.
  if (frame && sanitized.length > 0) {
    const lastUserIdx = [...sanitized].map(m => m.role).lastIndexOf('user');
    if (lastUserIdx !== -1) {
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
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  // Tell upstream proxies (Cloudflare / nginx / Railway edge) not to
  // buffer this response. Without it, the final tokens of a short
  // SSE stream can sit in the proxy buffer until well after the
  // client has rendered the bubble, so users see a half-sentence
  // reply ("Ce pot face pentru" with the final "tine?" lost) before
  // the late flush arrives — too late for the bubble to show it.
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Stream a chat completion with tool-calling enabled. When the model emits
  // a show_on_monitor tool_call, we forward it to the client as a
  // `{"tool":...}` SSE frame (the client invokes handleShowOnMonitor) and
  // then ask the model for a short confirmation reply. Two passes, but the
  // user only sees one continuous stream: first the tool frame, then the
  // final narration ("Here's Cluj-Napoca on the monitor.").
  // Detect keyword-driven tool forcing from the most recent user message.
  // When the user's question clearly calls for calculate / get_weather /
  // web_search / translate, we set tool_choice to force the model to emit
  // a function call instead of hallucinating a plain-text answer. Falls
  // back to 'auto' otherwise so the model can still freely chat.
  const lastUserText = (() => {
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
  })();
  const forcedTool = pickForcedTool(lastUserText);

  async function streamOnce(msgs, opts = {}) {
    const body = {
      model,
      stream: true,
      tools: CHAT_TOOLS,
      tool_choice: opts.toolChoice || 'auto',
      messages: msgs,
    };
    const stream = await ai.chat.completions.create(body);
    let textSoFar = '';
    const toolAcc = {}; // index -> { id, name, args }
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

  try {
    const firstMsgs = [{ role: 'system', content: systemPrompt }, ...sanitized];
    // If a keyword forces a specific tool, pass it on the first pass only —
    // after the tool result lands, the model is free to answer in prose.
    const firstOpts = forcedTool
      ? { toolChoice: { type: 'function', function: { name: forcedTool } } }
      : {};
    const first = await streamOnce(firstMsgs, firstOpts);

    // Per OpenAI API (documented 2024-08-06): when `tool_choice` is set to a
    // specific function, `finish_reason` comes back as `'stop'` not
    // `'tool_calls'`. Devin Review BUG_0001 on PR #133 flagged this as the
    // reason the forced-tool path was silently dropping tool calls — accept
    // either terminator so both the auto and the forced paths work.
    if (first.toolCalls.length > 0 && (first.finishReason === 'tool_calls' || first.finishReason === 'stop')) {
      // Assemble the assistant tool-call turn and synthetic tool results so
      // the second pass can produce the natural-language reply. Client-side
      // tools (show_on_monitor) succeed optimistically; server-side tools
      // (calculate/get_weather/web_search/translate) actually run here and
      // their JSON results are fed back so the model's next reply is
      // grounded in real data — not guessed.
      const toolCallsForHistory = first.toolCalls.map((t) => ({
        id: t.id || `call_${Math.random().toString(36).slice(2)}`,
        type: 'function',
        function: { name: t.name, arguments: t.args || '{}' },
      }));
      const toolMessages = [];
      for (let i = 0; i < first.toolCalls.length; i++) {
        const t = first.toolCalls[i];
        const tool_call_id = toolCallsForHistory[i].id;
        let parsed = {};
        try { parsed = JSON.parse(t.args || '{}'); } catch (_) { /* ignore */ }

        if (t.name === 'show_on_monitor') {
          // Emit the tool frame to the client — it runs handleShowOnMonitor
          // and updates the overlay immediately, before the narration lands.
          res.write(`data: ${JSON.stringify({ tool: t.name, arguments: parsed })}\n\n`);
          toolMessages.push({
            role: 'tool',
            tool_call_id,
            content: JSON.stringify({ ok: true, shown: parsed }),
          });
          continue;
        }

        if (t.name === 'compose_email_draft') {
          // Renderer-only: forward the draft to the client which opens the
          // email composer modal. Nothing is delivered until the user
          // explicitly clicks Send (which routes through send_email).
          res.write(`data: ${JSON.stringify({ tool: t.name, arguments: parsed })}\n\n`);
          toolMessages.push({
            role: 'tool',
            tool_call_id,
            content: JSON.stringify({ ok: true, opened: 'composer:email', draft: parsed }),
          });
          continue;
        }

        // Server-executed real tools. executeRealTool returns null for
        // unrecognised names so we can distinguish "not handled here" from
        // "tool ran and returned data". Pass user + real GPS coords via
        // ctx so tools like get_my_credits and get_my_location can read
        // them without going back through the request closure.
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
          // Let the client echo the tool call into the UI (shows a small
          // "Kelion used calculate(...)" chip). The rendered result is
          // whatever the model says in the second pass; we just announce.
          res.write(`data: ${JSON.stringify({ tool: t.name, arguments: parsed, result })}\n\n`);
          toolMessages.push({
            role: 'tool',
            tool_call_id,
            content: JSON.stringify(result).slice(0, 8000),
          });
          continue;
        }

        toolMessages.push({
          role: 'tool',
          tool_call_id,
          content: JSON.stringify({ ok: false, error: 'unknown tool' }),
        });
      }

      const secondMsgs = [
        ...firstMsgs,
        {
          role: 'assistant',
          content: first.text || '',
          tool_calls: toolCallsForHistory,
        },
        ...toolMessages,
      ];
      // Second pass lets the model freely produce a final natural-language
      // reply given the real tool results. No forced tool_choice here.
      await streamOnce(secondMsgs, { toolChoice: 'auto' });
    }
    res.write('data: [DONE]\n\n');
  } catch (err) {
    console.error('[chat] AI error:', err.message);
    res.write(`data: ${JSON.stringify({ error: 'AI service error. Please try again.' })}\n\n`);
  } finally {
    res.end();
  }
});

// Demo endpoint
router.post('/demo', async (req, res) => {
  const { messages = [] } = req.body;
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages must be an array' });

  const ai = getAI();
  if (!ai) return res.status(503).json({ error: 'AI service not configured' });

  const sanitized = messages
    .filter(m => m && typeof m === 'object' && ['user', 'assistant'].includes(m.role))
    .slice(-10)
    .map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content.slice(0, 2000) : '' }))
    .filter(m => m.content.length > 0);

  const model = getDefaultChatModel();

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  try {
    const stream = await ai.chat.completions.create({
      model, stream: true,
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
