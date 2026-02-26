// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — EVENTS & BIRTHDAYS TRACKER
// Memorizes dates, advance reminders, gift suggestions
// ═══════════════════════════════════════════════════════════════
'use strict';
const express = require('express');
const logger = require('./logger');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const MS_PER_DAY = 86400000;

const eventsLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { error: 'Prea multe cereri events. Așteaptă un minut.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Gift suggestions by category
const GIFT_SUGGESTIONS = {
    birthday: ['flowers', 'book', 'dinner', 'spa voucher', 'personalized gift'],
    anniversary: ['romantic dinner', 'weekend getaway', 'jewelry', 'photo album', 'experience voucher'],
    reminder: [],
    other: ['gift card', 'flowers', 'chocolate']
};

/**
 * Compute days until next occurrence of an event.
 * If year_repeats is true, find the next upcoming anniversary of the date.
 * Returns negative if the event was in the past (non-repeating).
 */
function daysUntil(eventDate, yearRepeats) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const ev = new Date(eventDate);
    if (yearRepeats) {
        // Use this year's occurrence; if already passed, use next year
        const thisYear = new Date(today.getFullYear(), ev.getMonth(), ev.getDate());
        if (thisYear >= today) return Math.round((thisYear - today) / MS_PER_DAY);
        const nextYear = new Date(today.getFullYear() + 1, ev.getMonth(), ev.getDate());
        return Math.round((nextYear - today) / MS_PER_DAY);
    }
    return Math.round((ev - today) / MS_PER_DAY);
}

// ═══ GET /api/events — list user's events (upcoming first) ═══
router.get('/', eventsLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const { data, error } = await supabaseAdmin
            .from('user_events')
            .select('*')
            .eq('user_id', user.id)
            .order('event_date', { ascending: true });

        if (error) throw error;

        const events = (data || []).map(e => ({
            id: e.id,
            title: e.title,
            eventDate: e.event_date,
            yearRepeats: e.year_repeats,
            category: e.category,
            personName: e.person_name,
            notes: e.notes,
            reminderDays: e.reminder_days,
            daysUntil: daysUntil(e.event_date, e.year_repeats),
            createdAt: e.created_at
        }));

        // Sort by daysUntil ascending (upcoming first), negatives (past) at end
        events.sort((a, b) => {
            if (a.daysUntil < 0 && b.daysUntil >= 0) return 1;
            if (a.daysUntil >= 0 && b.daysUntil < 0) return -1;
            return a.daysUntil - b.daysUntil;
        });

        res.json({ events });
    } catch (e) {
        logger.error({ component: 'Events', err: e.message }, 'GET /api/events');
        res.status(500).json({ error: 'Eroare citire evenimente' });
    }
});

// ═══ GET /api/events/upcoming — events in next 30 days with countdown ═══
router.get('/upcoming', eventsLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const { data, error } = await supabaseAdmin
            .from('user_events')
            .select('*')
            .eq('user_id', user.id);

        if (error) throw error;

        const upcoming = (data || [])
            .map(e => {
                const days = daysUntil(e.event_date, e.year_repeats);
                return { e, days };
            })
            .filter(({ days }) => days >= 0 && days <= 30)
            .sort((a, b) => a.days - b.days)
            .map(({ e, days }) => {
                // Apply proper possessive for names ending in 's'
                const possessive = e.person_name
                    ? e.person_name + (e.person_name.endsWith('s') ? "' " : "'s ") : '';
                return {
                    id: e.id,
                    title: e.title,
                    eventDate: e.event_date,
                    daysUntil: days,
                    category: e.category,
                    personName: e.person_name,
                    giftSuggestions: GIFT_SUGGESTIONS[e.category] || GIFT_SUGGESTIONS.other,
                    reminder: `${days === 0 ? '🎉' : '🎂'} ${possessive}${e.title}${days === 0 ? ' is TODAY!' : ` in ${days} day${days === 1 ? '' : 's'}!`}`
                };
            });

        res.json({ upcoming });
    } catch (e) {
        logger.error({ component: 'Events', err: e.message }, 'GET /api/events/upcoming');
        res.status(500).json({ error: 'Eroare citire upcoming events' });
    }
});

// ═══ GET /api/events/today — events happening today ═══
router.get('/today', eventsLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const { data, error } = await supabaseAdmin
            .from('user_events')
            .select('*')
            .eq('user_id', user.id);

        if (error) throw error;

        const today = (data || []).filter(e => daysUntil(e.event_date, e.year_repeats) === 0)
            .map(e => ({
                id: e.id,
                title: e.title,
                eventDate: e.event_date,
                category: e.category,
                personName: e.person_name,
                daysUntil: 0
            }));

        res.json({ today });
    } catch (e) {
        logger.error({ component: 'Events', err: e.message }, 'GET /api/events/today');
        res.status(500).json({ error: 'Eroare citire today events' });
    }
});

// ═══ POST /api/events — add new event ═══
router.post('/', eventsLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const { title, eventDate, yearRepeats = true, category = 'birthday', personName, notes, reminderDays = 3 } = req.body;
        if (!title || !eventDate) return res.status(400).json({ error: 'title și eventDate sunt obligatorii' });

        const validCategories = ['birthday', 'anniversary', 'reminder', 'other'];
        if (!validCategories.includes(category)) {
            return res.status(400).json({ error: `Categorie validă: ${validCategories.join(', ')}` });
        }

        const { data, error } = await supabaseAdmin
            .from('user_events')
            .insert({
                user_id: user.id,
                title,
                event_date: eventDate,
                year_repeats: yearRepeats,
                category,
                person_name: personName || null,
                notes: notes || null,
                reminder_days: reminderDays
            })
            .select()
            .single();

        if (error) throw error;

        logger.info({ component: 'Events', userId: user.id }, `Event added: ${title}`);
        res.status(201).json({
            event: {
                id: data.id,
                title: data.title,
                eventDate: data.event_date,
                yearRepeats: data.year_repeats,
                category: data.category,
                personName: data.person_name,
                notes: data.notes,
                reminderDays: data.reminder_days,
                daysUntil: daysUntil(data.event_date, data.year_repeats),
                createdAt: data.created_at
            }
        });
    } catch (e) {
        logger.error({ component: 'Events', err: e.message }, 'POST /api/events');
        res.status(500).json({ error: 'Eroare creare eveniment' });
    }
});

// ═══ PUT /api/events/:id — update event ═══
router.put('/:id', eventsLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const { title, eventDate, yearRepeats, category, personName, notes, reminderDays } = req.body;

        const updates = {};
        if (title !== undefined) updates.title = title;
        if (eventDate !== undefined) updates.event_date = eventDate;
        if (yearRepeats !== undefined) updates.year_repeats = yearRepeats;
        if (category !== undefined) {
            const validCategories = ['birthday', 'anniversary', 'reminder', 'other'];
            if (!validCategories.includes(category)) {
                return res.status(400).json({ error: `Categorie validă: ${validCategories.join(', ')}` });
            }
            updates.category = category;
        }
        if (personName !== undefined) updates.person_name = personName;
        if (notes !== undefined) updates.notes = notes;
        if (reminderDays !== undefined) updates.reminder_days = reminderDays;

        const { data, error } = await supabaseAdmin
            .from('user_events')
            .update(updates)
            .eq('id', req.params.id)
            .eq('user_id', user.id)
            .select()
            .single();

        if (error) {
            if (error.code === 'PGRST116') return res.status(404).json({ error: 'Eveniment negăsit' });
            throw error;
        }

        res.json({
            event: {
                id: data.id,
                title: data.title,
                eventDate: data.event_date,
                yearRepeats: data.year_repeats,
                category: data.category,
                personName: data.person_name,
                notes: data.notes,
                reminderDays: data.reminder_days,
                daysUntil: daysUntil(data.event_date, data.year_repeats),
                createdAt: data.created_at
            }
        });
    } catch (e) {
        logger.error({ component: 'Events', err: e.message }, 'PUT /api/events/:id');
        res.status(500).json({ error: 'Eroare actualizare eveniment' });
    }
});

// ═══ DELETE /api/events/:id — delete event ═══
router.delete('/:id', eventsLimiter, async (req, res) => {
    try {
        const { getUserFromToken, supabaseAdmin } = req.app.locals;
        const user = await getUserFromToken(req);
        if (!user) return res.status(401).json({ error: 'Neautentificat' });
        if (!supabaseAdmin) return res.status(503).json({ error: 'DB indisponibil' });

        const { error } = await supabaseAdmin
            .from('user_events')
            .delete()
            .eq('id', req.params.id)
            .eq('user_id', user.id);

        if (error) throw error;

        res.json({ success: true });
    } catch (e) {
        logger.error({ component: 'Events', err: e.message }, 'DELETE /api/events/:id');
        res.status(500).json({ error: 'Eroare ștergere eveniment' });
    }
});

module.exports = { router, daysUntil, GIFT_SUGGESTIONS };
