// ═══════════════════════════════════════════════════════════
// KelionAI – Live Translator + Accessibility Module
// Pure speech-to-text translator (NO brain, NO AI chat)
// For deaf/hard-of-hearing users + real-time translation
// Bidirectional: any language → RO | RO → detected language
// ═══════════════════════════════════════════════════════════
(function () {
    'use strict';

    const ADMIN_NAMES = ['adrianenc', 'enciculescu', 'admin'];
    let isActive = false;
    let recognition = null;
    let translatePanel = null;
    let transcriptArea = null;
    let savedMicState = null;

    // ── Check admin access ──
    function isAdmin() {
        const user = window.KAuth && KAuth.getUser ? KAuth.getUser() : null;
        if (!user) return false;
        const name = (user.user_metadata?.display_name || user.email || '').toLowerCase();
        return ADMIN_NAMES.some(function (a) { return name.includes(a); });
    }

    // ── Initialize T button visibility ──
    function initTranslator() {
        const tBtn = document.getElementById('btn-translate');
        if (!tBtn) return;

        // Show for admin only
        setTimeout(function () {
            if (isAdmin()) {
                tBtn.style.display = 'flex';
            } else {
                tBtn.style.display = 'none';
            }
        }, 2000);

        tBtn.addEventListener('click', toggleTranslator);
    }

    // ── Toggle translator ON/OFF ──
    function toggleTranslator() {
        if (isActive) {
            stopTranslator();
        } else {
            startTranslator();
        }
    }

    // ── Start listening + translating ──
    function startTranslator() {
        const tBtn = document.getElementById('btn-translate');
        const micBtn = document.getElementById('btn-mic');

        // Check browser support
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            alert('Browser-ul nu suportă recunoaștere vocală. Folosește Chrome.');
            return;
        }

        isActive = true;

        // Visual feedback
        if (tBtn) {
            tBtn.classList.add('active');
            tBtn.textContent = 'T';
            tBtn.title = 'Translator ACTIV — click pentru oprire';
        }

        // Disable normal mic
        if (micBtn) {
            savedMicState = micBtn.disabled;
            micBtn.disabled = true;
            micBtn.style.opacity = '0.3';
        }

        // Stop KVoice recognition if active
        if (window.KVoice && KVoice.stopListening) {
            try { KVoice.stopListening(); } catch (_e) { /* ok */ }
        }

        // Show translate panel
        showPanel();

        // Start recognition
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 1;
        // Auto-detect language (don't set recognition.lang — let browser decide)

        let lastFinalTranscript = '';

        recognition.onresult = function (event) {
            let interimTranscript = '';
            let finalTranscript = '';

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                if (event.results[i].isFinal) {
                    finalTranscript += transcript;
                } else {
                    interimTranscript += transcript;
                }
            }

            // Show interim (gray) text
            if (interimTranscript) {
                showInterim(interimTranscript);
            }

            // Process final text
            if (finalTranscript && finalTranscript !== lastFinalTranscript) {
                lastFinalTranscript = finalTranscript;
                processTranscript(finalTranscript.trim());
            }
        };

        recognition.onerror = function (event) {
            if (event.error === 'no-speech' || event.error === 'aborted') return;
            console.warn('[Translator] Recognition error:', event.error);
            addLine('⚠️ Eroare: ' + event.error, 'error');
        };

        recognition.onend = function () {
            // Auto-restart if still active
            if (isActive) {
                try { recognition.start(); } catch (_e) { /* ok */ }
            }
        };

        try {
            recognition.start();
            addLine('🎤 Translator pornit — vorbește în orice limbă...', 'system');
        } catch (_e) {
            addLine('⚠️ Nu am putut porni microfonul', 'error');
        }
    }

    // ── Stop translator ──
    function stopTranslator() {
        isActive = false;
        const tBtn = document.getElementById('btn-translate');
        const micBtn = document.getElementById('btn-mic');

        if (recognition) {
            try { recognition.stop(); } catch (_e) { /* ok */ }
            recognition = null;
        }

        // Visual reset
        if (tBtn) {
            tBtn.classList.remove('active');
            tBtn.title = 'Live Translator (admin)';
        }

        // Restore mic
        if (micBtn) {
            micBtn.disabled = savedMicState || false;
            micBtn.style.opacity = '1';
        }

        // Resume KVoice if available
        if (window.KVoice && KVoice.resumeWakeDetection) {
            try { KVoice.resumeWakeDetection(); } catch (_e) { /* ok */ }
        }

        addLine('⏹️ Translator oprit.', 'system');
    }

    // ── Process a final transcript — translate it ──
    async function processTranscript(text) {
        if (!text) return;

        const time = new Date().toLocaleTimeString('ro-RO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

        // Show original text immediately
        addLine('[' + time + '] 🎙️ ' + text, 'original');

        // Translate via backend (lightweight, no brain)
        try {
            const API_BASE = window.API_BASE || '';
            const resp = await fetch(API_BASE + '/api/translate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ text: text, targetLang: 'ro' })
            });

            if (resp.ok) {
                const data = await resp.json();
                const lang = data.detectedLang || '??';
                const translated = data.translated || text;

                if (lang.toLowerCase() === 'ro' || translated.toLowerCase() === text.toLowerCase()) {
                    // Already Romanian or same text — just show transcription
                    addLine('[' + time + '] 📝 ' + text, 'translated');
                } else {
                    // Show translation with detected lang flag
                    addLine('[' + time + '] 🌐 [' + lang.toUpperCase() + '→RO] ' + translated, 'translated');
                }
            } else {
                // Fallback — show original
                addLine('[' + time + '] 📝 ' + text, 'translated');
            }
        } catch (_e) {
            // Offline fallback — just show text
            addLine('[' + time + '] 📝 ' + text, 'translated');
        }
    }

    // ── Show interim (in-progress) text ──
    function showInterim(text) {
        if (!transcriptArea) return;
        let interimEl = transcriptArea.querySelector('.translate-interim');
        if (!interimEl) {
            interimEl = document.createElement('div');
            interimEl.className = 'translate-interim';
            transcriptArea.appendChild(interimEl);
        }
        interimEl.textContent = '... ' + text;
        transcriptArea.scrollTop = transcriptArea.scrollHeight;
    }

    // ── Add a line to the transcript ──
    function addLine(text, type) {
        if (!transcriptArea) return;

        // Remove interim
        const interim = transcriptArea.querySelector('.translate-interim');
        if (interim) interim.remove();

        const line = document.createElement('div');
        line.className = 'translate-line translate-' + (type || 'original');
        line.textContent = text;
        transcriptArea.appendChild(line);
        transcriptArea.scrollTop = transcriptArea.scrollHeight;
    }

    // ── Show/create the translate panel ──
    function showPanel() {
        translatePanel = document.getElementById('translate-output');
        if (!translatePanel) return;

        translatePanel.style.display = 'flex';
        translatePanel.innerHTML = '';

        // Header with controls
        const header = document.createElement('div');
        header.className = 'translate-header';
        header.innerHTML =
            '<span>🌐 Live Translator — Accesibilitate</span>' +
            '<div class="translate-actions">' +
            '<button id="tr-save" title="Salvează transcript">💾 Save</button>' +
            '<button id="tr-copy" title="Copiază text">📋 Copy</button>' +
            '<button id="tr-clear" title="Șterge tot">🗑️ Clear</button>' +
            '</div>';
        translatePanel.appendChild(header);

        // Transcript area
        transcriptArea = document.createElement('div');
        transcriptArea.className = 'translate-transcript';
        translatePanel.appendChild(transcriptArea);

        // Wire buttons
        header.querySelector('#tr-save').onclick = saveTranscript;
        header.querySelector('#tr-copy').onclick = copyTranscript;
        header.querySelector('#tr-clear').onclick = clearTranscript;
    }

    // ── Get full transcript text ──
    function getFullText() {
        if (!transcriptArea) return '';
        const lines = transcriptArea.querySelectorAll('.translate-line');
        return Array.from(lines).map(function (l) { return l.textContent; }).join('\n');
    }

    // ── Save transcript as .txt ──
    function saveTranscript() {
        const text = getFullText();
        if (!text) return;
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'kelion-translate-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.txt';
        a.click();
        URL.revokeObjectURL(a.href);
    }

    // ── Copy transcript to clipboard ──
    function copyTranscript() {
        const text = getFullText();
        if (!text) return;
        navigator.clipboard.writeText(text).then(function () {
            const btn = document.getElementById('tr-copy');
            if (btn) { btn.textContent = '✅ Copied!'; setTimeout(function () { btn.textContent = '📋 Copy'; }, 2000); }
        }).catch(function () {
            const ta = document.createElement('textarea');
            ta.value = text;
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
        });
    }

    // ── Clear transcript ──
    function clearTranscript() {
        if (transcriptArea) transcriptArea.innerHTML = '';
        if (!isActive) {
            const panel = document.getElementById('translate-output');
            if (panel) panel.style.display = 'none';
        }
    }

    // ── Auto-init ──
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initTranslator);
    } else {
        setTimeout(initTranslator, 500);
    }

    // Export for external use
    window.LiveTranslator = {
        start: startTranslator,
        stop: stopTranslator,
        toggle: toggleTranslator,
        isActive: function () { return isActive; }
    };
})();
