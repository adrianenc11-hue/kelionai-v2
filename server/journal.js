// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — JOURNAL (Daily Journal)
// Routes: GET/POST /api/journal, GET /api/journal/today,
//         GET /api/journal/trends, GET /api/journal/:date,
//         DELETE /api/journal/:id
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const logger = require('./logger');
const router = express.Router();

// ═══ AUTH HELPER ═══
async function requireUser(req, res) {
    const getUserFromToken = req.app.locals.getUserFromToken;
    const user = await getUserFromToken(req);
    if (!user) {
        res.status(401).json({ error: 'Neautentificat' });
        return null;
    }
    return user;
}

// ═══ GET /api/journal — list entries (last 30 days, paginated) ═══
router.get('/', async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const supabaseAdmin = req.app.locals.supabaseAdmin;
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 30));
        const offset = (page - 1) * limit;

        const since = new Date();
        since.setDate(since.getDate() - 30);
        const sinceStr = since.toISOString().split('T')[0];

        const { data, error } = await supabaseAdmin
            .from('journal_entries')
            .select('*')
            .eq('user_id', user.id)
            .gte('entry_date', sinceStr)
            .order('entry_date', { ascending: false })
            .range(offset, offset + limit - 1);
        if (error) throw error;
        res.json({ entries: data || [], page, limit });
    } catch (e) {
        logger.error({ component: 'Journal', err: e.message }, 'GET /journal error');
        res.status(500).json({ error: 'Eroare la listarea jurnalului' });
    }
});

// ═══ POST /api/journal — create/update today's entry ═══
router.post('/', async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const { mood, best_moment, improvements, goals, free_text, entry_date } = req.body;
        if (mood == null || mood < 1 || mood > 10) {
            return res.status(400).json({ error: 'mood trebuie să fie între 1 și 10' });
        }
        const supabaseAdmin = req.app.locals.supabaseAdmin;
        const date = entry_date || new Date().toISOString().split('T')[0];

        const { data, error } = await supabaseAdmin
            .from('journal_entries')
            .upsert({
                user_id: user.id,
                entry_date: date,
                mood: parseInt(mood, 10),
                best_moment: best_moment || null,
                improvements: improvements || null,
                goals: goals || null,
                free_text: free_text || null
            }, { onConflict: 'user_id,entry_date' })
            .select()
            .single();
        if (error) throw error;
        logger.info({ component: 'Journal', userId: user.id }, 'Journal entry saved for ' + date);
        res.status(201).json({ entry: data });
    } catch (e) {
        logger.error({ component: 'Journal', err: e.message }, 'POST /journal error');
        res.status(500).json({ error: 'Eroare la salvarea jurnalului' });
    }
});

// ═══ GET /api/journal/today — today's entry (or null) ═══
router.get('/today', async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const supabaseAdmin = req.app.locals.supabaseAdmin;
        const today = new Date().toISOString().split('T')[0];
        const { data, error } = await supabaseAdmin
            .from('journal_entries')
            .select('*')
            .eq('user_id', user.id)
            .eq('entry_date', today)
            .maybeSingle();
        if (error) throw error;
        res.json({ entry: data || null });
    } catch (e) {
        logger.error({ component: 'Journal', err: e.message }, 'GET /journal/today error');
        res.status(500).json({ error: 'Eroare la obținerea intrării de azi' });
    }
});

// ═══ GET /api/journal/trends — mood trends last 12 weeks ═══
router.get('/trends', async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const supabaseAdmin = req.app.locals.supabaseAdmin;

        const since = new Date();
        since.setDate(since.getDate() - 84); // 12 weeks
        const sinceStr = since.toISOString().split('T')[0];

        const { data, error } = await supabaseAdmin
            .from('journal_entries')
            .select('entry_date, mood')
            .eq('user_id', user.id)
            .gte('entry_date', sinceStr)
            .order('entry_date', { ascending: true });
        if (error) throw error;

        const entries = data || [];

        // Group by ISO week (YYYY-Www)
        const weekMap = {};
        for (const e of entries) {
            const w = _isoWeek(e.entry_date);
            if (!weekMap[w]) weekMap[w] = [];
            weekMap[w].push(e.mood);
        }

        const weeks = Object.keys(weekMap).sort().map(week => {
            const moods = weekMap[week];
            const avgMood = Math.round((moods.reduce((s, m) => s + m, 0) / moods.length) * 10) / 10;
            return { week, avgMood, entries: moods.length };
        });

        const allMoods = entries.map(e => e.mood);
        const overall_avg = allMoods.length
            ? Math.round((allMoods.reduce((s, m) => s + m, 0) / allMoods.length) * 10) / 10
            : null;

        // Trend: compare last 4 weeks avg vs prior 4 weeks avg
        const trend = _computeTrend(weeks);
        const best_week = weeks.length ? weeks.reduce((b, w) => w.avgMood > b.avgMood ? w : b).week : null;
        const streak = _computeStreak(entries);

        res.json({ weeks, overall_avg, trend, best_week, streak });
    } catch (e) {
        logger.error({ component: 'Journal', err: e.message }, 'GET /journal/trends error');
        res.status(500).json({ error: 'Eroare la calcularea tendințelor' });
    }
});

// ═══ GET /api/journal/:date — specific date (YYYY-MM-DD) ═══
router.get('/:date', async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const { date } = req.params;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
            return res.status(400).json({ error: 'Format dată invalid (YYYY-MM-DD)' });
        }
        const supabaseAdmin = req.app.locals.supabaseAdmin;
        const { data, error } = await supabaseAdmin
            .from('journal_entries')
            .select('*')
            .eq('user_id', user.id)
            .eq('entry_date', date)
            .maybeSingle();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Intrare negăsită' });
        res.json({ entry: data });
    } catch (e) {
        logger.error({ component: 'Journal', err: e.message }, 'GET /journal/:date error');
        res.status(500).json({ error: 'Eroare la obținerea intrării' });
    }
});

// ═══ DELETE /api/journal/:id — delete entry ═══
router.delete('/:id', async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const { id } = req.params;
        const supabaseAdmin = req.app.locals.supabaseAdmin;
        const { error } = await supabaseAdmin
            .from('journal_entries')
            .delete()
            .eq('id', id)
            .eq('user_id', user.id);
        if (error) throw error;
        res.json({ success: true });
    } catch (e) {
        logger.error({ component: 'Journal', err: e.message }, 'DELETE /journal/:id error');
        res.status(500).json({ error: 'Eroare la ștergerea intrării' });
    }
});

// ═══ HELPERS ═══
function _isoWeek(dateStr) {
    const d = new Date(dateStr);
    const day = d.getUTCDay() || 7; // Convert Sun=0 to 7, making Mon=1..Sun=7
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
    return d.getUTCFullYear() + '-W' + String(week).padStart(2, '0');
}

function _computeTrend(weeks) {
    if (weeks.length < 2) return 'stable';
    const half = Math.floor(weeks.length / 2);
    const recent = weeks.slice(-half).reduce((s, w) => s + w.avgMood, 0) / half;
    const prior = weeks.slice(0, half).reduce((s, w) => s + w.avgMood, 0) / half;
    if (recent - prior > 0.5) return 'improving';
    if (prior - recent > 0.5) return 'declining';
    return 'stable';
}

function _computeStreak(entries) {
    if (!entries.length) return 0;
    const today = new Date().toISOString().split('T')[0];
    const dates = new Set(entries.map(e => e.entry_date));
    let streak = 0;
    let cur = new Date(today);
    while (streak < 365) {
        const d = cur.toISOString().split('T')[0];
        if (dates.has(d)) {
            streak++;
            cur.setDate(cur.getDate() - 1);
        } else {
            break;
        }
    }
    return streak;
}

module.exports = router;
