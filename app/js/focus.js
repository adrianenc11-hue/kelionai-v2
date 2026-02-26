// ═══════════════════════════════════════════════════════════════
// KelionAI — Focus & Meditation Mode
// Pomodoro timer + guided breathing meditation
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var SESSION_KEY = 'kelion_focus_state';

    var POMODORO = { work: 25 * 60, shortBreak: 5 * 60, longBreak: 15 * 60, cycles: 4 };

    var audioCtx = null;
    var state = { mode: null, phase: null, cycle: 0, remaining: 0, total: 0, interval: null, stopAmbient: null };

    function getAudioCtx() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        return audioCtx;
    }

    function playBell(freq, duration) {
        try {
            var ctx = getAudioCtx();
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = freq || 880;
            osc.type = 'sine';
            gain.gain.setValueAtTime(0.3, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (duration || 0.5));
            osc.start(ctx.currentTime);
            osc.stop(ctx.currentTime + (duration || 0.5));
        } catch (e) {}
    }

    function playAmbient(freq) {
        try {
            var ctx = getAudioCtx();
            var osc = ctx.createOscillator();
            var gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = freq || 528;
            osc.type = 'sine';
            gain.gain.setValueAtTime(0.04, ctx.currentTime);
            osc.start(ctx.currentTime);
            return function () {
                try {
                    gain.gain.setValueAtTime(gain.gain.value, ctx.currentTime);
                    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 1);
                    osc.stop(ctx.currentTime + 1);
                } catch (e) {}
            };
        } catch (e) {
            return function () {};
        }
    }

    function fmt(seconds) {
        var m = Math.floor(seconds / 60), s = seconds % 60;
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function renderTimer(title, timeStr, subtitle, progress) {
        var pct = (progress * 100).toFixed(1);
        return '<div class="focus-timer">' +
            '<div class="focus-title">' + title + '</div>' +
            '<div class="focus-time">' + timeStr + '</div>' +
            '<div class="focus-subtitle">' + subtitle + '</div>' +
            '<div class="focus-progress"><div class="focus-bar" style="width:' + pct + '%"></div></div>' +
            '<button onclick="if(window.KFocus)KFocus.stop()" class="focus-stop">⏹ Stop</button>' +
            '</div>';
    }

    function saveState() {
        try {
            sessionStorage.setItem(SESSION_KEY, JSON.stringify({
                mode: state.mode, phase: state.phase, cycle: state.cycle,
                remaining: state.remaining, total: state.total
            }));
        } catch (e) {}
    }

    function clearSaved() {
        try { sessionStorage.removeItem(SESSION_KEY); } catch (e) {}
    }

    function showMonitor(html) {
        if (window.MonitorManager) MonitorManager.show(html, 'focus');
    }

    function startPomodoro() {
        stop();
        state.mode = 'pomodoro';
        state.phase = 'work';
        state.cycle = 0;
        state.remaining = POMODORO.work;
        state.total = POMODORO.work;
        saveState();

        playBell(880, 0.5);
        if (window.KVoice) KVoice.speak('Focus mode activat. 25 de minute de concentrare.');

        state.stopAmbient = playAmbient(528);

        function tick() {
            state.remaining--;
            saveState();
            var progress = 1 - (state.remaining / state.total);
            var subtitle = 'Ciclul ' + (state.cycle + 1) + ' / ' + POMODORO.cycles;
            var phaseLabel = state.phase === 'work' ? '🍅 Pomodoro — Concentrare' :
                (state.phase === 'long_break' ? '☕ Pauză lungă' : '☕ Pauză scurtă');
            showMonitor(renderTimer(phaseLabel, fmt(state.remaining), subtitle, progress));

            if (state.remaining <= 0) {
                clearInterval(state.interval);
                state.interval = null;
                if (state.stopAmbient) { state.stopAmbient(); state.stopAmbient = null; }
                playBell(660, 1);

                if (state.phase === 'work') {
                    state.cycle++;
                    if (state.cycle >= POMODORO.cycles) {
                        state.phase = 'long_break';
                        state.remaining = POMODORO.longBreak;
                        state.total = POMODORO.longBreak;
                        if (window.KVoice) KVoice.speak('Excelent! 4 cicluri complete. Pauză lungă de 15 minute.');
                    } else {
                        state.phase = 'short_break';
                        state.remaining = POMODORO.shortBreak;
                        state.total = POMODORO.shortBreak;
                        if (window.KVoice) KVoice.speak('Pauză de 5 minute. Bine meritat!');
                    }
                    state.stopAmbient = playAmbient(432);
                    state.interval = setInterval(tick, 1000);
                } else {
                    // Break ended — start next work cycle
                    state.phase = 'work';
                    state.remaining = POMODORO.work;
                    state.total = POMODORO.work;
                    if (window.KVoice) KVoice.speak('Pauza s-a terminat. Revenim la concentrare!');
                    state.stopAmbient = playAmbient(528);
                    state.interval = setInterval(tick, 1000);
                }
                saveState();
            }
        }

        state.interval = setInterval(tick, 1000);
        showMonitor(renderTimer('🍅 Pomodoro — Concentrare', fmt(state.remaining), 'Ciclul 1 / ' + POMODORO.cycles, 0));
    }

    function startMeditation(minutes) {
        stop();
        var totalSec = (minutes || 5) * 60;
        state.mode = 'meditation';
        state.phase = 'breathing_in';
        state.remaining = totalSec;
        state.total = totalSec;
        saveState();

        playBell(528, 1);
        if (window.KVoice) KVoice.speak('Meditație activată. Respiră adânc și relaxează-te.');

        state.stopAmbient = playAmbient(396);

        var breathPhase = 'in', breathRemaining = 4;

        function tick() {
            state.remaining--;
            breathRemaining--;
            saveState();

            if (breathRemaining <= 0) {
                breathPhase = breathPhase === 'in' ? 'out' : 'in';
                breathRemaining = breathPhase === 'in' ? 4 : 6;
                state.phase = breathPhase === 'in' ? 'breathing_in' : 'breathing_out';
            }

            var breathMsg = breathPhase === 'in'
                ? '🌬️ Inspiră... (' + breathRemaining + 's)'
                : '💨 Expiră... (' + breathRemaining + 's)';
            var progress = 1 - (state.remaining / state.total);
            showMonitor(renderTimer('🧘 Meditație', fmt(state.remaining), breathMsg, progress));

            if (state.remaining <= 0) {
                clearInterval(state.interval);
                state.interval = null;
                if (state.stopAmbient) { state.stopAmbient(); state.stopAmbient = null; }
                playBell(528, 2);
                state.mode = null;
                clearSaved();
                if (window.KVoice) KVoice.speak('Sesiunea de meditație s-a terminat. Simte-te bine!');
                showMonitor('<div class="focus-timer"><div class="focus-title">🧘 Meditație completă!</div><div class="focus-subtitle">Bine ai făcut!</div></div>');
            }
        }

        state.interval = setInterval(tick, 1000);
        showMonitor(renderTimer('🧘 Meditație', fmt(state.remaining), '🌬️ Inspiră... (4s)', 0));
    }

    function stop() {
        if (state.interval) { clearInterval(state.interval); state.interval = null; }
        if (state.stopAmbient) { state.stopAmbient(); state.stopAmbient = null; }
        state.mode = null;
        state.phase = null;
        state.remaining = 0;
        state.cycle = 0;
        clearSaved();
    }

    function getState() {
        return { mode: state.mode, phase: state.phase, cycle: state.cycle, remaining: state.remaining };
    }

    // Restore from sessionStorage on load — resume timer with saved progress
    (function () {
        try {
            var saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
            if (saved && saved.mode && saved.remaining > 0) {
                // Restore state then start the appropriate timer interval
                state.mode = saved.mode;
                state.phase = saved.phase;
                state.cycle = saved.cycle || 0;
                state.remaining = saved.remaining;
                state.total = saved.total || saved.remaining;
                if (saved.mode === 'pomodoro') {
                    playBell(880, 0.3);
                    state.stopAmbient = playAmbient(state.phase === 'work' ? 528 : 432);
                    state.interval = setInterval(function () {
                        state.remaining--;
                        saveState();
                        var progress = 1 - (state.remaining / state.total);
                        var subtitle = 'Ciclul ' + (state.cycle + 1) + ' / ' + POMODORO.cycles;
                        var phaseLabel = state.phase === 'work' ? '🍅 Pomodoro — Concentrare' :
                            (state.phase === 'long_break' ? '☕ Pauză lungă' : '☕ Pauză scurtă');
                        showMonitor(renderTimer(phaseLabel, fmt(state.remaining), subtitle, progress));
                        if (state.remaining <= 0) { stop(); }
                    }, 1000);
                    var ph0 = state.phase === 'work' ? '🍅 Pomodoro — Concentrare' :
                        (state.phase === 'long_break' ? '☕ Pauză lungă' : '☕ Pauză scurtă');
                    showMonitor(renderTimer(ph0, fmt(state.remaining), 'Ciclul ' + (state.cycle + 1) + ' / ' + POMODORO.cycles, 1 - (state.remaining / state.total)));
                } else if (saved.mode === 'meditation') {
                    state.stopAmbient = playAmbient(396);
                    var breathPhase = 'in', breathRemaining = 4;
                    state.interval = setInterval(function () {
                        state.remaining--;
                        breathRemaining--;
                        saveState();
                        if (breathRemaining <= 0) {
                            breathPhase = breathPhase === 'in' ? 'out' : 'in';
                            breathRemaining = breathPhase === 'in' ? 4 : 6;
                        }
                        var breathMsg = breathPhase === 'in'
                            ? '🌬️ Inspiră... (' + breathRemaining + 's)'
                            : '💨 Expiră... (' + breathRemaining + 's)';
                        showMonitor(renderTimer('🧘 Meditație', fmt(state.remaining), breathMsg, 1 - (state.remaining / state.total)));
                        if (state.remaining <= 0) { stop(); showMonitor('<div class="focus-timer"><div class="focus-title">🧘 Meditație completă!</div><div class="focus-subtitle">Bine ai făcut!</div></div>'); }
                    }, 1000);
                    showMonitor(renderTimer('🧘 Meditație', fmt(state.remaining), '🌬️ Inspiră...', 1 - (state.remaining / state.total)));
                }
            }
        } catch (e) {}
    }());

    window.KFocus = { startPomodoro: startPomodoro, startMeditation: startMeditation, stop: stop, getState: getState };
}());
