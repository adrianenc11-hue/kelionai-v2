// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — EVENTS & BIRTHDAYS UI
// Client-side module: add/view events via chat triggers
// window.KEvents = { init, addEvent, listUpcoming }
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    function getAuthHeader() {
        try {
            const session = JSON.parse(localStorage.getItem('kelion_session') || 'null');
            return session && session.access_token ? { 'Authorization': 'Bearer ' + session.access_token } : {};
        } catch (e) {
            return {};
        }
    }

    async function apiRequest(method, path, body) {
        const opts = {
            method,
            headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeader())
        };
        if (body) opts.body = JSON.stringify(body);
        const res = await fetch('/api/events' + path, opts);
        return res.json();
    }

    // ── Add an event (called from chat parsing or UI) ──
    async function addEvent(eventData) {
        return apiRequest('POST', '/', eventData);
    }

    // ── List upcoming events (next 30 days) ──
    async function listUpcoming() {
        return apiRequest('GET', '/upcoming');
    }

    // ── List all events ──
    async function listAll() {
        return apiRequest('GET', '/');
    }

    // ── Delete event ──
    async function deleteEvent(id) {
        return apiRequest('DELETE', '/' + id);
    }

    // ── Render upcoming events on the monitor panel ──
    async function showUpcomingOnMonitor() {
        const monitorText = document.getElementById('monitor-text');
        if (!monitorText) return;

        try {
            const data = await listUpcoming();
            const upcoming = data.upcoming || [];

            let html = '<div style="padding:16px;color:#e0e0e0">';
            html += '<h3 style="color:#00ffff;margin-bottom:12px">📅 Upcoming Events</h3>';

            if (upcoming.length === 0) {
                html += '<p style="color:#888">No events in the next 30 days.</p>';
            } else {
                upcoming.forEach(ev => {
                    const colorMap = { birthday: '#ff88cc', anniversary: '#ffaa44', reminder: '#88ccff', other: '#aaaaaa' };
                    const color = colorMap[ev.category] || '#aaaaaa';
                    html += `<div style="border-left:3px solid ${color};padding:8px 12px;margin-bottom:8px;background:rgba(255,255,255,0.04);border-radius:4px">`;
                    html += `<div style="font-weight:bold;color:${color}">${ev.reminder}</div>`;
                    if (ev.giftSuggestions && ev.giftSuggestions.length) {
                        html += `<div style="font-size:0.8rem;color:#888;margin-top:4px">🎁 ${ev.giftSuggestions.slice(0, 3).join(', ')}</div>`;
                    }
                    html += '</div>';
                });
            }
            html += '</div>';

            monitorText.innerHTML = html;
            ['monitor-image', 'monitor-map', 'monitor-search', 'monitor-weather', 'monitor-default'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.style.display = 'none';
            });
            monitorText.style.display = 'block';

            const titleEl = document.getElementById('display-title');
            if (titleEl) titleEl.textContent = 'Events';
        } catch (e) {
            console.warn('[Events] showUpcomingOnMonitor error:', e);
        }
    }

    // ── Parse "remember that X's birthday is DATE" from user message ──
    function parseBirthdayTrigger(message) {
        const patterns = [
            /remember\s+that\s+(.+?)(?:'s|s')\s+birthday\s+is\s+(.+)/i,
            /(.+?)(?:'s|s')\s+birthday\s+is\s+(?:on\s+)?(.+)/i,
            /add\s+birthday\s+(?:for\s+)?(.+?)\s+(?:on\s+)?(.+)/i
        ];
        for (const re of patterns) {
            const m = message.match(re);
            if (m) return { personName: m[1].trim(), dateStr: m[2].trim() };
        }
        return null;
    }

    // ── Process chat message: detect event triggers ──
    async function processChatMessage(message) {
        const parsed = parseBirthdayTrigger(message);
        if (!parsed) return false;

        // Try to parse date
        const date = new Date(parsed.dateStr);
        if (isNaN(date.getTime())) return false;

        const eventDate = date.toISOString().slice(0, 10);
        try {
            await addEvent({
                title: `${parsed.personName}'s Birthday`,
                eventDate,
                category: 'birthday',
                personName: parsed.personName,
                yearRepeats: true,
                reminderDays: 3
            });
            return true;
        } catch (e) {
            console.warn('[Events] processChatMessage error:', e);
            return false;
        }
    }

    // ── Detect "show events" / "my events" triggers in chat ──
    function isShowEventsTrigger(message) {
        return /\b(show\s+(my\s+)?(events|birthdays|reminders)|upcoming\s+events|my\s+events)\b/i.test(message);
    }

    // ── Init ──
    function init() {
        // Hook into outgoing chat messages if app.js exposes a hook
        if (window.KelionApp && typeof window.KelionApp.onBeforeChat === 'function') {
            window.KelionApp.onBeforeChat(async (message) => {
                if (isShowEventsTrigger(message)) {
                    await showUpcomingOnMonitor();
                }
                await processChatMessage(message);
            });
        }
    }

    window.KEvents = { init, addEvent, listUpcoming, listAll, deleteEvent, showUpcomingOnMonitor, processChatMessage };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
