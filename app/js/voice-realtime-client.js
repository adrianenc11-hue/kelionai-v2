// KelionAI — Voice-First Client (OpenAI Realtime via server proxy)
// Audio → WebSocket → Audio + CC Subtitles
(function () {
    'use strict';

    const WS_PATH = '/api/voice-realtime';
    let ws = null;
    let audioCtx = null;
    let micStream = null;
    let micProcessor = null;
    let isConnected = false;
    let isPlaying = false;
    let ccEnabled = true;


    // Audio playback scheduling
    let nextPlayTime = 0;
    const SAMPLE_RATE = 24000; // OpenAI Realtime uses 24kHz PCM16

    // ── CC Subtitle element ──
    let _ccEl = null;
    let _ccTimer = null;
    let _ccBuffer = '';

    function _ensureCCElement() {
        if (_ccEl && document.body.contains(_ccEl)) return _ccEl;
        _ccEl = document.createElement('div');
        _ccEl.id = 'voice-cc-subtitle';
        _ccEl.className = 'voice-cc-subtitle';
        _ccEl.setAttribute('aria-live', 'polite');
        const parent = document.getElementById('avatar-area') || document.querySelector('.left-panel') || document.body;
        parent.style.position = parent.style.position || 'relative';
        parent.appendChild(_ccEl);
        return _ccEl;
    }

    function _showCC(text) {
        if (!ccEnabled || !text) return;
        const el = _ensureCCElement();
        _ccBuffer += text;
        // Keep last ~150 chars visible
        const display = _ccBuffer.length > 150 ? '...' + _ccBuffer.slice(-147) : _ccBuffer;
        el.textContent = display;
        el.classList.add('visible');
        // Auto-hide after pause
        if (_ccTimer) clearTimeout(_ccTimer);
        _ccTimer = setTimeout(function () {
            el.classList.remove('visible');
            _ccBuffer = '';
        }, 4000);
    }

    function _hideCC() {
        if (_ccEl) _ccEl.classList.remove('visible');
        _ccBuffer = '';
    }

    // ── Audio Context ──
    function getAudioCtx() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
        if (audioCtx.state === 'suspended') audioCtx.resume();
        return audioCtx;
    }

    // ── Fallback state ──
    let _fallbackActive = false;
    let _lastAvatar = 'kelion';
    let _lastLanguage = 'ro';

    function _activateFallback(reason) {
        if (_fallbackActive) return;
        _fallbackActive = true;
        isConnected = false;
        stopMic();

        console.warn('[VoiceFirst] ⚠️ Realtime API unavailable:', reason);

        // Alert admin via custom event (admin panel picks this up)
        window.dispatchEvent(new CustomEvent('admin-alert', {
            detail: {
                type: 'voice-fallback',
                severity: 'warning',
                message: 'Voice-First Realtime API down. Reason: ' + reason,
                timestamp: new Date().toISOString()
            }
        }));

        // 🗣️ button → amber to signal issue (mic stays hidden per design)
        const vfBtn = document.getElementById('btn-voicefirst');
        if (vfBtn) {
            vfBtn.style.borderColor = '#f59e0b';
            vfBtn.style.color = '#f59e0b';
            vfBtn.style.boxShadow = '0 0 10px rgba(245,158,11,0.4)';
            vfBtn.title = '⚠️ Realtime indisponibil';
        }

        // Hide CC toggle (VF not active)
        const ccBtn = document.getElementById('btn-cc-toggle');
        if (ccBtn) ccBtn.style.display = 'none';

        window.dispatchEvent(new CustomEvent('voicefirst-fallback', { detail: { reason: reason } }));
    }

    function _clearFallback() {
        _fallbackActive = false;
    }

    // ── Connect to Voice-First server proxy ──
    function connect(avatar, language) {
        if (ws && ws.readyState <= WebSocket.OPEN) return; // already connected

        _lastAvatar = avatar || 'kelion';
        _lastLanguage = language || 'ro';
        _clearFallback();

        const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const url = proto + '//' + window.location.host + WS_PATH +
            '?avatar=' + encodeURIComponent(_lastAvatar) +
            '&language=' + encodeURIComponent(_lastLanguage);

        ws = new WebSocket(url);

        ws.onopen = function () {
            console.log('[VoiceFirst] WebSocket connected');
        };

        ws.onmessage = function (event) {
            try {
                const msg = JSON.parse(event.data);
                _handleMessage(msg);
            } catch (_e) {
                console.warn('[VoiceFirst] Unexpected binary data');
            }
        };

        ws.onclose = function (e) {
            console.log('[VoiceFirst] WebSocket disconnected, code:', e.code);
            isConnected = false;
            stopMic();
            // Auto-fallback if closed unexpectedly (not user-initiated)
            if (e.code !== 1000 && e.code !== 1005) {
                _activateFallback('WebSocket closed (code ' + e.code + ')');
            }
            window.dispatchEvent(new CustomEvent('voicefirst-disconnected'));
        };

        ws.onerror = function (_e) {
            console.error('[VoiceFirst] WebSocket error');
            _activateFallback('Connection error');
        };
    }

    function _handleMessage(msg) {
        switch (msg.type) {
            case 'ready':
                isConnected = true;
                console.log('[VoiceFirst] Ready:', msg.engine, msg.model);
                window.dispatchEvent(new CustomEvent('voicefirst-ready', { detail: msg }));
                // Auto-start mic capture
                startMic();
                break;

            case 'audio_chunk':
                // PCM16 base64 audio from GPT → queue for playback
                _queueAudio(msg.audio);
                break;

            case 'audio_end':
                // Signal end of response audio
                isPlaying = false;
                setTimeout(function () {
                    if (window.KAvatar) {
                        KAvatar.setExpression('neutral');
                        KAvatar.setPresenting(false);
                    }
                }, 500);
                break;

            case 'transcript':
                // CC subtitle — both user and assistant transcripts
                if (msg.role === 'assistant') {
                    _showCC(msg.text);
                }
                window.dispatchEvent(new CustomEvent('voicefirst-transcript', { detail: msg }));
                break;

            case 'transcript_done':
                // Full transcript available
                window.dispatchEvent(new CustomEvent('voicefirst-transcript-done', { detail: msg }));
                break;

            case 'speech_started':
                // User started talking — avatar listens
                if (window.KAvatar) KAvatar.setExpression('thinking', 0.3);
                window.dispatchEvent(new CustomEvent('voicefirst-speech-started'));
                break;

            case 'speech_stopped':
                // User stopped talking — avatar processes
                if (window.KAvatar) KAvatar.setExpression('thinking', 0.5);
                window.dispatchEvent(new CustomEvent('voicefirst-speech-stopped'));
                break;

            case 'turn_complete':
                _hideCC();
                window.dispatchEvent(new CustomEvent('voicefirst-turn-complete', { detail: msg }));
                break;

            case 'error':
                console.error('[VoiceFirst] Server error:', msg.error);
                _activateFallback(msg.error || 'Server error');
                window.dispatchEvent(new CustomEvent('voicefirst-error', { detail: msg }));
                break;

            case 'disconnected':
                isConnected = false;
                break;
        }
    }

    // ── Queue and play PCM audio chunks ──
    function _queueAudio(base64Audio) {
        const ctx = getAudioCtx();

        // Decode base64 → Int16 PCM → Float32
        const raw = atob(base64Audio);
        const bytes = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        const int16 = new Int16Array(bytes.buffer);
        const float32 = new Float32Array(int16.length);
        for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 32768.0;

        // Create audio buffer
        const audioBuf = ctx.createBuffer(1, float32.length, SAMPLE_RATE);
        audioBuf.getChannelData(0).set(float32);

        // Schedule playback
        const src = ctx.createBufferSource();
        src.buffer = audioBuf;

        // Connect to FFT lip-sync if available
        let fftConnected = false;
        if (window.KAvatar) {
            const ls = KAvatar.getLipSync();
            if (ls && ls.connectToContext) {
                try {
                    const analyser = ls.connectToContext(ctx);
                    if (analyser) {
                        src.connect(analyser);
                        analyser.connect(ctx.destination);
                        fftConnected = true;
                        if (!isPlaying) ls.start();
                    }
                } catch (_e) { /* ignored */ }
            }
            if (!isPlaying) {
                KAvatar.setExpression('happy', 0.3);
                KAvatar.setPresenting(true);
            }
        }
        if (!fftConnected) src.connect(ctx.destination);

        // Schedule at the right time (gapless)
        const now = ctx.currentTime;
        if (nextPlayTime < now) nextPlayTime = now;
        src.start(nextPlayTime);
        nextPlayTime += audioBuf.duration;

        isPlaying = true;

        // Dispatch audio-start for any listeners
        if (!isPlaying) {
            window.dispatchEvent(new CustomEvent('audio-start', { detail: { duration: audioBuf.duration, isRealtime: true } }));
        }
    }

    // ── Microphone capture → send PCM to server ──
    async function startMic() {
        if (micStream) return;

        try {
            micStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: SAMPLE_RATE,
                    channelCount: 1,
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                },
            });

            const ctx = getAudioCtx();
            const source = ctx.createMediaStreamSource(micStream);

            // Use ScriptProcessor for broad compatibility (AudioWorklet would be better but needs module)
            micProcessor = ctx.createScriptProcessor(4096, 1, 1);
            micProcessor.onaudioprocess = function (e) {
                if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) return;

                const float32 = e.inputBuffer.getChannelData(0);

                // Convert Float32 → Int16 PCM
                const int16 = new Int16Array(float32.length);
                for (let i = 0; i < float32.length; i++) {
                    const s = Math.max(-1, Math.min(1, float32[i]));
                    int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
                }

                // Send as binary (raw PCM bytes)
                ws.send(int16.buffer);
            };

            source.connect(micProcessor);
            micProcessor.connect(ctx.destination); // required for onaudioprocess to fire

            console.log('[VoiceFirst] Mic capture started (PCM 24kHz)');
        } catch (e) {
            console.error('[VoiceFirst] Mic error:', e);
        }
    }

    function stopMic() {
        if (micProcessor) {
            micProcessor.disconnect();
            micProcessor = null;
        }
        if (micStream) {
            micStream.getTracks().forEach(function (t) { t.stop(); });
            micStream = null;
        }
    }

    // ── Disconnect ──
    function disconnect() {
        stopMic();
        _hideCC();
        isConnected = false;
        isPlaying = false;
        if (ws) {
            try { ws.close(); } catch (_e) { /* ignored */ }
            ws = null;
        }
        if (window.KAvatar) {
            KAvatar.setExpression('neutral');
            KAvatar.setPresenting(false);
        }
    }

    // ── CC Toggle ──
    function setCCEnabled(enabled) {
        ccEnabled = !!enabled;
        if (!ccEnabled) _hideCC();
        console.log('[VoiceFirst] CC subtitles:', ccEnabled ? 'ON' : 'OFF');
    }

    // ── Send text (fallback when user types instead of speaking) ──
    function sendText(text) {
        if (!isConnected || !ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ type: 'text_input', text: text }));
    }

    // ── Public API ──
    window.KVoiceFirst = {
        connect: connect,
        disconnect: disconnect,
        isConnected: function () { return isConnected; },
        isPlaying: function () { return isPlaying; },
        setCCEnabled: setCCEnabled,
        isCCEnabled: function () { return ccEnabled; },
        sendText: sendText,
        startMic: startMic,
        stopMic: stopMic,
    };
})();
