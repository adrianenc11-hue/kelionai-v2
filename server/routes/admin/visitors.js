// ═══════════════════════════════════════════════════════════════
// Admin Sub-Router: Visitors Management v2
// Adapted to real DB schema: uses created_at as first_seen fallback
// Columns: id, created_at, ip, user_agent, referer, country_code,
//          city, photo, fingerprint, browser, device, os,
//          screen_width, screen_height, language, timezone,
//          referrer, utm_source, utm_medium, utm_campaign,
//          pages_visited, total_visits, total_time_sec,
//          status, last_seen, country, notes, tags, first_seen
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const logger = require('../../logger');
const router = express.Router();

// ── Safe columns that exist in DB (base set always present) ──
const BASE_SELECT = 'id,fingerprint,ip,country_code,country,city,browser,device,os,language,timezone,referrer,referer,utm_source,utm_medium,utm_campaign,pages_visited,total_visits,total_time_sec,status,last_seen,photo,screen_width,screen_height,created_at,user_agent';

// ── Track which optional columns exist ──
let _optionalCols = null; // null = not checked yet

async function getSelectCols(supabaseAdmin) {
  if (_optionalCols !== null) {
    return _optionalCols.length > 0
      ? BASE_SELECT + ',' + _optionalCols.join(',')
      : BASE_SELECT;
  }
  // Probe optional columns
  const optional = ['first_seen', 'notes', 'tags'];
  const present = [];
  try {
    const { data, error } = await supabaseAdmin.from('visitors').select(optional.join(',')).limit(1);
    if (!error) {
      present.push(...optional);
    } else {
      // Try one by one
      for (const col of optional) {
        const { error: e2 } = await supabaseAdmin.from('visitors').select(col).limit(1);
        if (!e2) present.push(col);
      }
    }
  } catch (_) {}
  _optionalCols = present;
  logger.info({ component: 'Admin.Visitors', optionalCols: present }, 'Optional columns detected');
  return present.length > 0 ? BASE_SELECT + ',' + present.join(',') : BASE_SELECT;
}

// ── Normalize visitor: map country_code→country if country missing, created_at→first_seen ──
function normalizeVisitor(v) {
  if (!v) return v;
  const out = { ...v };
  // country fallback
  if (!out.country && out.country_code) out.country = out.country_code;
  // first_seen fallback
  if (!out.first_seen) out.first_seen = out.created_at || null;
  // last_seen fallback
  if (!out.last_seen) out.last_seen = out.created_at || null;
  // referrer fallback (some rows use 'referer')
  if (!out.referrer && out.referer) out.referrer = out.referer;
  // notes/tags defaults
  if (out.notes === undefined) out.notes = null;
  if (out.tags === undefined) out.tags = [];
  return out;
}

// ── Period helper ──
function getPeriodFilter(period) {
  const now = new Date();
  if (period === '1d') {
    const d = new Date(now); d.setDate(d.getDate() - 1); return d.toISOString();
  }
  if (period === '7d') {
    const d = new Date(now); d.setDate(d.getDate() - 7); return d.toISOString();
  }
  if (period === '1m') {
    const d = new Date(now); d.setMonth(d.getMonth() - 1); return d.toISOString();
  }
  if (period === '3m') {
    const d = new Date(now); d.setMonth(d.getMonth() - 3); return d.toISOString();
  }
  return null;
}

// ── Safe sort column (only use columns that definitely exist) ──
function safeSortCol(sort) {
  const safe = {
    last_seen:      'last_seen',
    first_seen:     'created_at', // fallback to created_at if first_seen missing
    total_visits:   'total_visits',
    total_time_sec: 'total_time_sec',
    created_at:     'created_at',
  };
  return safe[sort] || 'last_seen';
}

// ═══════════════════════════════════════════════════════════════
// GET / — List visitors with filtering, search, pagination
// ═══════════════════════════════════════════════════════════════
router.get('/', async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ visitors: [], total: 0 });

    const period  = req.query.period  || 'unlimited';
    const search  = (req.query.search || '').trim().toLowerCase();
    const page    = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit   = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const sortKey = safeSortCol(req.query.sort || 'last_seen');
    const order   = req.query.order === 'asc';
    const country = req.query.country || null;
    const status  = req.query.status  || null;
    const offset  = (page - 1) * limit;
    const since   = getPeriodFilter(period);

    // ── Count query (use created_at as fallback for period filter) ──
    const periodCol = 'last_seen'; // always exists
    let countQ = supabaseAdmin.from('visitors').select('id', { count: 'exact', head: true });
    if (since)   countQ = countQ.gte(periodCol, since);
    if (country) countQ = countQ.or(`country.eq.${country},country_code.eq.${country}`);
    if (status)  countQ = countQ.eq('status', status);
    const { count: totalCount } = await countQ;

    // ── Data query ──
    const selectCols = await getSelectCols(supabaseAdmin);
    let q = supabaseAdmin
      .from('visitors')
      .select(selectCols)
      .order(sortKey, { ascending: order })
      .range(offset, offset + limit - 1);

    if (since)   q = q.gte(periodCol, since);
    if (country) q = q.or(`country.eq.${country},country_code.eq.${country}`);
    if (status)  q = q.eq('status', status);

    const { data, error } = await q;
    if (error) {
      logger.error({ component: 'Admin.Visitors', err: error.message }, 'List visitors failed');
      return res.status(500).json({ error: error.message });
    }

    let visitors = (data || []).map(normalizeVisitor);

    // ── Client-side search ──
    if (search) {
      visitors = visitors.filter((v) => {
        const fields = [v.ip, v.fingerprint, v.country, v.country_code, v.city, v.browser, v.device, v.os, v.referrer, v.notes, v.utm_source, v.utm_campaign]
          .map((f) => (f || '').toLowerCase());
        return fields.some((f) => f.includes(search));
      });
    }

    // ── Enrich with page_views count ──
    const enriched = await Promise.all(
      visitors.map(async (v) => {
        let pvCount = 0;
        try {
          if (v.ip) {
            const { count } = await supabaseAdmin
              .from('page_views')
              .select('id', { count: 'exact', head: true })
              .eq('ip', v.ip);
            pvCount = count || 0;
          }
        } catch (_e) { /* ignore */ }
        return { ...v, pageViewsCount: pvCount };
      })
    );

    res.json({
      visitors: enriched,
      total: search ? enriched.length : (totalCount || 0),
      page,
      limit,
      period,
      hasMore: !search && (offset + limit < (totalCount || 0)),
    });
  } catch (e) {
    logger.error({ component: 'Admin.Visitors', err: e.message }, 'List visitors failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /stats — Aggregated stats for dashboard
// ═══════════════════════════════════════════════════════════════
router.get('/stats', async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.json({ total: 0, today: 0, thisWeek: 0, thisMonth: 0 });

    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const week  = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const month = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    // Use last_seen for period filters (always exists)
    const [totalR, todayR, weekR, monthR, countriesR, browsersR] = await Promise.all([
      supabaseAdmin.from('visitors').select('id', { count: 'exact', head: true }),
      supabaseAdmin.from('visitors').select('id', { count: 'exact', head: true }).gte('last_seen', today),
      supabaseAdmin.from('visitors').select('id', { count: 'exact', head: true }).gte('last_seen', week),
      supabaseAdmin.from('visitors').select('id', { count: 'exact', head: true }).gte('last_seen', month),
      supabaseAdmin.from('visitors').select('country,country_code').limit(1000),
      supabaseAdmin.from('visitors').select('browser').not('browser', 'is', null).limit(500),
    ]);

    // Country distribution (use country or country_code)
    const countryMap = {};
    (countriesR.data || []).forEach((v) => {
      const c = v.country || v.country_code;
      if (c) countryMap[c] = (countryMap[c] || 0) + 1;
    });
    const topCountries = Object.entries(countryMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([country, count]) => ({ country, count }));

    // Browser distribution
    const browserMap = {};
    (browsersR.data || []).forEach((v) => {
      if (v.browser) browserMap[v.browser] = (browserMap[v.browser] || 0) + 1;
    });
    const topBrowsers = Object.entries(browserMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([browser, count]) => ({ browser, count }));

    res.json({
      total:     totalR.count  || 0,
      today:     todayR.count  || 0,
      thisWeek:  weekR.count   || 0,
      thisMonth: monthR.count  || 0,
      topCountries,
      topBrowsers,
    });
  } catch (e) {
    logger.error({ component: 'Admin.Visitors', err: e.message }, 'Visitor stats failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// GET /:id — Single visitor with page_views history
// ═══════════════════════════════════════════════════════════════
router.get('/:id', async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(500).json({ error: 'No DB' });

    const { data: visitor, error } = await supabaseAdmin
      .from('visitors')
      .select('*')
      .eq('id', req.params.id)
      .single();

    if (error || !visitor) return res.status(404).json({ error: 'Not found' });

    let pageViews = [];
    if (visitor.ip) {
      const { data: pv } = await supabaseAdmin
        .from('page_views')
        .select('path, referrer, created_at, country, ip')
        .eq('ip', visitor.ip)
        .order('created_at', { ascending: false })
        .limit(100);
      pageViews = pv || [];
    }

    res.json({ ...normalizeVisitor(visitor), pageViews });
  } catch (e) {
    logger.error({ component: 'Admin.Visitors', err: e.message }, 'Get visitor failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// PUT /:id — Update visitor (notes, tags, status, city, country)
// ═══════════════════════════════════════════════════════════════
router.put('/:id', async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(500).json({ error: 'No DB' });

    const allowed = ['notes', 'tags', 'status', 'city', 'country', 'browser', 'device', 'os'];
    const update = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) update[key] = req.body[key];
    }

    const { error } = await supabaseAdmin.from('visitors').update(update).eq('id', req.params.id);
    if (error) return res.status(500).json({ error: error.message });

    logger.info({ component: 'Admin.Visitors', id: req.params.id, fields: Object.keys(update) }, 'Visitor updated');
    res.json({ ok: true });
  } catch (e) {
    logger.error({ component: 'Admin.Visitors', err: e.message }, 'Update visitor failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// DELETE /:id — Delete single visitor + page_views
// ═══════════════════════════════════════════════════════════════
router.delete('/:id', async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(500).json({ error: 'No DB' });

    const { data: visitor } = await supabaseAdmin
      .from('visitors').select('fingerprint, ip').eq('id', req.params.id).single();

    const { data, error } = await supabaseAdmin.from('visitors').delete().eq('id', req.params.id).select('id');
    if (error) return res.status(500).json({ error: error.message });

    let pvDeleted = 0;
    if (visitor?.ip) {
      const { data: pvData } = await supabaseAdmin.from('page_views').delete().eq('ip', visitor.ip).select('id');
      pvDeleted = pvData ? pvData.length : 0;
    }

    logger.info({ component: 'Admin.Visitors', id: req.params.id, pvDeleted }, 'Visitor deleted');
    res.json({ ok: true, deleted: data ? data.length : 0, pageViewsDeleted: pvDeleted });
  } catch (e) {
    logger.error({ component: 'Admin.Visitors', err: e.message }, 'Delete visitor failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// POST /bulk-delete — Bulk delete visitors
// ═══════════════════════════════════════════════════════════════
router.post('/bulk-delete', async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(500).json({ error: 'No DB' });

    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) return res.status(400).json({ error: 'No IDs provided' });
    if (ids.length > 500) return res.status(400).json({ error: 'Max 500 IDs per bulk operation' });

    const { data: visitors } = await supabaseAdmin.from('visitors').select('fingerprint, ip').in('id', ids);
    const { data, error } = await supabaseAdmin.from('visitors').delete().in('id', ids).select('id');
    if (error) return res.status(500).json({ error: error.message });

    let pvDeleted = 0;
    if (visitors && visitors.length > 0) {
      const ips = [...new Set(visitors.map((v) => v.ip).filter(Boolean))];
      if (ips.length > 0) {
        const { data: pvData } = await supabaseAdmin.from('page_views').delete().in('ip', ips).select('id');
        pvDeleted = pvData ? pvData.length : 0;
      }
    }

    logger.info({ component: 'Admin.Visitors', count: ids.length, pvDeleted }, 'Bulk delete visitors');
    res.json({ ok: true, deleted: data ? data.length : 0, pageViewsDeleted: pvDeleted });
  } catch (e) {
    logger.error({ component: 'Admin.Visitors', err: e.message }, 'Bulk-delete visitors failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ═══════════════════════════════════════════════════════════════
// DELETE /by-period/:period — Delete all visitors in a period
// ═══════════════════════════════════════════════════════════════
router.delete('/by-period/:period', async (req, res) => {
  try {
    const { supabaseAdmin } = req.app.locals;
    if (!supabaseAdmin) return res.status(500).json({ error: 'No DB' });

    const since = getPeriodFilter(req.params.period);
    if (!since && req.params.period !== 'all') {
      return res.status(400).json({ error: 'Invalid period. Use: 1d, 7d, 1m, 3m, all' });
    }

    let q = supabaseAdmin.from('visitors').delete().select('ip');
    if (since) q = q.gte('last_seen', since);

    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });

    const ips = [...new Set((data || []).map((v) => v.ip).filter(Boolean))];
    let pvDeleted = 0;
    if (ips.length > 0) {
      const { data: pvData } = await supabaseAdmin.from('page_views').delete().in('ip', ips).select('id');
      pvDeleted = pvData ? pvData.length : 0;
    }

    logger.info({ component: 'Admin.Visitors', period: req.params.period, deleted: data?.length, pvDeleted }, 'Period delete');
    res.json({ ok: true, deleted: data ? data.length : 0, pageViewsDeleted: pvDeleted });
  } catch (e) {
    logger.error({ component: 'Admin.Visitors', err: e.message }, 'Period delete failed');
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;