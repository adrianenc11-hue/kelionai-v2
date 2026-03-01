// ═══════════════════════════════════════════════════════════════
// KelionAI — Voice Routes (TTS + STT)
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const FormData = require('form-data');
const logger = require('../logger');
const { validate, speakSchema, listenSchema } = require('../validation');
const { checkUsage, incrementUsage } = require('../payments');

const router = express.Router();

const ttsLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { error: 'Too many TTS requests. Please wait a minute.' }, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: { error: 'Too many API requests. Please wait 15 minutes.' }, standardHeaders: true, legacyHeaders: false });

// POST /api/speak — TTS via ElevenLabs
router.post('/speak', ttsLimiter, validate(speakSchema), async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const { text, avatar = 'kelion', mood = 'neutral' } = req.body;
        if (!text || !process.env.ELEVENLABS_API_KEY) return res.status(503).json({ error: 'TTS unavailable' });

        const user = await getUserFromToken(req);
        const usage = await checkUsage(user?.id, 'tts', supabaseAdmin);
        if (!usage.allowed) return res.status(429).json({ error: 'TTS limit reached. Upgrade to Pro for more.', plan: usage.plan, limit: usage.limit, upgrade: true });

        const voiceSettings = {
            happy: { stability: 0.4, similarity_boost: 0.8, style: 0.7 },
            sad: { stability: 0.7, similarity_boost: 0.9, style: 0.3 },
            laughing: { stability: 0.3, similarity_boost: 0.7, style: 0.9 },
            thinking: { stability: 0.6, similarity_boost: 0.8, style: 0.4 },
            excited: { stability: 0.3, similarity_boost: 0.8, style: 0.8 },
            concerned: { stability: 0.7, similarity_boost: 0.9, style: 0.4 },
            neutral: { stability: 0.5, similarity_boost: 0.75, style: 0.5 }
        };
        const selectedVoiceSettings = voiceSettings[mood] || voiceSettings.neutral;

        const vid = avatar === 'kira'
            ? (process.env.ELEVENLABS_VOICE_KIRA || 'EXAVITQu4vr4xnSDxMaL')
            : (process.env.ELEVENLABS_VOICE_KELION || 'VR6AewLTigWG4xSOukaG');
        const r = await fetch('https://api.elevenlabs.io/v1/text-to-speech/' + vid, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'xi-api-key': process.env.ELEVENLABS_API_KEY },
            body: JSON.stringify({ text, model_id: 'eleven_multilingual_v2', voice_settings: selectedVoiceSettings })
        });
        if (!r.ok) return res.status(503).json({ error: 'TTS fail' });
        const buf = Buffer.from(await r.arrayBuffer());
        logger.info({ component: 'Speak', bytes: buf.length, avatar, mood }, buf.length + ' bytes | ' + avatar);
        incrementUsage(user?.id, 'tts', supabaseAdmin).catch(() => { });
        res.set({ 'Content-Type': 'audio/mpeg', 'Content-Length': buf.length });
        res.send(buf);
    } catch (e) { res.status(500).json({ error: 'TTS error' }); }
});

// POST /api/listen — STT via Groq Whisper
router.post('/listen', apiLimiter, validate(listenSchema), async (req, res) => {
    try {
        if (req.body.text) return res.json({ text: req.body.text, engine: 'WebSpeech' });
        const { audio } = req.body;
        if (!audio) return res.status(400).json({ error: 'Audio is required' });
        if (process.env.GROQ_API_KEY) {
            const form = new FormData();
            form.append('file', Buffer.from(audio, 'base64'), { filename: 'a.webm', contentType: 'audio/webm' });
            form.append('model', 'whisper-large-v3');
            const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { 'Authorization': 'Bearer ' + process.env.GROQ_API_KEY }, body: form });
            const d = await r.json();
            return res.json({ text: d.text || '', engine: 'Groq' });
        }
        res.status(503).json({ error: 'Use Web Speech API' });
    } catch (e) { res.status(500).json({ error: 'STT error' }); }
});

module.exports = router;
