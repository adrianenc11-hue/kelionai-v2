import { Router } from 'express';
import { kelionBrain, kiraBrain } from '../services/brain.js';
import { synthesizeSpeech } from '../services/tts.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

router.post('/chat', requireAuth, async (req, res) => {
  try {
    const { message, avatar } = req.body;
    
    const brain = avatar === 'kira' ? kiraBrain : kelionBrain;
    const response = await brain.think(req.user.id, message, { ip: req.ip });
    
    let audio = null;
    try {
      audio = await synthesizeSpeech(response.text, avatar, response.language);
    } catch (e) {
      console.log('TTS error:', e.message);
    }

    res.json({
      text: response.text,
      audio: audio?.toString('base64'),
      language: response.language
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

export default router;
