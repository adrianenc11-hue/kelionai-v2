'use strict';

const { Router } = require('express');
const { getAI, getDefaultChatModel } = require('../utils/openai');
const { getCreditsBalance, findById, listMemoryItems } = require('../db');
const { isAdminEmail } = require('../middleware/subscription');
const ipGeo = require('../services/ipGeo');
const { trialStatus, stampTrialIfFresh } = require('../services/trialQuota');

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

Manners:
- You are unfailingly polite and warm. Greet, thank, apologize when appropriate. Never condescending, never impatient. Calm, professional, empathetic.

Honesty (HARD rule — no exceptions):
- NEVER claim you did something you did not do. Do NOT say "I showed it on the screen", "I opened the map", "I displayed it", "ți-am afișat", "v-am arătat pe ecran", "am deschis harta", "I'll forward this to my team", "voi transmite echipei", or any equivalent invented action in any language.
- If you cannot do what the user asked, say so plainly: "I can't do that" / "nu pot face asta" / "I don't know — let me search" / "nu știu". Then try a tool if one is available.
- You have the show_on_monitor tool. When the user asks to see / open / display / show a map, the weather, a video, an image, a Wikipedia page, or any web page — CALL THE TOOL. Do not just talk about it. If the tool is unavailable in this context, say "I can't open that here" — never pretend you did.
- Never invent a "team" you will forward feedback to. You are Kelion; there is no human team relaying messages in real time. If the user gives feedback, acknowledge it briefly and move on.

Be concise and helpful.
You have access to real-time information provided in the system context below.
If the user asks about the time, date, or location — answer using the context provided.`;

// Same show_on_monitor contract as the realtime (voice) path. Kept in sync
// manually with server/src/routes/realtime.js KELION_TOOLS — the shape must
// match because the client resolves the arguments identically for both
// transports.
const CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'show_on_monitor',
      description:
        "Display something on the big presentation monitor beside Kelion. " +
        "Use whenever the user asks (in any language) to see / open / show / " +
        "display a map, the weather, a video, an image, a Wikipedia / reference " +
        "page, or any web page. Pick the right `kind`. Call again with a new " +
        "query to swap content.",
      parameters: {
        type: 'object',
        properties: {
          kind: {
            type: 'string',
            enum: ['map', 'weather', 'video', 'image', 'wiki', 'web', 'clear'],
            description:
              "'map' = Google Maps for a place; 'weather' = forecast for a " +
              "city; 'video' = YouTube; 'image' = photo search; 'wiki' = " +
              "Wikipedia; 'web' = arbitrary https:// URL (for a Linux shell, " +
              "pass kind='web' with query='https://webvm.io'); 'clear' = blank.",
          },
          query: {
            type: 'string',
            description:
              "Search term or URL. Required unless kind='clear'.",
          },
        },
        required: ['kind'],
      },
    },
  },
];

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
  let memorySection = '';
  if (req.user && (Number.isFinite(req.user.id) || typeof req.user.id === 'string')) {
    try {
      const memoryItems = await listMemoryItems(req.user.id, 60);
      if (Array.isArray(memoryItems) && memoryItems.length) {
        memorySection =
          '\n\nKnown facts about the user (most recent first):\n' +
          memoryItems.map((m) => `- [${m.kind}] ${m.fact}`).join('\n');
      }
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
  async function streamOnce(msgs) {
    const stream = await ai.chat.completions.create({
      model,
      stream: true,
      tools: CHAT_TOOLS,
      tool_choice: 'auto',
      messages: msgs,
    });
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
    const first = await streamOnce(firstMsgs);

    if (first.toolCalls.length > 0 && first.finishReason === 'tool_calls') {
      // Assemble the assistant tool-call turn and synthetic tool results so
      // the second pass can produce the natural-language reply. Client-side
      // tools succeed optimistically — if resolveMonitor fails we still get
      // a sensible "Here's …" line rather than a stuck chat.
      const toolCallsForHistory = first.toolCalls.map((t) => ({
        id: t.id || `call_${Math.random().toString(36).slice(2)}`,
        type: 'function',
        function: { name: t.name, arguments: t.args || '{}' },
      }));
      const toolMessages = first.toolCalls.map((t) => {
        let parsed = {};
        try { parsed = JSON.parse(t.args || '{}'); } catch (_) { /* ignore */ }
        if (t.name === 'show_on_monitor') {
          // Emit the tool frame to the client — it runs handleShowOnMonitor
          // and updates the overlay immediately, before the narration lands.
          res.write(`data: ${JSON.stringify({ tool: t.name, arguments: parsed })}\n\n`);
          return {
            role: 'tool',
            tool_call_id: toolCallsForHistory.find(c => c.function.name === t.name)?.id
              || `call_${Math.random().toString(36).slice(2)}`,
            content: JSON.stringify({ ok: true, shown: parsed }),
          };
        }
        return {
          role: 'tool',
          tool_call_id: `call_${Math.random().toString(36).slice(2)}`,
          content: JSON.stringify({ ok: false, error: 'unknown tool' }),
        };
      });

      const secondMsgs = [
        ...firstMsgs,
        {
          role: 'assistant',
          content: first.text || '',
          tool_calls: toolCallsForHistory,
        },
        ...toolMessages,
      ];
      await streamOnce(secondMsgs);
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
