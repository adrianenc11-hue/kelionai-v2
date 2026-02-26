// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — EVENTS (Birthday & Events Tracker)
// Routes: GET/POST /api/events, PUT/DELETE /api/events/:id,
//         GET /api/events/upcoming, GET /api/events/today
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

// ═══ UPCOMING LOGIC ═══
// Compute daysUntil for an event (supports recurring or one-time YYYY-MM-DD)
function computeDaysUntil(eventDateStr, recurring) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    if (recurring) {
        // eventDateStr is YYYY-MM-DD — extract MM-DD portion safely
        const mmdd = String(eventDateStr).slice(-5).split('-');
        if (mmdd.length !== 2) return Infinity;
        const month = parseInt(mmdd[0], 10) - 1; // 0-indexed
        const day = parseInt(mmdd[1], 10);
        let next = new Date(today.getFullYear(), month, day);
        if (next < today) {
            next = new Date(today.getFullYear() + 1, month, day);
        }
        return Math.round((next - today) / 86400000);
    }

    // One-time
    const [y, m, d] = String(eventDateStr).split('-').map(Number);
    const target = new Date(y, m - 1, d);
    return Math.round((target - today) / 86400000);
}

// ═══ GET /api/events — list user's events ═══
router.get('/', async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const supabaseAdmin = req.app.locals.supabaseAdmin;
        const { data, error } = await supabaseAdmin
            .from('events')
            .select('*')
            .eq('user_id', user.id)
            .order('event_date', { ascending: true });
        if (error) throw error;
        res.json({ events: data || [] });
    } catch (e) {
        logger.error({ component: 'Events', err: e.message }, 'GET /events error');
        res.status(500).json({ error: 'Eroare la listarea evenimentelor' });
    }
});

// ═══ POST /api/events — add event ═══
router.post('/', async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const { title, event_date, type, recurring, notes, reminder_days } = req.body;
        if (!title || !event_date) {
            return res.status(400).json({ error: 'title și event_date sunt obligatorii' });
        }
        const supabaseAdmin = req.app.locals.supabaseAdmin;
        const { data, error } = await supabaseAdmin
            .from('events')
            .insert({
                user_id: user.id,
                title,
                event_date,
                type: type || 'birthday',
                recurring: recurring !== false,
                notes: notes || null,
                reminder_days: reminder_days != null ? reminder_days : 3
            })
            .select()
            .single();
        if (error) throw error;

        // Store upcoming events context in user_preferences for brain injection
        await _refreshUpcomingContext(user.id, supabaseAdmin);

        logger.info({ component: 'Events', userId: user.id }, 'Event created: ' + title);
        res.status(201).json({ event: data });
    } catch (e) {
        logger.error({ component: 'Events', err: e.message }, 'POST /events error');
        res.status(500).json({ error: 'Eroare la adăugarea evenimentului' });
    }
});

// ═══ PUT /api/events/:id — update event ═══
router.put('/:id', async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const { id } = req.params;
        const { title, event_date, type, recurring, notes, reminder_days } = req.body;
        const supabaseAdmin = req.app.locals.supabaseAdmin;
        const updates = {};
        if (title !== undefined) updates.title = title;
        if (event_date !== undefined) updates.event_date = event_date;
        if (type !== undefined) updates.type = type;
        if (recurring !== undefined) updates.recurring = recurring;
        if (notes !== undefined) updates.notes = notes;
        if (reminder_days !== undefined) updates.reminder_days = reminder_days;

        const { data, error } = await supabaseAdmin
            .from('events')
            .update(updates)
            .eq('id', id)
            .eq('user_id', user.id)
            .select()
            .single();
        if (error) throw error;
        if (!data) return res.status(404).json({ error: 'Eveniment negăsit' });

        await _refreshUpcomingContext(user.id, supabaseAdmin);

        res.json({ event: data });
    } catch (e) {
        logger.error({ component: 'Events', err: e.message }, 'PUT /events/:id error');
        res.status(500).json({ error: 'Eroare la actualizarea evenimentului' });
    }
});

// ═══ DELETE /api/events/:id — delete event ═══
router.delete('/:id', async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const { id } = req.params;
        const supabaseAdmin = req.app.locals.supabaseAdmin;
        const { error } = await supabaseAdmin
            .from('events')
            .delete()
            .eq('id', id)
            .eq('user_id', user.id);
        if (error) throw error;

        await _refreshUpcomingContext(user.id, supabaseAdmin);

        res.json({ success: true });
    } catch (e) {
        logger.error({ component: 'Events', err: e.message }, 'DELETE /events/:id error');
        res.status(500).json({ error: 'Eroare la ștergerea evenimentului' });
    }
});

// ═══ GET /api/events/upcoming — events in next 30 days ═══
router.get('/upcoming', async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const supabaseAdmin = req.app.locals.supabaseAdmin;
        const { data, error } = await supabaseAdmin
            .from('events')
            .select('*')
            .eq('user_id', user.id);
        if (error) throw error;

        const upcoming = (data || [])
            .map(ev => ({ ...ev, daysUntil: computeDaysUntil(ev.event_date, ev.recurring) }))
            .filter(ev => ev.daysUntil >= 0 && ev.daysUntil <= 30)
            .sort((a, b) => a.daysUntil - b.daysUntil)
            .map(ev => ({
                id: ev.id,
                title: ev.title,
                type: ev.type,
                daysUntil: ev.daysUntil,
                eventDate: ev.event_date,
                notes: ev.notes,
                giftSuggestion: null
            }));

        res.json({ upcoming });
    } catch (e) {
        logger.error({ component: 'Events', err: e.message }, 'GET /events/upcoming error');
        res.status(500).json({ error: 'Eroare la listarea evenimentelor viitoare' });
    }
});

// ═══ GET /api/events/today — events today or within reminder_days ═══
router.get('/today', async (req, res) => {
    try {
        const user = await requireUser(req, res);
        if (!user) return;
        const supabaseAdmin = req.app.locals.supabaseAdmin;
        const { data, error } = await supabaseAdmin
            .from('events')
            .select('*')
            .eq('user_id', user.id);
        if (error) throw error;

        const today = (data || [])
            .map(ev => ({ ...ev, daysUntil: computeDaysUntil(ev.event_date, ev.recurring) }))
            .filter(ev => ev.daysUntil >= 0 && ev.daysUntil <= ev.reminder_days)
            .sort((a, b) => a.daysUntil - b.daysUntil)
            .map(ev => ({
                id: ev.id,
                title: ev.title,
                type: ev.type,
                daysUntil: ev.daysUntil,
                eventDate: ev.event_date,
                notes: ev.notes,
                giftSuggestion: null
            }));

        res.json({ today });
    } catch (e) {
        logger.error({ component: 'Events', err: e.message }, 'GET /events/today error');
        res.status(500).json({ error: 'Eroare la listarea evenimentelor de azi' });
    }
});

// ═══ BRAIN CONTEXT HELPER ═══
// Store upcoming events in user_preferences for brain injection
async function _refreshUpcomingContext(userId, supabaseAdmin) {
    try {
        const { data } = await supabaseAdmin
            .from('events')
            .select('*')
            .eq('user_id', userId);
        if (!data) return;

        const upcoming = data
            .map(ev => ({ ...ev, daysUntil: computeDaysUntil(ev.event_date, ev.recurring) }))
            .filter(ev => ev.daysUntil >= 0 && ev.daysUntil <= 30)
            .sort((a, b) => a.daysUntil - b.daysUntil)
            .map(ev => ({ title: ev.title, type: ev.type, daysUntil: ev.daysUntil, notes: ev.notes }));

        await supabaseAdmin
            .from('user_preferences')
            .upsert({ user_id: userId, key: 'upcoming_events', value: upcoming, updated_at: new Date().toISOString() },
                { onConflict: 'user_id,key' });
    } catch (e) {
        logger.warn({ component: 'Events', err: e.message }, 'Failed to refresh upcoming_events context');
    }
}

module.exports = router;
