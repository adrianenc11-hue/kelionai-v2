'use strict';

// POST /api/chat — text chat using Claude Opus via generateContent API.
// This is a fallback/primary text chat route that does NOT require
// This is the primary text chat route using Claude Opus via OpenRouter.
// generateContent, including Claude Opus.

const { Router } = require('express');
const { trialStatus, stampTrialIfFresh } = require('../services/trialQuota');
const { peekSignedInUser, isAdminUser } = require('../middleware/optionalAuth');
const ipGeo = require('../services/ipGeo');
const { buildKelionToolsChatCompletions } = require('./realtime');

const router = Router();

// In-memory conversation history per session (simple, resets on server restart)
const sessions = new Map();
const MAX_HISTORY = 20;
const SESSION_TTL = 30 * 60 * 1000; // 30 min

// Cleanup old sessions every 5 min
setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL;
  for (const [id, s] of sessions) {
    if (s.lastUsed < cutoff) sessions.delete(id);
  }
}, 5 * 60 * 1000).unref();

router.post('/', async (req, res) => {
  try {
    const orKey = process.env.OPENROUTER_API_KEY;
    if (!orKey) {
      return res.status(503).json({ error: 'OPENROUTER_API_KEY not configured' });
    }

    // Auth / trial gating (same logic as realtime)
    const adminUser = await peekSignedInUser(req);
    const isAdmin = await isAdminUser(adminUser);
    const isGuest = !adminUser;

    if (isGuest && !isAdmin) {
      const guestIp = ipGeo.clientIp(req) || req.ip || '';
      const trial = await trialStatus(guestIp);
      if (!trial.allowed) {
        return res.status(401).json({
          error: trial.reason === 'lifetime_expired'
            ? 'Free trial expired. Create an account to continue.'
            : 'Daily free trial used up. Come back tomorrow or sign in.',
        });
      }
      await stampTrialIfFresh(guestIp, trial);
    }

    const { message, sessionId, toolResponses, image, lat, lon, clientTimezone, clientLocalTime } = req.body || {};
    if (!message && !toolResponses) {
      return res.status(400).json({ error: 'message or toolResponses is required' });
    }

    // Session history
    const sid = sessionId || 'default';
    if (!sessions.has(sid)) {
      sessions.set(sid, { history: [], lastUsed: Date.now() });
    }
    const session = sessions.get(sid);
    session.lastUsed = Date.now();

    // Add user message or function responses to history
    if (toolResponses) {
      session.history.push({
        role: 'function',
        parts: toolResponses.map(tr => ({
          functionResponse: {
            name: tr.name,
            response: { result: tr.response },
            id: tr.id
          }
        }))
      });
    } else if (message) {
      const parts = [{ text: message.trim() }];
      if (image) {
        // image should be base64 string
        parts.push({
          inlineData: { mimeType: 'image/jpeg', data: image.replace(/^data:image\/\w+;base64,/, '') }
        });
      }
      session.history.push({ role: 'user', parts });
    }

    if (session.history.length > MAX_HISTORY * 2) {
      session.history = session.history.slice(-MAX_HISTORY * 2);
    }

    // Smart Model Router — unified stable routing
    const { smartFetch } = require('../services/modelRouter');
    
    // ── Demand-driven tool activation ─────────────────────────────────
    const openRouterTools = buildKelionToolsChatCompletions();

    // Convert history to OpenAI format
    const sanitizedMessages = session.history.map(h => {
      if (h.role === 'function') {
        return {
          role: 'tool',
          tool_call_id: h.parts[0].functionResponse.id,
          name: h.parts[0].functionResponse.name,
          content: JSON.stringify(h.parts[0].functionResponse.response.result)
        };
      }
      let text = '';
      h.parts.forEach(p => { if (p.text) text += p.text; });
      return { role: h.role, content: text };
    });

    const body = {
      messages: sanitizedMessages,
      tools: openRouterTools.length > 0 ? openRouterTools : undefined,
      tool_choice: openRouterTools.length > 0 ? 'auto' : undefined,
      temperature: 0.7,
      max_tokens: 1024,
    };

    let result;
    try {
      const { response, model: activeModel } = await smartFetch('chat', body);
      result = await response.json();
      
      const choice = result.choices?.[0];
      const reply = choice?.message?.content || '';

      if (choice?.message?.tool_calls) {
        // Model wants to call tools. 
        session.history.push({
          role: 'assistant',
          parts: choice.message.tool_calls.map(tc => ({
            functionCall: {
              name: tc.function.name,
              args: JSON.parse(tc.function.arguments),
              id: tc.id
            }
          }))
        });

        return res.json({
          reply: 'Calling tools...',
          toolCalls: choice.message.tool_calls.map(tc => ({
            id: tc.id,
            name: tc.function.name,
            args: JSON.parse(tc.function.arguments)
          }))
        });
      }

      // Standard text reply
      if (reply) {
        session.history.push({ role: 'assistant', parts: [{ text: reply }] });
      }
      return res.json({ reply, model: activeModel });
    } catch (err) {
      console.error('[chat] AI generation failed:', err.message);
      return res.status(502).json({ error: 'AI is temporarily unavailable. Please try again.' });
    }
  } catch (error) {
    console.error('[chat] Error:', error.message);
    res.status(500).json({ error: 'Internal server error during chat' });
  }
});

module.exports = router;
