/**
 * KelionAI — Multi-modal Input Route (Tier 0)
 *
 * Accepts video, audio, image, PDF uploads
 * Sends to Gemini 3.1 Pro for combined analysis
 * Returns unified analysis with brain memory integration
 */
'use strict';

const express = require('express');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const logger = require('../logger');
const { MODELS } = require('../config/models');

const router = express.Router();

// Rate limiting for public-facing API routes
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// ═══ MULTER CONFIG ═══
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB max
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'video/mp4',
      'video/webm',
      'video/quicktime',
      'audio/mpeg',
      'audio/wav',
      'audio/webm',
      'audio/ogg',
      'application/pdf',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`));
    }
  },
});

// ═══ SUPPORTED MIME → GEMINI PART TYPE ═══
function getMediaType(mimetype) {
  if (mimetype.startsWith('image/')) return 'image';
  if (mimetype.startsWith('video/')) return 'video';
  if (mimetype.startsWith('audio/')) return 'audio';
  if (mimetype === 'application/pdf') return 'document';
  return 'unknown';
}

// ═══ POST /api/multimodal/analyze ═══
// Upload file + optional text prompt → Gemini 3.1 Pro analysis
router.post('/analyze', upload.single('file'), async (req, res) => {
  try {
    const geminiKey = process.env.GOOGLE_AI_KEY || process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      return res.status(503).json({ error: 'Gemini API key not configured' });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded. Send a file with key 'file'" });
    }

    const { mimetype, buffer, originalname, size } = req.file;
    const mediaType = getMediaType(mimetype);
    const prompt =
      req.body.prompt || req.body.question || 'Analyze this content in detail. Describe what you see/hear.';
    const language = req.body.language || 'ro';

    logger.info(
      {
        component: 'Multimodal',
        filename: originalname,
        mimetype,
        size: `${(size / 1024 / 1024).toFixed(1)}MB`,
        mediaType,
      },
      `📹 Multimodal analysis: ${originalname} (${mediaType})`
    );

    // Build Gemini request with inline data
    const base64Data = buffer.toString('base64');

    const parts = [
      {
        inlineData: {
          mimeType: mimetype,
          data: base64Data,
        },
      },
      {
        text: `${prompt}\n\nRespond in ${language === 'ro' ? 'Romanian' : 'English'}. Be detailed and thorough.`,
      },
    ];

    // Use Gemini 3.1 Pro for multi-modal (more capable than Flash for video/audio)
    const model = mediaType === 'video' || mediaType === 'audio' ? MODELS.GEMINI_MULTIMODAL : MODELS.GEMINI_VISION;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts }],
          generationConfig: {
            maxOutputTokens: 2000,
            temperature: 0.4,
          },
        }),
        signal: AbortSignal.timeout(60000), // 60s for video processing
      }
    );

    if (!geminiResponse.ok) {
      const errText = await geminiResponse.text();
      logger.error(
        {
          component: 'Multimodal',
          status: geminiResponse.status,
          err: errText.substring(0, 200),
        },
        'Gemini multimodal API failed'
      );
      return res.status(502).json({ error: 'AI analysis failed', details: geminiResponse.status });
    }

    const data = await geminiResponse.json();
    const analysis = data.candidates?.[0]?.content?.parts?.[0]?.text || 'No analysis available';

    // Save to brain memory
    const { brain } = req.app.locals;
    if (brain) {
      const userId = req.body.userId || req.headers['x-user-id'] || null;
      if (userId) {
        brain
          .saveMemory(
            userId,
            'multimodal',
            `Analyzed ${mediaType} "${originalname}": ${analysis.substring(0, 500)}`,
            { mediaType, filename: originalname, size },
            6
          )
          .catch((err) => {
            console.error(err);
          });
      }
    }

    logger.info({ component: 'Multimodal', mediaType, chars: analysis.length }, '✅ Analysis complete');

    res.json({
      success: true,
      mediaType,
      filename: originalname,
      size,
      model,
      analysis,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    logger.error({ component: 'Multimodal', err: e.message }, 'Multimodal analysis error');
    res.status(500).json({ error: e.message });
  }
});

// ═══ GET /api/multimodal/formats ═══
// List supported formats
router.get('/formats', (_req, res) => {
  res.json({
    supported: {
      image: ['jpeg', 'png', 'webp', 'gif'],
      video: ['mp4', 'webm', 'quicktime'],
      audio: ['mpeg', 'wav', 'webm', 'ogg'],
      document: ['pdf'],
    },
    maxSize: '25MB',
    model: `${MODELS.GEMINI_MULTIMODAL} (video/audio) / ${MODELS.GEMINI_VISION} (image/doc)`,
  });
});

// GET /api/multimodal/health — health check
router.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    model: MODELS.GEMINI_MULTIMODAL,
    maxUploadSize: '25MB',
    supportedTypes: ['image', 'video', 'audio', 'pdf'],
  });
});

/**
 * undefined
 * @returns {*}
 */
module.exports = router;
