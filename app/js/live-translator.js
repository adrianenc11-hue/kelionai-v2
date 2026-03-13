// ═══════════════════════════════════════════════════════════════
// KelionAI — Live Translator (Admin-only)
// Uses Web Speech API for continuous listening + optional translation
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    let _recognition = null;
    let _active = false;
    let _transcript = '';
    let _interimText = '';

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
        console.warn('[Translator] Web Speech API not supported');
        return;
    }

    function getElements() {
        return {
            btn: document.getElementById('btn-translate'),
            output: document.getElementById('translate-output'),
            textEl: document.getElementById('translate-text'),
            saveBtn: document.getElementById('btn-translate-save'),
            copyBtn: document.getElementById('btn-translate-copy'),
            clearBtn: document.getElementById('btn-translate-clear'),
            micBtn: document.getElementById('btn-mic-toggle'),
        };
    }

    function start() {
        if (_active) return;
        _active = true;

        const els = getElements();

        // Show output panel
        if (els.output) els.output.style.display = '';
        if (els.textEl) els.textEl.textContent = '🎤 Listening...';

        // Style T button as active
        if (els.btn) {
            els.btn.style.borderColor = '#10B981';
            els.btn.style.color = '#10B981';
            els.btn.style.boxShadow = '0 0 12px rgba(16,185,129,0.5)';
            els.btn.title = 'Translator ACTIV — Click to stop';
        }

        // Disable normal mic
        if (els.micBtn) {
            els.micBtn.style.opacity = '0.3';
            els.micBtn.style.pointerEvents = 'none';
            els.micBtn.title = 'Mic disabled — Translator active';
        }

        // Stop KVoice wake detection if available
        if (window.KVoice && KVoice.pauseWakeDetection) {
            try { KVoice.pauseWakeDetection(); } catch (e) { }
        }

        // Create recognition
        _recognition = new SpeechRecognition();
        _recognition.continuous = true;
        _recognition.interimResults = true;
        _recognition.maxAlternatives = 1;
        // Accept any language — browser auto-detects
        _recognition.lang = ''; // empty = auto-detect

        _recognition.onresult = function (event) {
            let interim = '';
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i];
                if (result.isFinal) {
                    const text = result[0].transcript.trim();
                    if (text) {
                        const timestamp = new Date().toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                        _transcript += '[' + timestamp + '] ' + text + '\n';
                    }
                } else {
                    interim = result[0].transcript;
                }
            }
            _interimText = interim;
            updateDisplay();
        };

        _recognition.onerror = function (event) {
            console.warn('[Translator] Error:', event.error);
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                stop();
                return;
            }
            // Auto-restart on other errors
            if (_active) {
                setTimeout(function () {
                    if (_active) {
                        try { _recognition.start(); } catch (e) { }
                    }
                }, 500);
            }
        };

        _recognition.onend = function () {
            // Auto-restart if still active (continuous mode sometimes stops)
            if (_active) {
                setTimeout(function () {
                    if (_active && _recognition) {
                        try { _recognition.start(); } catch (e) { }
                    }
                }, 200);
            }
        };

        try {
            _recognition.start();
        } catch (e) {
            console.error('[Translator] Start failed:', e);
            stop();
        }
    }

    function stop() {
        _active = false;
        const els = getElements();

        if (_recognition) {
            try { _recognition.stop(); } catch (e) { }
            _recognition = null;
        }

        // Style T button as inactive
        if (els.btn) {
            els.btn.style.borderColor = '#555';
            els.btn.style.color = '#888';
            els.btn.style.boxShadow = '';
            els.btn.title = 'Live Translator (Admin)';
        }

        // Re-enable normal mic
        if (els.micBtn) {
            els.micBtn.style.opacity = '';
            els.micBtn.style.pointerEvents = '';
            els.micBtn.title = 'Microphone ON/OFF';
        }

        // Resume wake detection
        if (window.KVoice && KVoice.resumeWakeDetection) {
            try { KVoice.resumeWakeDetection(); } catch (e) { }
        }

        _interimText = '';
        updateDisplay();
    }

    function toggle() {
        if (_active) {
            stop();
        } else {
            start();
        }
        return _active;
    }

    function updateDisplay() {
        const els = getElements();
        if (!els.textEl) return;

        let display = _transcript;
        if (_interimText) {
            display += '💬 ' + _interimText + '...';
        }
        if (!display) {
            display = _active ? '🎤 Listening...' : '(no transcript yet)';
        }
        els.textEl.textContent = display;

        // Auto-scroll
        if (els.output) {
            els.output.scrollTop = els.output.scrollHeight;
        }
    }

    function saveTranscript() {
        if (!_transcript.trim()) return;
        const blob = new Blob([_transcript], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const date = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
        a.href = url;
        a.download = 'kelion-transcript-' + date + '.txt';
        a.click();
        setTimeout(function () { URL.revokeObjectURL(url); }, 100);
    }

    function copyTranscript() {
        if (!_transcript.trim()) return;
        navigator.clipboard.writeText(_transcript).then(function () {
            const els = getElements();
            if (els.copyBtn) {
                els.copyBtn.textContent = '✅ Copied!';
                setTimeout(function () { els.copyBtn.textContent = '📋 Copy'; }, 2000);
            }
        }).catch(function () { });
    }

    function clearTranscript() {
        _transcript = '';
        _interimText = '';
        updateDisplay();
    }

    // Wire up buttons on DOMContentLoaded
    document.addEventListener('DOMContentLoaded', function () {
        const els = getElements();

        // Show T button only for admin users
        // Check periodically since auth loads async
        function checkAdmin() {
            var userEl = document.getElementById('user-name');
            var userName = (userEl && userEl.textContent) || '';
            var isAdmin = /adrianenc|ENCICULESCU|admin/i.test(userName) && !/guest/i.test(userName);
            if (isAdmin && els.btn) {
                els.btn.style.display = '';
            }
        }
        checkAdmin();
        // Re-check after auth loads (2s, 5s)
        setTimeout(checkAdmin, 2000);
        setTimeout(checkAdmin, 5000);

        if (els.btn) {
            els.btn.addEventListener('click', toggle);
        }
        if (els.saveBtn) {
            els.saveBtn.addEventListener('click', saveTranscript);
        }
        if (els.copyBtn) {
            els.copyBtn.addEventListener('click', copyTranscript);
        }
        if (els.clearBtn) {
            els.clearBtn.addEventListener('click', function () {
                clearTranscript();
                if (!_active && els.output) {
                    els.output.style.display = 'none';
                }
            });
        }
    });

    // Export for external use
    window.KTranslator = {
        start: start,
        stop: stop,
        toggle: toggle,
        isActive: function () { return _active; },
        getTranscript: function () { return _transcript; },
    };
})();
