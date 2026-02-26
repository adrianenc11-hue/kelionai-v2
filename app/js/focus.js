(function () {
    'use strict';

    var _mode = null; // 'pomodoro' | 'meditation' | null
    var _phaseIndex = 0;
    var _sessionCount = 0;
    var _secondsLeft = 0;
    var _timerId = null;
    var _breathTimerId = null;
    var _audioCtx = null;
    var _ambientNode = null;
    var _meditationDuration = 10; // minutes

    // Pomodoro phases: [label, seconds, isBreak]
    var POMODORO_PHASES = [
        ['Work Session 1/4', 25 * 60, false],
        ['Break', 5 * 60, true],
        ['Work Session 2/4', 25 * 60, false],
        ['Break', 5 * 60, true],
        ['Work Session 3/4', 25 * 60, false],
        ['Break', 5 * 60, true],
        ['Work Session 4/4', 25 * 60, false],
        ['Long Break', 15 * 60, true]
    ];

    var BREATH_CYCLE = [
        { label: 'Inhale...', duration: 4000, scale: 1.5 },
        { label: 'Hold...', duration: 7000, scale: 1.5 },
        { label: 'Exhale...', duration: 8000, scale: 1.0 }
    ];

    function _getPanel()  { return document.getElementById('monitor-focus'); }
    function _getTimerEl(){ return document.getElementById('focus-timer-display'); }
    function _getPhaseEl(){ return document.getElementById('focus-phase'); }
    function _getBreathEl(){ return document.getElementById('focus-breathing'); }
    function _getBreathCircle(){ return document.getElementById('breath-circle'); }
    function _getBreathLabel(){ return document.getElementById('breath-label'); }

    function _showPanel() {
        var panel = _getPanel();
        if (panel) panel.style.display = 'block';
        var name = document.getElementById('focus-mode-name');
        var mon = document.getElementById('monitor-default');
        if (mon) mon.style.display = 'none';
    }

    function _hidePanel() {
        var panel = _getPanel();
        if (panel) panel.style.display = 'none';
        var mon = document.getElementById('monitor-default');
        if (mon) mon.style.display = '';
    }

    function _formatTime(secs) {
        var m = Math.floor(secs / 60);
        var s = secs % 60;
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }

    function _updateTimerDisplay() {
        var el = _getTimerEl();
        if (el) el.textContent = _formatTime(_secondsLeft);
    }

    function _updatePhaseDisplay(label) {
        var el = _getPhaseEl();
        if (el) el.textContent = label;
    }

    function _speak(text) {
        if (window.KVoice && KVoice.speak) {
            KVoice.speak(text).catch(function () {});
        }
    }

    function _startAmbient() {
        try {
            if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            _audioCtx.resume();
            var osc = _audioCtx.createOscillator();
            var gain = _audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.setValueAtTime(60, _audioCtx.currentTime);
            gain.gain.setValueAtTime(0.04, _audioCtx.currentTime);
            osc.connect(gain);
            gain.connect(_audioCtx.destination);
            osc.start();
            _ambientNode = { osc: osc, gain: gain };
        } catch (e) { /* audio unavailable */ }
    }

    function _stopAmbient() {
        if (_ambientNode) {
            try { _ambientNode.osc.stop(); } catch (e) {}
            _ambientNode = null;
        }
    }

    // ─── Pomodoro ────────────────────────────────────────────
    function startPomodoro() {
        stop();
        _mode = 'pomodoro';
        _phaseIndex = 0;
        _showPanel();
        var nameEl = document.getElementById('focus-mode-name');
        if (nameEl) nameEl.textContent = 'Focus Mode';
        var breathing = _getBreathEl();
        if (breathing) breathing.classList.add('hidden');
        _runPomodoroPhase();
    }

    function _runPomodoroPhase() {
        if (_phaseIndex >= POMODORO_PHASES.length) _phaseIndex = 0;
        var phase = POMODORO_PHASES[_phaseIndex];
        _secondsLeft = phase[1];
        _updatePhaseDisplay(phase[0]);
        _updateTimerDisplay();
        _speak(phase[0]);
        if (!phase[2]) _startAmbient(); else _stopAmbient();

        _timerId = setInterval(function () {
            _secondsLeft--;
            _updateTimerDisplay();
            if (_secondsLeft <= 0) {
                clearInterval(_timerId);
                _timerId = null;
                _phaseIndex++;
                if (_phaseIndex >= POMODORO_PHASES.length) {
                    stop();
                    _speak('Sesiunea Pomodoro completă!');
                } else {
                    _runPomodoroPhase();
                }
            }
        }, 1000);
    }

    // ─── Meditation ──────────────────────────────────────────
    function startMeditation(durationMins) {
        stop();
        _mode = 'meditation';
        _meditationDuration = durationMins || 10;
        _showPanel();
        var nameEl = document.getElementById('focus-mode-name');
        if (nameEl) nameEl.textContent = 'Meditation Mode';
        var breathing = _getBreathEl();
        if (breathing) breathing.classList.remove('hidden');
        _startAmbient();
        _speak('Sesiunea de meditație începe. Respiră adânc.');

        var endTime = Date.now() + _meditationDuration * 60 * 1000;
        _secondsLeft = _meditationDuration * 60;
        _updatePhaseDisplay(_meditationDuration + ' min Meditation');
        _updateTimerDisplay();

        _timerId = setInterval(function () {
            _secondsLeft--;
            _updateTimerDisplay();
            if (_secondsLeft <= 0) {
                clearInterval(_timerId);
                _timerId = null;
                _stopBreathCycle();
                _stopAmbient();
                _speak('Sesiunea de meditație completă. Bine ai revenit.');
                _hidePanel();
                _mode = null;
            }
        }, 1000);

        _runBreathCycle();
    }

    var _breathPhase = 0;
    function _runBreathCycle() {
        _breathPhase = 0;
        _doBreathStep();
    }    function _doBreathStep() {
        if (_mode !== 'meditation') return;
        var step = BREATH_CYCLE[_breathPhase % BREATH_CYCLE.length];
        var circle = _getBreathCircle();
        var label = _getBreathLabel();
        if (label) label.textContent = step.label;
        if (circle) circle.style.transform = 'scale(' + step.scale + ')';
        _breathTimerId = setTimeout(function () {
            if (_mode !== 'meditation') return;
            _breathPhase++;
            _doBreathStep();
        }, step.duration);
    }

    function _stopBreathCycle() {
        if (_breathTimerId) { clearTimeout(_breathTimerId); _breathTimerId = null; }
        var circle = _getBreathCircle();
        if (circle) circle.style.transform = 'scale(1)';
    }

    // ─── Command detection ───────────────────────────────────
    var FOCUS_START = ['focus mode', 'start pomodoro', 'pomodoro'];
    var MEDITATION_START = ['meditation mode', 'start meditation', 'meditatie', 'meditație'];
    var SESSION_STOP = ['stop focus', 'end session', 'stop meditation', 'opreste focus'];

    function detectCommand(message) {
        if (!message) return;
        var lower = message.toLowerCase();
        if (SESSION_STOP.some(function (t) { return lower.includes(t); })) { stop(); return; }
        if (MEDITATION_START.some(function (t) { return lower.includes(t); })) { startMeditation(10); return; }
        if (FOCUS_START.some(function (t) { return lower.includes(t); })) { startPomodoro(); return; }
    }

    function stop() {
        if (_timerId) { clearInterval(_timerId); _timerId = null; }
        _stopBreathCycle();
        _stopAmbient();
        _mode = null;
        _hidePanel();
    }

    function isActive() { return _mode !== null; }

    function _init() {
        var startBtn = document.getElementById('focus-start');
        var stopBtn = document.getElementById('focus-stop');
        if (startBtn) startBtn.addEventListener('click', function () { startPomodoro(); });
        if (stopBtn) stopBtn.addEventListener('click', function () { stop(); });
    }

    window.KFocus = { startPomodoro: startPomodoro, startMeditation: startMeditation, stop: stop, isActive: isActive, detectCommand: detectCommand };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _init);
    } else {
        _init();
    }
}());
