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

const router = express.Router();

// ── Validation schema ──
const chatSchema = [
  body('message').isString().trim().isLength({ min: 1, max: 4000 }).withMessage('Message required (1-4000 chars)'),
  body('avatar').optional().isIn(['kelion', 'kira']),
  body('language').optional().isString().isLength({ max: 10 }),
  body('history').optional().isArray({ max: 50 }),
  body('conversationId').optional().isString().isLength({ max: 100 }),
  body('imageBase64').optional().isString().isLength({ max: 10_000_000 }),
  body('audioBase64').optional().isString().isLength({ max: 5_000_000 }),
  body('fingerprint').optional().isString().isLength({ max: 200 }),
  body('geo').optional().isObject(),
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

// ── Usage quota check ──
async function checkUsage(userId, type, supabaseAdmin, fingerprint) {
  if (!supabaseAdmin) return { allowed: true };
  try {
    const identifier = userId || fingerprint || 'anonymous';
    const today = new Date().toISOString().split('T')[0];
    const { data } = await supabaseAdmin
      .from('usage_tracking')
      .select('count')
      .eq('identifier', identifier)
      .eq('type', type)
      .eq('date', today)
      .single();
    const count = data?.count || 0;
    const limits = { chat: 50, search: 20, image: 5, vision: 10, tts: 50 };
    return { allowed: count < (limits[type] || 50), count, limit: limits[type] || 50 };
  } catch {
    return { allowed: true };
  }
}

// ═══════════════════════════════════════════════════════════════
// POST /api/chat
// ═══════════════════════════════════════════════════════════════
router.post('/chat', chatLimiter, validate(chatSchema), async (req, res) => {
  try {
    const _chatStart = Date.now();
    const { getUserFromToken, supabaseAdmin, brain } = req.app.locals;
    const { message, avatar = 'kelion', history = [], conversationId, imageBase64, audioBase64, geo } = req.body;
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
              clientIp: realClientIp,
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
    const { message, avatar = 'kelion', history = [], conversationId, imageBase64, audioBase64, geo } = req.body;
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

    // ── SSE headers ──
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    // ── Brain think ──
    try {
      const result = await brain.think(
        message,
        avatar,
        history,
        language,
        memoryUserIdS,
        null,
        { imageBase64, audioBase64, geo, clientIp: realClientIpS },
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

module.exports = router;