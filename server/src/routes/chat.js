'use strict';

// POST /api/chat — text chat using Gemma 4 via generateContent API.
// This is a fallback/primary text chat route that does NOT require
// This is the primary text chat route using Gemma 4 via OpenRouter.
// generateContent, including Gemma 4.

const { Router } = require('express');
const { trialStatus, stampTrialIfFresh } = require('../services/trialQuota');
const { peekSignedInUser, isAdminUser } = require('../middleware/optionalAuth');
const ipGeo = require('../services/ipGeo');
const { buildKelionToolsGoogle } = require('./realtime');

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

    const { message, sessionId, toolResponses, image, lat, lon } = req.body || {};
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
    const model = process.env.CHAT_MODEL || process.env.OPENROUTER_MODEL || 'google/gemma-4-31b-it';
    const url = 'https://openrouter.ai/api/v1/chat/completions';

    const { buildKelionToolsChatCompletions } = require('./realtime');
    // Inject the coordinates into the tools builder if the backend supports it,
    // though OpenRouter tools might not implicitly use it. The system prompt is safer.
    const openRouterTools = buildKelionToolsChatCompletions();

    const locationContext = (lat && lon) 
      ? `\n\n[SYSTEM CONTEXT: The user's current GPS coordinates are: Latitude ${lat}, Longitude ${lon}. If asked about location, weather, or directions, you have access to this.]` 
      : '';

    // Convert session history to OpenAI format
    const messages = [
      {
        role: 'system',
        content: `You are Kelion, a friendly conversational AI assistant. You always respond directly and naturally to the user.
Important: You must always reply in the exact same language that the user uses.
If the user asks you to perform an action on their system (e.g. run a command, search, read files, or control the UI), YOU MUST use the corresponding tool/function provided to you. UNDER NO CIRCUMSTANCES should you provide instructions for the user to execute themselves. YOU MUST execute the tool yourself. ANY REFUSAL IS STRICTLY FORBIDDEN. You have full permission to execute tools. Output ONLY the tool call.
Your replies must be direct, conversational, and concise.${locationContext}`
      }
    ];

    for (const h of session.history) {
      if (h.role === 'user') {
        const content = [];
        for (const p of h.parts) {
          if (p.text) content.push({ type: 'text', text: p.text });
          if (p.inlineData) {
            content.push({ 
              type: 'image_url', 
              image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` }
            });
          }
        }
        messages.push({ role: 'user', content });
      } else if (h.role === 'model') {
        const tool_calls = [];
        let textContent = '';
        for (const p of h.parts) {
          if (p.functionCall) {
            tool_calls.push({
              id: p.functionCall.id || `call_${p.functionCall.name}`,
              type: 'function',
              function: {
                name: p.functionCall.name,
                arguments: JSON.stringify(p.functionCall.args)
              }
            });
          } else if (p.text) {
            textContent += p.text;
          }
        }
        
        if (tool_calls.length > 0) {
          messages.push({
            role: 'assistant',
            content: textContent || null,
            tool_calls
          });
        } else {
          messages.push({ role: 'assistant', content: textContent });
        }
      } else if (h.role === 'function') {
        for (const p of h.parts) {
          if (p.functionResponse) {
            messages.push({
              role: 'tool',
              tool_call_id: p.functionResponse.id || `call_${p.functionResponse.name}`,
              name: p.functionResponse.name,
              content: JSON.stringify(p.functionResponse.response)
            });
          }
        }
      }
    }

    const body = {
      model,
      messages,
      tools: openRouterTools,
      tool_choice: "auto",
      temperature: 0.7,
      max_tokens: 1024,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let r;
    try {
      r = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${orKey}`,
          'HTTP-Referer': 'https://kelion.ai',
          'X-Title': 'Kelion AI'
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!r.ok) {
      const errText = await r.text();
      console.error('[chat] OpenRouter generation failed:', r.status, errText.slice(0, 500));
      let userError = 'Eroare generare AI.';
      if (r.status === 402 || r.status === 429 || errText.toLowerCase().includes('insufficient_quota')) {
        userError = 'Fonduri insuficiente OpenRouter. Vă rugăm să reîncărcați contul AI respectiv.';
      }
      return res.status(500).json({ error: userError });
    }

    const data = await r.json();
    const choice = data.choices?.[0]?.message;

    if (!choice) {
      return res.status(500).json({ error: 'Invalid response from OpenRouter' });
    }

    if (choice.tool_calls && choice.tool_calls.length > 0) {
      const toolCalls = choice.tool_calls.map(tc => {
        let args = {};
        try { args = JSON.parse(tc.function.arguments); } catch(e){}
        return { name: tc.function.name, args, id: tc.id };
      });
      
      // Save the model's turn so history is valid
      session.history.push({ 
        role: 'model', 
        parts: toolCalls.map(tc => ({ functionCall: tc })) 
      });
      return res.json({ toolCalls, model });
    }

    const reply = choice.content || 'Sorry, I could not generate a response.';
    
    // Add assistant response to history
    session.history.push({ role: 'model', parts: [{ text: reply }] });

    res.json({ reply, model });
  } catch (err) {
    console.error('[chat] error:', err);
    res.status(500).json({ error: 'Internal server error', details: err.message, stack: err.stack });
  }
});

module.exports = router;
