'use strict';

// Conversation history endpoints (Adrian 2026-04-21: "sa aiba optiune de
// save … conversatia cu Kelion - nu se salveaza momentan intre sesiuni").
//
// All routes require a signed-in user (requireAuth is applied in
// `index.js`). Guests get localStorage-only persistence on the client.
//
// Ownership: `assertConversationOwner` in the DB layer rejects any
// attempt to read, append to, rename or delete a conversation that does
// not belong to `req.user.id`. 404 is returned for not-found AND
// not-owned so callers can't probe other users' thread IDs.

const { Router } = require('express');
const {
  createConversation,
  appendConversationMessage,
  listConversations,
  getConversationWithMessages,
  updateConversationTitle,
  deleteConversation,
} = require('../db');

const router = Router();

// GET /api/conversations — list the user's threads, newest first.
router.get('/', async (req, res) => {
  try {
    const limit = Math.max(1, Math.min(200, parseInt(req.query.limit || '50', 10)));
    const items = await listConversations(req.user.id, limit);
    res.json({ items });
  } catch (err) {
    console.error('[conversations/list]', err);
    res.status(500).json({ error: 'Failed to list conversations' });
  }
});

// POST /api/conversations — create a new empty thread.
// Body: { title? }
router.post('/', async (req, res) => {
  try {
    const title = typeof req.body?.title === 'string' ? req.body.title : null;
    const conv = await createConversation(req.user.id, title);
    res.json({ conversation: conv });
  } catch (err) {
    console.error('[conversations/create]', err);
    res.status(500).json({ error: 'Failed to create conversation' });
  }
});

// GET /api/conversations/:id — thread with all messages.
router.get('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const conv = await getConversationWithMessages(req.user.id, id);
    if (!conv) return res.status(404).json({ error: 'not found' });
    res.json({ conversation: conv });
  } catch (err) {
    console.error('[conversations/get]', err);
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

// POST /api/conversations/:id/messages — append one turn.
// Body: { role: 'user'|'assistant'|'system', content: '...' }
// Also accepts { messages: [{role, content}, ...] } for batch writes
// (used by the client to flush a whole burst after reconnect).
router.post('/:id/messages', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });

    const body = req.body || {};
    const batch = Array.isArray(body.messages)
      ? body.messages
      : (body.role && body.content ? [{ role: body.role, content: body.content }] : []);
    if (batch.length === 0) return res.status(400).json({ error: 'role + content required' });

    const saved = [];
    for (const m of batch) {
      const row = await appendConversationMessage(req.user.id, id, m.role, m.content);
      if (row) saved.push(row);
    }
    if (saved.length === 0) {
      // Either conversation not found / not owned, or content was empty.
      return res.status(404).json({ error: 'not found' });
    }
    res.json({ messages: saved });
  } catch (err) {
    console.error('[conversations/append]', err);
    res.status(500).json({ error: 'Failed to append message' });
  }
});

// PATCH /api/conversations/:id — rename.
// Body: { title }
router.patch('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const ok = await updateConversationTitle(req.user.id, id, req.body?.title || '');
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[conversations/rename]', err);
    res.status(500).json({ error: 'Failed to rename conversation' });
  }
});

// DELETE /api/conversations/:id — forget one thread.
router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'bad id' });
    const ok = await deleteConversation(req.user.id, id);
    if (!ok) return res.status(404).json({ error: 'not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[conversations/delete]', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;
