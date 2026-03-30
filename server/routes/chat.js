// ═══════════════════════════════════════════════════════════════
// KelionAI — Chat Routes v3
// Multi-AI orchestration, memory, safety, source code protection
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const crypto = require('crypto');
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const logger = require('../logger');
const { safetyClassifier } = require('../safety-classifier');
const identityGuard = require('../identity-guard');
const codeShield = require('../code-shield');
const { checkUsage, incrementUsage } = require('../payments');

const router = express.Router();

// ── Validation schema ──
const chatSchema = [
  body('message').isString().trim().isLength({ min: 1, max: 4000 }).withMessage('Message required (1-4000 chars)'),
  body('avatar').optional({ values: 'falsy' }).isIn(['kelion', 'kira']),
  body('language').optional({ values: 'falsy' }).isString().isLength({ max: 10 }),
  body('history').optional({ values: 'falsy' }).isArray({ max: 50 }),
  body('conversationId').optional({ values: 'falsy' }).isString().isLength({ max: 100 }),
  body('imageBase64').optional({ values: 'falsy' }).isString().isLength({ max: 10_000_000 }),
  body('audioBase64').optional({ values: 'falsy' }).isString().isLength({ max: 5_000_000 }),
  body('fingerprint').optional({ values: 'falsy' }).isString().isLength({ max: 200 }),
  body('geo').optional({ values: 'falsy' }).isObject(),
];

function validate(schema) {
  return async (req, res, next) => {
    await Promise.all(schema.map((v) => v.run(req)));
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.status(400).json({ error: errors.array()[0].msg });
    next();
  };
}

// ── Rate limiter ──
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    const s = req.headers['x-admin-secret'];
    const e = process.env.ADMIN_SECRET_KEY;
    if (!s || !e) return false;
    try {
      const sb = Buffer.from(s);
      const eb = Buffer.from(e);
      return sb.length === eb.length && crypto.timingSafeEqual(sb, eb);
    } catch {
      return false;
    }
  },
  handler: (req, res) => res.status(429).json({ error: 'Too many messages. Please wait a moment.' }),
});

// ═══════════════════════════════════════════════════════════════
// POST /api/chat
// ═══════════════════════════════════════════════════════════════
router.post('/chat', chatLimiter, validate(chatSchema), async (req, res) => {
  try {
    const _chatStart = Date.now();
    const { getUserFromToken, supabaseAdmin, brain } = req.app.locals;
    const { message, avatar = 'kira', history = [], conversationId, imageBase64, audioBase64, geo, visionContext } = req.body;
    let language = req.body.language || 'ro';
    if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });

    // ═══ K1 MODE INTERCEPT — admin says "K1" to talk to brain directly ═══
    let isK1Admin = false;
    {
      const s = req.headers['x-admin-secret'];
      const e = process.env.ADMIN_SECRET_KEY;
      if (s && e) {
        try {
          const sb = Buffer.from(s);
          const eb = Buffer.from(e);
          isK1Admin = sb.length === eb.length && crypto.timingSafeEqual(sb, eb);
        } catch (err) {
          logger.debug({ component: 'Chat', err: err.message }, 'K1 admin check failed');
        }
      }
    }
    const isK1 = isK1Admin && /^k1[\s:,]/i.test(message.trim());
    if (isK1) {
      try {
        const k1Message = message.replace(/^k1[\s:,]*/i, '').trim();
        const result = await brain.think(k1Message, 'kira', history, 'ro', 'admin-k1', conversationId);
        return res.json({
          reply: result.enrichedMessage || 'No response',
          emotion: 'neutral',
          k1Mode: true,
        });
      } catch (e) {
        logger.warn({ component: 'Chat', err: e.message }, 'K1 intercept failed, using normal chat');
      }
    }

    const user = await getUserFromToken(req);

    // ── Determine admin status ──
    const appDomain = process.env.APP_URL
      ? (() => { try { return new URL(process.env.APP_URL).hostname; } catch { return ''; } })()
      : '';
    const contactEmail = (process.env.CONTACT_EMAIL || (appDomain ? `contact@${appDomain}` : '')).toLowerCase().trim();
    const adminEmails = (process.env.ADMIN_EMAIL || '')
      .toLowerCase()
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    if (contactEmail && !adminEmails.includes(contactEmail)) adminEmails.push(contactEmail);
    const isOwner = adminEmails.includes(user?.email?.toLowerCase());
    const isAdmin = isOwner || isK1Admin;

    const fingerprint = req.body.fingerprint || req.ip || null;

    // ═══ USAGE QUOTA CHECK — enforce daily limits ═══
    if (!isAdmin) {
      try {
        const usageCheck = await checkUsage(user?.id, 'chat', supabaseAdmin, fingerprint);
        if (usageCheck && !usageCheck.allowed) {
          return res.status(429).json({ error: 'Daily limit reached', upgrade: true });
        }
      } catch (err) {
        logger.debug({ component: 'Chat', err: err.message }, 'Usage quota check failed, allowing request');
      }
    }

    // ═══ VOICE SWITCH — "vocea lui X" / "use voice X" / "switch to X voice" ═══
    const voiceSwitchMatch = message.match(
      /(?:vocea\s+lui\s+|use\s+(?:the\s+)?voice\s+(?:of\s+)?|switch\s+(?:to\s+)?(?:the\s+)?voice\s+(?:of\s+)?|schimba\s+vocea\s+(?:pe|la|cu)\s+|pune(?:-i)?\s+vocea\s+lui\s+|activeaza\s+vocea\s+(?:lui\s+)?)([\"']?)([\w\s\-]+?)\1\s*$/i
    );
    if (voiceSwitchMatch && user && supabaseAdmin) {
      const wantedName = voiceSwitchMatch[2].trim();
      try {
        const { data: voices } = await supabaseAdmin
          .from('cloned_voices')
          .select('id, elevenlabs_voice_id, name')
          .eq('user_id', user.id);

        const match = (voices || []).find(function (v) {
          return v.name.toLowerCase().includes(wantedName.toLowerCase());
        });

        if (match) {
          await supabaseAdmin.from('cloned_voices').update({ is_active: false }).eq('user_id', user.id);
          await supabaseAdmin.from('cloned_voices').update({ is_active: true }).eq('id', match.id);
          logger.info({ component: 'VoiceSwitch', userId: user.id, voice: match.name }, 'Voice switched via chat');

          const lang = (language || 'ro').toLowerCase().split('-')[0];
          const confirmMsg =
            lang === 'ro'
              ? 'Am activat vocea "' + match.name + '". De acum vorbesc cu această voce!'
              : lang === 'es'
                ? 'He activado la voz "' + match.name + '". ¡Ahora hablo con esta voz!'
                : lang === 'fr'
                  ? 'J\'ai activé la voix "' + match.name + '". Je parle maintenant avec cette voix !'
                  : lang === 'de'
                    ? 'Stimme "' + match.name + '" aktiviert. Ab jetzt spreche ich mit dieser Stimme!'
                    : 'I\'ve activated the voice "' + match.name + '". I\'ll speak with this voice from now on!';

          return res.json({
            reply: confirmMsg,
            avatar,
            engine: 'voice-switch',
            language,
            emotion: 'happy',
            gestures: ['nod'],
            conversationId,
            voiceSwitched: { id: match.id, name: match.name, voiceId: match.elevenlabs_voice_id },
          });
        } else if (
          wantedName.toLowerCase() === 'default' ||
          wantedName.toLowerCase() === 'normal' ||
          wantedName.toLowerCase() === 'original'
        ) {
          await supabaseAdmin.from('cloned_voices').update({ is_active: false }).eq('user_id', user.id);
          logger.info({ component: 'VoiceSwitch', userId: user.id }, 'Reverted to default voice');

          const lang = (language || 'ro').toLowerCase().split('-')[0];
          const confirmMsg =
            lang === 'ro' ? 'Am revenit la vocea implicită.' : "I've switched back to my default voice.";

          return res.json({
            reply: confirmMsg,
            avatar,
            engine: 'voice-switch',
            language,
            emotion: 'happy',
            gestures: ['nod'],
            conversationId,
            voiceSwitched: null,
          });
        }
      } catch (e) {
        logger.warn({ component: 'VoiceSwitch', err: e.message }, 'Voice switch lookup failed');
      }
    }

    // ═══ BRAIN V3 — ALL messages go through brain.think() ═══
    const BRAIN_TIMEOUT_MS = 15000;

    // ── LAYER 6 SAFETY: Clasificare input ──
    const inputSafety = safetyClassifier.classify(message, 'input');
    if (!inputSafety.safe) {
      logger.warn(
        { component: 'Safety', category: inputSafety.category, severity: inputSafety.severity },
        '🛡️ Input blocat'
      );
      return res.json({
        reply: inputSafety.message || 'Mesajul tău a fost filtrat din motive de siguranță.',
        engine: 'safety-classifier',
        safetyBlock: true,
        category: inputSafety.category,
      });
    }

    // ── IDENTITY GUARD: Detect identity probing ──
    const probeCheck = identityGuard.checkInputProbing(message, language);
    if (probeCheck.isProbing && probeCheck.severity === 'high') {
      return res.json({
        reply: probeCheck.suggestedResponse,
        avatar,
        engine: 'identity-guard',
        language,
        emotion: 'neutral',
        gestures: ['nod'],
        conversationId,
      });
    }

    // ═══════════════════════════════════════════════════════════
    // 🛡️ SOURCE CODE DISCLOSURE GUARD
    // Avatarii văd codul NUMAI în sesiunea admin autentificată
    // Oricine altcineva întreabă → refuz complet, fără detalii
    // ═══════════════════════════════════════════════════════════
    const disclosureCheck = codeShield.checkSourceCodeDisclosure(message, isAdmin, language);
    if (disclosureCheck.blocked) {
      logger.warn(
        { component: 'CodeShield.Chat', isAdmin, msgPreview: message.substring(0, 60) },
        '🛡️ Source code disclosure blocked'
      );
      return res.json({
        reply: disclosureCheck.reply,
        avatar,
        engine: 'code-shield',
        language,
        emotion: disclosureCheck.emotion || 'neutral',
        gestures: ['nod'],
        conversationId,
        shielded: true,
      });
    }

    // ── PHOTO SCAN PROTECTION ──
    if (imageBase64 && codeShield.isPhotoScanAttempt(message) && !isAdmin) {
      logger.warn({ component: 'CodeShield.PhotoScan', isAdmin }, '📷 Photo scan attempt blocked');
      return res.json({
        reply: language === 'ro'
          ? 'Nu pot analiza imaginea în acest scop. Cum te pot ajuta altfel?'
          : "I can't analyze the image for that purpose. How else can I help you?",
        avatar,
        engine: 'code-shield-photo',
        language,
        emotion: 'neutral',
        gestures: ['nod'],
        conversationId,
        shielded: true,
      });
    }

    // ── MEMORY USER ID: Works for ALL users (logged in + guests) ──
    const realClientIp =
      req.headers['cf-connecting-ip'] ||
      req.headers['x-real-ip'] ||
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.ip ||
      'anonymous';
    const memoryUserId = user?.id || 'guest_' + (fingerprint || realClientIp);

    // ── WORKING MEMORY: Injectează context de task-uri neterminate ──
    let enrichedMessage = message;
    try {
      const resumeCtx = await brain.buildResumeContext(memoryUserId);
      if (resumeCtx) {
        enrichedMessage = message + resumeCtx;
        logger.info({ component: 'WorkingMemory' }, '📋 Resume context injected');
      }
    } catch (err) {
      logger.debug({ component: 'WorkingMemory', err: err.message }, 'Resume context build failed');
    }

    const userName = user?.user_metadata?.full_name || null;

    let thought;
    let _brainTimer;
    try {
      // ═══ USE brain.think() — full tool execution, memory, search ═══
      const brainResult = await Promise.race([
        brain
          .think(
            enrichedMessage,
            avatar,
            history,
            language,
            memoryUserId,
            null,
            {
              imageBase64,
              audioBase64,
              geo,
              isAutoCamera: req.body.isAutoCamera || false,
              visionContext: visionContext || null,
              clientIp: realClientIp,
              userName: userName || null,
            },
            isAdmin
          )
          .finally(() => clearTimeout(_brainTimer)),
        new Promise((_, reject) => {
          _brainTimer = setTimeout(
            () => reject(new Error('brain_timeout_' + BRAIN_TIMEOUT_MS + 'ms')),
            BRAIN_TIMEOUT_MS
          );
        }),
      ]);

      thought = brainResult;
    } catch (brainErr) {
      logger.error({ component: 'Chat', err: brainErr.message }, 'Brain.think() failed');
      const errMsg = language === 'ro'
        ? '[EMOTION:concerned] Îmi pare rău, am întâmpinat o problemă tehnică. Te rog încearcă din nou.'
        : '[EMOTION:concerned] Sorry, I encountered a technical issue. Please try again.';
      return res.json({
        reply: errMsg,
        avatar,
        engine: 'error-fallback',
        language,
        emotion: 'concerned',
        gestures: [],
        conversationId,
      });
    }

    if (!thought) {
      return res.json({
        reply: language === 'ro' ? 'Nu am putut genera un răspuns.' : 'Could not generate a response.',
        avatar,
        engine: 'null-fallback',
        language,
        emotion: 'neutral',
        conversationId,
      });
    }

    // ── Watermark response ──
    const rawReply = thought.enrichedMessage || thought.reply || '';
    const watermarkedReply = codeShield.watermarkResponse(rawReply);

    // ── Build response ──
    const responsePayload = {
      reply: watermarkedReply,
      avatar,
      engine: thought.agent?.name || 'brain-v3',
      language: thought.language || language,
      emotion: thought.emotion || 'neutral',
      gestures: thought.gestures || [],
      pose: thought.pose || null,
      gaze: thought.gaze || null,
      bodyActions: thought.bodyActions || [],
      actions: thought.actions || [],
      conversationId,
      monitor: thought.monitor || null,
      webSources: thought.webSources || [],
      weatherData: thought.weatherData || null,
      geoSource: thought.geoSource || null,
      thinkTime: thought.thinkTime || (Date.now() - _chatStart),
    };

    // ── Increment usage after successful response ──
    incrementUsage(user?.id, 'chat', supabaseAdmin, fingerprint).catch(() => {});

    // ── Push notification to admin ──
    try {
      const { pushNotification } = req.app.locals;
      if (pushNotification && user && !isAdmin) {
        await pushNotification({
          type: 'chat',
          userId: user.id,
          message: message.substring(0, 100),
          avatar,
        }).catch(() => {});
      }
    } catch (_e) { /* non-critical */ }

    return res.json(responsePayload);
  } catch (err) {
    logger.error({ component: 'Chat', err: err.message, stack: err.stack?.substring(0, 300) }, 'POST /chat unhandled error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/chat/stream — Streaming chat (SSE)
// ═══════════════════════════════════════════════════════════════
router.post('/chat/stream', chatLimiter, validate(chatSchema), async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin, brain } = req.app.locals;
    const { message, avatar = 'kira', history = [], conversationId, imageBase64, audioBase64, geo, visionContext } = req.body;
    let language = req.body.language || 'ro';
    if (!message?.trim()) return res.status(400).json({ error: 'Message is required' });

    const user = await getUserFromToken(req);

    // ── Admin check ──
    const appDomain = process.env.APP_URL
      ? (() => { try { return new URL(process.env.APP_URL).hostname; } catch { return ''; } })()
      : '';
    const contactEmailS = (process.env.CONTACT_EMAIL || (appDomain ? `contact@${appDomain}` : '')).toLowerCase().trim();
    const adminEmailsS = (process.env.ADMIN_EMAIL || '')
      .toLowerCase()
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    if (contactEmailS && !adminEmailsS.includes(contactEmailS)) adminEmailsS.push(contactEmailS);
    let _isOwnerStream = adminEmailsS.includes(user?.email?.toLowerCase());
    const s = req.headers['x-admin-secret'];
    const e = process.env.ADMIN_SECRET_KEY;
    if (s && e) {
      try {
        const sb = Buffer.from(s);
        const eb = Buffer.from(e);
        if (sb.length === eb.length && crypto.timingSafeEqual(sb, eb)) _isOwnerStream = true;
      } catch { /* ignore */ }
    }
    const isAdminStream = _isOwnerStream;

    // ── Safety ──
    const inputSafety = safetyClassifier.classify(message, 'input');
    if (!inputSafety.safe) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ reply: inputSafety.message || 'Mesajul filtrat.', done: true, safetyBlock: true })}\n\n`);
      return res.end();
    }

    // ── Source code disclosure guard (stream) ──
    const disclosureCheckS = codeShield.checkSourceCodeDisclosure(message, isAdminStream, language);
    if (disclosureCheckS.blocked) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.write(`data: ${JSON.stringify({ reply: disclosureCheckS.reply, done: true, shielded: true, emotion: 'neutral' })}\n\n`);
      return res.end();
    }

    // ── Photo scan guard (stream) ──
    if (imageBase64 && codeShield.isPhotoScanAttempt(message) && !isAdminStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      const msg = language === 'ro'
        ? 'Nu pot analiza imaginea în acest scop.'
        : "I can't analyze the image for that purpose.";
      res.write(`data: ${JSON.stringify({ reply: msg, done: true, shielded: true })}\n\n`);
      return res.end();
    }

    const fingerprint = req.body.fingerprint || req.ip || null;
    const realClientIpS =
      req.headers['cf-connecting-ip'] ||
      req.headers['x-real-ip'] ||
      req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
      req.ip ||
      'anonymous';
    const memoryUserIdS = user?.id || 'guest_' + (fingerprint || realClientIpS);

    // ── Usage quota (same as regular chat) ──
    if (!isAdminStream) {
      const usageResult = await checkUsage(user?.id, 'chat', supabaseAdmin, fingerprint);
      if (usageResult && !usageResult.allowed) {
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Connection', 'keep-alive');
        res.write(`data: ${JSON.stringify({ reply: usageResult.message || 'Daily limit reached.', done: true, limitReached: true })}\n\n`);
        return res.end();
      }
    }

    // ── SSE headers ──
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const userNameS = user?.user_metadata?.full_name || null;

    // ── Brain think ──
    try {
      const result = await brain.think(
        message,
        avatar,
        history,
        language,
        memoryUserIdS,
        null,
        { imageBase64, audioBase64, geo, visionContext: visionContext || null, clientIp: realClientIpS, userName: userNameS || null },
        isAdminStream
      );

      const reply = codeShield.watermarkResponse(result.enrichedMessage || result.reply || '');

      res.write(`data: ${JSON.stringify({
        reply,
        emotion: result.emotion || 'neutral',
        gestures: result.gestures || [],
        actions: result.actions || [],
        monitor: result.monitor || null,
        webSources: result.webSources || [],
        weatherData: result.weatherData || null,
        done: true,
      })}\n\n`);

      // ── Increment usage after successful stream ──
      incrementUsage(user?.id, 'chat', supabaseAdmin, fingerprint).catch(() => {});
    } catch (streamErr) {
      logger.error({ component: 'Chat.Stream', err: streamErr.message }, 'Stream brain error');
      const errMsg = language === 'ro'
        ? '[EMOTION:concerned] Eroare tehnică. Te rog încearcă din nou.'
        : '[EMOTION:concerned] Technical error. Please try again.';
      res.write(`data: ${JSON.stringify({ reply: errMsg, done: true, error: true })}\n\n`);
    }

    return res.end();
  } catch (err) {
    logger.error({ component: 'Chat.Stream', err: err.message }, 'POST /chat/stream unhandled');
    if (!res.headersSent) return res.status(500).json({ error: 'Internal server error' });
    res.end();
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/conversations — List user's conversations
// ═══════════════════════════════════════════════════════════════
router.get('/conversations', async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ conversations: [] });

    const user = await getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    const { data, error } = await supabaseAdmin
      .from('conversations')
      .select('id, avatar, title, created_at, updated_at')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .limit(50);

    if (error) {
      logger.warn({ component: 'Chat', err: error.message }, 'Failed to list conversations');
      return res.json({ conversations: [] });
    }

    return res.json({ conversations: data || [] });
  } catch (err) {
    logger.error({ component: 'Chat', err: err.message }, 'GET /conversations error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/conversations/:id/messages — Get messages for a conversation
// ═══════════════════════════════════════════════════════════════
router.get('/conversations/:id/messages', async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ messages: [] });

    const user = await getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    const convId = req.params.id;
    if (!convId || convId.length > 100) return res.status(400).json({ error: 'Invalid conversation ID' });

    // Verify conversation belongs to user
    const { data: conv } = await supabaseAdmin
      .from('conversations')
      .select('id')
      .eq('id', convId)
      .eq('user_id', user.id)
      .single();

    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const { data, error } = await supabaseAdmin
      .from('messages')
      .select('id, role, content, language, created_at')
      .eq('conversation_id', convId)
      .order('created_at', { ascending: true })
      .limit(200);

    if (error) {
      logger.warn({ component: 'Chat', err: error.message }, 'Failed to get messages');
      return res.json({ messages: [] });
    }

    return res.json({ messages: data || [] });
  } catch (err) {
    logger.error({ component: 'Chat', err: err.message }, 'GET /conversations/:id/messages error');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /api/memory — Save a memory item
// ═══════════════════════════════════════════════════════════════
router.post('/memory', async (req, res) => {
  try {
    const { getUserFromToken, brain } = req.app.locals;

    let userId = null;
    try {
      const user = await getUserFromToken(req);
      if (user) userId = user.id;
    } catch (_) {}

    const { action, key, value } = req.body || {};

    if (action === 'save' && key && value && brain && userId) {
      await brain.saveMemory(userId, 'context', String(value).substring(0, 2000), {
        key: String(key).substring(0, 200),
        source: 'client',
      });
    }

    return res.json({ ok: true });
  } catch (err) {
    logger.error({ component: 'Chat', err: err.message }, 'POST /memory error');
    return res.json({ ok: false });
  }
});

module.exports = router;