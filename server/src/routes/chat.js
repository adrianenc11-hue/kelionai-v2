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

    // Model: via OpenRouter — explicitly supports tool_calls.
    const model = process.env.CHAT_MODEL || process.env.OPENROUTER_MODEL || 'google/gemini-1.5-flash:free';
    const url = 'https://openrouter.ai/api/v1/chat/completions';

    // ── Demand-driven tool activation ─────────────────────────────────
    // Default: all tools OFF. Activate only tools relevant to this
    // specific message. After the request completes, tools go back to OFF.
    const openRouterTools = buildKelionToolsChatCompletions();
    
    // Convert history to OpenAI format for OpenRouter
    const sanitizedMessages = session.history.map(h => {
      if (h.role === 'function') {
        return {
          role: 'tool',
          tool_call_id: h.parts[0].functionResponse.id,
          name: h.parts[0].functionResponse.name,
          content: JSON.stringify(h.parts[0].functionResponse.response.result)
        };
      }
      // Handle user/assistant text
      let text = '';
      h.parts.forEach(p => { if (p.text) text += p.text; });
      return { role: h.role, content: text };
    });

    const body = {
      model,
      messages: sanitizedMessages,
      tools: openRouterTools.length > 0 ? openRouterTools : undefined,
      tool_choice: openRouterTools.length > 0 ? 'auto' : undefined,
      temperature: 0.7,
      max_tokens: 1024,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    const googleKey = process.env.GOOGLE_API_KEY;
    const isGoogleModel = model.startsWith('google/');
    let apiUrl = url;
    let authHeader = `Bearer ${orKey}`;

    if (googleKey && isGoogleModel) {
      // Use direct Google AI Studio endpoint (OpenAI-compatible)
      // This bypasses OpenRouter limits and provides a true "free/unlimited" experience
      const modelSlug = model.replace('google/', '').replace(':free', '');
      apiUrl = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`;
      authHeader = `Bearer ${googleKey}`;
      body.model = `models/${modelSlug}`; // Google OpenAI shim often requires the models/ prefix
    }

    let r;
    try {
      r = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': authHeader,
          'HTTP-Referer': 'https://kelion.ai',
          'X-Title': 'Kelion AI'
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (r.ok) {
      const data = await r.json();
      const choice = data.choices?.[0];
      const reply = choice?.message?.content || '';

      if (choice?.message?.tool_calls) {
        // Model wants to call tools. 
        // We add the tool_calls to history so the next turn can refer to them.
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
        
        // Return tool_calls to client for execution
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
      return res.json({ reply, model });
    } else {
      const errText = await r.text();
      console.error('[chat] OpenAI-compatible request failed:', r.status, errText);
      
      // Fallback model if rate limited or insufficient quota
      if (r.status === 429 || errText.toLowerCase().includes('insufficient_quota') || errText.toLowerCase().includes('rate-limited')) {
        console.log('[chat] Attempting fallback to gemini-1.5-flash due to rate limit...');
        const fallbackBody = { ...body, model: 'gemini-1.5-flash' };
        try {
          const r2 = await fetch(url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${orKey}`,
              'HTTP-Referer': 'https://kelion.ai',
              'X-Title': 'Kelion AI'
            },
            body: JSON.stringify(fallbackBody),
          });
          if (r2.ok) {
            const data2 = await r2.json();
            const reply2 = data2.choices?.[0]?.message?.content || '';
            if (reply2) {
              session.history.push({ role: 'assistant', parts: [{ text: reply2 }] });
            }
            return res.json({ reply: reply2, model: 'google/gemini-flash-1.5' });
          }
        } catch (fErr) {
          console.error('[chat] Fallback failed:', fErr.message);
        }
      }
      
      return res.status(r.status).json({ error: `AI generation failed. Status: ${r.status}, Details: ${errText}` });
    }
  } catch (error) {
    console.error('[chat] Error:', error.message);
    res.status(500).json({ error: 'Internal server error during chat' });
  }
});

module.exports = router;
