'use strict';

const { Router } = require('express');
const { getOpenAI } = require('../utils/openai');

const router = Router();

router.post('/', async (req, res) => {
  const ALLOWED_MODELS = ['tts-1', 'tts-1-hd'];
  const ALLOWED_VOICES = ['alloy', 'echo', 'fable', 'onyx', 'nova', 'shimmer'];

  const { text, model: rawModel = 'tts-1', voice: rawVoice = 'alloy' } = req.body;

  if (!text) {
    return res.status(400).json({ error: 'Text is required' });
  }
  if (typeof text !== 'string' || text.length > 2000) {
    return res.status(400).json({ error: 'Text must be a string under 2000 characters' });
  }

  const model = ALLOWED_MODELS.includes(rawModel) ? rawModel : 'tts-1';
  const voice = ALLOWED_VOICES.includes(rawVoice) ? rawVoice : 'alloy';

  const openai = getOpenAI();
  if (!openai) {
    return res.status(503).json({
      error: 'AI service not configured',
      message: 'Set OPENAI_API_KEY to enable voice synthesis.',
    });
  }

  try {
    const mp3 = await openai.audio.speech.create({
      model: model,
      voice: voice,
      input: text,
    });

    const buffer = Buffer.from(await mp3.arrayBuffer());

    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': buffer.length,
    });

    res.send(buffer);
  } catch (err) {
    console.error('[tts] OpenAI error:', err.message);
    res.status(500).json({ error: 'Voice synthesis failed' });
  }
});

module.exports = router;
