'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { checkSubscription } = require('../middleware/subscription');

const router = Router();

// System prompts per avatar — defined on the server so they are not exposed to
// the client and can be changed without a frontend deploy.
const SYSTEM_PROMPTS = {
  kelion: 'You are Kelion, a friendly and intelligent male AI assistant. Detect the language the user is writing in and always respond in that same language. Be concise and helpful. Personality: calm, professional, empathetic.',
  kira:   'You are Kira, a friendly and enthusiastic female AI assistant. Detect the language the user is writing in and always respond in that same language. Be warm and direct. Personality: cheerful, creative, energetic.',
};

// ---------------------------------------------------------------------------
// Lazy-initialise the OpenAI client only when the key is present
// ---------------------------------------------------------------------------
function getOpenAI() {
  const key = process.env.OPENAI_API_KEY || process.env.AI_API_KEY;
  if (!key) return null;
  const OpenAI = require('openai');
  return new OpenAI({ apiKey: key });
}

// ---------------------------------------------------------------------------
// POST /api/chat
// ---------------------------------------------------------------------------
router.post('/', requireAuth, checkSubscription, async (req, res) => {
  const openai = getOpenAI();
  if (!openai) {
    return res.status(503).json({
      error: 'AI service not configured',
      message: 'Set OPENAI_API_KEY to enable chat.',
    });
  }

  const { messages = [], avatar = 'kelion' } = req.body;
  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be an array' });
  }

  const systemPrompt = SYSTEM_PROMPTS[avatar] || SYSTEM_PROMPTS.kelion;
  const model = process.env.AI_MODEL || 'gpt-4o-mini';

  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    const stream = await openai.chat.completions.create({
      model,
      stream: true,
      messages: [
        { role: 'system', content: systemPrompt },
        ...messages,
      ],
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write('data: [DONE]\n\n');
  } catch (err) {
    console.error('[chat] OpenAI error:', err.message);
    res.write(`data: ${JSON.stringify({ error: err.message })}\n\n`);
  } finally {
    res.end();
  }
});

module.exports = router;
