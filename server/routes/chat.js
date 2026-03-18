// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
// KelionAI â€” Chat Routes (brain-powered + streaming)
// Brain decides tools â†’ executes in parallel â†’ builds deep prompt â†’ AI responds â†’ learns
// â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('../logger');
const { validate, chatSchema, memorySchema } = require('../validation');
const { checkUsage, incrementUsage } = require('../payments');
const { buildSystemPrompt, buildNewbornPrompt } = require('../persona');
const { _KelionBrain } = require('../brain');
const { thinkV5 } = require('../brain-v5');
const { MODELS } = require('../config/models');
const { notify } = require('../notifications');

const router = express.Router();

// â”€â”€ Sanitize internal markers from AI replies â”€â”€
function sanitizeReply(text) {
  if (!text) return text;
  let r = text;
  r = r.replace(/\[SYSTEM INSTRUCTION[^\]]*\][\s\S]*?\[END SYSTEM INSTRUCTION\]\s*/gi, '');
  r = r.replace(/\[LEARNED PATTERNS\][\s\S]*?\[\/LEARNED PATTERNS\]\s*/gi, '');
  r = r.replace(/\[SELF-EVAL HINTS\][\s\S]*?\[\/SELF-EVAL HINTS\]\s*/gi, '');
  r = r.replace(/\[CONTEXT SWITCH\][^\n]*\n?/gi, '');
  r = r.replace(/\[PROACTIVE\][\s\S]*?\[\/PROACTIVE\]\s*/gi, '');
  r = r.replace(/\[EMOTIONAL CONTEXT\][^\n]*\n?/gi, '');
  r = r.replace(/\[CURRENT DATE & TIME\][^\n]*\n?/gi, '');
  r = r.replace(/\[USER LOCATION\][^\n]*\n?/gi, '');
  r = r.replace(/\[REZULTATE CAUTARE WEB REALE\][\s\S]*?Citeaza sursele\.\s*/gi, '');
  r = r.replace(/\[DATE METEO REALE\][^\n]*\n?/gi, '');
  r = r.replace(/\[CONTEXT DIN MEMORIE\][^\n]*\n?/gi, '');
  return r.trim();
}

// Emotion is decided by the brain via [EMOTION:xxx] tag in the AI reply

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Too many requests. Please wait a minute.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.headers['x-admin-secret'] === process.env.ADMIN_SECRET_KEY,
});
const memoryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many memory requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});
const convLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Too many requests.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// â•â•â• SAVE CONVERSATION HELPER â•â•â•
async function saveConv(supabaseAdmin, uid, avatar, userMsg, aiReply, convId, lang) {
  if (!supabaseAdmin) return;
  if (!convId) {
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .insert({ user_id: uid || null, avatar, title: userMsg.substring(0, 80) })
      .select('id')
      .single();
    if (error) {
      logger.warn({ component: 'Chat', err: error.message }, 'saveConv insert failed');
      return;
    }
    convId = data?.id;
  } else {
    const { error: updErr } = await supabaseAdmin
      .from('conversations')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', convId);
    if (updErr) logger.warn({ component: 'Chat', err: updErr.message }, 'saveConv update failed');
  }
  if (convId) {
    const { error: msgErr } = await supabaseAdmin.from('messages').insert([
      {
        conversation_id: convId,
        role: 'user',
        content: userMsg,
        language: lang,
        source: 'web',
      },
      {
        conversation_id: convId,
        role: 'assistant',
        content: aiReply,
        language: lang,
        source: 'web',
      },
    ]);
    if (msgErr) logger.warn({ component: 'Chat', err: msgErr.message }, 'saveConv messages failed');
  }
  return convId;
}

// â•â•â• ADMIN KEYWORD BLACKLIST â•â•â•

// POST /api/chat
router.post('/chat', chatLimiter, validate(chatSchema), async (req, res) => {
  try {
    const _chatStart = Date.now();
    const { getUserFromToken, supabaseAdmin, brain } = req.app.locals;
    const {
      message,
      avatar = 'kelion',
      history = [],
      language = 'ro',
      conversationId,
      imageBase64,
      audioBase64,
      geo,
    } = req.body;
    if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });

    // â•â•â• K1 MODE INTERCEPT â€” admin says "K1" to talk to brain directly â•â•â•
    const isK1Admin = req.headers['x-admin-secret'] === process.env.ADMIN_SECRET_KEY;
    const isK1 = isK1Admin && /^k1[\s:,]/i.test(message.trim());
    if (isK1) {
      try {
        const brainChat = require('./brain-chat');
        const k1Message = message.replace(/^k1[\s:,]*/i, '').trim();
        // Forward to brain-chat internally
        const proxyReq = {
          body: { message: k1Message, sessionId: 'k1_chat_' + Date.now() },
          app: req.app,
        };
        const proxyRes = {
          json: (data) => {
            // Return as K1 response with different voice marker
            res.json({
              reply: data.reply,
              emotion: 'neutral',
              k1Mode: true,
              k1Voice: 'alloy', // Different from Kelion/Kira voice
              pendingApproval: data.pendingApproval || null,
            });
          },
          status: (code) => ({ json: (d) => res.status(code).json(d) }),
        };
        await brainChat.handle(proxyReq, proxyRes);
        return;
      } catch (e) {
        // K1 not available, fall through to normal chat
        logger.warn({ component: 'Chat', err: e.message }, 'K1 intercept failed, using normal chat');
      }
    }

    const user = await getUserFromToken(req);

    // Admin tool execution is gated in brain.buildPlan() via isAdmin parameter.
    // Non-admin users can mention admin keywords freely â€” tools won't execute.
    const adminEmail = (process.env.ADMIN_EMAIL || '').toLowerCase();
    const isOwner = user?.email?.toLowerCase() === adminEmail;
    const isAdmin = isOwner && req.headers['x-admin-mode'] === 'true';

    const usage = await checkUsage(user?.id, 'chat', supabaseAdmin);
    if (!usage.allowed)
      return res.status(429).json({
        error: 'Chat limit reached. Upgrade to Pro for more messages.',
        plan: usage.plan,
        limit: usage.limit,
        upgrade: true,
      });

    // â•â•â• BRAIN V5: GPT-5.4 + Gemini hybrid with Quality Gate â•â•â•
    const thought = await thinkV5(
      brain,
      message,
      avatar,
      history,
      language,
      user?.id,
      conversationId,
      { imageBase64, audioBase64, geo, isAutoCamera: req.body.isAutoCamera || false },
      isAdmin
    );

    // V5 returns the final reply from GPT-5.4 or Gemini Flash
    let reply = thought.enrichedMessage;
    const engine = thought.agent || 'V5';

    // â”€â”€ SANITIZE: Strip leaked system instructions from reply â”€â”€
    if (reply) {
      reply = sanitizeReply(reply);
    }

    // â”€â”€ Push notification to admin â”€â”€
    try {
      notify('info', `ðŸ’¬ ${user?.email || 'guest'}: ${(message || '').slice(0, 60)}`, {
        userId: user?.id,
        avatar,
        engine: thought.agent,
      });
    } catch {
      /* non-blocking */
    }
    // Agent logging removed â€” was hardcoded to localhost:7257 (non-functional on Railway)

    if (!reply) return res.status(503).json({ error: 'AI unavailable' });

    let savedConvId = conversationId;
    if (supabaseAdmin) {
      try {
        savedConvId = await saveConv(supabaseAdmin, user?.id, avatar, message, reply, conversationId, language);
      } catch (e) {
        logger.warn({ component: 'Chat', err: e.message }, 'saveConv');
      }
    }
    brain
      .learnFromConversation(user?.id, message, reply)
      .catch((e) => logger.warn({ component: 'Chat', err: e.message }, 'learnFromConversation failed'));
    // Save brain memory (text) + extract facts
    if (user?.id) {
      brain
        .saveMemory(user.id, 'text', 'User: ' + message.substring(0, 500) + ' | Kelion: ' + reply.substring(0, 500), {
          avatar,
          language,
          engine,
        })
        .catch(() => {});
      brain.extractAndSaveFacts(user.id, message, reply).catch(() => {});
      // Save visual memory if image was analyzed
      if (imageBase64 && reply) {
        brain.saveMemory(user.id, 'visual', 'Image analysis: ' + reply.substring(0, 500), { avatar }).catch(() => {});
      }
      // Save audio memory if voice was transcribed
      if (audioBase64 && message) {
        brain.saveMemory(user.id, 'audio', 'Voice said: ' + message.substring(0, 500), { avatar }).catch(() => {});
      }
    }
    // Log AI cost for this chat interaction
    const estimatedTokens = Math.ceil((message.length + reply.length) / 4);
    brain
      ._logCost(
        engine === 'Gemini-V4' ? 'Google' : 'OpenAI',
        engine,
        Math.ceil(message.length / 4),
        Math.ceil(reply.length / 4),
        estimatedTokens * 0.000003, // approximate cost
        user?.id
      )
      .catch(() => {});
    incrementUsage(user?.id, 'chat', supabaseAdmin).catch((e) =>
      logger.warn({ component: 'Chat', err: e.message }, 'incrementUsage failed')
    );

    logger.info(
      {
        component: 'Chat',
        engine,
        avatar,
        language,
        tools: thought.toolsUsed,
        chainOfThought: !!thought.chainOfThought,
        thinkTime: thought.thinkTime,
        replyLength: reply.length,
      },
      `${engine} | ${avatar} | ${language} | tools:[${thought.toolsUsed.join(',')}] | CoT:${!!thought.chainOfThought} | ${thought.thinkTime}ms think | ${reply.length}c`
    );

    const totalTime = Date.now() - _chatStart;
    // Parse [MONITOR]...[/MONITOR] tags from AI reply
    let monitorFromReply = null;
    const monitorMatch = reply.match(/\[MONITOR\]([\s\S]*?)\[\/MONITOR\]/i);
    if (monitorMatch) {
      monitorFromReply = { content: monitorMatch[1].trim(), type: 'html' };
      reply = reply.replace(/\[MONITOR\][\s\S]*?\[\/MONITOR\]/gi, '').trim();
    }
    // Parse [EMOTION:xxx] tag from AI reply (brain decides the emotion)
    let emotion = 'neutral';
    const emotionMatch = reply.match(/\[EMOTION:\s*(\w+)\]/i);
    if (emotionMatch) {
      emotion = emotionMatch[1].toLowerCase();
      reply = reply.replace(/\[EMOTION:\s*\w+\]/gi, '').trim();
    } else {
      // FALLBACK: auto-detect emotion from reply text when AI doesn't emit tags
      const replyLow = reply.toLowerCase();
      if (/ðŸ˜‚|ðŸ˜„|ðŸ˜Š|haha|:D|bravo|super|perfect|excelent|genial|fantastic/i.test(replyLow)) emotion = 'laughing';
      else if (/â¤|ðŸ¥°|ðŸ’•|te iubesc|love|drag|iubit/i.test(replyLow)) emotion = 'loving';
      else if (/ðŸ˜¢|ðŸ˜”|din pÄƒcate|unfortunately|Ã®mi pare rÄƒu|sorry|scuze|regret/i.test(replyLow)) emotion = 'sad';
      else if (/ðŸ¤”|hmm|interesant|curios|interesting|oare|perhaps/i.test(replyLow)) emotion = 'thinking';
      else if (/ðŸ˜®|wow|uau|incredibil|amazing|unbelievable|nu-mi vine/i.test(replyLow)) emotion = 'surprised';
      else if (/ðŸ˜|heh|glum|ironic|witty|ðŸ˜œ/i.test(replyLow)) emotion = 'playful';
      else if (/ðŸ’ª|determinat|going to|vom reuÈ™i|we will|hai sÄƒ/i.test(replyLow)) emotion = 'determined';
      else if (/ðŸ˜Ÿ|grijÄƒ|atenÈ›ie|careful|warning|pericol|danger/i.test(replyLow)) emotion = 'concerned';
      else if (/salut|bunÄƒ|hello|hey|hi |welcome|ðŸ‘‹/i.test(replyLow)) emotion = 'happy';
      else if (/\?$/.test(reply.trim())) emotion = 'thinking';
      else emotion = 'happy'; // default to happy, not neutral â€” feels more alive
    }
    // Parse [GESTURE:xxx] tags from AI reply (brain controls body language)
    const gestures = [];
    const gestureMatches = reply.matchAll(/\[GESTURE:\s*(\w+)\]/gi);
    for (const gm of gestureMatches) gestures.push(gm[1].toLowerCase());
    reply = reply.replace(/\[GESTURE:\s*\w+\]/gi, '').trim();
    // Parse [POSE:xxx] tag (arms_down, arms_crossed, presenting, relaxed, etc.)
    let pose = null;
    const poseMatch = reply.match(/\[POSE:\s*(\w+)\]/i);
    if (poseMatch) {
      pose = poseMatch[1].toLowerCase();
      reply = reply.replace(/\[POSE:\s*\w+\]/gi, '').trim();
    }
    // Parse [BODY:xxx] tags from AI reply (per-limb body actions)
    const bodyActions = [];
    const bodyMatches = reply.matchAll(/\[BODY:\s*(\w+)\]/gi);
    for (const bm of bodyMatches) bodyActions.push(bm[1]);
    reply = reply.replace(/\[BODY:\s*\w+\]/gi, '').trim();
    // Parse [GAZE:xxx] tag from AI reply (eye direction: center, left, right, up, down, up-left, etc.)
    let gaze = null;
    const gazeMatch = reply.match(/\[GAZE:\s*([\w-]+)\]/i);
    if (gazeMatch) {
      gaze = gazeMatch[1].toLowerCase();
      reply = reply.replace(/\[GAZE:\s*[\w-]+\]/gi, '').trim();
    }

    const response = {
      reply,
      avatar,
      engine,
      language,
      thinkTime: thought.thinkTime,
      totalTime,
      conversationId: savedConvId,
      emotion,
      gestures,
      pose,
      bodyActions,
      gaze,
    };
    if (monitorFromReply) {
      response.monitor = monitorFromReply;
    } else if (thought.monitor.content) {
      response.monitor = thought.monitor;
    }
    res.json(response);
  } catch (e) {
    logger.error({ component: 'Chat', err: e.message }, e.message);
    res.status(500).json({ error: 'AI error' });
  }
});

// POST /api/chat/stream â€” Server-Sent Events powered by thinkV5 (full brain)
router.post('/chat/stream', chatLimiter, validate(chatSchema), async (req, res) => {
  let heartbeat = null;
  try {
    const { getUserFromToken, supabaseAdmin, brain } = req.app.locals;
    const {
      message, avatar = 'kelion', history = [], language = 'ro',
      conversationId, imageBase64, audioBase64, geo,
    } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const user = await getUserFromToken(req);
    const adminEmailS = (process.env.ADMIN_EMAIL || '').toLowerCase();
    const isOwnerStream = user?.email?.toLowerCase() === adminEmailS;
    const isAdminStream = isOwnerStream && req.headers['x-admin-mode'] === 'true';

    const usage = await checkUsage(user?.id, 'chat', supabaseAdmin);
    if (!usage.allowed)
      return res.status(429).json({
        error: 'Chat limit reached. Upgrade to Pro for more messages.',
        plan: usage.plan, limit: usage.limit, upgrade: true,
      });

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    heartbeat = setInterval(() => res.write(':keepalive\n\n'), 15000);
    res.write(`data: ${JSON.stringify({ type: 'thinking' })}\n\n`);

    // â”€â”€ USE thinkV5 â€” full brain with tool calling, memory, Supabase â”€â”€
    const thought = await thinkV5(
      brain, message, avatar, history, language,
      user?.id, conversationId,
      { imageBase64, audioBase64, geo, isAutoCamera: req.body.isAutoCamera || false },
      isAdminStream
    );

    let fullReply = thought.enrichedMessage || '';
    if (!fullReply) {
      res.write(`data: ${JSON.stringify({ type: 'done', reply: '', conversationId })}\n\n`);
      res.end();
      return;
    }

    // â”€â”€ Send monitor if brain produced one â”€â”€
    if (thought.monitor?.content) {
      res.write(`data: ${JSON.stringify({
        type: 'monitor',
        content: thought.monitor.content,
        monitorType: thought.monitor.type,
      })}\n\n`);
    }

    // â”€â”€ Extract and strip [MONITOR] from reply â”€â”€
    let monitorFromReply = null;
    const monitorMatch = fullReply.match(/\[MONITOR\]([\s\S]*?)\[\/MONITOR\]/i);
    if (monitorMatch) {
      monitorFromReply = { content: monitorMatch[1].trim(), type: 'html' };
      fullReply = fullReply.replace(/\[MONITOR\][\s\S]*?\[\/MONITOR\]/gi, '').trim();
      if (!thought.monitor?.content) {
        res.write(`data: ${JSON.stringify({
          type: 'monitor', content: monitorFromReply.content, monitorType: 'html',
        })}\n\n`);
      }
    }

    // â”€â”€ Extract [ACTION:xxx] tags and send them â”€â”€
    const actionMatches = [...fullReply.matchAll(/\[ACTION:([^\]]+)\]/gi)];
    if (actionMatches.length > 0) {
      const actions = actionMatches.map(m => m[1].trim());
      res.write(`data: ${JSON.stringify({ type: 'actions', actions })}\n\n`);
      fullReply = fullReply.replace(/\[ACTION:[^\]]+\]/gi, '').trim();
    }

    // â”€â”€ Extract avatar tags â”€â”€
    let emotion = 'neutral';
    const emotionMatch = fullReply.match(/\[EMOTION:\s*(\w+)\]/i);
    if (emotionMatch) emotion = emotionMatch[1].toLowerCase();
    else {
      const rl = fullReply.toLowerCase();
      if (/ðŸ˜‚|bravo|super|perfect|genial/i.test(rl)) emotion = 'laughing';
      else if (/ðŸ˜¢|Ã®mi pare rÄƒu|sorry/i.test(rl)) emotion = 'sad';
      else if (/ðŸ¤”|hmm|interesant/i.test(rl)) emotion = 'thinking';
      else if (/salut|bunÄƒ|hello|hey/i.test(rl)) emotion = 'happy';
      else emotion = 'happy';
    }

    const gestures = [...fullReply.matchAll(/\[GESTURE:\s*(\w+)\]/gi)].map(m => m[1].toLowerCase());
    const bodyActions = [...fullReply.matchAll(/\[BODY:\s*(\w+)\]/gi)].map(m => m[1]);
    const poseMatch = fullReply.match(/\[POSE:\s*(\w+)\]/i);
    const pose = poseMatch ? poseMatch[1].toLowerCase() : null;
    const gazeMatch = fullReply.match(/\[GAZE:\s*([\w-]+)\]/i);
    const gaze = gazeMatch ? gazeMatch[1].toLowerCase() : null;

    // â”€â”€ Clean reply â”€â”€
    let cleanReply = sanitizeReply(fullReply)
      .replace(/\[EMOTION:\s*\w+\]/gi, '')
      .replace(/\[GESTURE:\s*\w+\]/gi, '')
      .replace(/\[BODY:\s*\w+\]/gi, '')
      .replace(/\[GAZE:\s*[\w-]+\]/gi, '')
      .replace(/\[POSE:\s*\w+\]/gi, '')
      .replace(/\[ACTION:[^\]]+\]/gi, '')
      .trim();

    // â”€â”€ Stream reply word by word â”€â”€
    res.write(`data: ${JSON.stringify({ type: 'start', engine: thought.agent || 'V5' })}\n\n`);
    const words = cleanReply.split(/(\s+)/);
    for (const word of words) {
      if (word) res.write(`data: ${JSON.stringify({ type: 'chunk', text: word })}\n\n`);
    }

    // â”€â”€ Save to Supabase â”€â”€
    let savedConvId = conversationId;
    if (supabaseAdmin) {
      try {
        savedConvId = await saveConv(supabaseAdmin, user?.id, avatar, message, cleanReply, conversationId, language);
      } catch (e) {
        logger.warn({ component: 'Stream', err: e.message }, 'saveConv failed');
      }
    }

    // â”€â”€ Save brain memory â”€â”€
    if (user?.id) {
      brain.saveMemory(user.id, 'text',
        'User: ' + message.substring(0, 500) + ' | Kelion: ' + cleanReply.substring(0, 500),
        { avatar, language }
      ).catch(() => {});
      brain.extractAndSaveFacts(user.id, message, cleanReply).catch(() => {});
    }

    // â”€â”€ Send done event WITH avatar metadata â”€â”€
    res.write(`data: ${JSON.stringify({
      type: 'done',
      reply: cleanReply,
      thinkTime: thought.thinkTime,
      conversationId: savedConvId,
      emotion,
      gestures,
      bodyActions,
      pose,
      gaze,
      monitor: monitorFromReply || thought.monitor?.content ? (monitorFromReply || thought.monitor) : undefined,
    })}\n\n`);
    res.end();

    brain.learnFromConversation(user?.id, message, cleanReply).catch(() => {});
    incrementUsage(user?.id, 'chat', supabaseAdmin).catch(() => {});
    logger.info({ component: 'Stream-V5', avatar, language, tools: thought.toolsUsed, replyLength: cleanReply.length },
      `V5 | ${avatar} | tools:[${(thought.toolsUsed || []).join(',')}] | ${cleanReply.length}c`);

  } catch (e) {
    logger.error({ component: 'Stream', err: e.message }, e.message);
    if (!res.headersSent) res.status(500).json({ error: 'Stream error' });
    else res.end();
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
});
router.get('/conversations', convLimiter, async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const u = await getUserFromToken(req);
    if (!u || !supabaseAdmin) return res.json({ conversations: [] });
    const { data, error } = await supabaseAdmin
      .from('conversations')
      .select('id, avatar, title, created_at, updated_at')
      .eq('user_id', u.id)
      .order('updated_at', { ascending: false })
      .limit(50);
    if (error) logger.warn({ component: 'Chat', err: error.message }, 'conversations list failed');
    res.json({ conversations: data || [] });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// GET /api/conversations/:id/messages
router.get('/conversations/:id/messages', convLimiter, async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const u = await getUserFromToken(req);
    if (!u || !supabaseAdmin) return res.json({ messages: [] });
    const { data: conv, error: convErr } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', u.id)
      .single();
    if (convErr && convErr.code !== 'PGRST116') return res.status(500).json({ error: 'Server error' });
    if (!conv) return res.status(403).json({ error: 'Access denied' });
    const { data, error: msgErr2 } = await supabaseAdmin
      .from('messages')
      .select('id, role, content, created_at')
      .eq('conversation_id', req.params.id)
      .order('created_at', { ascending: true });
    if (msgErr2) logger.warn({ component: 'Chat', err: msgErr2.message }, 'messages list failed');
    res.json({ messages: data || [] });
  } catch {
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /api/memory
router.post('/memory', memoryLimiter, validate(memorySchema), async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin, memFallback } = req.app.locals;
    const { action, key, value } = req.body;
    const user = await getUserFromToken(req);
    const uid = 'u:' + (user?.id || 'guest');
    if (supabaseAdmin && user) {
      if (action === 'save') {
        const { error: sErr } = await supabaseAdmin.from('user_preferences').upsert(
          {
            user_id: user.id,
            key,
            value: typeof value === 'object' ? value : { data: value },
          },
          { onConflict: 'user_id,key' }
        );
        if (sErr) logger.warn({ component: 'Memory', err: sErr.message }, 'pref save failed');
        return res.json({ success: !sErr });
      }
      if (action === 'load') {
        const { data, error: lErr } = await supabaseAdmin
          .from('user_preferences')
          .select('value')
          .eq('user_id', user.id)
          .eq('key', key)
          .single();
        if (lErr && lErr.code !== 'PGRST116')
          logger.warn({ component: 'Memory', err: lErr.message }, 'pref load failed');
        return res.json({ value: data?.value || null });
      }
      if (action === 'list') {
        const { data, error: liErr } = await supabaseAdmin
          .from('user_preferences')
          .select('key, value')
          .eq('user_id', user.id);
        if (liErr) logger.warn({ component: 'Memory', err: liErr.message }, 'pref list failed');
        return res.json({
          keys: (data || []).map((d) => d.key),
          items: data || [],
        });
      }
    }
    if (!memFallback[uid]) memFallback[uid] = Object.create(null);
    if (action === 'save') {
      memFallback[uid][key] = value;
      res.json({ success: true });
    } else if (action === 'load') res.json({ value: memFallback[uid][key] || null });
    else if (action === 'list') res.json({ keys: Object.keys(memFallback[uid]) });
    else res.status(400).json({ error: 'Action must be: save, load, list' });
  } catch {
    res.status(500).json({ error: 'Memory error' });
  }
});

module.exports = router;
