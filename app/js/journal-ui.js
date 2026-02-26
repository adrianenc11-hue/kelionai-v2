// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — DAILY JOURNAL UI
// Guided daily reflection with mood chart
// Triggers: "kelion, open journal" / "daily reflection" / "jurnal"
// window.KJournal = { init, open, close }
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const MOOD_COLORS = { 1: '#ff4444', 2: '#ff8844', 3: '#ffcc00', 4: '#88dd44', 5: '#00cc66' };

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
        const res = await fetch('/api/journal' + path, opts);
        return res.json();
    }

    // ── Draw mood bar chart on canvas ──
    function drawChart(canvas, weeks) {
        const ctx = canvas.getContext('2d');
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        if (!weeks || weeks.length === 0) {
            ctx.fillStyle = '#888';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('No data yet', w / 2, h / 2);
            return;
        }

        const last7 = weeks.slice(-7);
        const barW = Math.floor((w - 40) / last7.length) - 4;
        const maxMood = 5;

        last7.forEach((wk, i) => {
            const barH = Math.round(((wk.avgMood || 0) / maxMood) * (h - 30));
            const x = 20 + i * (barW + 4);
            const y = h - 20 - barH;
            const score = Math.round(wk.avgMood || 0);
            ctx.fillStyle = MOOD_COLORS[score] || '#888';
            ctx.fillRect(x, y, barW, barH);

            // Label
            ctx.fillStyle = '#aaa';
            ctx.font = '9px sans-serif';
            ctx.textAlign = 'center';
            // Strip the year part (e.g. "2025-W01" → "W01") for cleaner bar chart labels
            const label = wk.week ? wk.week.replace(/^\d{4}-/, '') : '';
            ctx.fillText(label, x + barW / 2, h - 6);
        });
    }

    // ── Load and render chart from trends API ──
    async function loadChart() {
        const canvas = document.getElementById('journal-chart');
        if (!canvas) return;
        try {
            const data = await apiRequest('GET', '/trends');
            drawChart(canvas, data.weeks || []);
            // Update streak/overall info if element exists
            const infoEl = document.getElementById('journal-overall');
            if (infoEl && data.overall) {
                const { avgMood, totalEntries, streak } = data.overall;
                infoEl.textContent = `⚡ ${streak} day streak | avg mood: ${avgMood || '—'} | ${totalEntries} entries`;
            }
        } catch (e) {
            console.warn('[Journal] loadChart error:', e);
        }
    }

    // ── Load today's entry into form ──
    async function loadTodayEntry() {
        try {
            const data = await apiRequest('GET', '/today');
            if (!data.entry) return;
            const e = data.entry;
            if (e.mood_score) {
                selectedMood = e.mood_score;
                updateStars();
            }
            const best = document.getElementById('journal-best');
            const improve = document.getElementById('journal-improve');
            const goals = document.getElementById('journal-goals');
            if (best) best.value = e.best_moment || '';
            if (improve) improve.value = e.improvements || '';
            if (goals) goals.value = e.goals || '';
        } catch (e) {
            console.warn('[Journal] loadTodayEntry error:', e);
        }
    }

    let selectedMood = 0;

    function updateStars() {
        const stars = document.querySelectorAll('#journal-stars .star');
        stars.forEach((s, i) => {
            const val = i + 1;
            s.style.opacity = val <= selectedMood ? '1' : '0.3';
            s.style.transform = val === selectedMood ? 'scale(1.3)' : 'scale(1)';
        });
    }

    function bindStars() {
        const stars = document.querySelectorAll('#journal-stars .star');
        stars.forEach((s, i) => {
            s.style.cursor = 'pointer';
            s.style.transition = 'transform 0.15s, opacity 0.15s';
            s.addEventListener('click', () => {
                selectedMood = i + 1;
                updateStars();
            });
        });
    }

    // ── Save entry ──
    async function saveEntry() {
        const best = document.getElementById('journal-best');
        const improve = document.getElementById('journal-improve');
        const goals = document.getElementById('journal-goals');

        const payload = {
            moodScore: selectedMood || undefined,
            bestMoment: best ? best.value.trim() : undefined,
            improvements: improve ? improve.value.trim() : undefined,
            goals: goals ? goals.value.trim() : undefined
        };

        try {
            const result = await apiRequest('POST', '/', payload);
            if (result.entry) {
                await loadChart();
                const saveBtn = document.getElementById('journal-save');
                if (saveBtn) {
                    const orig = saveBtn.textContent;
                    saveBtn.textContent = '✅ Saved!';
                    setTimeout(() => { saveBtn.textContent = orig; }, 2000);
                }
            }
        } catch (e) {
            console.warn('[Journal] saveEntry error:', e);
        }
    }

    // ── Open journal panel on display monitor ──
    function open() {
        const panel = document.getElementById('monitor-journal');
        if (!panel) return;

        ['monitor-image', 'monitor-map', 'monitor-text', 'monitor-search', 'monitor-weather', 'monitor-default'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        panel.style.display = 'block';

        const titleEl = document.getElementById('display-title');
        if (titleEl) titleEl.textContent = '📓 Journal';

        selectedMood = 0;
        updateStars();
        loadTodayEntry();
        loadChart();
    }

    // ── Close journal panel ──
    function close() {
        const panel = document.getElementById('monitor-journal');
        if (!panel) return;
        panel.style.display = 'none';
        const defaultEl = document.getElementById('monitor-default');
        if (defaultEl) defaultEl.style.display = 'block';
        const titleEl = document.getElementById('display-title');
        if (titleEl) titleEl.textContent = 'Monitor';
    }

    // ── Detect trigger phrases ──
    function isJournalTrigger(message) {
        return /\b(open\s+journal|daily\s+reflection|jurnal|my\s+journal|show\s+journal)\b/i.test(message);
    }

    // ── Init ──
    function init() {
        bindStars();

        const saveBtn = document.getElementById('journal-save');
        if (saveBtn) saveBtn.addEventListener('click', saveEntry);

        const closeBtn = document.getElementById('journal-close');
        if (closeBtn) closeBtn.addEventListener('click', close);

        // Hook into app chat
        if (window.KelionApp && typeof window.KelionApp.onBeforeChat === 'function') {
            window.KelionApp.onBeforeChat(async (message) => {
                if (isJournalTrigger(message)) {
                    open();
                }
            });
        }
    }

    window.KJournal = { init, open, close };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
