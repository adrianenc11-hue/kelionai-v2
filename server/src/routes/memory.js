'use strict';

// Stage 3 — M14/M16/M17: Long-term memory endpoints.
//
// All endpoints require a signed-in user (requireAuth is applied in index.js).
// Memory retrieval happens server-side inside the realtime token mint
// (see routes/realtime.js) so the frontend does not need to fetch facts
// separately before each session.

const { Router } = require('express');
const {
  addMemoryItems,
  listMemoryItems,
  deleteMemoryItem,
  clearMemoryForUser,
} = require('../db');
const { extractFacts } = require('../services/factExtractor');

const router = Router();

// POST /api/memory/extract-and-store
// Body: { turns: [{role, text}, ...] }
// Runs the LLM fact extractor over the turns and persists the results.
// Returns the list of newly-stored facts (already-known facts are de-duped).
router.post('/extract-and-store', async (req, res) => {
  try {
    const turns = Array.isArray(req.body?.turns) ? req.body.turns : [];
    if (turns.length === 0) return res.json({ added: [] });

    const facts = await extractFacts(turns);
    const added = await addMemoryItems(req.user.id, facts);
    res.json({ added, candidates: facts.length });
  } catch (err) {
    console.error('[memory/extract-and-store]', err);
    res.status(500).json({ error: 'Extraction failed' });
  }
});

// GET /api/memory — list the user's stored facts (most recent first)
router.get('/', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(500, parseInt(req.query.limit || '200', 10)));
    const items = await listMemoryItems(req.user.id, limit);
    res.json({ items });
  } catch (err) {
    console.error('[memory/list]', err);
    res.status(500).json({ error: 'Failed to list memory' });
  }
});

// DELETE /api/memory/:id — forget one fact
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const ok = await deleteMemoryItem(req.user.id, id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[memory/delete]', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

// DELETE /api/memory — forget everything
router.delete('/', async (req, res) => {
  try {
    const deleted = await clearMemoryForUser(req.user.id);
    res.json({ deleted });
  } catch (err) {
    console.error('[memory/clear]', err);
    res.status(500).json({ error: 'Clear failed' });
  }
});

module.exports = router;
