'use strict';

const { Router } = require('express');
const { getOpenAI } = require('../utils/openai');

const router = Router();

const SYSTEM_PROMPTS = {
  kelion: 'You are Kelion, a friendly and intelligent male AI assistant. Detect the language the user is writing in and always respond in that same language. Be concise and helpful. Personality: calm, professional, empathetic.',
};

const MAX_MESSAGE_LENGTH = 4000;
const MAX_MESSAGES_COUNT = 40;

router.post('/', async (req, res) => {
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

// Demo endpoint (kept for landing page demo chat)
router.post('/demo', async (req, res) => {
  const { messages = [] } = req.body;

  if (!Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages must be an array' });
  }

  const openai = getOpenAI();
  if (!openai) {
    return res.status(503).json({ error: 'AI service not configured' });
  }

  const sanitized = messages
    .filter(m => m && typeof m === 'object' && ['user', 'assistant'].includes(m.role))
    .slice(-10)
    .map(m => ({
      role:    m.role,
      content: typeof m.content === 'string' ? m.content.slice(0, 2000) : '',
    }))
    .filter(m => m.content.length > 0);

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
        { role: 'system', content: SYSTEM_PROMPTS.kelion },
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
    console.error('[chat/demo] error:', err.message);
    res.write(`data: ${JSON.stringify({ error: 'AI service encountered an error. Please try again.' })}\n\n`);
  } finally {
    res.end();
  }
});

module.exports = router;
