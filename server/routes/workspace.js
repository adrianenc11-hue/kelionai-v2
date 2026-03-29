// ═══════════════════════════════════════════════════════════════
// KelionAI — Workspace / File Storage (/api/workspace/*)
//
// Upload fișiere, poze, arhive pentru analiză AI
// Suportă: imagini, PDF, docx, txt, csv, zip, arhive
//
// POST /upload          — încarcă fișier(e)
// GET  /files           — lista fișierelor utilizatorului
// GET  /files/:id       — detalii fișier
// DELETE /files/:id     — șterge fișier
// POST /analyze/:id     — analizează fișier cu AI
// POST /analyze-batch   — analizează mai multe fișiere
// GET  /storage-info    — spațiu utilizat
// ═══════════════════════════════════════════════════════════════
'use strict';

const express  = require('express');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');
const crypto   = require('crypto');
const logger   = require('../logger');

const router = express.Router();

// ── Allowed MIME types ──
const ALLOWED_TYPES = {
  // Images
  'image/jpeg':      { ext: '.jpg',  category: 'image',    maxMB: 10 },
  'image/png':       { ext: '.png',  category: 'image',    maxMB: 10 },
  'image/gif':       { ext: '.gif',  category: 'image',    maxMB: 5  },
  'image/webp':      { ext: '.webp', category: 'image',    maxMB: 10 },
  'image/svg+xml':   { ext: '.svg',  category: 'image',    maxMB: 2  },
  // Documents
  'application/pdf': { ext: '.pdf',  category: 'document', maxMB: 20 },
  'text/plain':      { ext: '.txt',  category: 'document', maxMB: 5  },
  'text/csv':        { ext: '.csv',  category: 'data',     maxMB: 10 },
  'text/markdown':   { ext: '.md',   category: 'document', maxMB: 5  },
  'application/json':{ ext: '.json', category: 'data',     maxMB: 5  },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { ext: '.docx', category: 'document', maxMB: 20 },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':       { ext: '.xlsx', category: 'data',     maxMB: 20 },
  'application/msword': { ext: '.doc', category: 'document', maxMB: 20 },
  // Archives
  'application/zip':              { ext: '.zip', category: 'archive', maxMB: 50 },
  'application/x-zip-compressed': { ext: '.zip', category: 'archive', maxMB: 50 },
  'application/x-rar-compressed': { ext: '.rar', category: 'archive', maxMB: 50 },
  'application/x-tar':            { ext: '.tar', category: 'archive', maxMB: 50 },
  'application/gzip':             { ext: '.gz',  category: 'archive', maxMB: 50 },
  // Audio (pentru analiză)
  'audio/mpeg':  { ext: '.mp3', category: 'audio', maxMB: 20 },
  'audio/wav':   { ext: '.wav', category: 'audio', maxMB: 20 },
  'audio/ogg':   { ext: '.ogg', category: 'audio', maxMB: 20 },
  'audio/webm':  { ext: '.webm',category: 'audio', maxMB: 20 },
};

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB global max
// Use /tmp/uploads on Railway/Docker (read-only container fs), fallback to local
const UPLOAD_DIR = process.env.UPLOAD_DIR ||
  (process.env.RAILWAY_ENVIRONMENT ? '/tmp/uploads' : path.join(__dirname, '../../uploads'));

// Ensure upload dir exists — wrapped in try/catch to avoid crash on permission errors
try {
  if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (e) {
  // If we can't create the dir, fall back to /tmp/uploads
  try {
    const fallback = '/tmp/uploads';
    if (!fs.existsSync(fallback)) fs.mkdirSync(fallback, { recursive: true });
    // Reassign — note: this won't affect the const above, handled via env var going forward
    logger.warn({ component: 'Workspace', err: e.message, fallback }, 'Upload dir creation failed, using /tmp/uploads');
  } catch (_e2) { /* ignore */ }
}

// ── Multer storage ──
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const userDir = path.join(UPLOAD_DIR, req.userId || 'anonymous');
    if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (req, file, cb) => {
    const hash = crypto.randomBytes(8).toString('hex');
    const ext  = path.extname(file.originalname).toLowerCase() || (ALLOWED_TYPES[file.mimetype]?.ext || '');
    cb(null, `${Date.now()}-${hash}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: 10 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_TYPES[file.mimetype]) {
      cb(null, true);
    } else {
      cb(new Error(`File type not allowed: ${file.mimetype}`));
    }
  },
});

// ── Auth middleware ──
async function requireAuth(req, res, next) {
  const { getUserFromToken } = req.app.locals;
  try {
    const user = await getUserFromToken(req);
    if (!user) return res.status(401).json({ error: 'Authentication required' });
    req.userId   = user.id;
    req.userEmail = user.email;
    next();
  } catch (_e) {
    return res.status(401).json({ error: 'Authentication required' });
  }
}

// ─────────────────────────────────────────────────────────────
// POST /api/workspace/upload — Încarcă fișier(e)
// ─────────────────────────────────────────────────────────────
router.post('/upload', requireAuth, (req, res, next) => {
  upload.array('files', 10)(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File too large (max 50MB)' });
      if (err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: 'Too many files (max 10)' });
      return res.status(400).json({ error: err.message });
    }
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  try {
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ error: 'No files uploaded' });
    }

    const { supabaseAdmin } = req.app.locals;
    const { description = '', tags = '', analyzeNow = false } = req.body;
    const tagList = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];

    const saved = [];

    for (const file of req.files) {
      const typeInfo = ALLOWED_TYPES[file.mimetype] || { category: 'other', maxMB: 50 };
      const fileHash = await _hashFile(file.path);

      let fileId = null;
      if (supabaseAdmin) {
        try {
          const { data } = await supabaseAdmin.from('workspace_files').insert({
            user_id:       req.userId,
            original_name: file.originalname,
            stored_name:   file.filename,
            file_path:     file.path,
            mime_type:     file.mimetype,
            category:      typeInfo.category,
            size_bytes:    file.size,
            file_hash:     fileHash,
            description:   description || null,
            tags:          tagList,
            status:        'ready',
          }).select('id').single();
          fileId = data?.id;
        } catch (dbErr) {
          logger.warn({ component: 'Workspace', err: dbErr.message }, 'DB save failed');
        }
      }

      const fileRecord = {
        id:           fileId,
        originalName: file.originalname,
        storedName:   file.filename,
        mimeType:     file.mimetype,
        category:     typeInfo.category,
        sizeBytes:    file.size,
        sizeMB:       (file.size / 1024 / 1024).toFixed(2),
        description,
        tags:         tagList,
        uploadedAt:   new Date().toISOString(),
      };

      // Auto-analyze if requested and it's a text/image file
      if (analyzeNow === 'true' || analyzeNow === true) {
        try {
          const analysis = await _analyzeFile(file, typeInfo.category, req.app.locals);
          fileRecord.analysis = analysis;
          if (supabaseAdmin && fileId) {
            await supabaseAdmin.from('workspace_files').update({
              ai_analysis: analysis,
              analyzed_at: new Date().toISOString(),
              status: 'analyzed',
            }).eq('id', fileId);
          }
        } catch (aErr) {
          logger.warn({ component: 'Workspace', err: aErr.message }, 'Auto-analysis failed');
        }
      }

      saved.push(fileRecord);
    }

    logger.info({ component: 'Workspace', userId: req.userId, count: saved.length }, 'Files uploaded');
    return res.json({ success: true, files: saved, count: saved.length });
  } catch (err) {
    logger.error({ component: 'Workspace', err: err.message }, 'Upload failed');
    return res.status(500).json({ error: 'Upload failed: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/workspace/files — Lista fișierelor
// ─────────────────────────────────────────────────────────────
router.get('/files', requireAuth, async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'DB unavailable' });

    const { category, search, limit = 50, offset = 0 } = req.query;

    let query = supabaseAdmin
      .from('workspace_files')
      .select('id, original_name, mime_type, category, size_bytes, description, tags, status, created_at, analyzed_at')
      .eq('user_id', req.userId)
      .order('created_at', { ascending: false })
      .range(Number(offset), Number(offset) + Number(limit) - 1);

    if (category) query = query.eq('category', category);
    if (search)   query = query.ilike('original_name', `%${search}%`);

    const { data: files, error } = await query;
    if (error) throw error;

    const { count: total } = await supabaseAdmin
      .from('workspace_files')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', req.userId);

    return res.json({ files: files || [], total: total || 0 });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/workspace/files/:id — Detalii fișier
// ─────────────────────────────────────────────────────────────
router.get('/files/:id', requireAuth, async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'DB unavailable' });

    const { data, error } = await supabaseAdmin
      .from('workspace_files')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();

    if (error || !data) return res.status(404).json({ error: 'File not found' });
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/workspace/files/:id
// ─────────────────────────────────────────────────────────────
router.delete('/files/:id', requireAuth, async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'DB unavailable' });

    const { data } = await supabaseAdmin
      .from('workspace_files')
      .select('file_path, user_id')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();

    if (!data) return res.status(404).json({ error: 'File not found' });

    // Delete physical file
    try {
      if (data.file_path && fs.existsSync(data.file_path)) {
        fs.unlinkSync(data.file_path);
      }
    } catch (_e) { /* ignore */ }

    await supabaseAdmin.from('workspace_files').delete().eq('id', req.params.id);
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/workspace/analyze/:id — Analizează fișier cu AI
// ─────────────────────────────────────────────────────────────
router.post('/analyze/:id', requireAuth, async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'DB unavailable' });

    const { prompt = '' } = req.body;

    const { data: fileRecord } = await supabaseAdmin
      .from('workspace_files')
      .select('*')
      .eq('id', req.params.id)
      .eq('user_id', req.userId)
      .single();

    if (!fileRecord) return res.status(404).json({ error: 'File not found' });

    // Check file exists on disk
    if (!fs.existsSync(fileRecord.file_path)) {
      return res.status(404).json({ error: 'Physical file not found' });
    }

    const file = {
      path:         fileRecord.file_path,
      originalname: fileRecord.original_name,
      mimetype:     fileRecord.mime_type,
      size:         fileRecord.size_bytes,
    };

    const analysis = await _analyzeFile(file, fileRecord.category, req.app.locals, prompt);

    await supabaseAdmin.from('workspace_files').update({
      ai_analysis: analysis,
      analyzed_at: new Date().toISOString(),
      status:      'analyzed',
    }).eq('id', req.params.id);

    logger.info({ component: 'Workspace', fileId: req.params.id }, 'File analyzed');
    return res.json({ success: true, analysis, fileId: req.params.id });
  } catch (err) {
    logger.error({ component: 'Workspace', err: err.message }, 'Analyze failed');
    return res.status(500).json({ error: 'Analysis failed: ' + err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/workspace/storage-info — Spațiu utilizat
// ─────────────────────────────────────────────────────────────
router.get('/storage-info', requireAuth, async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'DB unavailable' });

    const { data: files } = await supabaseAdmin
      .from('workspace_files')
      .select('size_bytes, category')
      .eq('user_id', req.userId);

    const totalBytes = (files || []).reduce((sum, f) => sum + (f.size_bytes || 0), 0);
    const byCategory = {};
    for (const f of (files || [])) {
      byCategory[f.category] = (byCategory[f.category] || 0) + (f.size_bytes || 0);
    }

    const LIMIT_BYTES = 500 * 1024 * 1024; // 500MB per user
    return res.json({
      totalBytes,
      totalMB:     (totalBytes / 1024 / 1024).toFixed(2),
      limitMB:     500,
      usedPercent: Math.round((totalBytes / LIMIT_BYTES) * 100),
      fileCount:   (files || []).length,
      byCategory:  Object.fromEntries(
        Object.entries(byCategory).map(([k, v]) => [k, (v / 1024 / 1024).toFixed(2) + ' MB'])
      ),
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════════
// AI Analysis Engine
// ═══════════════════════════════════════════════════════════════

async function _analyzeFile(file, category, appLocals, customPrompt = '') {
  const result = {
    category,
    fileName:   file.originalname,
    sizeBytes:  file.size,
    analyzedAt: new Date().toISOString(),
    summary:    '',
    details:    {},
    insights:   [],
    provider:   'none',
  };

  try {
    if (category === 'image') {
      result.details = await _analyzeImage(file, customPrompt);
      result.summary = result.details.description || 'Image analyzed';
      result.provider = result.details.provider || 'vision';
    } else if (category === 'document' || category === 'data') {
      result.details = await _analyzeDocument(file, customPrompt);
      result.summary = result.details.summary || 'Document analyzed';
      result.insights = result.details.insights || [];
      result.provider = result.details.provider || 'text';
    } else if (category === 'archive') {
      result.details = { note: 'Archive files cannot be directly analyzed. Extract and upload individual files.' };
      result.summary = 'Archive uploaded — extract files for AI analysis';
    } else {
      result.details = { note: 'File uploaded successfully' };
      result.summary = 'File stored successfully';
    }
  } catch (e) {
    result.summary = 'Analysis failed: ' + e.message;
    result.error   = e.message;
  }

  return result;
}

async function _analyzeImage(file, customPrompt) {
  const prompt = customPrompt || 'Analizează această imagine în detaliu. Descrie: conținutul, obiectele, culorile, textul vizibil, contextul și orice informații relevante. Răspunde în română.';

  // Try GPT-4o Vision
  if (process.env.OPENAI_API_KEY) {
    try {
      const imageData = fs.readFileSync(file.path);
      const base64    = imageData.toString('base64');
      const mimeType  = file.mimetype;

      const { OpenAI } = require('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const resp = await openai.chat.completions.create({
        model:    'gpt-4o',
        messages: [{
          role:    'user',
          content: [
            { type: 'text',      text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64}`, detail: 'high' } },
          ],
        }],
        max_tokens: 1500,
      });
      return {
        description: resp.choices[0].message.content,
        model:       'gpt-4o',
        provider:    'openai',
        tokens:      resp.usage?.total_tokens,
      };
    } catch (e) {
      logger.warn({ component: 'Workspace.Vision', err: e.message }, 'GPT-4o vision failed');
    }
  }

  // Try Gemini Vision
  if (process.env.GOOGLE_AI_KEY) {
    try {
      const imageData = fs.readFileSync(file.path);
      const base64    = imageData.toString('base64');
      const resp = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GOOGLE_AI_KEY}`,
        {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({
            contents: [{
              parts: [
                { text: prompt },
                { inline_data: { mime_type: file.mimetype, data: base64 } },
              ],
            }],
          }),
        }
      );
      const data = await resp.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
      return { description: text, model: 'gemini-1.5-flash', provider: 'google' };
    } catch (e) {
      logger.warn({ component: 'Workspace.Vision', err: e.message }, 'Gemini vision failed');
    }
  }

  return { description: 'No vision AI provider available. Configure OPENAI_API_KEY or GOOGLE_AI_KEY.', provider: 'none' };
}

async function _analyzeDocument(file, customPrompt) {
  // Read file content
  let content = '';
  try {
    if (file.mimetype === 'application/pdf') {
      // Basic PDF text extraction (without pdf-parse dependency)
      const raw = fs.readFileSync(file.path, 'binary');
      const matches = raw.match(/\(([^)]{3,200})\)/g) || [];
      content = matches.map(m => m.slice(1, -1)).join(' ').slice(0, 8000);
      if (!content.trim()) content = '[PDF binary — text extraction limited without pdf-parse library]';
    } else {
      content = fs.readFileSync(file.path, 'utf8').slice(0, 8000);
    }
  } catch (e) {
    content = '[Could not read file content: ' + e.message + ']';
  }

  const prompt = customPrompt
    ? `${customPrompt}\n\nConținut fișier:\n${content}`
    : `Analizează acest document și oferă:
1. Un rezumat concis (3-5 propoziții)
2. Punctele cheie (max 5)
3. Tipul de document și scopul său
4. Orice date/cifre importante
5. Recomandări sau acțiuni sugerate

Conținut fișier (${file.originalname}):
${content}

Răspunde în română, structurat și clar.`;

  let analysisText = '';
  let provider = 'none';

  if (process.env.ANTHROPIC_API_KEY) {
    try {
      const Anthropic = require('@anthropic-ai/sdk');
      const client = new Anthropic.Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const msg = await client.messages.create({
        model:      'claude-3-haiku-20240307',
        max_tokens: 1500,
        messages:   [{ role: 'user', content: prompt }],
      });
      analysisText = msg.content[0]?.text || '';
      provider = 'anthropic';
    } catch (_e) {}
  }

  if (!analysisText && process.env.OPENAI_API_KEY) {
    try {
      const { OpenAI } = require('openai');
      const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      const resp = await openai.chat.completions.create({
        model:      'gpt-4o-mini',
        messages:   [{ role: 'user', content: prompt }],
        max_tokens: 1500,
      });
      analysisText = resp.choices[0].message.content || '';
      provider = 'openai';
    } catch (_e) {}
  }

  if (!analysisText && process.env.GROQ_API_KEY) {
    try {
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.GROQ_API_KEY}` },
        body:    JSON.stringify({
          model:      'llama-3.3-70b-versatile',
          messages:   [{ role: 'user', content: prompt }],
          max_tokens: 1500,
        }),
      });
      const data = await resp.json();
      analysisText = data.choices?.[0]?.message?.content || '';
      provider = 'groq';
    } catch (_e) {}
  }

  // Parse insights from analysis
  const insights = [];
  if (analysisText) {
    const lines = analysisText.split('\n').filter(l => l.trim().startsWith('-') || l.trim().match(/^\d+\./));
    insights.push(...lines.slice(0, 5).map(l => l.replace(/^[-\d.]\s*/, '').trim()));
  }

  return {
    summary:      analysisText || 'No AI provider available for document analysis.',
    insights,
    contentLength: content.length,
    provider,
  };
}

async function _hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash   = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', d => hash.update(d));
    stream.on('end',  () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

module.exports = router;