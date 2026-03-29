// ═══════════════════════════════════════════════════════════════
// KelionAI — Admin History Routes (/api/admin/history/*)
// GET / — conversation history with pagination
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const logger  = require('../../logger');
const router  = express.Router();

// ─── GET / — Conversation history ───
router.get('/', async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ conversations: [], total: 0 });

    const limit  = Math.min(parseInt(req.query.limit,  10) || 50, 200);
    const offset = parseInt(req.query.offset, 10) || 0;
    const userId = req.query.user_id || null;

    let query = supabaseAdmin
      .from('conversations')
      .select('id, user_id, avatar, created_at, updated_at', { count: 'exact' })
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (userId) query = query.eq('user_id', userId);

    const { data: conversations, count, error } = await query;

    if (error) {
      logger.warn({ component: 'AdminHistory', err: error.message }, 'conversations query failed');
      return res.json({ conversations: [], total: 0, error: error.message });
    }

    // Enrich with message counts
    const enriched = [];
    for (const c of (conversations || [])) {
      let msgCount = 0;
      try {
        const { count: mc } = await supabaseAdmin
          .from('messages')
          .select('*', { count: 'exact', head: true })
          .eq('conversation_id', c.id);
        msgCount = mc || 0;
      } catch (_) {}

      enriched.push({
        id:           c.id,
        user_id:      c.user_id ? c.user_id.substring(0, 8) + '...' : 'Guest',
        avatar:       c.avatar || 'kelion',
        message_count: msgCount,
        created_at:   c.created_at,
        updated_at:   c.updated_at,
      });
    }

    res.json({ conversations: enriched, total: count || 0, limit, offset });
  } catch (e) {
    logger.error({ component: 'AdminHistory', err: e.message }, 'GET /admin/history failed');
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// ─── DELETE /:id — Delete a conversation ───
router.delete('/:id', async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(503).json({ error: 'No DB' });

    const { id } = req.params;

    // Delete messages first
    await supabaseAdmin.from('messages').delete().eq('conversation_id', id);
    // Delete conversation
    const { error } = await supabaseAdmin.from('conversations').delete().eq('id', id);
    if (error) throw error;

    logger.info({ component: 'AdminHistory', id }, 'Conversation deleted');
    res.json({ ok: true });
  } catch (e) {
    logger.error({ component: 'AdminHistory', err: e.message }, 'DELETE /admin/history/:id failed');
    res.status(500).json({ error: 'Delete failed' });
  }
});

module.exports = router;