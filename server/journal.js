// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — JOURNAL (Daily Journal)
// Routes: GET/POST /api/journal, GET /api/journal/today
//         GET /api/journal/stats, GET /api/journal/chart
//         GET /api/journal/:date
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('./logger');
const { validate, journalSchema } = require('./validation');

const router = express.Router();

const journalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { error: 'Prea multe cereri journal. Așteaptă un minut.' },
    standardHeaders: true,
    legacyHeaders: false,
});
router.use(journalLimiter);

// ── Helpers ──────────────────────────────────────────────────────

/** Returns today's date in UTC as YYYY-MM-DD string */
function todayUTC() {
    return new Date().toISOString().split('T')[0];
}

/** Build a simple HTML/CSS bar chart from mood entries */
function buildMoodChart(entries) {
    const MOOD_COLORS = ['', '#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#27ae60'];
    const MOOD_LABELS = ['', 'Teribil', 'Rău', 'OK', 'Bine', 'Excelent'];

    const bars = entries.map(e => {
        const pct = (e.mood / 5) * 100;
        const color = MOOD_COLORS[e.mood] || '#888';
        const label = MOOD_LABELS[e.mood] || e.mood;
        return `<div class="bar-group">
  <div class="bar-wrap"><div class="bar" style="height:${pct}%;background:${color}" title="${label} (${e.date})"></div></div>
  <div class="bar-date">${e.date.slice(5)}</div>
  <div class="bar-mood">${e.mood}</div>
</div>`;
    }).join('');

    return `<!DOCTYPE html><html><head><meta charset="utf-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{background:#0a0a1a;color:#e0e0e0;font-family:system-ui,sans-serif;padding:16px}
h2{color:#00ffff;font-size:1rem;margin-bottom:12px}
.chart{display:flex;align-items:flex-end;gap:8px;height:120px;border-bottom:1px solid rgba(255,255,255,0.1);padding-bottom:4px}
.bar-group{display:flex;flex-direction:column;align-items:center;flex:1}
.bar-wrap{flex:1;display:flex;align-items:flex-end;width:100%}
.bar{width:100%;border-radius:4px 4px 0 0;min-height:4px;transition:height 0.3s}
.bar-date{font-size:0.65rem;color:#888;margin-top:4px}
.bar-mood{font-size:0.75rem;font-weight:bold;color:#00ffff}
</style></head><body>
<h2>📊 Mood Chart — Ultimele 7 zile</h2>
<div class="chart">${bars}</div>
</body></html>`;
}

// ── Routes ───────────────────────────────────────────────────────

// GET /api/journal — list last 30 entries
router.get('/', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const { data, error } = await supabaseAdmin
            .from('journal')
            .select('*')
            .eq('user_id', user.id)
            .order('date', { ascending: false })
            .limit(30);

        if (error) throw error;

        res.json({ entries: data || [] });
    } catch (e) {
        logger.error({ component: 'Journal', err: e.message }, 'list journal');
        res.status(500).json({ error: 'Eroare la listarea jurnalului' });
    }
});

// GET /api/journal/today — today's entry (or null)
router.get('/today', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const today = todayUTC();
        const { data, error } = await supabaseAdmin
            .from('journal')
            .select('*')
            .eq('user_id', user.id)
            .eq('date', today)
            .maybeSingle();

        if (error) throw error;

        res.json({ entry: data || null });
    } catch (e) {
        logger.error({ component: 'Journal', err: e.message }, 'today journal');
        res.status(500).json({ error: 'Eroare la intrarea de azi' });
    }
});

// GET /api/journal/stats — mood averages + streak
router.get('/stats', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const { data, error } = await supabaseAdmin
            .from('journal')
            .select('date, mood')
            .eq('user_id', user.id)
            .order('date', { ascending: false })
            .limit(30);

        if (error) throw error;

        const entries = data || [];
        const total_entries = entries.length;

        const last7 = entries.slice(0, 7).filter(e => e.mood != null);
        const last30 = entries.filter(e => e.mood != null);

        const avg = (arr) => arr.length ? parseFloat((arr.reduce((s, e) => s + e.mood, 0) / arr.length).toFixed(2)) : null;

        const withMood = entries.filter(e => e.mood != null);
        const best_day = withMood.length ? withMood.reduce((b, e) => e.mood > b.mood ? e : b).date : null;
        const worst_day = withMood.length ? withMood.reduce((w, e) => e.mood < w.mood ? e : w).date : null;

        // Consecutive streak from today backwards
        let streak = 0;
        const today = todayUTC();
        const dateSet = new Set(entries.map(e => e.date));
        let cursor = new Date(today);
        while (dateSet.has(cursor.toISOString().split('T')[0])) {
            streak++;
            cursor.setDate(cursor.getDate() - 1);
        }

        res.json({
            avg_mood_7d: avg(last7),
            avg_mood_30d: avg(last30),
            best_day,
            worst_day,
            streak,
            total_entries,
        });
    } catch (e) {
        logger.error({ component: 'Journal', err: e.message }, 'journal stats');
        res.status(500).json({ error: 'Eroare la statistici jurnal' });
    }
});

// GET /api/journal/chart — HTML fragment with mood bar chart (last 7 days)
router.get('/chart', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const { data, error } = await supabaseAdmin
            .from('journal')
            .select('date, mood')
            .eq('user_id', user.id)
            .not('mood', 'is', null)
            .order('date', { ascending: false })
            .limit(7);

        if (error) throw error;

        const html = buildMoodChart((data || []).reverse());
        res.type('html').send(html);
    } catch (e) {
        logger.error({ component: 'Journal', err: e.message }, 'journal chart');
        res.status(500).json({ error: 'Eroare la graficul jurnal' });
    }
});

// POST /api/journal — create or update today's entry (upsert by date)
router.post('/', validate(journalSchema), async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const today = todayUTC();
        const { mood, best_moment, improvements, goals, free_text } = req.body;

        const { data, error } = await supabaseAdmin
            .from('journal')
            .upsert(
                { user_id: user.id, date: today, mood, best_moment, improvements, goals, free_text },
                { onConflict: 'user_id,date' }
            )
            .select()
            .single();

        if (error) throw error;

        logger.info({ component: 'Journal', userId: user.id }, `Journal entry upserted for ${today}`);
        res.json({ entry: data });
    } catch (e) {
        logger.error({ component: 'Journal', err: e.message }, 'upsert journal');
        res.status(500).json({ error: 'Eroare la salvarea jurnalului' });
    }
});

// GET /api/journal/:date — entry for specific date (YYYY-MM-DD)
router.get('/:date', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const { date } = req.params;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'Format dată invalid. Folosește YYYY-MM-DD.' });
        }

        const { data, error } = await supabaseAdmin
            .from('journal')
            .select('*')
            .eq('user_id', user.id)
            .eq('date', date)
            .maybeSingle();

        if (error) throw error;

        res.json({ entry: data || null });
    } catch (e) {
        logger.error({ component: 'Journal', err: e.message }, 'get journal entry');
        res.status(500).json({ error: 'Eroare la intrarea din jurnal' });
    }
});

module.exports = router;
