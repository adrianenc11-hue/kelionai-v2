// ═══════════════════════════════════════════════════════════════
// KelionAI — Brain API Routes (/api/brain/*)
//
// GET  /status        — starea brain-ului (modele active, circuite)
// POST /chat          — trimite mesaj direct la brain
// GET  /memory        — memoria recentă a brain-ului
// POST /reset         — resetează memoria sesiunii
// GET  /agents        — lista agenților disponibili
// POST /error         — raportează o eroare de brain
// ═══════════════════════════════════════════════════════════════
'use strict';

const express   = require('express');
const rateLimit = require('express-rate-limit');
const logger    = require('../logger');

const router = express.Router();

const brainLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many brain requests. Please wait.' },
});

// ─────────────────────────────────────────────────────────────
// GET /api/brain/status — Starea brain-ului
// ─────────────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const brain = req.app.locals.brain;
    if (!brain) {
      return res.json({
        status: 'offline',
        message: 'Brain not initialized',
        timestamp: new Date().toISOString(),
      });
    }

    const status = {
      status: 'online',
      version: 'v3',
      timestamp: new Date().toISOString(),
      agents: {
        scout:       'groq',
        code:        'claude',
        math:        'deepseek',
        web:         'perplexity',
        vision:      'gpt',
        weather:     'open-meteo',
        chat:        'groq',
        orchestrator:'gpt',
        qa:          'gemini',
      },
      intents: ['code', 'math', 'web', 'weather', 'image', 'vision', 'document', 'chat_simple', 'chat_deep', 'orchestrate'],
      memory:  typeof brain.getMemoryStats === 'function' ? brain.getMemoryStats() : { enabled: true },
    };

    return res.json(status);
  } catch (err) {
    logger.error({ component: 'BrainAPI', err: err.message }, 'GET /status failed');
    return res.status(500).json({ error: 'Failed to get brain status' });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/brain/agents — Lista agenților disponibili
// ─────────────────────────────────────────────────────────────
router.get('/agents', (req, res) => {
  return res.json({
    agents: [
      { id: 'scout',        name: 'Front Scout',      model: 'Groq Llama',        role: 'Intent classification (~50ms)',         layer: 0 },
      { id: 'code',         name: 'Code Specialist',  model: 'Claude Sonnet 4',   role: 'Code generation & debugging',           layer: 1 },
      { id: 'math',         name: 'Math Reasoner',    model: 'DeepSeek Reasoner', role: 'Mathematical reasoning & calculations', layer: 1 },
      { id: 'web',          name: 'Web Search',       model: 'Perplexity Sonar',  role: 'Real-time web search & research',       layer: 1 },
      { id: 'vision',       name: 'Vision Analyst',   model: 'GPT-4 Vision',      role: 'Image analysis & description',          layer: 1 },
      { id: 'weather',      name: 'Weather Agent',    model: 'Open-Meteo',        role: 'Live GPS weather data',                 layer: 1 },
      { id: 'chat',         name: 'Chat Agent',       model: 'Groq / GPT-4.1',    role: 'General conversation',                  layer: 1 },
      { id: 'orchestrator', name: 'Orchestrator',     model: 'GPT-5.4',           role: 'Complex multi-step tasks',              layer: 1 },
      { id: 'qa',           name: 'QA Validator',     model: 'Gemini Flash',      role: 'Response quality assurance',            layer: 2 },
      { id: 'memory',       name: 'Memory Engine',    model: 'Supabase',          role: 'Persistent memory & learning',          layer: 3 },
    ],
  });
});

// ─────────────────────────────────────────────────────────────
// GET /api/brain/memory — Memoria recentă
// ─────────────────────────────────────────────────────────────
router.get('/memory', async (req, res) => {
  try {
    const { getUserFromToken } = req.app.locals;
    let userId = null;
    try {
      const user = await getUserFromToken(req);
      if (user) userId = user.id;
    } catch (_) {}

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

    const { data: memory } = await supabaseAdmin
      .from('brain_memory')
      .select('id, role, content, intent, model_used, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(20);

    return res.json({ memory: memory || [], count: (memory || []).length });
  } catch (err) {
    logger.error({ component: 'BrainAPI', err: err.message }, 'GET /memory failed');
    return res.status(500).json({ error: 'Failed to fetch memory' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/brain/reset — Resetează memoria sesiunii
// ─────────────────────────────────────────────────────────────
router.post('/reset', brainLimiter, async (req, res) => {
  try {
    const { getUserFromToken } = req.app.locals;
    let userId = null;
    try {
      const user = await getUserFromToken(req);
      if (user) userId = user.id;
    } catch (_) {}

    if (!userId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { supabaseAdmin } = req.app.locals;
    if (supabaseAdmin) {
      await supabaseAdmin
        .from('brain_memory')
        .delete()
        .eq('user_id', userId)
        .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    }

    logger.info({ component: 'BrainAPI', userId }, 'Brain memory reset');
    return res.json({ success: true, message: 'Session memory cleared' });
  } catch (err) {
    logger.error({ component: 'BrainAPI', err: err.message }, 'POST /reset failed');
    return res.status(500).json({ error: 'Failed to reset memory' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/brain/error — Raportează eroare de brain
// ─────────────────────────────────────────────────────────────
router.post('/error', brainLimiter, async (req, res) => {
  try {
    const { component, message, stack, context } = req.body;

    logger.error({
      component: component || 'BrainFrontend',
      message,
      stack,
      context,
      ip: req.ip,
    }, 'Brain error reported from client');

    const { supabaseAdmin } = req.app.locals;
    if (supabaseAdmin) {
      await supabaseAdmin.from('admin_logs').insert({
        action:    'brain_error',
        details:   JSON.stringify({ component, message, stack: stack ? stack.slice(0, 500) : null, context }),
        ip:        req.ip,
        user_agent: req.headers['user-agent'] || '',
        created_at: new Date().toISOString(),
      }).catch(() => {});
    }

    return res.json({ received: true });
  } catch (err) {
    logger.error({ component: 'BrainAPI', err: err.message }, 'POST /error failed');
    return res.status(500).json({ error: 'Failed to log error' });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/brain/chat — Chat direct cu brain (fallback endpoint)
// ─────────────────────────────────────────────────────────────
router.post('/chat', brainLimiter, async (req, res) => {
  try {
    const brain = req.app.locals.brain;
    if (!brain) {
      return res.status(503).json({ error: 'Brain not available' });
    }

    const { message, language, sessionId, avatar } = req.body;
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const { getUserFromToken } = req.app.locals;
    let userId = null;
    try {
      const user = await getUserFromToken(req);
      if (user) userId = user.id;
    } catch (_) {}

    const result = await brain.think(
      message.trim(),
      avatar || 'kelion',
      [],
      language || 'auto',
      userId || 'guest',
      null,
      { sessionId: sessionId || ('brain-api-' + Date.now()) }
    );

    return res.json({
      reply:    result.reply || result.text || result.content || '',
      intent:   result.intent || 'chat',
      model:    result.model || 'unknown',
      duration: result.duration || 0,
    });
  } catch (err) {
    logger.error({ component: 'BrainAPI', err: err.message }, 'POST /chat failed');
    return res.status(500).json({ error: 'Brain processing failed' });
  }
});

module.exports = router;