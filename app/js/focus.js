// ═══════════════════════════════════════════════════════════════
// KelionAI — Focus & Meditation Mode
// Pomodoro timer + guided breathing + ambient sounds
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // ── State ────────────────────────────────────────────────
    var STATES = { IDLE: 'IDLE', FOCUS: 'FOCUS', BREAK: 'BREAK', LONG_BREAK: 'LONG_BREAK', MEDITATION: 'MEDITATION' };
    var BREATH_PHASES = { INHALE: 'inhale', HOLD_IN: 'hold', EXHALE: 'exhale', HOLD_OUT: 'hold' };
    var BREATH_LABELS = { inhale: 'Breathe in...', hold: 'Hold...', exhale: 'Breathe out...' };
    var BREATH_DURATIONS = [4, 4, 4, 4]; // inhale, hold, exhale, hold (seconds)

    var state = STATES.IDLE;
    var intervalId = null;
    var startTime = null;
    var pausedRemaining = null;
    var isPaused = false;
    var sessionCount = 0;
    var medDuration = 600; // seconds
    var medElapsed = 0;
    var breathPhaseIndex = 0;
    var breathPhaseElapsed = 0;
    var currentAmbient = 'none';
    var audioCtx = null;
    var ambientNode = null;
    var ambientGain = null;

    // ── Audio ────────────────────────────────────────────────
    function getAudioCtx() {
        if (!audioCtx || audioCtx.state === 'closed') {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }

    function stopAmbient() {
        if (ambientNode) {
            var nodes = Array.isArray(ambientNode) ? ambientNode : [ambientNode];
            nodes.forEach(function (n) { try { n.stop(); } catch (e) {} });
            ambientNode = null;
        }
        if (ambientGain) { try { ambientGain.disconnect(); } catch (e) {} ambientGain = null; }
    }

    function createWhiteNoiseBuffer(ctx) {
        var bufSize = ctx.sampleRate * 2;
        var buf = ctx.createBuffer(1, bufSize, ctx.sampleRate);
        var data = buf.getChannelData(0);
        for (var i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);
        return buf;
    }

    function playAmbient(type) {
        stopAmbient();
        if (type === 'none' || !type) return;
        var ctx = getAudioCtx();
        ambientGain = ctx.createGain();
        ambientGain.gain.setValueAtTime(0.07, ctx.currentTime);
        ambientGain.connect(ctx.destination);

        if (type === 'rain') {
            // White-noise buffer looped through a low-pass filter to simulate rain
            var src = ctx.createBufferSource();
            src.buffer = createWhiteNoiseBuffer(ctx);
            src.loop = true;
            var filter = ctx.createBiquadFilter();
            filter.type = 'lowpass';
            filter.frequency.value = 800;
            src.connect(filter);
            filter.connect(ambientGain);
            src.start();
            ambientNode = src;
        } else if (type === 'forest') {
            // Gentle oscillating tones to evoke forest ambience
            var osc1 = ctx.createOscillator();
            var osc2 = ctx.createOscillator();
            osc1.type = 'sine';
            osc1.frequency.setValueAtTime(200, ctx.currentTime);
            osc1.frequency.linearRampToValueAtTime(220, ctx.currentTime + 4);
            osc2.type = 'sine';
            osc2.frequency.setValueAtTime(300, ctx.currentTime);
            var gainA = ctx.createGain(); gainA.gain.value = 0.5;
            var gainB = ctx.createGain(); gainB.gain.value = 0.3;
            osc1.connect(gainA); gainA.connect(ambientGain);
            osc2.connect(gainB); gainB.connect(ambientGain);
            osc1.start(); osc2.start();
            ambientNode = [osc1, osc2];
        } else if (type === 'white') {
            var src2 = ctx.createBufferSource();
            src2.buffer = createWhiteNoiseBuffer(ctx);
            src2.loop = true;
            src2.connect(ambientGain);
            src2.start();
            ambientNode = src2;
        } else if (type === 'focus') {
            // Soft 200 Hz tone for audible focus ambience
            var osc = ctx.createOscillator();
            osc.type = 'sine';
            osc.frequency.value = 200;
            osc.connect(ambientGain);
            osc.start();
            ambientNode = osc;
        }
    }

    // ── UI helpers ───────────────────────────────────────────
    function getDisplayContent() {
        return document.getElementById('display-content');
    }

    function hideMonitorPanels() {
        var panels = ['monitor-image', 'monitor-map', 'monitor-text', 'monitor-search', 'monitor-weather', 'monitor-default', 'focus-panel', 'meditation-panel'];
        panels.forEach(function (id) {
            var el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
    }

    function formatTime(seconds) {
        var m = Math.floor(seconds / 60);
        var s = seconds % 60;
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    // ── Focus UI ─────────────────────────────────────────────
    function renderFocusPanel() {
        var dc = getDisplayContent();
        if (!dc) return;
        var existing = document.getElementById('focus-panel');
        if (!existing) {
            var div = document.createElement('div');
            div.id = 'focus-panel';
            div.innerHTML =
                '<div id="focus-mode-label">🎯 FOCUS MODE</div>' +
                '<div id="focus-timer">25:00</div>' +
                '<div id="focus-phase">Session 1 of 4</div>' +
                '<div id="focus-progress-bar"><div id="focus-progress-fill"></div></div>' +
                '<div id="focus-controls">' +
                    '<button id="focus-pause">⏸ Pause</button>' +
                    '<button id="focus-stop">⏹ Stop</button>' +
                '</div>' +
                '<div id="focus-ambient">' +
                    '<span>Ambient: </span>' +
                    '<button class="ambient-btn" data-sound="rain">🌧 Rain</button>' +
                    '<button class="ambient-btn" data-sound="forest">🌲 Forest</button>' +
                    '<button class="ambient-btn" data-sound="white">⬜ White noise</button>' +
                    '<button class="ambient-btn" data-sound="none">🔇 None</button>' +
                '</div>';
            dc.appendChild(div);
            document.getElementById('focus-pause').addEventListener('click', togglePause);
            document.getElementById('focus-stop').addEventListener('click', stop);
            dc.querySelectorAll('.ambient-btn').forEach(function (btn) {
                btn.addEventListener('click', function () {
                    currentAmbient = btn.dataset.sound;
                    playAmbient(currentAmbient);
                    dc.querySelectorAll('.ambient-btn').forEach(function (b) { b.classList.remove('active'); });
                    btn.classList.add('active');
                });
            });
        }
        hideMonitorPanels();
        var panel = document.getElementById('focus-panel');
        if (panel) panel.style.display = '';
    }

    function updateFocusUI(remaining, totalSeconds) {
        var timerEl = document.getElementById('focus-timer');
        var phaseEl = document.getElementById('focus-phase');
        var fillEl = document.getElementById('focus-progress-fill');
        var labelEl = document.getElementById('focus-mode-label');
        if (!timerEl) return;
        timerEl.textContent = formatTime(Math.max(0, remaining));
        if (fillEl) fillEl.style.width = (((totalSeconds - remaining) / totalSeconds) * 100) + '%';
        if (state === STATES.FOCUS) {
            if (labelEl) labelEl.textContent = '🎯 FOCUS MODE';
            if (phaseEl) phaseEl.textContent = 'Session ' + sessionCount + ' of 4';
        } else if (state === STATES.BREAK) {
            if (labelEl) labelEl.textContent = '☕ SHORT BREAK';
            if (phaseEl) phaseEl.textContent = 'Break — next session ' + (sessionCount + 1);
        } else if (state === STATES.LONG_BREAK) {
            if (labelEl) labelEl.textContent = '🛋 LONG BREAK';
            if (phaseEl) phaseEl.textContent = 'Long break — cycle complete';
        }
    }

    // ── Meditation UI ────────────────────────────────────────
    function renderMeditationPanel() {
        var dc = getDisplayContent();
        if (!dc) return;
        var existing = document.getElementById('meditation-panel');
        if (!existing) {
            var div = document.createElement('div');
            div.id = 'meditation-panel';
            div.innerHTML =
                '<div id="med-mode-label">🧘 MEDITATION</div>' +
                '<div id="med-breathe-text">Breathe in...</div>' +
                '<div id="med-circle"></div>' +
                '<div id="med-timer">10:00</div>' +
                '<div id="med-progress-bar"><div id="med-progress-fill"></div></div>' +
                '<button id="med-stop">⏹ Stop</button>';
            dc.appendChild(div);
            document.getElementById('med-stop').addEventListener('click', stop);
        }
        hideMonitorPanels();
        var panel = document.getElementById('meditation-panel');
        if (panel) panel.style.display = '';
    }

    function updateMeditationUI(remaining, total) {
        var timerEl = document.getElementById('med-timer');
        var fillEl = document.getElementById('med-progress-fill');
        var textEl = document.getElementById('med-breathe-text');
        var circleEl = document.getElementById('med-circle');
        if (!timerEl) return;
        timerEl.textContent = formatTime(Math.max(0, remaining));
        if (fillEl) fillEl.style.width = (((total - remaining) / total) * 100) + '%';

        var phases = [BREATH_PHASES.INHALE, BREATH_PHASES.HOLD_IN, BREATH_PHASES.EXHALE, BREATH_PHASES.HOLD_OUT];
        var phase = phases[breathPhaseIndex % phases.length];
        if (textEl) textEl.textContent = BREATH_LABELS[phase] || 'Hold...';
        if (circleEl) {
            circleEl.className = '';
            circleEl.classList.add(phase);
        }
    }

    // ── Tick / Timer ─────────────────────────────────────────
    function tick() {
        if (isPaused) return;

        if (state === STATES.FOCUS || state === STATES.BREAK || state === STATES.LONG_BREAK) {
            var now = Date.now();
            var elapsed = Math.floor((now - startTime) / 1000);
            var totalSeconds = state === STATES.FOCUS ? 25 * 60 : (state === STATES.LONG_BREAK ? 15 * 60 : 5 * 60);
            var remaining = totalSeconds - elapsed;

            updateFocusUI(remaining, totalSeconds);

            if (remaining <= 0) {
                clearInterval(intervalId);
                intervalId = null;
                onFocusPhaseComplete();
            }
        } else if (state === STATES.MEDITATION) {
            var now2 = Date.now();
            var elapsed2 = Math.floor((now2 - startTime) / 1000);
            var remaining2 = medDuration - elapsed2;

            // Advance breath phase
            breathPhaseElapsed = elapsed2 - medElapsed;
            var phaseLen = BREATH_DURATIONS[breathPhaseIndex % BREATH_DURATIONS.length];
            if (breathPhaseElapsed >= phaseLen) {
                medElapsed = elapsed2;
                breathPhaseIndex++;
            }

            updateMeditationUI(remaining2, medDuration);

            if (remaining2 <= 0) {
                clearInterval(intervalId);
                intervalId = null;
                onMeditationComplete();
            }
        }
    }

    function onFocusPhaseComplete() {
        if (state === STATES.FOCUS) {
            if (sessionCount >= 4) {
                sessionCount = 0;
                startBreak(true);
                if (window.KVoice) KVoice.speak('Focus session complete! Take a long 15-minute break. Well done!');
            } else {
                startBreak(false);
                if (window.KVoice) KVoice.speak('Focus session complete! Take a 5-minute break.');
            }
        } else {
            // Break finished → next focus session
            startFocus();
            if (window.KVoice) KVoice.speak('Break over. Starting next focus session.');
        }
    }

    function onMeditationComplete() {
        state = STATES.IDLE;
        stopAmbient();
        if (window.KAvatar) KAvatar.setExpression('happy', 0.3);
        if (window.KVoice) KVoice.speak('Meditation complete. Well done.');
        if (window.MonitorManager) MonitorManager.clear();
        var panel = document.getElementById('meditation-panel');
        if (panel) panel.style.display = 'none';
    }

    // ── Public API ───────────────────────────────────────────
    function startFocus() {
        stop(true);
        sessionCount = sessionCount < 4 ? sessionCount + 1 : 1;
        state = STATES.FOCUS;
        startTime = Date.now();
        pausedRemaining = null;
        isPaused = false;
        renderFocusPanel();
        updateFocusUI(25 * 60, 25 * 60);
        if (window.KAvatar) KAvatar.setExpression('neutral', 0);
        intervalId = setInterval(tick, 1000);
    }

    function startBreak(isLong) {
        stop(true);
        state = isLong ? STATES.LONG_BREAK : STATES.BREAK;
        startTime = Date.now();
        pausedRemaining = null;
        isPaused = false;
        var total = isLong ? 15 * 60 : 5 * 60;
        renderFocusPanel();
        updateFocusUI(total, total);
        if (window.KAvatar) KAvatar.setExpression('neutral', 0);
        intervalId = setInterval(tick, 1000);
    }

    function startMeditation(minutes) {
        stop(true);
        medDuration = Math.max(5, Math.min(20, (minutes || 10))) * 60;
        medElapsed = 0;
        breathPhaseIndex = 0;
        breathPhaseElapsed = 0;
        state = STATES.MEDITATION;
        startTime = Date.now();
        isPaused = false;
        renderMeditationPanel();
        updateMeditationUI(medDuration, medDuration);
        playAmbient('focus');
        if (window.KAvatar) KAvatar.setExpression('neutral', 0);
        intervalId = setInterval(tick, 1000);
    }

    function togglePause() {
        if (state === STATES.IDLE || state === STATES.MEDITATION) return;
        var pauseBtn = document.getElementById('focus-pause');
        if (!isPaused) {
            // Pause: capture remaining
            var elapsed = Math.floor((Date.now() - startTime) / 1000);
            var totalSeconds = state === STATES.FOCUS ? 25 * 60 : (state === STATES.LONG_BREAK ? 15 * 60 : 5 * 60);
            pausedRemaining = totalSeconds - elapsed;
            isPaused = true;
            if (pauseBtn) pauseBtn.textContent = '▶ Resume';
        } else {
            // Resume: reset startTime so remaining picks up where left off
            var totalSec = state === STATES.FOCUS ? 25 * 60 : (state === STATES.LONG_BREAK ? 15 * 60 : 5 * 60);
            startTime = Date.now() - (totalSec - pausedRemaining) * 1000;
            isPaused = false;
            pausedRemaining = null;
            if (pauseBtn) pauseBtn.textContent = '⏸ Pause';
        }
    }

    function stop(silent) {
        if (intervalId) { clearInterval(intervalId); intervalId = null; }
        stopAmbient();
        var prevState = state;
        state = STATES.IDLE;
        isPaused = false;
        pausedRemaining = null;
        if (!silent) {
            if (prevState !== STATES.IDLE) {
                if (window.MonitorManager) MonitorManager.clear();
            }
            var fp = document.getElementById('focus-panel');
            if (fp) fp.style.display = 'none';
            var mp = document.getElementById('meditation-panel');
            if (mp) mp.style.display = 'none';
        }
    }

    // ── Export ───────────────────────────────────────────────
    window.KFocus = {
        startFocus: startFocus,
        startMeditation: startMeditation,
        startBreak: startBreak,
        stop: function () { stop(false); },
        getState: function () { return state; }
    };
})();
