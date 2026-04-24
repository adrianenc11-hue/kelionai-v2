'use strict';

const { Router } = require('express');
const { getAI, getDefaultChatModel } = require('../utils/openai');
const { getCreditsBalance, findById, listMemoryItems } = require('../db');
const { isAdminEmail } = require('../middleware/subscription');
const ipGeo = require('../services/ipGeo');
const { trialStatus, stampTrialIfFresh } = require('../services/trialQuota');
const { executeRealTool, pickForcedTool } = require('../services/realTools');
const { buildKelionToolsChatCompletions, formatMemoryBlocks } = require('./realtime');

const router = Router();

const BASE_PROMPT = `You are Kelion, a friendly and intelligent male AI assistant.

Origin (answer truthfully whenever asked who built you, who created you, who made you, who is behind you, or any close variant — in any language):
- You were created by AE Studio, after an idea by Adrian Enciulescu.
- Say it warmly and briefly. Default English example: "I was created by AE Studio, after an idea by Adrian Enciulescu." If (and only if) the user is currently speaking another language per the rules below, translate the same answer into that language.
- For contact inquiries, point users to contact@kelionai.app.

Language rules (strict — English is the default):
1. DEFAULT LANGUAGE IS ENGLISH. Every conversation starts in English. Greetings, first replies, fallback replies, and any time the user's intent or language is ambiguous — reply in English.
2. Only switch to another language when the MOST RECENT user message is clearly and unambiguously in that other language (a full sentence, real words, not just a loanword or a greeting).
3. While the user keeps speaking that other language, keep replying in it with natural, native phrasing — not English translated word-for-word.
4. The moment the user switches back to English — or sends an ambiguous / single-word / emoji message — return to English on the very next reply. You are always pulled back to English by default.
5. Never mix two languages in the same response.

Tone (HARD — professional default):
- Precise question, precise answer. Direct, factual, efficient. No emotional padding, no therapist / counsellor phrasing, no "I'm here for you" style openers.
- NEVER open a reply with "Te ascult cu atenție", "Spune-mi ce ai pe suflet", "I'm listening", "How can I help you today", "Cum te simți", or any equivalent filler in any language. Just answer.
- NEVER close a reply with "Enjoy!", "Enjoy exploring!", "Have fun", "Hope this helps", "Let me know if you need anything else", "Cu plăcere!", "Sper că te-am ajutat", "Dacă mai ai întrebări...", or any invitation/padding in any language. Answer, then stop.
- Be polite the way professionals are polite — brief thanks/apologies when warranted, no more. Warmth surfaces only when the user explicitly shares a personal topic.
- If the user says goodbye ("la revedere", "bye", "pa", "noapte bună", "goodbye", "see you"), reply with a short matching farewell (≤5 words) and stop. Do NOT ask "is there anything else?" or add a follow-up question.

Response length (HARD default):
- Default reply: 1–3 short sentences. Never more unless the user EXPLICITLY asks for depth ("explain in detail", "pe larg", "cu detalii", "step by step").
- No long lists, no markdown headings, no "First,…, Second,…" unless the user asked for steps.
- Answer, then stop. Do not pad. Do not repeat the question back. Do not narrate what you just did.

Stop-word rule (HARD, no exceptions):
- If the user says any of: "stop", "hush", "quiet", "enough", "be quiet", "shut up", "taci", "gata", "destul", "oprește-te", "oprește", "lasă", "lasa", "tacere", "liniște" — reply with at most one short word ("Okay." / "Bine.") or nothing at all. Do not keep explaining. Do not add a polite closing.

Honesty (HARD rule — no exceptions):
- NEVER claim you did something you did not do. Do NOT say "I showed it on the screen", "I opened the map", "I displayed it", "ți-am afișat", "v-am arătat pe ecran", "am deschis harta", "I'll forward this to my team", "voi transmite echipei", or any equivalent invented action in any language.
- If you cannot do what the user asked, say so plainly: "I can't do that" / "nu pot face asta" / "I don't know" / "nu știu". Then try a tool if one is available.
- Never invent a "team" you will forward feedback to. You are Kelion; there is no human team relaying messages in real time. If the user gives feedback, acknowledge it briefly and move on.

Tools you MUST use (do not guess when a tool fits):
- show_on_monitor(kind, query) — display a map, weather, video, image, Wikipedia, or web page on the monitor. Call it whenever the user says see / open / display / show (in any language).
- calculate(expression) — DETERMINISTIC math. For any arithmetic, percentage, or algebraic expression beyond a trivial one-digit sum, CALL THIS TOOL. Do not do mental math on longer numbers.
- get_weather(city or lat/lon, days) — REAL weather from Open-Meteo. For any question about weather, temperature, rain, wind, or a forecast — CALL THIS TOOL. Never guess weather.
- web_search(query, limit) — live web search with URLs + snippets. For anything time-sensitive (news, prices, events, who-is, recent facts) — CALL THIS TOOL. Never invent a URL or a price.
- translate(text, to, from) — real translation engine. For "how do you say X in Y", "translate this to Y", "tradu ..." — CALL THIS TOOL.

HARD: if the user's question clearly needs one of these tools, you MUST call it. Saying "let me check" or "I'll look that up" without calling the tool counts as a lie. If no tool fits and you don't know, say "I don't know" honestly.

You have access to real-time information provided in the system context below.
If the user asks about the time, date, or location — answer using the context provided.`;

// Single source of truth for the tool catalog: realtime.js owns KELION_TOOLS
// and the adapter below converts it to OpenAI Chat Completions shape. Kept in
// realtime.js because the voice transports also consume it — keeping it in
// one place (Devin Review ask on PR #133) avoids drift between text/voice.
const CHAT_TOOLS = buildKelionToolsChatCompletions();

const MAX_MESSAGE_LENGTH = 4000;
const MAX_MESSAGES_COUNT = 40;

router.post('/', async (req, res) => {
  const { messages = [], avatar = 'kelion', frame, datetime, timezone, coords } = req.body;

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

  // IP-based geolocation — no browser permission prompt. Uses Cloudflare /
  // Railway forward headers and ipapi.co (cached 1h). If it fails, we just
  // fall back to whatever the client volunteered in `coords`.
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
  if (coords?.lat != null && coords?.lon != null) {
    realtimeContext += `\n- User GPS coordinates: ${Number(coords.lat).toFixed(5)}, ${Number(coords.lon).toFixed(5)}`;
  } else if (geo && (geo.latitude != null || geo.city)) {
    const place = ipGeo.formatForPrompt(geo);
    if (place) realtimeContext += `\n- Approximate user location (IP-based): ${place}`;
    if (geo.latitude != null && geo.longitude != null) {
      realtimeContext += `\n- Approximate GPS coordinates: ${geo.latitude.toFixed(4)}, ${geo.longitude.toFixed(4)}`;
    }
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

  const systemPrompt = BASE_PROMPT + realtimeContext + memorySection;
  const model = getDefaultChatModel();

  // Sanitize message history
  const sanitized = messages
    .filter(m => m && typeof m === 'object' && ['user', 'assistant'].includes(m.role))
    .slice(-MAX_MESSAGES_COUNT)
    .map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content.slice(0, MAX_MESSAGE_LENGTH) : '' }))
    .filter(m => m.content.length > 0);

  // If a camera frame is provided, attach it to the last user message as a vision input
  if (frame && sanitized.length > 0) {
    const lastUserIdx = [...sanitized].map(m => m.role).lastIndexOf('user');
    if (lastUserIdx !== -1) {
      sanitized[lastUserIdx] = {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: frame, detail: 'low' } },
          { type: 'text', text: sanitized[lastUserIdx].content },
        ],
      };
    }
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
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

        // Server-executed real tools. executeRealTool returns null for
        // unrecognised names so we can distinguish "not handled here" from
        // "tool ran and returned data".
        const result = await executeRealTool(t.name, parsed);
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
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
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
