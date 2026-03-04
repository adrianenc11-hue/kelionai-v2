// ═══════════════════════════════════════════════════════════════
// KelionAI — Voice Cloning Routes
// Upload audio → ElevenLabs clone → save to user profile
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const multer = require('multer');
const logger = require('../logger');

const router = express.Router();

// Multer: accept audio files up to 25MB, store in memory
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowed = ['audio/wav', 'audio/mpeg', 'audio/mp3', 'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/x-m4a'];
        if (allowed.includes(file.mimetype) || file.mimetype.startsWith('audio/')) {
            cb(null, true);
        } else {
            cb(new Error('Only audio files are accepted'), false);
        }
    }
});

// POST /api/voice/clone — Upload audio sample and create cloned voice
router.post('/voice/clone', upload.single('audio'), async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);

        if (!user) return res.status(401).json({ error: 'Login required to clone voice' });
        if (!process.env.ELEVENLABS_API_KEY) return res.status(503).json({ error: 'Voice cloning unavailable — ElevenLabs not configured' });
        if (!req.file) return res.status(400).json({ error: 'Audio file required. Record at least 30 seconds of speech.' });

        // Validate minimum file size (~25s of audio at low quality is ~100KB)
        if (req.file.size < 50000) {
            return res.status(400).json({ error: 'Audio too short. Please record at least 30 seconds of clear speech.' });
        }

        const voiceName = req.body.name || `KelionAI-${user.id.substring(0, 8)}`;
        const description = req.body.description || 'Voice cloned via KelionAI';

        logger.info({ component: 'VoiceClone', userId: user.id, fileSize: req.file.size, mimeType: req.file.mimetype }, 'Starting voice clone');

        // ── Send to ElevenLabs Voice Cloning API ──
        const FormData = (await import('form-data')).default;
        const form = new FormData();
        form.append('name', voiceName);
        form.append('description', description);
        form.append('files', req.file.buffer, {
            filename: 'voice_sample.' + (req.file.mimetype.includes('webm') ? 'webm' : req.file.mimetype.includes('wav') ? 'wav' : 'mp3'),
            contentType: req.file.mimetype
        });

        const cloneResp = await fetch('https://api.elevenlabs.io/v1/voices/add', {
            method: 'POST',
            headers: {
                'xi-api-key': process.env.ELEVENLABS_API_KEY,
                ...form.getHeaders()
            },
            body: form
        });

        if (!cloneResp.ok) {
            const errData = await cloneResp.json().catch(() => ({}));
            logger.error({ component: 'VoiceClone', status: cloneResp.status, error: errData }, 'ElevenLabs clone failed');
            return res.status(500).json({ error: 'Voice cloning failed: ' + (errData.detail?.message || errData.detail || 'Unknown error') });
        }

        const cloneData = await cloneResp.json();
        const voiceId = cloneData.voice_id;

        if (!voiceId) {
            return res.status(500).json({ error: 'ElevenLabs did not return a voice ID' });
        }

        logger.info({ component: 'VoiceClone', userId: user.id, voiceId }, 'Voice cloned successfully');

        // ── Save cloned voice ID to user profile ──
        if (supabaseAdmin) {
            await supabaseAdmin.from('user_preferences').upsert(
                { user_id: user.id, key: 'cloned_voice_id', value: { voice_id: voiceId, name: voiceName, created_at: new Date().toISOString() } },
                { onConflict: 'user_id,key' }
            );
        }

        res.json({ success: true, voiceId, name: voiceName, message: 'Voice cloned successfully! All TTS responses will now use your voice.' });

    } catch (e) {
        logger.error({ component: 'VoiceClone', err: e.message }, 'Clone error');
        res.status(500).json({ error: 'Voice cloning error: ' + e.message });
    }
});

// DELETE /api/voice/clone — Remove cloned voice
router.delete('/voice/clone', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);

        if (!user) return res.status(401).json({ error: 'Login required' });

        // Get the stored voice ID
        let voiceId = null;
        if (supabaseAdmin) {
            const { data } = await supabaseAdmin.from('user_preferences').select('value').eq('user_id', user.id).eq('key', 'cloned_voice_id').single();
            voiceId = data?.value?.voice_id;
        }

        if (!voiceId) {
            return res.status(404).json({ error: 'No cloned voice found' });
        }

        // Delete from ElevenLabs
        if (process.env.ELEVENLABS_API_KEY) {
            try {
                await fetch(`https://api.elevenlabs.io/v1/voices/${voiceId}`, {
                    method: 'DELETE',
                    headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY }
                });
            } catch (e) { logger.warn({ component: 'VoiceClone', err: e.message }, 'ElevenLabs delete failed'); }
        }

        // Remove from user profile
        if (supabaseAdmin) {
            await supabaseAdmin.from('user_preferences').delete().eq('user_id', user.id).eq('key', 'cloned_voice_id');
        }

        logger.info({ component: 'VoiceClone', userId: user.id, voiceId }, 'Cloned voice deleted');
        res.json({ success: true, message: 'Cloned voice removed. Default voices restored.' });

    } catch (e) {
        logger.error({ component: 'VoiceClone', err: e.message }, 'Delete error');
        res.status(500).json({ error: 'Error removing voice: ' + e.message });
    }
});

// GET /api/voice/clone — Check if user has a cloned voice
router.get('/voice/clone', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);

        if (!user || !supabaseAdmin) return res.json({ hasClone: false });

        const { data } = await supabaseAdmin.from('user_preferences').select('value').eq('user_id', user.id).eq('key', 'cloned_voice_id').single();

        if (data?.value?.voice_id) {
            res.json({ hasClone: true, voiceId: data.value.voice_id, name: data.value.name, createdAt: data.value.created_at });
        } else {
            res.json({ hasClone: false });
        }
    } catch {
        res.json({ hasClone: false });
    }
});

module.exports = router;
