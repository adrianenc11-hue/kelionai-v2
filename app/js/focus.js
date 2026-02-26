// KelionAI v2 — Focus & Meditation Module
(function () {
    'use strict';

    var FOCUS_KEYWORDS = ['focus mode', 'pomodoro', 'meditatie', 'meditation', 'breathing', 'respiratie', 'focus'];
    var MEDITATION_KEYWORDS = ['meditatie', 'meditation', 'breathing', 'respiratie', 'breathe', 'relax', 'liniste'];
    var POMODORO_KEYWORDS = ['focus mode', 'pomodoro', 'focus'];

    var timerInterval = null, breathInterval = null;
    var pomodoroState = null;
    var panel = null;

    // ─── Audio cue (Web Audio API) ────────────────────────────
    function beep(freq, duration, type) {
        try {
            var ctx = new (window.AudioContext || window.webkitAudioContext)();
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = type || 'sine';
            osc.frequency.value = freq || 440;
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (duration || 0.5));
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + (duration || 0.5));
            setTimeout(function () { ctx.close(); }, ((duration || 0.5) + 0.1) * 1000);
        } catch (e) { /* no audio ctx */ }
    }

    // ─── Panel helpers ────────────────────────────────────────
    function getOrCreatePanel() {
        var existing = document.getElementById('focus-panel');
        if (existing) return existing;
        panel = document.createElement('div');
        panel.id = 'focus-panel';
        panel.style.cssText = [
            'position:fixed', 'bottom:20px', 'right:20px', 'width:300px',
            'background:rgba(10,10,30,0.97)', 'border:1px solid rgba(0,204,255,0.3)',
            'border-radius:16px', 'padding:20px', 'z-index:9000',
            'font-family:Inter,sans-serif', 'color:#e8e8f0', 'text-align:center'
        ].join(';');
        document.body.appendChild(panel);
        return panel;
    }

    function removePanel() {
        var el = document.getElementById('focus-panel');
        if (el) el.remove();
        panel = null;
    }

    // ─── POMODORO ─────────────────────────────────────────────
    var PHASES = [
        { label: 'Work', mins: 25 }, { label: 'Break', mins: 5 },
        { label: 'Work', mins: 25 }, { label: 'Break', mins: 5 },
        { label: 'Work', mins: 25 }, { label: 'Break', mins: 5 },
        { label: 'Work', mins: 25 }, { label: 'Long Break', mins: 15 }
    ];

    function getPomodoroSession() {
        try { return parseInt(localStorage.getItem('kelion_pomodoro_session') || '0', 10); } catch(e) { return 0; }
    }
    function setPomodoroSession(n) { try { localStorage.setItem('kelion_pomodoro_session', String(n)); } catch(e) {} }

    function startPomodoro() {
        stop();
        var session = getPomodoroSession() % PHASES.length;
        pomodoroState = { phase: session, secondsLeft: PHASES[session].mins * 60, paused: false };
        renderPomodoro();
        timerInterval = setInterval(function () {
            if (!pomodoroState || pomodoroState.paused) return;
            pomodoroState.secondsLeft--;
            if (pomodoroState.secondsLeft <= 0) {
                beep(880, 0.8);
                pomodoroState.phase = (pomodoroState.phase + 1) % PHASES.length;
                setPomodoroSession(pomodoroState.phase);
                pomodoroState.secondsLeft = PHASES[pomodoroState.phase].mins * 60;
                notify(PHASES[pomodoroState.phase].label === 'Work' ? 'Back to work! 💪' : 'Time for a break! ☕');
            }
            renderPomodoro();
        }, 1000);
    }

    function notify(msg) {
        if (window.Notification && Notification.permission === 'granted') {
            new Notification('KelionAI', { body: msg, icon: '/favicon.ico' });
        }
    }

    function renderPomodoro() {
        var p = getOrCreatePanel();
        if (!pomodoroState) return;
        var phase = PHASES[pomodoroState.phase];
        var mins = Math.floor(pomodoroState.secondsLeft / 60);
        var secs = pomodoroState.secondsLeft % 60;
        var timeStr = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
        var sessionNum = Math.floor(pomodoroState.phase / 2) + 1;
        p.innerHTML = [
            '<div style="font-size:1.4rem;font-weight:700;color:#00ccff;margin-bottom:6px">⏱ Pomodoro</div>',
            '<div style="font-size:0.85rem;opacity:0.7;margin-bottom:8px">Session ' + sessionNum + ' of 4 — ' + phase.label + '</div>',
            '<div style="font-size:3rem;font-weight:700;color:#fff;margin-bottom:16px">' + timeStr + '</div>',
            '<div style="display:flex;gap:8px;justify-content:center">',
            '  <button id="focus-pause" style="' + btnStyle('#00ccff','#000') + '">' + (pomodoroState.paused ? '▶ Resume' : '⏸ Pause') + '</button>',
            '  <button id="focus-stop" style="' + btnStyle('#ff4444','#fff') + '">■ Stop</button>',
            '</div>'
        ].join('');
        document.getElementById('focus-pause').addEventListener('click', function () {
            pomodoroState.paused = !pomodoroState.paused;
            renderPomodoro();
        });
        document.getElementById('focus-stop').addEventListener('click', stop);
    }

    // ─── MEDITATION ───────────────────────────────────────────
    var BREATH_PHASES = [
        { label: 'Inhale...', secs: 4 },
        { label: 'Hold...', secs: 4 },
        { label: 'Exhale...', secs: 4 },
        { label: 'Rest...', secs: 4 }
    ];

    function startMeditation(durationMins) {
        stop();
        durationMins = durationMins || 5;
        if (window.KBG) KBG.setContext('zen');
        var endTime = Date.now() + durationMins * 60 * 1000;
        var breathIdx = 0, secsInPhase = 0;

        renderMeditation(BREATH_PHASES[0].label, 0, durationMins * 60);

        breathInterval = setInterval(function () {
            secsInPhase++;
            var phase = BREATH_PHASES[breathIdx];
            var progress = secsInPhase / phase.secs;
            var totalRemaining = Math.max(0, Math.round((endTime - Date.now()) / 1000));

            if (secsInPhase >= phase.secs) {
                secsInPhase = 0;
                breathIdx = (breathIdx + 1) % BREATH_PHASES.length;
                beep(breathIdx % 2 === 0 ? 440 : 360, 0.3);
            }
            renderMeditation(BREATH_PHASES[breathIdx].label, progress, totalRemaining);

            if (Date.now() >= endTime) {
                stop();
                var p = getOrCreatePanel();
                p.innerHTML = '<div style="font-size:1.2rem;color:#00ffcc;padding:20px">🧘 Meditation complete.<br>Feel centered.</div>';
                setTimeout(removePanel, 4000);
            }
        }, 1000);
    }

    function renderMeditation(phaseLabel, progress, totalSecs) {
        var p = getOrCreatePanel();
        var mins = Math.floor(totalSecs / 60);
        var secs = totalSecs % 60;
        var timeStr = (mins < 10 ? '0' : '') + mins + ':' + (secs < 10 ? '0' : '') + secs;
        var radius = 60, circ = 2 * Math.PI * radius;
        var offset = circ * (1 - Math.min(1, progress));
        p.innerHTML = [
            '<div style="font-size:1.4rem;font-weight:700;color:#00ffcc;margin-bottom:8px">🧘 Meditation</div>',
            '<svg width="160" height="160" style="display:block;margin:0 auto 12px">',
            '  <circle cx="80" cy="80" r="' + radius + '" fill="none" stroke="rgba(0,255,200,0.15)" stroke-width="8"/>',
            '  <circle cx="80" cy="80" r="' + radius + '" fill="none" stroke="#00ffcc" stroke-width="8"',
            '    stroke-dasharray="' + circ.toFixed(1) + '" stroke-dashoffset="' + offset.toFixed(1) + '"',
            '    stroke-linecap="round" transform="rotate(-90 80 80)"',
            '    style="transition:stroke-dashoffset 0.9s ease"/>',
            '  <text x="80" y="88" text-anchor="middle" fill="#e8e8f0" font-size="18" font-family="Inter,sans-serif">' + phaseLabel + '</text>',
            '</svg>',
            '<div style="font-size:0.85rem;opacity:0.6;margin-bottom:14px">Remaining: ' + timeStr + '</div>',
            '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap;margin-bottom:10px">',
            '  <button data-dur="5" style="' + btnStyle('#00ffcc','#000') + '">5 min</button>',
            '  <button data-dur="10" style="' + btnStyle('#00ffcc','#000') + '">10 min</button>',
            '  <button data-dur="20" style="' + btnStyle('#00ffcc','#000') + '">20 min</button>',
            '</div>',
            '<button id="focus-stop" style="' + btnStyle('#ff4444','#fff') + '">■ Stop</button>'
        ].join('');
        p.querySelectorAll('[data-dur]').forEach(function (btn) {
            btn.addEventListener('click', function () { startMeditation(parseInt(btn.dataset.dur, 10)); });
        });
        document.getElementById('focus-stop').addEventListener('click', stop);
    }

    // ─── Shared ───────────────────────────────────────────────
    function btnStyle(bg, color) {
        return 'background:' + bg + ';color:' + color + ';border:none;padding:8px 18px;border-radius:50px;font-size:0.85rem;font-weight:600;cursor:pointer';
    }

    function stop() {
        if (timerInterval) { clearInterval(timerInterval); timerInterval = null; }
        if (breathInterval) { clearInterval(breathInterval); breathInterval = null; }
        pomodoroState = null;
        removePanel();
    }

    function handleMessage(text) {
        var lower = text.toLowerCase();
        var isMed = MEDITATION_KEYWORDS.some(function (k) { return lower.indexOf(k) !== -1; });
        var isPom = POMODORO_KEYWORDS.some(function (k) { return lower.indexOf(k) !== -1; });
        if (isPom && !isMed) { startPomodoro(); return; }
        if (isMed) { startMeditation(5); return; }
    }

    function init() {
        window.addEventListener('kelion-context-change', function (e) {
            var text = (e.detail && e.detail.message) ? e.detail.message : '';
            var lower = text.toLowerCase();
            var triggered = FOCUS_KEYWORDS.some(function (k) { return lower.indexOf(k) !== -1; });
            if (triggered) handleMessage(text);
        });
    }

    window.KFocus = { init: init, startPomodoro: startPomodoro, startMeditation: startMeditation, stop: stop };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
