// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — EVENTS (Birthday & Events Tracker)
// Routes: GET/POST /api/events, PUT/DELETE /api/events/:id
//         GET /api/events/upcoming, GET /api/events/today
// ═══════════════════════════════════════════════════════════════
'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const logger = require('./logger');
const { validate, eventSchema } = require('./validation');

const router = express.Router();

const eventsLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 60,
    message: { error: 'Prea multe cereri events. Așteaptă un minut.' },
    standardHeaders: true,
    legacyHeaders: false,
});
router.use(eventsLimiter);

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Given an event date string (YYYY-MM-DD) and whether it recurs yearly,
 * return the next occurrence date (as Date) and days until it.
 */
function nextOccurrence(dateStr, recurring) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [year, month, day] = dateStr.split('-').map(Number);

    if (!recurring) {
        const d = new Date(year, month - 1, day);
        const diff = Math.round((d - today) / 86400000);
        return { next: d, daysUntil: diff };
    }

    // recurring: find next occurrence this year or next year
    let next = new Date(today.getFullYear(), month - 1, day);
    if (next < today) {
        next = new Date(today.getFullYear() + 1, month - 1, day);
    }
    const daysUntil = Math.round((next - today) / 86400000);
    return { next, daysUntil };
}

/**
 * Compute age for birthday events when year is present in date string.
 * Returns null for non-birthday events or when year is not informative.
 */
function computeAge(dateStr, type, nextYear) {
    if (type !== 'birthday') return null;
    const birthYear = parseInt(dateStr.split('-')[0], 10);
    if (!birthYear || birthYear < 1900 || birthYear > new Date().getFullYear()) return null;
    return nextYear - birthYear;
}

// ── Routes ───────────────────────────────────────────────────────

// GET /api/events — list all user events sorted by next occurrence
router.get('/', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const { data, error } = await supabaseAdmin
            .from('events')
            .select('*')
            .eq('user_id', user.id)
            .order('date', { ascending: true });

        if (error) throw error;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const enriched = (data || []).map(ev => {
            const { next, daysUntil } = nextOccurrence(ev.date, ev.recurring);
            const age = computeAge(ev.date, ev.type, next.getFullYear());
            return { ...ev, daysUntil, nextDate: next.toISOString().split('T')[0], ...(age !== null ? { age } : {}) };
        }).sort((a, b) => a.daysUntil - b.daysUntil);

        res.json({ events: enriched });
    } catch (e) {
        logger.error({ component: 'Events', err: e.message }, 'list events');
        res.status(500).json({ error: 'Eroare la listarea evenimentelor' });
    }
});

// GET /api/events/upcoming — events in next 7 days
router.get('/upcoming', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const { data, error } = await supabaseAdmin
            .from('events')
            .select('*')
            .eq('user_id', user.id);

        if (error) throw error;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const upcoming = (data || [])
            .map(ev => {
                const { next, daysUntil } = nextOccurrence(ev.date, ev.recurring);
                const age = computeAge(ev.date, ev.type, next.getFullYear());
                return { ...ev, daysUntil, nextDate: next.toISOString().split('T')[0], ...(age !== null ? { age } : {}) };
            })
            .filter(ev => ev.daysUntil >= 0 && ev.daysUntil <= 7)
            .sort((a, b) => a.daysUntil - b.daysUntil);

        res.json({ events: upcoming });
    } catch (e) {
        logger.error({ component: 'Events', err: e.message }, 'upcoming events');
        res.status(500).json({ error: 'Eroare la evenimentele viitoare' });
    }
});

// GET /api/events/today — events happening today
router.get('/today', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const { data, error } = await supabaseAdmin
            .from('events')
            .select('*')
            .eq('user_id', user.id);

        if (error) throw error;

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const todayEvents = (data || [])
            .map(ev => {
                const { next, daysUntil } = nextOccurrence(ev.date, ev.recurring);
                const age = computeAge(ev.date, ev.type, next.getFullYear());
                return { ...ev, daysUntil, nextDate: next.toISOString().split('T')[0], ...(age !== null ? { age } : {}) };
            })
            .filter(ev => ev.daysUntil === 0);

        res.json({ events: todayEvents });
    } catch (e) {
        logger.error({ component: 'Events', err: e.message }, 'today events');
        res.status(500).json({ error: 'Eroare la evenimentele de azi' });
    }
});

// POST /api/events — create event
router.post('/', validate(eventSchema), async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const { title, type, date, recurring, notes, remind_days_before } = req.body;

        const { data, error } = await supabaseAdmin
            .from('events')
            .insert({ user_id: user.id, title, type, date, recurring, notes, remind_days_before })
            .select()
            .single();

        if (error) throw error;

        logger.info({ component: 'Events', userId: user.id }, `Event created: ${title}`);
        res.status(201).json({ event: data });
    } catch (e) {
        logger.error({ component: 'Events', err: e.message }, 'create event');
        res.status(500).json({ error: 'Eroare la crearea evenimentului' });
    }
});

// PUT /api/events/:id — update event
router.put('/:id', validate(eventSchema), async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const { id } = req.params;
        const { title, type, date, recurring, notes, remind_days_before } = req.body;

        const { data, error } = await supabaseAdmin
            .from('events')
            .update({ title, type, date, recurring, notes, remind_days_before })
            .eq('id', id)
            .eq('user_id', user.id)
            .select()
            .single();

        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Eveniment negăsit' });

        res.json({ event: data });
    } catch (e) {
        logger.error({ component: 'Events', err: e.message }, 'update event');
        res.status(500).json({ error: 'Eroare la actualizarea evenimentului' });
    }
});

// DELETE /api/events/:id — delete event
router.delete('/:id', async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const { id } = req.params;

        const { error, count } = await supabaseAdmin
            .from('events')
            .delete({ count: 'exact' })
            .eq('id', id)
            .eq('user_id', user.id);

        if (error) throw error;
        if (count === 0) return res.status(404).json({ error: 'Eveniment negăsit' });

        res.json({ success: true });
    } catch (e) {
        logger.error({ component: 'Events', err: e.message }, 'delete event');
        res.status(500).json({ error: 'Eroare la ștergerea evenimentului' });
    }
});

module.exports = router;
