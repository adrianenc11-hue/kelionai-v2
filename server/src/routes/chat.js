'use strict';

const { Router } = require('express');
const { requireAuth } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/csrf');
const { checkSubscription } = require('../middleware/subscription');

const { getOpenAI } = require('../utils/openai');

const router = Router();

const SYSTEM_PROMPTS = {
  kelion: 'You are Kelion, a friendly and intelligent male AI assistant. Detect the language the user is writing in and always respond in that same language. Be concise and helpful. Personality: calm, professional, empathetic.',
  kira:   'You are Kira, a friendly and enthusiastic female AI assistant. Detect the language the user is writing in and always respond in that same language. Be warm and direct. Personality: cheerful, creative, energetic.',
};

const MAX_MESSAGE_LENGTH = 4000;   // chars per message
const MAX_MESSAGES_COUNT = 40;     // history depth


// ---------------------------------------------------------------------------
// POST /api/chat
// ---------------------------------------------------------------------------
router.post('/', requireAuth, csrfProtection, checkSubscription, async (req, res) => {
  const { messages = [], avatar = 'kelion' } = req.body;

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be an array' });
  }

  const openai = getOpenAI();
  if (!openai) {
    return res.status(503).json({
      error: 'AI service not configured',
      message: 'Set OPENAI_API_KEY to enable chat.',
    });
  }

  // Sanitize: only allow 'user' and 'assistant' roles — never 'system'
  // Strip messages that are too long or have invalid role
  const sanitized = messages
    .filter(m => m && typeof m === 'object' && ['user', 'assistant'].includes(m.role))
    .slice(-MAX_MESSAGES_COUNT)
    .map(m => ({
      role:    m.role,
      content: typeof m.content === 'string'
        ? m.content.slice(0, MAX_MESSAGE_LENGTH)
        : '',
    }))
    .filter(m => m.content.length > 0);

  const systemPrompt = SYSTEM_PROMPTS[avatar] || SYSTEM_PROMPTS.kelion;
  const model = process.env.AI_MODEL || 'gpt-4o-mini';

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
        ...sanitized,
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
    res.write(`data: ${JSON.stringify({ error: 'AI service encountered an error. Please try again.' })}\n\n`);
  } finally {
    res.end();
  }
});

module.exports = router;
