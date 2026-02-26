// ═══════════════════════════════════════════════════════════════
// KelionAI — Focus & Meditation Mode
// Pomodoro: 25min work, 5min break
// Meditation: 5/10/20 min with breathing guide
// State: IDLE → FOCUS(25min) → BREAK(5min) → FOCUS ...
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var STATE = { IDLE: 'idle', FOCUS: 'focus', BREAK: 'break', MEDITATION: 'meditation' };
    var state = STATE.IDLE;
    var startTime = null;
    var durationMs = 0;
    var intervalId = null;
    var pomodoroCount = 0;
    var widgetEl = null;

    // ─── Web Audio tick (no external files) ─────────────────
    function playTick(freq, duration) {
        try {
            var ctx = new (window.AudioContext || window.webkitAudioContext)();
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = freq || 440;
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (duration || 0.3));
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + (duration || 0.3));
        } catch (e) {}
    }

    function playDone() { playTick(880, 0.5); setTimeout(function () { playTick(1100, 0.5); }, 300); }

    // ─── Widget ──────────────────────────────────────────────
    function getWidget() {
        if (!widgetEl) {
            widgetEl = document.createElement('div');
            widgetEl.id = 'kfocus-widget';
            widgetEl.style.cssText = 'position:fixed;bottom:80px;right:16px;background:rgba(10,14,26,0.95);border:1px solid rgba(0,212,255,0.3);border-radius:14px;padding:14px 18px;z-index:8000;min-width:180px;color:#fff;font-family:system-ui,sans-serif;box-shadow:0 4px 24px rgba(0,0,0,0.5);';
            document.body.appendChild(widgetEl);
        }
        return widgetEl;
    }

    function removeWidget() {
        if (widgetEl) { widgetEl.remove(); widgetEl = null; }
    }

    function renderWidget() {
        if (state === STATE.IDLE) { removeWidget(); return; }
        var w = getWidget();
        var elapsed = Date.now() - startTime;
        var remaining = Math.max(0, durationMs - elapsed);
        var mins = Math.floor(remaining / 60000);
        var secs = Math.floor((remaining % 60000) / 1000);
        var pad = function (n) { return n < 10 ? '0' + n : '' + n; };
        var icon = state === STATE.FOCUS ? '🎯' : state === STATE.BREAK ? '☕' : '🧘';
        var label = state === STATE.FOCUS ? 'Focus' : state === STATE.BREAK ? 'Pauză' : 'Meditație';
        var accentColor = state === STATE.BREAK ? '#69f0ae' : state === STATE.MEDITATION ? '#80cbc4' : '#00D4FF';
        w.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between;gap:12px">' +
            '<div>' +
            '<div style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px">' + icon + ' ' + label + (state === STATE.FOCUS ? ' #' + (pomodoroCount + 1) : '') + '</div>' +
            '<div style="font-size:28px;font-weight:bold;color:' + accentColor + ';letter-spacing:2px;margin-top:2px">' + pad(mins) + ':' + pad(secs) + '</div>' +
            '</div>' +
            '<button onclick="window.KFocus.stop()" style="background:none;border:1px solid rgba(255,255,255,0.2);color:#aaa;border-radius:8px;padding:4px 8px;cursor:pointer;font-size:12px">Stop</button>' +
            '</div>';
    }

    // ─── Breathing guide for meditation ─────────────────────
    var breathPhase = 0;
    var breathTimer = null;
    var BREATH_PHASES = [
        { label: 'Inspiră', duration: 4000, color: '#80cbc4' },
        { label: 'Ține', duration: 4000, color: '#4fc3f7' },
        { label: 'Expiră', duration: 4000, color: '#a5d6a7' },
        { label: 'Pauză', duration: 2000, color: '#888' },
    ];

    function runBreathing() {
        if (state !== STATE.MEDITATION) return;
        var phase = BREATH_PHASES[breathPhase % BREATH_PHASES.length];
        var w = getWidget();
        if (w) {
            var breathDiv = w.querySelector('.breath-label');
            if (breathDiv) { breathDiv.textContent = phase.label; breathDiv.style.color = phase.color; }
        }
        breathPhase++;
        breathTimer = setTimeout(runBreathing, phase.duration);
    }

    // ─── Timer tick ──────────────────────────────────────────
    function onTick() {
        if (state === STATE.IDLE) return;
        var elapsed = Date.now() - startTime;
        var remaining = durationMs - elapsed;

        renderWidget();

        // Warn at 1 minute remaining
        if (remaining > 0 && remaining <= 60000 && remaining > 59000) {
            playTick(660, 0.2);
        }

        if (remaining <= 0) {
            playDone();
            if (state === STATE.FOCUS) {
                pomodoroCount++;
                // Every 4 pomodoros → longer break (15min), else 5min break
                var breakMs = (pomodoroCount % 4 === 0) ? 15 * 60000 : 5 * 60000;
                startPhase(STATE.BREAK, breakMs);
                if (window.KVoice) KVoice.speak('Felicitări! Timp de pauză.');
            } else if (state === STATE.BREAK) {
                startPhase(STATE.FOCUS, 25 * 60000);
                if (window.KVoice) KVoice.speak('Pauza s-a terminat. Să continuăm!');
            } else {
                // Meditation ended
                stop();
                if (window.KVoice) KVoice.speak('Sesiunea de meditație s-a încheiat. Cum te simți?');
            }
        }
    }

    function startPhase(newState, ms) {
        state = newState;
        startTime = Date.now();
        durationMs = ms;
        renderWidget();
        if (newState === STATE.MEDITATION) {
            breathPhase = 0;
            // Add breath label to widget
            setTimeout(function () {
                var w = getWidget();
                if (w && !w.querySelector('.breath-label')) {
                    var bd = document.createElement('div');
                    bd.className = 'breath-label';
                    bd.style.cssText = 'font-size:18px;font-weight:bold;margin-top:8px;text-align:center;transition:color 1s';
                    bd.textContent = 'Inspiră';
                    w.appendChild(bd);
                }
                runBreathing();
            }, 100);
        }
    }

    // ─── Public API ──────────────────────────────────────────
    function startPomodoro() {
        if (state !== STATE.IDLE) stop();
        pomodoroCount = 0;
        startPhase(STATE.FOCUS, 25 * 60000);
        if (!intervalId) intervalId = setInterval(onTick, 1000);
        playTick(440, 0.2);
        if (window.KVoice) KVoice.speak('Modul focus activat. 25 de minute. Succes!');
    }

    function startMeditation(minutes) {
        if (state !== STATE.IDLE) stop();
        var mins = minutes || 10;
        startPhase(STATE.MEDITATION, mins * 60000);
        if (!intervalId) intervalId = setInterval(onTick, 1000);
        playTick(220, 0.5);
        if (window.KVoice) KVoice.speak('Meditație ' + mins + ' minute. Respiră adânc și relaxează-te.');
    }

    function stop() {
        state = STATE.IDLE;
        startTime = null;
        if (intervalId) { clearInterval(intervalId); intervalId = null; }
        if (breathTimer) { clearTimeout(breathTimer); breathTimer = null; }
        removeWidget();
    }

    function getState() { return { state: state, pomodoroCount: pomodoroCount }; }

    window.KFocus = { startPomodoro: startPomodoro, startMeditation: startMeditation, stop: stop, getState: getState };
})();
