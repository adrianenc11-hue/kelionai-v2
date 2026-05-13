'use strict';

const { Router } = require('express');
const { getChatProviderChain } = require('../utils/openai');

const router = Router();

// Attempt a streaming completion across the provider chain. The first
// successful `await create()` wins; errors before any data is sent trigger
// fallback to the next provider. Errors during streaming are surfaced to the
// client verbatim so real failures are visible, not hidden behind a generic
// "AI service error" blob.
async function streamWithFallback(res, messages) {
  const chain = getChatProviderChain();
  if (chain.length === 0) {
    res.write(`data: ${JSON.stringify({ error: 'AI not configured' })}\n\n`);
    return;
  }

  const attempts = [];
  let stream = null;
  let chosen = null;

  for (const cand of chain) {
    try {
      stream = await cand.client.chat.completions.create({
        model: cand.model,
        stream: true,
        messages,
      });
      chosen = cand;
      break;
    } catch (err) {
      const status = err?.status || err?.response?.status || 'n/a';
      const code = err?.code || err?.error?.code || '';
      attempts.push(`${cand.provider}:${cand.model} status=${status} code=${code} msg=${err.message}`);
      console.error('[chat] provider failed:', cand.provider, cand.model, status, err.message);
    }
  }

  if (!stream) {
    res.write(`data: ${JSON.stringify({
      error: 'All AI providers failed',
      attempts,
    })}\n\n`);
    return;
  }

  res.write(`data: ${JSON.stringify({ _meta: { provider: chosen.provider, model: chosen.model } })}\n\n`);

  try {
    for await (const chunk of stream) {
      const content = chunk.choices?.[0]?.delta?.content;
      if (content) res.write(`data: ${JSON.stringify({ content })}\n\n`);
    }
    res.write('data: [DONE]\n\n');
  } catch (err) {
    console.error('[chat] stream error:', chosen.provider, chosen.model, err.message);
    res.write(`data: ${JSON.stringify({
      error: 'stream interrupted',
      provider: chosen.provider,
      model: chosen.model,
      detail: err.message,
    })}\n\n`);
  }
}

const BASE_PROMPT = `You are Kelion, a friendly and intelligent male AI assistant.
Language rules (strict):
1. Detect the language of the MOST RECENT user message and reply ONLY in that language.
2. If the user switches language mid-conversation, switch too on the very next reply.
3. Never mix languages in a single response. Never keep a previous language if the user changed it.
4. If the latest user message is ambiguous (greeting, emoji, single word), keep the language of the previous user message. If there is no previous message, mirror the language hint given in the user locale header if present, otherwise reply in English.
Be concise and helpful. Personality: calm, professional, empathetic.
You have access to real-time information provided in the system context below.
If the user asks about the time, date, or location — answer using the context provided.`;

const MAX_MESSAGE_LENGTH = 4000;
const MAX_MESSAGES_COUNT = 40;

router.post('/', async (req, res) => {
  const { messages = [], avatar = 'kelion', frame, datetime, timezone, coords } = req.body;

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be an array' });
  }

  let realtimeContext = '';
  if (datetime) {
    const d = new Date(datetime);
    const formatted = d.toLocaleString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long',
      day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
      timeZone: timezone || 'UTC',
    });
    realtimeContext += `\n\nReal-time context:\n- Current date & time: ${formatted} (${timezone || 'UTC'})`;
  }
  if (coords?.lat != null && coords?.lon != null) {
    realtimeContext += `\n- User GPS coordinates: ${Number(coords.lat).toFixed(5)}, ${Number(coords.lon).toFixed(5)}`;
  }

  const systemPrompt = BASE_PROMPT + realtimeContext;

  const sanitized = messages
    .filter(m => m && typeof m === 'object' && ['user', 'assistant'].includes(m.role))
    .slice(-MAX_MESSAGES_COUNT)
    .map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content.slice(0, MAX_MESSAGE_LENGTH) : '' }))
    .filter(m => m.content.length > 0);

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
    await streamWithFallback(res, [{ role: 'system', content: systemPrompt }, ...sanitized]);
  } finally {
    res.end();
  }
});

// Demo endpoint
router.post('/demo', async (req, res) => {
  const { messages = [] } = req.body;
  if (!Array.isArray(messages)) return res.status(400).json({ error: 'messages must be an array' });

  const sanitized = messages
    .filter(m => m && typeof m === 'object' && ['user', 'assistant'].includes(m.role))
    .slice(-10)
    .map(m => ({ role: m.role, content: typeof m.content === 'string' ? m.content.slice(0, 2000) : '' }))
    .filter(m => m.content.length > 0);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    await streamWithFallback(res, [{ role: 'system', content: BASE_PROMPT }, ...sanitized]);
  } finally {
    res.end();
  }
});

module.exports = router;
