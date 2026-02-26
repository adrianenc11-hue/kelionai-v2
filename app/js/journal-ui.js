// ═══════════════════════════════════════════════════════════════
// KelionAI — Journal UI
// Mood form + mood chart in monitor panel
// ═══════════════════════════════════════════════════════════════
/* global MonitorManager, AuthManager */
var JournalUI = (function () {
    'use strict';

    var MOOD_EMOJI = { 1: '😢', 2: '😞', 3: '😟', 4: '😕', 5: '😐', 6: '🙂', 7: '😊', 8: '😄', 9: '😁', 10: '🤩' };

    // ─── Draw mood bar chart (canvas 2D, no Chart.js) ───────────
    function drawMoodChart(canvasId, entries) {
        var canvas = document.getElementById(canvasId);
        if (!canvas) return;
        var ctx = canvas.getContext('2d');
        var W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);

        if (!entries || !entries.length) {
            ctx.fillStyle = '#888';
            ctx.font = '12px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText('Nicio intrare', W / 2, H / 2);
            return;
        }

        var barW = Math.floor((W - 20) / entries.length) - 4;
        var maxMood = 10;
        var barArea = H - 30;

        entries.forEach(function (e, i) {
            var x = 10 + i * (barW + 4);
            var barH = Math.round((e.mood / maxMood) * barArea);
            var y = H - 20 - barH;

            // Bar gradient
            var grad = ctx.createLinearGradient(x, y, x, y + barH);
            grad.addColorStop(0, '#00ffff');
            grad.addColorStop(1, '#00ff88');
            ctx.fillStyle = grad;
            ctx.fillRect(x, y, barW, barH);

            // Mood number
            ctx.fillStyle = '#fff';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(e.mood, x + barW / 2, y - 3);

            // Date label (day)
            var dayStr = e.entry_date ? e.entry_date.slice(8) : '';
            ctx.fillStyle = '#888';
            ctx.font = '9px sans-serif';
            ctx.fillText(dayStr, x + barW / 2, H - 5);
        });
    }

    // ─── Build form HTML ────────────────────────────────────────
    function _formHtml(entry) {
        var mood = (entry && entry.mood) || 5;
        var best = (entry && entry.best_moment) || '';
        var impr = (entry && entry.improvements) || '';
        var goals = (entry && entry.goals) || '';
        var free = (entry && entry.free_text) || '';
        var emoji = MOOD_EMOJI[mood] || '😐';
        return (
            '<div class="journal-panel">' +
            '<h3 class="journal-heading">📔 Jurnalul meu</h3>' +
            '<div class="journal-mood-row">' +
            '  <span class="journal-mood-label">Stare de spirit:</span>' +
            '  <input type="range" id="jn-mood" min="1" max="10" value="' + mood + '" class="journal-slider">' +
            '  <span id="jn-mood-display" class="journal-mood-val">' + mood + ' ' + emoji + '</span>' +
            '</div>' +
            '<textarea id="jn-best" class="journal-textarea" placeholder="Cel mai bun moment al zilei...">' + _esc(best) + '</textarea>' +
            '<textarea id="jn-impr" class="journal-textarea" placeholder="Ce aș îmbunătăți...">' + _esc(impr) + '</textarea>' +
            '<textarea id="jn-goals" class="journal-textarea" placeholder="Obiectivele mele...">' + _esc(goals) + '</textarea>' +
            '<textarea id="jn-free" class="journal-textarea" placeholder="Gânduri libere...">' + _esc(free) + '</textarea>' +
            '<div class="journal-actions">' +
            '  <button id="jn-save" class="journal-btn journal-btn-primary">💾 Salvează</button>' +
            '  <button id="jn-history" class="journal-btn">📊 Istoric</button>' +
            '</div>' +
            '<div id="jn-status" class="journal-status"></div>' +
            '<canvas id="jn-chart" width="260" height="90" class="journal-chart"></canvas>' +
            '</div>'
        );
    }

    function _esc(str) {
        return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    // ─── Load last 7 days and draw chart ────────────────────────
    function _loadChart() {
        var token = _getToken();
        if (!token) return;
        fetch('/api/journal?limit=7', { headers: { Authorization: 'Bearer ' + token } })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                var entries = (d.entries || []).slice(0, 7).reverse();
                drawMoodChart('jn-chart', entries);
            })
            .catch(function () {});
    }

    // ─── Save today's entry ─────────────────────────────────────
    function _save() {
        var token = _getToken();
        if (!token) return;
        var mood = parseInt(document.getElementById('jn-mood').value, 10);
        var body = {
            mood: mood,
            best_moment: (document.getElementById('jn-best') || {}).value || '',
            improvements: (document.getElementById('jn-impr') || {}).value || '',
            goals: (document.getElementById('jn-goals') || {}).value || '',
            free_text: (document.getElementById('jn-free') || {}).value || ''
        };
        var statusEl = document.getElementById('jn-status');
        if (statusEl) statusEl.textContent = 'Se salvează...';

        fetch('/api/journal', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
            body: JSON.stringify(body)
        })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                if (d.entry) {
                    if (statusEl) { statusEl.textContent = '✅ Salvat!'; statusEl.style.color = '#00ff88'; }
                    _loadChart();
                } else {
                    if (statusEl) { statusEl.textContent = '❌ ' + (d.error || 'Eroare'); statusEl.style.color = '#ff4444'; }
                }
            })
            .catch(function () {
                if (statusEl) { statusEl.textContent = '❌ Eroare de rețea'; statusEl.style.color = '#ff4444'; }
            });
    }

    // ─── Show history panel ─────────────────────────────────────
    function _showHistory() {
        var token = _getToken();
        if (!token) return;
        fetch('/api/journal?limit=30', { headers: { Authorization: 'Bearer ' + token } })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                var entries = d.entries || [];
                var html = '<div class="journal-panel"><h3 class="journal-heading">📊 Istoric jurnal</h3>' +
                    '<button id="jn-back" class="journal-btn" style="margin-bottom:10px">← Înapoi</button>' +
                    '<div class="journal-history-list">';
                entries.forEach(function (e) {
                    var emoji = MOOD_EMOJI[e.mood] || '😐';
                    html += '<div class="journal-history-item">' +
                        '<span class="jh-date">' + e.entry_date + '</span>' +
                        '<span class="jh-mood">' + e.mood + ' ' + emoji + '</span>' +
                        (e.best_moment ? '<p class="jh-text">' + _esc(e.best_moment) + '</p>' : '') +
                        '</div>';
                });
                html += '</div></div>';
                var el = document.getElementById('monitor-journal');
                if (el) {
                    el.innerHTML = html;
                    var backBtn = document.getElementById('jn-back');
                    if (backBtn) backBtn.addEventListener('click', function () { show(); });
                }
            })
            .catch(function () {});
    }

    // ─── Get auth token ─────────────────────────────────────────
    function _getToken() {
        if (window.AuthManager && typeof AuthManager.getToken === 'function') {
            return AuthManager.getToken();
        }
        try { return (JSON.parse(localStorage.getItem('kelion_session') || '{}')).access_token || null; }
        catch (e) { return null; }
    }

    // ─── Public: show journal panel ─────────────────────────────
    function show() {
        var token = _getToken();
        var el = document.getElementById('monitor-journal');
        if (!el) return;

        if (!token) {
            el.innerHTML = '<div class="journal-panel"><p style="color:#888">Autentifică-te pentru a folosi jurnalul.</p></div>';
            if (window.MonitorManager) MonitorManager.showPanel('monitor-journal');
            return;
        }

        fetch('/api/journal/today', { headers: { Authorization: 'Bearer ' + token } })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                el.innerHTML = _formHtml(d.entry);
                _bindEvents();
                _loadChart();
                if (window.MonitorManager) MonitorManager.showPanel('monitor-journal');
            })
            .catch(function () {
                el.innerHTML = _formHtml(null);
                _bindEvents();
                if (window.MonitorManager) MonitorManager.showPanel('monitor-journal');
            });
    }

    function _bindEvents() {
        var slider = document.getElementById('jn-mood');
        var display = document.getElementById('jn-mood-display');
        if (slider && display) {
            slider.addEventListener('input', function () {
                var v = parseInt(slider.value, 10);
                display.textContent = v + ' ' + (MOOD_EMOJI[v] || '');
            });
        }
        var saveBtn = document.getElementById('jn-save');
        if (saveBtn) saveBtn.addEventListener('click', _save);
        var histBtn = document.getElementById('jn-history');
        if (histBtn) histBtn.addEventListener('click', _showHistory);
    }

    return { show: show, drawMoodChart: drawMoodChart };
}());
