// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — DAILY JOURNAL WITH MOOD CHART
// Daily reflection: rate day (1-5), best moment, improvements, goals
// ═══════════════════════════════════════════════════════════════
'use strict';
const express = require('express');
const logger = require('./logger');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const MS_PER_DAY = 86400000;

const journalLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Prea multe cereri journal. Așteaptă un minut.' },
    standardHeaders: true,
    legacyHeaders: false
});

/**
 * Format a Date as ISO week string "YYYY-Www"
 */
function isoWeek(date) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() + 4 - (d.getDay() || 7));
    const year = d.getFullYear();
    const week = Math.ceil(((d - new Date(year, 0, 1)) / MS_PER_DAY + 1) / 7);
    return `${year}-W${String(week).padStart(2, '0')}`;
}

// ═══ GET /api/journal — list entries (last 30 days, newest first) ═══
router.get('/', journalLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const since = new Date();
        since.setDate(since.getDate() - 30);

        const { data, error } = await supabaseAdmin
            .from('journal_entries')
            .select('*')
            .eq('user_id', user.id)
            .gte('entry_date', since.toISOString().slice(0, 10))
            .order('entry_date', { ascending: false });

        if (error) throw error;

        res.json({ entries: data || [] });
    } catch (e) {
        logger.error({ component: 'Journal', err: e.message }, 'GET /api/journal');
        res.status(500).json({ error: 'Eroare citire jurnal' });
    }
});

// ═══ GET /api/journal/today — get today's entry (or null) ═══
router.get('/today', journalLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const today = new Date().toISOString().slice(0, 10);

        const { data, error } = await supabaseAdmin
            .from('journal_entries')
            .select('*')
            .eq('user_id', user.id)
            .eq('entry_date', today)
            .single();

        if (error && error.code !== 'PGRST116') throw error;

        res.json({ entry: data || null });
    } catch (e) {
        logger.error({ component: 'Journal', err: e.message }, 'GET /api/journal/today');
        res.status(500).json({ error: 'Eroare citire intrare azi' });
    }
});

// ═══ GET /api/journal/trends — mood trend data (last 12 weeks) ═══
router.get('/trends', journalLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const since = new Date();
        since.setDate(since.getDate() - 84); // ~12 weeks

        const { data, error } = await supabaseAdmin
            .from('journal_entries')
            .select('entry_date, mood_score')
            .eq('user_id', user.id)
            .gte('entry_date', since.toISOString().slice(0, 10))
            .order('entry_date', { ascending: true });

        if (error) throw error;

        // Group by ISO week
        const weekMap = {};
        (data || []).forEach(e => {
            if (e.mood_score == null) return;
            const w = isoWeek(e.entry_date);
            if (!weekMap[w]) weekMap[w] = { scores: [], count: 0 };
            weekMap[w].scores.push(e.mood_score);
            weekMap[w].count++;
        });

        const weeks = Object.entries(weekMap)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([week, { scores, count }]) => ({
                week,
                avgMood: parseFloat((scores.reduce((s, v) => s + v, 0) / scores.length).toFixed(2)),
                entries: count
            }));

        // Overall stats
        const allEntries = data || [];
        const scoredEntries = allEntries.filter(e => e.mood_score != null);
        const totalScored = scoredEntries.length;
        const avgMood = totalScored > 0
            ? parseFloat((scoredEntries.reduce((s, e) => s + e.mood_score, 0) / totalScored).toFixed(2))
            : null;

        // Streak: consecutive days ending today
        const { data: allData } = await supabaseAdmin
            .from('journal_entries')
            .select('entry_date')
            .eq('user_id', user.id)
            .order('entry_date', { ascending: false });

        let streak = 0;
        const check = new Date();
        check.setHours(0, 0, 0, 0);
        const dateSet = new Set((allData || []).map(e => e.entry_date));
        while (dateSet.has(check.toISOString().slice(0, 10))) {
            streak++;
            check.setDate(check.getDate() - 1);
        }

        // Total entries (all time)
        const { count: totalEntries } = await supabaseAdmin
            .from('journal_entries')
            .select('*', { count: 'exact', head: true })
            .eq('user_id', user.id);

        res.json({
            weeks,
            overall: { avgMood, totalEntries: totalEntries || 0, streak }
        });
    } catch (e) {
        logger.error({ component: 'Journal', err: e.message }, 'GET /api/journal/trends');
        res.status(500).json({ error: 'Eroare citire trends' });
    }
});

// ═══ GET /api/journal/export — export all entries as JSON (GDPR) ═══
router.get('/export', journalLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const { data, error } = await supabaseAdmin
            .from('journal_entries')
            .select('*')
            .eq('user_id', user.id)
            .order('entry_date', { ascending: false });

        if (error) throw error;

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="journal-export-${user.id}.json"`);
        res.json({
            exportDate: new Date().toISOString(),
            format: 'KelionAI Journal Export',
            userId: user.id,
            entries: data || []
        });
    } catch (e) {
        logger.error({ component: 'Journal', err: e.message }, 'GET /api/journal/export');
        res.status(500).json({ error: 'Eroare export jurnal' });
    }
});

// ═══ POST /api/journal — create/update today's entry ═══
router.post('/', journalLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const { moodScore, bestMoment, improvements, goals, freeText, tags, entryDate } = req.body;

        if (moodScore !== undefined && (moodScore < 1 || moodScore > 5)) {
            return res.status(400).json({ error: 'mood_score trebuie să fie între 1 și 5' });
        }

        const date = entryDate || new Date().toISOString().slice(0, 10);

        const record = {
            user_id: user.id,
            entry_date: date,
            mood_score: moodScore || null,
            best_moment: bestMoment || null,
            improvements: improvements || null,
            goals: goals || null,
            free_text: freeText || null,
            tags: tags || null
        };

        const { data, error } = await supabaseAdmin
            .from('journal_entries')
            .upsert(record, { onConflict: 'user_id,entry_date' })
            .select()
            .single();

        if (error) throw error;

        logger.info({ component: 'Journal', userId: user.id }, `Journal entry saved for ${date}`);
        res.json({ entry: data });
    } catch (e) {
        logger.error({ component: 'Journal', err: e.message }, 'POST /api/journal');
        res.status(500).json({ error: 'Eroare salvare intrare jurnal' });
    }
});

// ═══ DELETE /api/journal/:id — delete entry ═══
router.delete('/:id', journalLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const { error } = await supabaseAdmin
            .from('journal_entries')
            .delete()
            .eq('id', req.params.id)
            .eq('user_id', user.id);

        if (error) throw error;

        res.json({ success: true });
    } catch (e) {
        logger.error({ component: 'Journal', err: e.message }, 'DELETE /api/journal/:id');
        res.status(500).json({ error: 'Eroare ștergere intrare jurnal' });
    }
});

module.exports = router;
