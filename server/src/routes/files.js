'use strict';

const { Router } = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  createUserFile,
  listUserFiles,
  getUserFileById,
  deleteUserFile,
} = require('../db');

const FILES_DIR = path.resolve(__dirname, '../../data/files');
if (!fs.existsSync(FILES_DIR)) {
  fs.mkdirSync(FILES_DIR, { recursive: true });
}

// 50 GB cap — practical disk limit. Use S3/R2 for truly unlimited.
const MAX_FILE_BYTES = 50 * 1024 * 1024 * 1024;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, FILES_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}-${file.originalname}`;
    cb(null, unique);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES },
});

const router = Router();

// POST /api/files/upload — multipart upload, any format
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });

    const rec = await createUserFile(userId, {
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      storageType: 'local',
      storagePath: req.file.filename,
    });

    res.json({ ok: true, file: rec });
  } catch (err) {
    console.error('[files/upload]', err);
    res.status(500).json({ error: 'Upload failed' });
  }
});

// GET /api/files — list user's files
router.get('/', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const items = await listUserFiles(userId, 200);
    res.json({ items });
  } catch (err) {
    console.error('[files/list]', err);
    res.status(500).json({ error: 'List failed' });
  }
});

// GET /api/files/:id/download — streaming download
router.get('/:id/download', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });

    const rec = await getUserFileById(userId, id);
    if (!rec) return res.status(404).json({ error: 'Not found' });

    const filePath = path.join(FILES_DIR, rec.storage_path);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File missing on disk' });

    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(rec.original_name)}"`);
    if (rec.mime_type) res.setHeader('Content-Type', rec.mime_type);
    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (err) {
    console.error('[files/download]', err);
    res.status(500).json({ error: 'Download failed' });
  }
});

// DELETE /api/files/:id
router.delete('/:id', async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'Bad id' });

    const rec = await getUserFileById(userId, id);
    if (!rec) return res.status(404).json({ error: 'Not found' });

    const filePath = path.join(FILES_DIR, rec.storage_path);
    if (fs.existsSync(filePath)) {
      try { fs.unlinkSync(filePath); } catch (_) { /* ignore */ }
    }

    await deleteUserFile(userId, id);
    res.json({ ok: true });
  } catch (err) {
    console.error('[files/delete]', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;
