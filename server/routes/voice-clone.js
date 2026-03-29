// ═══════════════════════════════════════════════════════════════
// KelionAI — Voice Cloning Routes
// Upload audio → ElevenLabs clone → save to user profile
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const multer = require('multer');
const logger = require('../logger');
const { API_ENDPOINTS } = require('../config/models');

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
  },
});

// POST /api/voice/clone — Upload audio sample and create cloned voice
router.post('/voice/clone', upload.single('audio'), async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);

    if (!user) return res.status(401).json({ error: 'Login required to clone voice' });
    if (!process.env.ELEVENLABS_API_KEY)
      return res.status(503).json({
        error: 'Voice cloning unavailable — ElevenLabs not configured',
      });
    if (!req.file)
      return res.status(400).json({
        error: 'Audio file required. Record at least 30 seconds of speech.',
      });

    // Validate minimum file size (~25s of audio at low quality is ~100KB)
    if (req.file.size < 50000) {
      return res.status(400).json({
        error: 'Audio too short. Please record at least 30 seconds of clear speech.',
      });
    }

    // Limit max cloned voices per user
    if (supabaseAdmin) {
      const { count } = await supabaseAdmin
        .from('cloned_voices')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id);
      if (count >= 10) {
        return res.status(400).json({ error: 'Maximum 10 cloned voices. Delete one first.' });
      }
    }

    const voiceName = req.body.name || `My Voice ${new Date().toLocaleDateString()}`;
    const description = req.body.description || ('Voice cloned via ' + (require('../config/app').APP_NAME || 'App'));

    logger.info(
      {
        component: 'VoiceClone',
        userId: user.id,
        fileSize: req.file.size,
        mimeType: req.file.mimetype,
      },
      'Starting voice clone'
    );

    // ── Send to ElevenLabs Voice Cloning API ──
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('name', voiceName);
    form.append('description', description);
    form.append('files', req.file.buffer, {
      filename:
        'voice_sample.' +
        (req.file.mimetype.includes('webm') ? 'webm' : req.file.mimetype.includes('wav') ? 'wav' : 'mp3'),
      contentType: req.file.mimetype,
    });

    const cloneResp = await fetch(API_ENDPOINTS.ELEVENLABS + '/voices/add', {
      method: 'POST',
      headers: {
        'xi-api-key': process.env.ELEVENLABS_API_KEY,
        ...form.getHeaders(),
      },
      body: form,
    });

    if (!cloneResp.ok) {
      const errData = await cloneResp.json().catch(() => ({}));
      logger.error({ component: 'VoiceClone', status: cloneResp.status, error: errData }, 'ElevenLabs clone failed');
      return res.status(500).json({
        error: 'Voice cloning failed: ' + (errData.detail?.message || errData.detail || 'Unknown error'),
      });
    }

    const cloneData = await cloneResp.json();
    const voiceId = cloneData.voice_id;

    if (!voiceId) {
      return res.status(500).json({ error: 'ElevenLabs did not return a voice ID' });
    }

    logger.info({ component: 'VoiceClone', userId: user.id, voiceId }, 'Voice cloned successfully');

    // ── Save to cloned_voices table ──
    let savedId = null;
    if (supabaseAdmin) {
      // Deactivate all other voices for this user
      await supabaseAdmin.from('cloned_voices').update({ is_active: false }).eq('user_id', user.id);

      const { data: inserted } = await supabaseAdmin
        .from('cloned_voices')
        .insert({
          user_id: user.id,
          elevenlabs_voice_id: voiceId,
          name: voiceName,
          description,
          is_active: true,
          sample_duration_sec: Math.round(req.file.size / 8000), // rough estimate
        })
        .select('id')
        .single();
      savedId = inserted?.id;
    }

    res.json({
      success: true,
      id: savedId,
      voiceId,
      name: voiceName,
      isActive: true,
      message: 'Voice cloned successfully! It is now your active voice.',
    });

    // ═══ BRAIN INTEGRATION — save voice clone fact ═══
    const brain = req.app.locals.brain;
    if (brain && user?.id) {
      brain
        .saveMemory(user.id, 'voice', 'User a clonat vocea: ' + voiceName + ' (ID: ' + voiceId + ')', {
          source: 'voice-clone',
        })
        .catch(() => {});
    }
  } catch (e) {
    logger.error({ component: 'VoiceClone', err: e.message }, 'Clone error');
    res.status(500).json({ error: 'Voice cloning failed' });
  }
});

// DELETE /api/voice/clone/:id — Remove a specific cloned voice
router.delete('/voice/clone/:id', async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);

    if (!user) return res.status(401).json({ error: 'Login required' });
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

    const voiceRow = await supabaseAdmin
      .from('cloned_voices')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', user.id)
      .single();

    if (!voiceRow.data) {
      return res.status(404).json({ error: 'Voice not found' });
    }

    const elVoiceId = voiceRow.data.elevenlabs_voice_id;

    // Delete from ElevenLabs
    if (process.env.ELEVENLABS_API_KEY && elVoiceId) {
      try {
        await fetch(`${API_ENDPOINTS.ELEVENLABS}/voices/${encodeURIComponent(elVoiceId)}`, {
          method: 'DELETE',
          headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY },
        });
      } catch (e) {
        logger.warn({ component: 'VoiceClone', err: e.message }, 'ElevenLabs delete failed');
      }
    }

    // Remove from DB
    await supabaseAdmin.from('cloned_voices').delete().eq('id', req.params.id).eq('user_id', user.id);

    logger.info({ component: 'VoiceClone', userId: user.id, voiceId: elVoiceId }, 'Cloned voice deleted');
    res.json({ success: true });
  } catch (e) {
    logger.error({ component: 'VoiceClone', err: e.message }, 'Delete error');
    res.status(500).json({ error: 'Failed to remove voice' });
  }
});

// PATCH /api/voice/clone/:id/activate — Set a cloned voice as active
router.patch('/voice/clone/:id/activate', async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);

    if (!user) return res.status(401).json({ error: 'Login required' });
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

    // Verify the voice belongs to user
    const { data: voice } = await supabaseAdmin
      .from('cloned_voices')
      .select('id')
      .eq('id', req.params.id)
      .eq('user_id', user.id)
      .single();

    if (!voice) return res.status(404).json({ error: 'Voice not found' });

    // Deactivate all, then activate the chosen one
    await supabaseAdmin.from('cloned_voices').update({ is_active: false }).eq('user_id', user.id);

    await supabaseAdmin
      .from('cloned_voices')
      .update({ is_active: true })
      .eq('id', req.params.id)
      .eq('user_id', user.id);

    res.json({ success: true });
  } catch (e) {
    logger.error({ component: 'VoiceClone', err: e.message }, 'Activate error');
    res.status(500).json({ error: 'Failed to activate voice' });
  }
});

// PATCH /api/voice/clone/:id/deactivate — Use default voice instead
router.patch('/voice/clone/:id/deactivate', async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);

    if (!user) return res.status(401).json({ error: 'Login required' });
    if (!supabaseAdmin) return res.status(503).json({ error: 'Database unavailable' });

    await supabaseAdmin.from('cloned_voices').update({ is_active: false }).eq('user_id', user.id);

    res.json({ success: true });
  } catch (e) {
    logger.error({ component: 'VoiceClone', err: e.message }, 'Deactivate error');
    res.status(500).json({ error: 'Failed to deactivate voice' });
  }
});

// GET /api/voice/clone — List all cloned voices for user
router.get('/voice/clone', async (req, res) => {
  try {
    const { getUserFromToken, supabaseAdmin } = req.app.locals;
    const user = await getUserFromToken(req);

    if (!user || !supabaseAdmin) return res.json({ voices: [] });

    const { data } = await supabaseAdmin
      .from('cloned_voices')
      .select('id, elevenlabs_voice_id, name, description, is_active, sample_duration_sec, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    res.json({
      voices: (data || []).map((v) => ({
        id: v.id,
        voiceId: v.elevenlabs_voice_id,
        name: v.name,
        description: v.description,
        isActive: v.is_active,
        durationSec: v.sample_duration_sec,
        createdAt: v.created_at,
      })),
    });
  } catch (e) {
    logger.error({ component: 'VoiceClone', err: e.message }, 'List error');
    res.status(500).json({ error: 'Failed to fetch voices' });
  }
});

module.exports = router;
