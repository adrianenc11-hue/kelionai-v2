// ═══════════════════════════════════════════════════════════════
// KelionAI — Admin Alerts API
// GET    /api/admin/alerts               — list alerts with filters
// GET    /api/admin/alerts/stats         — summary counts by type/status
// PATCH  /api/admin/alerts/mark-all-read — mark all unread as read
// PATCH  /api/admin/alerts/:id/read      — mark single alert as read
// DELETE /api/admin/alerts/clear-all     — delete all alerts
// DELETE /api/admin/alerts/:id           — delete single alert
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const router  = express.Router();
const logger  = require('../../logger');

// ── Type metadata — covers both naming conventions ──
const TYPE_META = {
  // Frontend filter names
  low_credits:      { label: 'Credite Scăzute',      icon: '⚠️',  color: '#f59e0b' },
  zero_credits:     { label: 'Credite Epuizate',      icon: '🚨',  color: '#ef4444' },
  new_user:         { label: 'Utilizator Nou',         icon: '👤',  color: '#22c55e' },
  system_error:     { label: 'Eroare Sistem',          icon: '💥',  color: '#dc2626' },
  ai_status:        { label: 'AI Status',              icon: '🤖',  color: '#818cf8' },
  payment:          { label: 'Plată',                  icon: '💰',  color: '#34d399' },
  refund:           { label: 'Ramburs',                icon: '💸',  color: '#fbbf24' },
  security:         { label: 'Securitate',             icon: '🔒',  color: '#a78bfa' },
  // Legacy names (backward compat)
  credit_low:       { label: 'Credite Scăzute',      icon: '⚠️',  color: '#f59e0b' },
  credit_zero:      { label: 'Credite Epuizate',      icon: '🚨',  color: '#ef4444' },
  ai_down:          { label: 'AI Provider Down',       icon: '🔴',  color: '#ef4444' },
  ai_degraded:      { label: 'AI Provider Degradat',   icon: '🟡',  color: '#f59e0b' },
  healing_report:   { label: 'Self-Healing Report',    icon: '🔧',  color: '#06b6d4' },
  healing_critical: { label: 'Healing Critic',         icon: '🚨',  color: '#ef4444' },
  critical_error:   { label: 'Eroare Critică',         icon: '💥',  color: '#dc2626' },
  payment_success:  { label: 'Plată Reușită',          icon: '💳',  color: '#22c55e' },
  payment_failed:   { label: 'Plată Eșuată',           icon: '❌',  color: '#ef4444' },
};

// ── PATCH /api/admin/alerts/mark-all-read ──
router.patch('/mark-all-read', async (req, res) => {
  const pool = req.app.locals.pool;
  if (!pool) return res.status(500).json({ error: 'No database' });
  try {
    const result = await pool.query(
      `UPDATE alert_logs SET status = 'read' WHERE status = 'unread' RETURNING id`
    );
    res.json({ success: true, updated: result.rowCount });
  } catch (e) {
    logger.error({ component: 'AdminAlerts', err: e.message }, 'Mark-all-read failed');
    res.status(500).json({ error: e.message });
  }
});

// ── DELETE /api/admin/alerts/clear-all ──
router.delete('/clear-all', async (req, res) => {
  const pool = req.app.locals.pool;
  if (!pool) return res.status(500).json({ error: 'No database' });
  try {
    const result = await pool.query('DELETE FROM alert_logs RETURNING id');
    res.json({ success: true, deleted: result.rowCount });
  } catch (e) {
    logger.error({ component: 'AdminAlerts', err: e.message }, 'Clear-all failed');
    res.status(500).json({ error: e.message });
  }
});

// ── PATCH /api/admin/alerts/:id/read ──
router.patch('/:id/read', async (req, res) => {
  const pool = req.app.locals.pool;
  if (!pool) return res.status(500).json({ error: 'No database' });
  try {
    await pool.query(
      `UPDATE alert_logs SET status = 'read' WHERE id = $1`,
      [req.params.id]
    );
    res.json({ success: true });
  } catch (e) {
    logger.error({ component: 'AdminAlerts', err: e.message }, 'Mark-read failed');
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/alerts/stats ──
router.get('/stats', async (req, res) => {
  const pool = req.app.locals.pool;
  if (!pool) return res.json({ byType: [], byStatus: [], total: 0, last24h: 0 });

  try {
    const [byType, byStatus, total, last24h] = await Promise.all([
      pool.query(`
        SELECT alert_type, COUNT(*) AS cnt
        FROM alert_logs
        GROUP BY alert_type
        ORDER BY cnt DESC
      `),
      pool.query(`
        SELECT status, COUNT(*) AS cnt
        FROM alert_logs
        GROUP BY status
      `),
      pool.query(`SELECT COUNT(*) AS cnt FROM alert_logs`),
      pool.query(`
        SELECT COUNT(*) AS cnt
        FROM alert_logs
        WHERE created_at >= NOW() - INTERVAL '24 hours'
      `),
    ]);

    const byTypeEnriched = byType.rows.map(r => ({
      type:  r.alert_type,
      count: parseInt(r.cnt, 10),
      ...(TYPE_META[r.alert_type] || { label: r.alert_type, icon: '🔔', color: '#6366f1' }),
    }));

    res.json({
      byType:   byTypeEnriched,
      byStatus: byStatus.rows.map(r => ({ status: r.status, count: parseInt(r.cnt, 10) })),
      total:    parseInt(total.rows[0]?.cnt || '0', 10),
      last24h:  parseInt(last24h.rows[0]?.cnt || '0', 10),
    });
  } catch (e) {
    logger.error({ component: 'AdminAlerts', err: e.message }, 'Stats query failed');
    res.status(500).json({ error: e.message });
  }
});

// ── GET /api/admin/alerts ──
// Query params: type, status, search, limit, offset, from, to
router.get('/', async (req, res) => {
  const pool = req.app.locals.pool;
  if (!pool) return res.json({ alerts: [], total: 0, success: true });

  try {
    const {
      type,
      status,
      search,
      limit  = 50,
      offset = 0,
      from,
      to,
    } = req.query;

    const conditions = [];
    const params     = [];
    let   pi         = 1;

    if (type && type !== 'all') {
      conditions.push(`alert_type = $${pi++}`);
      params.push(type);
    }
    if (status && status !== 'all') {
      conditions.push(`status = $${pi++}`);
      params.push(status);
    }
    if (search) {
      conditions.push(`(subject ILIKE $${pi} OR user_email ILIKE $${pi} OR recipient_email ILIKE $${pi})`);
      params.push(`%${search}%`);
      pi++;
    }
    if (from) {
      conditions.push(`created_at >= $${pi++}`);
      params.push(from);
    }
    if (to) {
      conditions.push(`created_at <= $${pi++}`);
      params.push(to);
    }

    const where  = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const lim    = Math.min(parseInt(limit, 10) || 50, 200);
    const off    = parseInt(offset, 10) || 0;

    const [rows, countRow, statsRow] = await Promise.all([
      pool.query(
        `SELECT id, alert_type, subject, recipient_email, user_id, user_email,
                status, error_msg, metadata, created_at, message
         FROM alert_logs
         ${where}
         ORDER BY created_at DESC
         LIMIT $${pi} OFFSET $${pi + 1}`,
        [...params, lim, off]
      ),
      pool.query(`SELECT COUNT(*) AS cnt FROM alert_logs ${where}`, params),
      // Stats for the stats bar (always full counts, no filter)
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE status = 'unread')                                         AS unread,
          COUNT(*) FILTER (WHERE alert_type IN ('low_credits','credit_low'))                AS low_credits,
          COUNT(*) FILTER (WHERE alert_type IN ('zero_credits','credit_zero'))              AS zero_credits,
          COUNT(*) FILTER (WHERE alert_type = 'new_user')                                  AS new_user,
          COUNT(*) FILTER (WHERE alert_type IN ('system_error','critical_error'))          AS system_error,
          COUNT(*) FILTER (WHERE alert_type IN ('ai_status','ai_down','ai_degraded'))      AS ai_status,
          COUNT(*) FILTER (WHERE alert_type IN ('payment','payment_success','payment_failed')) AS payment,
          COUNT(*) FILTER (WHERE alert_type = 'refund')                                    AS refund,
          COUNT(*) FILTER (WHERE alert_type = 'security')                                  AS security,
          COUNT(*)                                                                          AS total
        FROM alert_logs
      `),
    ]);

    const alerts = rows.rows.map(r => ({
      ...r,
      meta: TYPE_META[r.alert_type] || { label: r.alert_type, icon: '🔔', color: '#6366f1' },
    }));

    const s = statsRow.rows[0] || {};

    res.json({
      success: true,
      alerts,
      total:  parseInt(countRow.rows[0]?.cnt || '0', 10),
      limit:  lim,
      offset: off,
      stats: {
        total:        parseInt(s.total       || 0, 10),
        unread:       parseInt(s.unread      || 0, 10),
        low_credits:  parseInt(s.low_credits || 0, 10),
        zero_credits: parseInt(s.zero_credits|| 0, 10),
        new_user:     parseInt(s.new_user    || 0, 10),
        system_error: parseInt(s.system_error|| 0, 10),
        ai_status:    parseInt(s.ai_status   || 0, 10),
        payment:      parseInt(s.payment     || 0, 10),
        refund:       parseInt(s.refund      || 0, 10),
        security:     parseInt(s.security    || 0, 10),
      },
    });
  } catch (e) {
    logger.error({ component: 'AdminAlerts', err: e.message }, 'List query failed');
    res.status(500).json({ success: false, error: e.message });
  }
});

// ── DELETE /api/admin/alerts/:id ──
router.delete('/:id', async (req, res) => {
  const pool = req.app.locals.pool;
  if (!pool) return res.status(500).json({ error: 'No database' });
  try {
    await pool.query('DELETE FROM alert_logs WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (e) {
    logger.error({ component: 'AdminAlerts', err: e.message }, 'Delete failed');
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;