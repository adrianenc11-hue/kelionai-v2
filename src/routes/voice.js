'use strict';

const express = require('express');
const { validateTTSRequest, estimateSpeechDuration, SUPPORTED_VOICES, SUPPORTED_LANGUAGES } = require('../utils/textToSpeech');
const { requireFields, limitPayloadSize } = require('../middleware/validation');

const router = express.Router();

const MAX_PAYLOAD_BYTES = 20 * 1024;

router.get('/voices', (req, res) => {
  res.json({ voices: SUPPORTED_VOICES });
});

router.get('/languages', (req, res) => {
  res.json({ languages: SUPPORTED_LANGUAGES });
});

router.post('/synthesise', limitPayloadSize(MAX_PAYLOAD_BYTES), requireFields(['text']), (req, res) => {
  const result = validateTTSRequest(req.body);

  if (!result.valid) {
    return res.status(422).json({ error: 'Validation failed', details: result.errors });
  }

  const { sanitised } = result;
  const durationSeconds = estimateSpeechDuration(sanitised.text, sanitised.speed);

  res.status(202).json({
    message: 'Speech synthesis queued',
    request: sanitised,
    estimatedDurationSeconds: Math.round(durationSeconds * 100) / 100,
  });
});

router.post('/estimate', requireFields(['text']), (req, res) => {
  const { text, speed } = req.body;

  if (typeof text !== 'string' || text.trim().length === 0) {
    return res.status(400).json({ error: 'text must be a non-empty string' });
  }

  const parsedSpeed = speed !== undefined ? Number(speed) : 1.0;

  if (isNaN(parsedSpeed) || parsedSpeed <= 0) {
    return res.status(400).json({ error: 'speed must be a positive number' });
  }

  const duration = estimateSpeechDuration(text, parsedSpeed);

  res.json({
    wordCount: text.trim().split(/\s+/).filter(Boolean).length,
    estimatedDurationSeconds: Math.round(duration * 100) / 100,
  });
});

module.exports = router;
