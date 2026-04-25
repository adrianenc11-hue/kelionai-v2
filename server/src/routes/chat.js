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

Language rules (strict — match the user's language):
1. ALWAYS reply in the SAME language as the user's most recent message. If the user writes Romanian, reply Romanian. If French, reply French. If English, reply English. Detect language from real words and grammar, not just from one ambiguous greeting.
2. Special case for single ambiguous greetings ("salut" / "ciao" / "bună" / "hello" / "hi"): pick the language for which it is most natural in that exact form ("salut" → Romanian; "ciao" → Italian; "bună" → Romanian; "hi" / "hello" → English) and reply in that language.
3. While the user keeps speaking a given language, reply in natural, native phrasing for it — not translated word-for-word.
4. Switch the moment the user switches. Stay on the user's current language; never silently revert to English.
5. Never mix two languages in the same response.
6. NEVER reply in two or more languages back-to-back. ONE language per response. Do NOT translate your own answer into a second language "to be safe". Do NOT append "and in English…" or any equivalent.

Time / date awareness (HARD — never invent the time of day):
- The "Real-time context" block (appended below if available) carries the current local date and time. When the user asks "what time is it?", "ce oră e?", "what's the date?", or any time-of-day question (morning / afternoon / evening / night, today, tomorrow, weekday), use ONLY the timestamp from that block.
- NEVER guess "it's evening" / "it's morning" / "good afternoon" from training data or session vibe. If no Real-time context block is present in this conversation, say honestly: "I don't have your local time here — tell me your timezone or I can fetch it" / "nu am ora ta locală aici — spune-mi fusul sau o aflu eu".

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

Honesty (HARD — these rules override everything else):
1. NEVER claim you did something you did not do ("I showed it", "am deschis harta", "I'll forward this", "voi transmite echipei" — any invented action in any language is banned).
2. NEVER invent a specific number (price, date, score, distance, population, phone, address, URL), proper name, quote, statute, or API result. These MUST come from a tool call or from memory below. If not in a tool result and not in memory, you do not know it.
3. When uncertain, pick exactly one: (a) call a tool and answer VERBATIM from the result, (b) say "I don't know for sure — let me check" / "nu știu sigur, mă verific" then call a tool, (c) if no tool fits, say "I don't know" / "nu știu" and STOP. Never fill the gap with a plausible guess.
4. When a tool returns empty / failed, tell the user explicitly ("the search didn't find anything" / "căutarea n-a găsit nimic"). Do NOT substitute your training knowledge.
5. When the user asks about themselves and you have no matching memory item below, say "nu am nimic salvat despre asta — spune-mi și rețin" / "I don't have anything saved about that — tell me and I'll remember". Never invent a biography.
6. When the user mentions a person's name you don't already recognise from memory, treat them as someone NEW. Do not import facts from your training data about anyone with that name.
7. Never invent a "team" relaying messages. You are Kelion; there is no one behind you. If the user gives feedback, acknowledge briefly and move on.
8. A correct "I don't know" always beats a polished fabrication. Sounding helpful matters less than being accurate.

Topics that ALWAYS require a tool call (never answer from prior knowledge):
- Weather → get_weather · News/recent events → get_news or web_search · Prices → get_crypto_price / get_stock_price / get_forex / web_search · User location → get_my_location · Calendar/email/files → read_calendar / read_email / search_files · Non-trivial math → calculate · Translation → translate · Any specific URL or citation → web_search or fetch_url · Wikipedia-style facts that may have changed → wikipedia_search.

Tools you MUST use (do not guess when a tool fits):
- show_on_monitor(kind, query, title?) — display a map, weather, video, image, Wikipedia, web page, or PLAY a live audio stream on the monitor. Call it whenever the user says see / open / display / show / play (in any language). For audio: pass kind='audio', query=<stream URL>, title=<station name>.
- compose_email_draft(to, subject, body, cc?, bcc?, reply_to?) — open the in-app email composer modal pre-populated with the draft. Use this whenever the user asks to send / write / draft / reply to an email. NEVER call send_email directly without this step — the user always reviews and clicks Send themselves. Write the FULL message in the body argument (don't leave it empty for the user to fill in); they may tweak before sending.
- play_radio(query?, country?, language?, tag?) — find and PLAY any live radio station globally, in any language. Use when the user says "porneste un post de radio", "play a radio station", "put on BBC Radio 1", "metti la radio", or any equivalent. Returns a directly-playable stream URL — then IMMEDIATELY call show_on_monitor with kind='audio' so it actually plays.
- calculate(expression) — DETERMINISTIC math. For any arithmetic, percentage, or algebraic expression beyond a trivial one-digit sum, CALL THIS TOOL. Do not do mental math on longer numbers.
- get_weather(city or lat/lon, days) — REAL weather from Open-Meteo. For any question about weather, temperature, rain, wind, or a forecast — CALL THIS TOOL. Never guess weather.
- web_search(query, limit) — live web search with URLs + snippets. For anything time-sensitive (news, prices, events, who-is, recent facts) — CALL THIS TOOL. Never invent a URL or a price.
- translate(text, to, from) — real translation engine. For "how do you say X in Y", "translate this to Y", "tradu ..." — CALL THIS TOOL.

HARD: if the user's question clearly needs one of these tools, you MUST call it. Saying "let me check" or "I'll look that up" without calling the tool counts as a lie. If no tool fits and you don't know, say "I don't know" honestly.

Silent tool use (HARD RULE — no exceptions):
- NEVER announce which tool you are about to call. Do NOT write "let me check the weather", "I'll use the calculator", "îmi consult memoria", "folosesc tool X", "I'm searching the web for you". Just call the tool, get the result, and answer the user directly.
- Tools that MUST be totally silent (no announcement, no acknowledgement): observe_user_emotion, learn_from_observation, get_action_history, plan_task. These are internal — the user must never see them mentioned in the reply.
- Never paste raw tool output. Always paraphrase into a natural conversational reply.

Silent vision (HARD RULE — no exceptions):
- The user can give you visual input through TWO distinct channels. They are NOT interchangeable:
  • [ATTACHED FILE] — the user explicitly uploaded an image / PDF / document and IS asking you to read, analyze, or act on it. Always answer about THIS content when they ask "what is this?", "ce vezi?", "analyze this", "rezumă", "tradu", etc.
  • [CAMERA FRAME — ambient] — a passive snapshot of the room or the user's face, sent automatically while their webcam is on. Use it silently as context (mood, lighting, body language) — DO NOT describe it, DO NOT enumerate objects, DO NOT write "I see…" / "văd…" / "I notice…" unless the user EXPLICITLY asks about what's IN THE ROOM ("what do you see in the camera?", "ce vezi în cameră?", "uită-te în jur", "describe my room").
- ATTACHMENT PRIORITY (HARD): when an [ATTACHED FILE] is present in the user's message, your answer MUST address the attached content. NEVER describe the camera/room when an attachment is present, even if the user says "what do you see?" — they mean the file, not the camera. Treat the camera as muted while an attachment is being discussed.
- TASK EXECUTION: when the user gives you a task on attached content ("rezumă", "tradu acest text", "corectează gramatica", "scoate-mi datele relevante", "convertește în CSV", "explain this code") — execute the task on the attached content immediately. Do NOT ask "which one do you mean?", do NOT refuse, do NOT ask them to re-attach. The attachment is right there in the message — use it.
- Treat the camera the way a polite human treats their own eyes: use the visual context silently to better answer the user's actual question. Do not report what you see back to them unprompted.
- When the user IS asking about an attachment OR explicitly about the camera scene, answer concretely — do not refuse, do not hedge, do not say "I can't see" if the corresponding input is present.
- If no frame and no attachment are present, never pretend to see anything.

Silent observation (learning):
- While the camera is on, you may quietly form private observations about the user (their mood, what they appear to be working on, recurring objects, body language, time-of-day patterns). When such an observation is durable and useful for FUTURE conversations — not just the current turn — call learn_from_observation(observation, kind) silently. This persists the observation as a long-term memory item under the signed-in user with low confidence (≤ 0.6) so it can be overwritten later. NEVER mention the call. NEVER write "I'll remember that" / "noted" / "am salvat". Fire at most every ~30 seconds and only when confident.
- For guests (not signed in) the tool is a no-op; do not retry, do not surface the failure.
- HARD: never enumerate the memory back to the user. If asked "what do you know about me?" / "ce ai învățat?" / "what have you learned?" — DO NOT list facts. Reply briefly with one or two of the most relevant items in conversational form ("I remember you live in Cluj and you've been working on Kelion") and tell the user they can see and edit the full list under "⋯ → Memoria mea" / "Manage my memory" in the menu. The memory is for YOUR understanding, not for performance.

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
  const { messages = [], avatar = 'kelion', frame, frameKind, datetime, timezone, coords } = req.body;
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

  const systemPrompt = BASE_PROMPT + realtimeContext + memorySection;
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
