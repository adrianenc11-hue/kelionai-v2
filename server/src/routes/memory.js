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
  listAllMemoryItems,
  deleteMemoryItem,
  clearMemoryForUser,
  archiveMemoryItem,
  setMemoryItemTier,
} = require('../db');
const { extractFacts } = require('../services/factExtractor');
const { planConsolidation } = require('../services/memoryConsolidator');

const router = Router();

// POST /api/memory/extract-and-store
// Body: { turns: [{role, text}, ...] }
// Runs the LLM fact extractor over the turns and persists the results.
// Returns the list of newly-stored facts (already-known facts are de-duped).
router.post('/extract-and-store', async (req, res) => {
  try {
    const turns = Array.isArray(req.body?.turns) ? req.body.turns : [];
    if (turns.length === 0) return res.json({ added: [] });

    // Thread the signed-in user's display name through so the
    // extractor can tell apart "I love tennis" (user fact — keep)
    // from "my wife loves tennis" (third-party — skip). Before this
    // change the extractor greedily kept every "likes X" phrase it
    // found, which is how facts about spouses and friends were
    // ending up attached to the user's memory record.
    const userName = (req.user && (req.user.name || req.user.displayName || req.user.email)) || '';
    const facts = await extractFacts(turns, { userName });
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

// Audit M8 — POST /api/memory/consolidate
// Runs the pure consolidator in services/memoryConsolidator.js against
// the caller's own memory and optionally applies the plan in-place.
// Query params:
//   ?dry=1           — preview only; no DB writes.
//   ?limit=<n>       — cap the full-set snapshot fed to the planner
//                      (default 500, hard max 1000).
// Response:
//   {
//     dryRun: boolean,
//     considered: number,
//     plan: [{ id, action, reason }],
//     applied: { archived, promoted, demoted } | null
//   }
router.post('/consolidate', async (req, res) => {
  try {
    const dryRun = String(req.query.dry || '').trim() === '1'
      || req.body?.dryRun === true;
    const rawLimit = parseInt(req.query.limit || req.body?.limit || '500', 10);
    const limit = Math.max(1, Math.min(1000, Number.isFinite(rawLimit) ? rawLimit : 500));

    const items = await listAllMemoryItems(req.user.id, limit);
    const plan = planConsolidation(items);

    let applied = null;
    if (!dryRun && plan.length > 0) {
      let archived = 0;
      let promoted = 0;
      let demoted  = 0;
      for (const step of plan) {
        if (!step || step.id == null) continue;
        if (step.action === 'archive') {
          const ok = await archiveMemoryItem(req.user.id, step.id, step.reason);
          if (ok) archived += 1;
        } else if (step.action === 'promote') {
          const ok = await setMemoryItemTier(req.user.id, step.id, 'core');
          if (ok) promoted += 1;
        } else if (step.action === 'demote') {
          const ok = await setMemoryItemTier(req.user.id, step.id, 'recent');
          if (ok) demoted += 1;
        }
      }
      applied = { archived, promoted, demoted };
    }

    res.json({
      dryRun,
      considered: items.length,
      plan,
      applied,
    });
  } catch (err) {
    console.error('[memory/consolidate]', err);
    res.status(500).json({ error: 'Consolidation failed' });
  }
});

module.exports = router;
