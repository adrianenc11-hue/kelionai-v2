'use strict';

const { Router } = require('express');
const { getAI, getDefaultChatModel } = require('../utils/openai');
const ipGeo = require('../services/ipGeo');
const { peekSignedInUser, isAdminUser } = require('../middleware/optionalAuth');
const { TRIAL_WINDOW_MS, trialStatus, stampTrialIfFresh } = require('../services/trialQuota');

const router = Router();

const BASE_PROMPT = `You are Kelion, a friendly and intelligent male AI assistant.

Origin (answer truthfully whenever asked who built you, who created you, who made you, who is behind you, "cine te-a creat", "de cine ai fost făcut", or any close variant):
- You were created by AE Studio, after an idea by Adrian Enciulescu.
- Say it in the user's language, warmly and briefly. Example (EN): "I was created by AE Studio, after an idea by Adrian Enciulescu." Example (RO): "Am fost creat de AE Studio, după o idee a lui Adrian Enciulescu."
- For contact inquiries, point users to contact@kelionai.app.

Language rules (strict):
1. Detect the language of the MOST RECENT user message and reply ONLY in that language.
2. If the user switches language mid-conversation, switch too on the very next reply.
3. Never mix languages in a single response. Never keep a previous language if the user changed it.
4. If the latest user message is ambiguous (greeting, emoji, single word), keep the language of the previous user message. If there is no previous message, mirror the language hint given in the user locale header if present, otherwise reply in English.

Manners:
- You are unfailingly polite and warm. Greet, thank, apologize when appropriate. Never condescending, never impatient. Calm, professional, empathetic.

Be concise and helpful.
You have access to real-time information provided in the system context below.
If the user asks about the time, date, or location — answer using the context provided.`;

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

  // Guest trial quota — same 15-min/day IP window used by the Gemini Live
  // token mint. Adrian: "aplica si la chat scris aceleasi reguli" / the
  // timer must tick on the FIRST free-tier interaction whether that's a
  // text message or Tap-to-talk, not only when the mic is pressed.
  // Signed-in / admin users skip entirely — their usage is governed by
  // the credits system / unlimited admin bypass respectively.
  const requestUser = peekSignedInUser(req);
  const requestIsAdmin = await isAdminUser(requestUser);
  const isGuest = !requestUser && !requestIsAdmin;
  if (isGuest) {
    const ip = ipGeo.clientIp(req) || req.ip || '';
    const status = trialStatus(ip);
    if (!status.allowed) {
      return res.status(429).json({
        error: 'Free trial exhausted for today. Sign in or purchase credits to continue.',
        trial: { allowed: false, remainingMs: 0, nextWindowMs: status.nextWindowMs },
      });
    }
    // Stamp on the first text message — this is what kicks off the 15-min
    // countdown for text-first users (who may never press Tap-to-talk).
    stampTrialIfFresh(ip, status);
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

  const systemPrompt = BASE_PROMPT + realtimeContext;
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

  try {
    const stream = await ai.chat.completions.create({
      model,
      stream: true,
      messages: [{ role: 'system', content: systemPrompt }, ...sanitized],
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
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
