// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — Events & Journal Routers
// Birthday/Anniversary/Reminder tracker + Daily journal
// ═══════════════════════════════════════════════════════════════
'use strict';
const express = require('express');
const { randomUUID } = require('crypto');
const logger = require('./logger');
const rateLimit = require('express-rate-limit');

const eventsLimiter = rateLimit({ windowMs: 60 * 1000, max: 30, message: { error: 'Prea multe cereri.' }, standardHeaders: true, legacyHeaders: false });
const journalLimiter = eventsLimiter;

// ═══ EVENTS ROUTER ═══
const eventsRouter = express.Router();

// POST /api/events — save a new event
eventsRouter.post('/', eventsLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });

        const { name, date, type, notes } = req.body;
        if (!name || !date) return res.status(400).json({ error: 'name și date sunt obligatorii' });
        const validTypes = ['birthday', 'anniversary', 'reminder'];
        if (type && !validTypes.includes(type)) return res.status(400).json({ error: 'Tip invalid. Folosiți: birthday, anniversary, reminder' });

        const id = randomUUID();
        const eventData = { id, name, date, type: type || 'reminder', notes: notes || '' };
        const key = 'event_' + id;

        if (supabaseAdmin) {
            const { error } = await supabaseAdmin
                .from('user_preferences')
                .insert({ user_id: user.id, key, value: eventData });
            if (error) {
                logger.error({ component: 'Events', err: error.message }, 'Failed to save event');
                return res.status(500).json({ error: 'Eroare salvare eveniment' });
            }
        }

        logger.info({ component: 'Events', userId: user.id, eventId: id }, 'Event saved');
        res.json({ success: true, event: eventData });
    } catch (e) {
        logger.error({ component: 'Events', err: e.message }, 'POST /api/events error');
        res.status(500).json({ error: 'Eroare server' });
    }
});

// GET /api/events/upcoming — events within next 7 days
eventsRouter.get('/upcoming', eventsLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });

        if (!supabaseAdmin) return res.json({ events: [] });

        const { data, error } = await supabaseAdmin
            .from('user_preferences')
            .select('value')
            .eq('user_id', user.id)
            .like('key', 'event_%');

        if (error) {
            logger.error({ component: 'Events', err: error.message }, 'Failed to fetch events');
            return res.status(500).json({ error: 'Eroare preluare evenimente' });
        }

        const now = new Date();
        const inSevenDays = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
        const currentYear = now.getFullYear();

        const upcoming = (data || [])
            .map(row => row.value)
            .filter(ev => {
                if (!ev || !ev.date) return false;
                try {
                    // Normalize date: treat as recurring yearly (month-day match)
                    const parts = ev.date.split('-');
                    if (parts.length < 2) return false;
                    const month = parseInt(parts[parts.length - 2], 10) - 1;
                    const day = parseInt(parts[parts.length - 1], 10);
                    let eventDate = new Date(currentYear, month, day);
                    // If this year's date has already passed, check next year
                    if (eventDate < now) eventDate = new Date(currentYear + 1, month, day);
                    return eventDate >= now && eventDate <= inSevenDays;
                } catch (err) {
                    return false;
                }
            });

        res.json({ events: upcoming });
    } catch (e) {
        logger.error({ component: 'Events', err: e.message }, 'GET /api/events/upcoming error');
        res.status(500).json({ error: 'Eroare server' });
    }
});

// GET /api/events — list all user events
eventsRouter.get('/', eventsLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });

        if (!supabaseAdmin) return res.json({ events: [] });

        const { data, error } = await supabaseAdmin
            .from('user_preferences')
            .select('value')
            .eq('user_id', user.id)
            .like('key', 'event_%');

        if (error) {
            logger.error({ component: 'Events', err: error.message }, 'Failed to list events');
            return res.status(500).json({ error: 'Eroare preluare evenimente' });
        }

        const events = (data || []).map(row => row.value).filter(Boolean);
        res.json({ events });
    } catch (e) {
        logger.error({ component: 'Events', err: e.message }, 'GET /api/events error');
        res.status(500).json({ error: 'Eroare server' });
    }
});

// DELETE /api/events/:id — delete an event
eventsRouter.delete('/:id', eventsLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });

        const key = 'event_' + req.params.id;

        if (supabaseAdmin) {
            const { error } = await supabaseAdmin
                .from('user_preferences')
                .delete()
                .eq('user_id', user.id)
                .eq('key', key);

            if (error) {
                logger.error({ component: 'Events', err: error.message }, 'Failed to delete event');
                return res.status(500).json({ error: 'Eroare ștergere eveniment' });
            }
        }

        logger.info({ component: 'Events', userId: user.id, eventId: req.params.id }, 'Event deleted');
        res.json({ success: true });
    } catch (e) {
        logger.error({ component: 'Events', err: e.message }, 'DELETE /api/events/:id error');
        res.status(500).json({ error: 'Eroare server' });
    }
});

// ═══ JOURNAL ROUTER ═══
const journalRouter = express.Router();

// POST /api/journal — save journal entry (upsert by user_id + date)
journalRouter.post('/', journalLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });

        const { rating, best_moment, improvement, goals, mood } = req.body;
        if (rating !== undefined && (typeof rating !== 'number' || rating < 1 || rating > 5)) {
            return res.status(400).json({ error: 'rating trebuie să fie între 1 și 5' });
        }

        const today = new Date().toISOString().split('T')[0];
        const entry = { user_id: user.id, date: today, rating: rating || null, best_moment: best_moment || null, improvement: improvement || null, goals: goals || null, mood: mood || 'neutral' };

        if (!supabaseAdmin) return res.json({ success: true, entry });

        const { data, error } = await supabaseAdmin
            .from('journal_entries')
            .upsert(entry, { onConflict: 'user_id,date' })
            .select()
            .single();

        if (error) {
            logger.error({ component: 'Journal', err: error.message }, 'Failed to save journal entry');
            return res.status(500).json({ error: 'Eroare salvare jurnal' });
        }

        logger.info({ component: 'Journal', userId: user.id, date: today }, 'Journal entry saved');
        res.json({ success: true, entry: data });
    } catch (e) {
        logger.error({ component: 'Journal', err: e.message }, 'POST /api/journal error');
        res.status(500).json({ error: 'Eroare server' });
    }
});

// GET /api/journal/mood — mood trend data for chart
journalRouter.get('/mood', journalLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });

        if (!supabaseAdmin) return res.json({ dates: [], ratings: [], moods: [] });

        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const { data, error } = await supabaseAdmin
            .from('journal_entries')
            .select('date, rating, mood')
            .eq('user_id', user.id)
            .gte('date', since)
            .order('date', { ascending: true });

        if (error) {
            logger.error({ component: 'Journal', err: error.message }, 'Failed to fetch mood data');
            return res.status(500).json({ error: 'Eroare preluare date stare' });
        }

        const entries = data || [];
        res.json({
            dates: entries.map(e => e.date),
            ratings: entries.map(e => e.rating),
            moods: entries.map(e => e.mood)
        });
    } catch (e) {
        logger.error({ component: 'Journal', err: e.message }, 'GET /api/journal/mood error');
        res.status(500).json({ error: 'Eroare server' });
    }
});

// GET /api/journal — list last 30 days of entries
journalRouter.get('/', journalLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });

        if (!supabaseAdmin) return res.json({ entries: [] });

        const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
        const { data, error } = await supabaseAdmin
            .from('journal_entries')
            .select('id, date, rating, best_moment, improvement, goals, mood, created_at')
            .eq('user_id', user.id)
            .gte('date', since)
            .order('date', { ascending: false });

        if (error) {
            logger.error({ component: 'Journal', err: error.message }, 'Failed to list journal entries');
            return res.status(500).json({ error: 'Eroare preluare jurnal' });
        }

        res.json({ entries: data || [] });
    } catch (e) {
        logger.error({ component: 'Journal', err: e.message }, 'GET /api/journal error');
        res.status(500).json({ error: 'Eroare server' });
    }
});

module.exports = { eventsRouter, journalRouter };
