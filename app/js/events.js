// ═══════════════════════════════════════════════════════════════
// KelionAI — Events & Journal (client-side)
// Birthday/event tracker + Daily journal UI + Mood chart
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var API_BASE = window.location.origin;
    var MONITOR_PANELS = ['monitor-image', 'monitor-map', 'monitor-text', 'monitor-search', 'monitor-weather', 'monitor-default', 'monitor-journal'];

    function authHeaders() {
        return { 'Content-Type': 'application/json', ...(window.KAuth ? KAuth.getAuthHeaders() : {}) };
    }

    function escapeHtml(t) {
        var d = document.createElement('div');
        d.textContent = String(t || '');
        return d.innerHTML;
    }

    // ─── Monitor helpers ─────────────────────────────────────
    function showJournalPanel() {
        MONITOR_PANELS.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        var el = document.getElementById('monitor-journal');
        if (el) el.style.display = '';
        var titleEl = document.getElementById('display-title');
        if (titleEl) titleEl.textContent = '📔 Jurnal';
        if (window.KAvatar) KAvatar.setPresenting(true);
    }

    function resetMonitorTitle() {
        var titleEl = document.getElementById('display-title');
        if (titleEl) titleEl.textContent = 'Monitor';
    }

    // ─── Event formatting helper ──────────────────────────────
    function formatEvent(e) {
        return e.name + ' — ' + e.type + ' pe ' + e.date;
    }

    // ─── Event detection patterns ─────────────────────────────
    var EVENT_PATTERNS = [
        { re: /(?:remember|remind|memorize|ține minte|amintește).+?(?:birthday|ziua|aniversar(?:e|y)?|anniversary|reminder).+?(?:is|on|pe|în|de|e)\s+(.+)/i, typeGuess: 'birthday' },
        { re: /(.+?)'s\s+birthday.+?(?:is|on|pe|în)\s+(.+)/i, typeGuess: 'birthday' },
        { re: /ziua\s+(?:de\s+naștere|de\s+nastere)\s+(?:a\s+)?(.+?)\s+(?:este|e|este pe|pe|în|in)\s+(.+)/i, typeGuess: 'birthday' },
        { re: /(?:anniversary|aniversar(?:e|y)?)\s+(?:on|pe|în|de|la)\s+(.+)/i, typeGuess: 'anniversary' }
    ];

    function detectEventIntent(text) {
        for (var i = 0; i < EVENT_PATTERNS.length; i++) {
            var m = EVENT_PATTERNS[i].re.exec(text);
            if (m) return { matched: true, typeGuess: EVENT_PATTERNS[i].typeGuess, raw: text };
        }
        return null;
    }

    // ─── Save event explicitly ───────────────────────────────
    async function saveEvent(name, date, type, notes) {
        try {
            var r = await fetch(API_BASE + '/api/events', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ name: name, date: date, type: type || 'reminder', notes: notes || '' })
            });
            if (!r.ok) return null;
            var data = await r.json();
            return data.event || null;
        } catch (e) {
            console.warn('[Events] saveEvent error:', e.message);
            return null;
        }
    }

    // ─── Check upcoming events (called on init) ───────────────
    async function checkUpcomingEvents() {
        try {
            var r = await fetch(API_BASE + '/api/events/upcoming', { headers: authHeaders() });
            if (!r.ok) return;
            var data = await r.json();
            var events = data.events || [];
            if (events.length === 0) return;

            setTimeout(function () {
                if (window.KVoice) KVoice.speak('Reminder: ' + events.map(formatEvent).join('; '));
                if (window.MonitorManager) {
                    MonitorManager.showMarkdown('### 📅 Evenimente în curând\n' + events.map(function (e) {
                        return '- **' + escapeHtml(e.name) + '** — ' + escapeHtml(e.type) + ' pe ' + escapeHtml(e.date);
                    }).join('\n'));
                }
            }, 3000);
        } catch (e) {
            console.warn('[Events] checkUpcomingEvents error:', e.message);
        }
    }

    // ─── Journal UI ───────────────────────────────────────────
    function ensureJournalPanel() {
        if (document.getElementById('monitor-journal')) return;

        var panel = document.createElement('div');
        panel.id = 'monitor-journal';
        panel.style.display = 'none';
        panel.innerHTML = [
            '<div class="journal-panel">',
            '  <h3>📔 Jurnalul de Azi</h3>',
            '  <div class="journal-rating">',
            '    <span>Cum a fost ziua ta?</span>',
            '    <div class="stars">',
            '      <span class="star" data-val="1">⭐</span>',
            '      <span class="star" data-val="2">⭐</span>',
            '      <span class="star" data-val="3">⭐</span>',
            '      <span class="star" data-val="4">⭐</span>',
            '      <span class="star" data-val="5">⭐</span>',
            '    </div>',
            '    <span id="journal-rating-val" class="journal-rating-val"></span>',
            '  </div>',
            '  <textarea id="journal-best" placeholder="Cel mai bun moment de azi..." rows="3"></textarea>',
            '  <textarea id="journal-improve" placeholder="Ce ar putea fi mai bine..." rows="3"></textarea>',
            '  <textarea id="journal-goals" placeholder="Obiective pentru mâine..." rows="3"></textarea>',
            '  <div class="journal-mood-row">',
            '    <label>Starea de spirit:</label>',
            '    <select id="journal-mood">',
            '      <option value="great">😄 Excelent</option>',
            '      <option value="good">🙂 Bun</option>',
            '      <option value="neutral" selected>😐 Neutru</option>',
            '      <option value="bad">😕 Slab</option>',
            '      <option value="terrible">😞 Teribil</option>',
            '    </select>',
            '  </div>',
            '  <button id="journal-save" class="journal-btn-save">💾 Salvează</button>',
            '  <div id="journal-status" class="journal-status"></div>',
            '</div>'
        ].join('');

        var displayContent = document.getElementById('display-content');
        if (displayContent) displayContent.appendChild(panel);

        // Star click handlers
        panel.querySelectorAll('.star').forEach(function (star) {
            star.addEventListener('click', function () {
                var val = parseInt(star.dataset.val, 10);
                panel.querySelectorAll('.star').forEach(function (s, i) {
                    s.style.opacity = (i < val) ? '1' : '0.3';
                });
                panel.dataset.rating = val;
                var ratingVal = document.getElementById('journal-rating-val');
                if (ratingVal) ratingVal.textContent = val + '/5';
            });
        });

        // Save button
        var saveBtn = document.getElementById('journal-save');
        if (saveBtn) saveBtn.addEventListener('click', saveJournalEntry);
    }

    async function saveJournalEntry() {
        var panel = document.getElementById('monitor-journal');
        if (!panel) return;

        var rating = panel.dataset.rating ? parseInt(panel.dataset.rating, 10) : null;
        var bestMoment = (document.getElementById('journal-best') || {}).value || '';
        var improvement = (document.getElementById('journal-improve') || {}).value || '';
        var goals = (document.getElementById('journal-goals') || {}).value || '';
        var mood = (document.getElementById('journal-mood') || {}).value || 'neutral';

        var statusEl = document.getElementById('journal-status');

        try {
            var r = await fetch(API_BASE + '/api/journal', {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ rating: rating, best_moment: bestMoment, improvement: improvement, goals: goals, mood: mood })
            });

            if (!r.ok) {
                var err = await r.json().catch(function () { return {}; });
                if (statusEl) statusEl.textContent = '❌ ' + (err.error || 'Eroare');
                return;
            }

            if (statusEl) statusEl.textContent = '✅ Jurnal salvat!';
            if (window.KVoice) KVoice.speak('Jurnalul tău a fost salvat. Continuă să îți notezi gândurile!');

            setTimeout(function () { if (statusEl) statusEl.textContent = ''; }, 3000);
        } catch (e) {
            console.warn('[Events] saveJournalEntry error:', e.message);
            if (statusEl) statusEl.textContent = '❌ Eroare conexiune';
        }
    }

    function openJournal() {
        ensureJournalPanel();
        showJournalPanel();
    }

    // ─── Mood Chart ───────────────────────────────────────────
    async function showMoodChart() {
        try {
            var r = await fetch(API_BASE + '/api/journal/mood', { headers: authHeaders() });
            if (!r.ok) return;
            var data = await r.json();

            if (!data.dates || data.dates.length === 0) {
                if (window.MonitorManager) MonitorManager.showMarkdown('### 📊 Grafic Stare\n_Nu există date încă. Scrie în jurnal pentru a vedea evoluția._');
                return;
            }

            var svgHtml = buildMoodChartSvg(data.dates, data.ratings, data.moods);
            var el = document.getElementById('monitor-text');
            if (el) {
                el.innerHTML = '<div class="mood-chart-wrapper">' + svgHtml + '</div>';
                MONITOR_PANELS.forEach(function (id) {
                    var p = document.getElementById(id);
                    if (p) p.style.display = 'none';
                });
                if (el) el.style.display = '';
                var titleEl = document.getElementById('display-title');
                if (titleEl) titleEl.textContent = '📊 Grafic Stare';
                if (window.KAvatar) KAvatar.setPresenting(true);
            }
        } catch (e) {
            console.warn('[Events] showMoodChart error:', e.message);
        }
    }

    function buildMoodChartSvg(dates, ratings, moods) {
        var W = 480, H = 220, PAD = 40;
        var n = dates.length;
        if (n === 0) return '<p>Nu există date.</p>';

        var validRatings = ratings.filter(function (r) { return r !== null && r !== undefined; });
        if (validRatings.length === 0) return '<p>Nu există note încă.</p>';

        var xStep = (W - PAD * 2) / Math.max(n - 1, 1);
        var yScale = function (v) { return H - PAD - ((v - 1) / 4) * (H - PAD * 2); };

        var moodColors = { great: '#00ff88', good: '#00ccff', neutral: '#ffaa00', bad: '#ff7744', terrible: '#ff4444' };

        // Build polyline points
        var points = [];
        for (var i = 0; i < n; i++) {
            if (ratings[i] !== null && ratings[i] !== undefined) {
                var x = PAD + i * xStep;
                var y = yScale(ratings[i]);
                points.push(x + ',' + y);
            }
        }

        var polyline = '<polyline points="' + points.join(' ') + '" fill="none" stroke="#00ffff" stroke-width="2"/>';

        // Dots
        var dots = '';
        for (var j = 0; j < n; j++) {
            if (ratings[j] !== null && ratings[j] !== undefined) {
                var cx = PAD + j * xStep;
                var cy = yScale(ratings[j]);
                var color = moodColors[moods[j]] || '#00ffff';
                dots += '<circle cx="' + cx + '" cy="' + cy + '" r="5" fill="' + color + '" title="' + escapeHtml(dates[j]) + ': ' + ratings[j] + '/5"/>';
                // Date label (every 3rd or if ≤7 total)
                if (n <= 7 || j % 3 === 0) {
                    var shortDate = dates[j].slice(5); // MM-DD
                    dots += '<text x="' + cx + '" y="' + (H - PAD + 15) + '" text-anchor="middle" font-size="10" fill="#aaa">' + escapeHtml(shortDate) + '</text>';
                }
            }
        }

        // Y-axis labels
        var yLabels = '';
        for (var v = 1; v <= 5; v++) {
            var ly = yScale(v);
            yLabels += '<text x="' + (PAD - 5) + '" y="' + (ly + 4) + '" text-anchor="end" font-size="10" fill="#888">' + v + '</text>';
            yLabels += '<line x1="' + PAD + '" y1="' + ly + '" x2="' + (W - PAD) + '" y2="' + ly + '" stroke="rgba(255,255,255,0.05)"/>';
        }

        return '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Grafic evoluție stare: ' + n + ' intrări în ultimele 30 zile" xmlns="http://www.w3.org/2000/svg" style="width:100%;max-width:' + W + 'px;background:rgba(0,0,0,0.3);border-radius:8px">' +
            yLabels + polyline + dots +
            '<text x="' + (W / 2) + '" y="18" text-anchor="middle" font-size="13" fill="#00ffff">Evoluție stare (ultimele 30 zile)</text>' +
            '</svg>';
    }

    // ─── Voice trigger hook (called from app.js onSendText / onMicUp) ───
    function handleVoiceTrigger(text) {
        var l = text.toLowerCase();
        if (/\b(journal|jurnal|diary)\b/i.test(l)) {
            openJournal();
            return true;
        }
        if (/\b(mood chart|grafic stare|starea mea|mood trend|trend)\b/i.test(l)) {
            showMoodChart();
            return true;
        }
        return false;
    }

    window.KEvents = {
        checkUpcomingEvents: checkUpcomingEvents,
        openJournal: openJournal,
        showMoodChart: showMoodChart,
        saveEvent: saveEvent,
        detectEventIntent: detectEventIntent,
        handleVoiceTrigger: handleVoiceTrigger
    };

    console.log('[Events] ✅ KelionAI Events & Journal loaded');
})();
