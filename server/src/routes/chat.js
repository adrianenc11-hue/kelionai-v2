'use strict';

const express = require('express');
const router = express.Router();

const config = require('../config');
const OPENAI_API_KEY = config.openai.apiKey || process.env.OPENAI_API_KEY;
const OPENAI_BASE_URL = config.openai.baseUrl || 'https://api.openai.com/v1';
const OPENAI_MODEL = config.openai.model || 'gpt-4.1-mini';

/**
 * POST /api/chat
 * Streaming AI chat endpoint using OpenAI
 * Supports text + optional image (Vision) from camera
 * Works for both authenticated users and demo users
 */
router.post('/', async (req, res) => {
  const { messages, systemPrompt, image } = req.body;

  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  if (!OPENAI_API_KEY) {
    return res.status(503).json({ error: 'AI service not configured' });
  }

  const systemMsg = systemPrompt || 
    'You are Kelion, a friendly and intelligent AI assistant. Always respond in the same language the user writes in. Be concise and helpful. Personality: calm, professional, empathetic.';

  // Build messages array for OpenAI
  const allMessages = [
    { role: 'system', content: systemMsg },
  ];

  // Add conversation history (last 20 messages)
  const recentMessages = messages.slice(-20);
  
  for (let i = 0; i < recentMessages.length; i++) {
    const msg = recentMessages[i];
    
    // If this is the LAST user message AND we have an image, use Vision format
    if (i === recentMessages.length - 1 && msg.role === 'user' && image) {
      allMessages.push({
        role: 'user',
        content: [
          { type: 'text', text: msg.content },
          {
            type: 'image_url',
            image_url: {
              url: image,
              detail: 'low',
            }
          }
        ]
      });
    } else {
      allMessages.push({ role: msg.role, content: msg.content });
    }
  }

  try {
    console.log(`[chat] Sending to ${OPENAI_BASE_URL}/chat/completions with model ${OPENAI_MODEL}, image: ${!!image}`);
    
    const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages: allMessages,
        stream: true,
        max_tokens: 500,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('[chat] OpenAI error:', err);
      return res.status(502).json({ error: 'AI service error' });
    }

    // Set up SSE streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    const reader = response.body;
    let buffer = '';

    reader.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop(); // Keep incomplete line in buffer

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const data = line.slice(6).trim();
          if (data === '[DONE]') {
            res.write('data: [DONE]\n\n');
            return;
          }
          try {
            const parsed = JSON.parse(data);
            const content = parsed.choices?.[0]?.delta?.content || '';
            if (content) {
              res.write(`data: ${JSON.stringify({ content })}\n\n`);
            }
          } catch (e) {
            // Skip malformed JSON
          }
        }
      }
    });

    reader.on('end', () => {
      res.write('data: [DONE]\n\n');
      res.end();
    });

    reader.on('error', (err) => {
      console.error('[chat] Stream error:', err);
      res.end();
    });

    req.on('close', () => {
      // Client disconnected
    });

  } catch (err) {
    console.error('[chat] Error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Failed to connect to AI service' });
    }
  }
});

module.exports = router;
