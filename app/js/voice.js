// KelionAI v2 — Voice Module (AudioContext — FIXED)
(function () {
    'use strict';
    const API_BASE = window.location.origin;
    let mediaRecorder = null, audioChunks = [], isRecording = false, isSpeaking = false;
    let currentSourceNode = null, sharedAudioCtx = null, detectedLanguage = 'ro';
    let pendingAudioBuffer = null, pendingAudioAvatar = null, pendingAudioText = null;
    let recognition = null, isListeningForWake = false, isProcessing = false;

    function getAudioContext() {
        if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume();
        return sharedAudioCtx;
    }

    function ensureAudioUnlocked() {
        const ctx = getAudioContext();
        if (ctx.state === 'suspended') ctx.resume();
        try { const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch (e) { }
        // Replay pending audio if context was suspended and is now running
        if (ctx.state === 'running' && pendingAudioBuffer) {
            const buf = pendingAudioBuffer, av = pendingAudioAvatar, txt = pendingAudioText;
            pendingAudioBuffer = null; pendingAudioAvatar = null; pendingAudioText = null;
            const btn = document.getElementById('audio-unlock-btn'); if (btn) btn.remove();
            isSpeaking = true;
            playAudioBuffer(buf, txt);
        }
    }

    // ─── Wake Word (always-on mic) ───────────────────────────
    function startWakeWordDetection() {
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SR) return;
        recognition = new SR();
        recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 3;

        recognition.onresult = (event) => {
            if (isProcessing || isSpeaking) return;
            for (let i = event.resultIndex; i < event.results.length; i++) {
                if (!event.results[i].isFinal) continue;
                const t = event.results[i][0].transcript.toLowerCase().trim();
                const c = event.results[i][0].confidence;
                if (c < 0.3) continue;

                const hasKelion = t.includes('kelion') || t.includes('chelion');
                const hasKira = t.includes('kira') || t.includes('chira');

                if ((hasKelion || hasKira) && t.length > 1) {
                    // 1. Activate mic FIRST — always, regardless of selected avatar
                    isProcessing = true;
                    if (window.KAvatar) window.KAvatar.setAttentive(true);
                    let msg = t;
                    if (hasKelion) msg = t.replace(/kelion|chelion/i, '').trim() || t;
                    else if (hasKira) msg = t.replace(/kira|chira/i, '').trim() || t;
                    window.dispatchEvent(new CustomEvent('wake-message', { detail: { text: msg, language: detectedLanguage } }));

                    // 2. Switch avatar AFTER dispatch (heavy 3D load won't block message)
                    const targetAvatar = hasKira ? 'kira' : 'kelion';
                    if (window.KAvatar && targetAvatar !== window.KAvatar.getCurrentAvatar()) {
                        window.KAvatar.loadAvatar(targetAvatar);
                        document.querySelectorAll('.avatar-pill').forEach(b => b.classList.toggle('active', b.dataset.avatar === targetAvatar));
                        var displayName = targetAvatar.charAt(0).toUpperCase() + targetAvatar.slice(1);
                        var navName = document.getElementById('navbar-avatar-name');
                        if (navName) navName.textContent = displayName;
                        var avatarName = document.getElementById('avatar-name');
                        if (avatarName) avatarName.textContent = displayName;
                        document.title = displayName + 'AI';
                    }
                }
            }
        };
        recognition.onend = () => { if (isListeningForWake && !isProcessing) try { recognition.start(); } catch (e) { } };
        recognition.onerror = (e) => { if (e.error !== 'not-allowed' && isListeningForWake) setTimeout(() => { try { recognition.start(); } catch (e) { } }, 1000); };
        try { recognition.start(); isListeningForWake = true; console.log('[Voice] Wake word active'); } catch (e) { }
        // Start mic level monitor (standalone function, no duplicate)
        startMicMonitor();
    }

    function resumeWakeDetection() {
        isProcessing = false; window.KAvatar.setAttentive(false);
        if (isListeningForWake && recognition) try { recognition.start(); } catch (e) { }
    }

    function stopWakeWordDetection() {
        isListeningForWake = false;
        isProcessing = false;
        if (recognition) try { recognition.stop(); } catch (e) { }
        console.log('[Voice] Wake word stopped');
    }

    function detectLanguage(text) {
        // Language detection disabled for voice switching —
        // Voice language is controlled by AI response (KVoice.setLanguage from app.js)
        // The naive keyword matching was causing voice switching mid-conversation (B3 bug)
        return;
    }

    // ─── SPEAK — AudioContext (bypass autoplay!) ─────────────
    function cleanTextForTTS(text) {
        return text
            .replace(/```[\s\S]*?```/g, '')         // code blocks
            .replace(/`[^`]+`/g, '')                 // inline code
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url) → text
            .replace(/https?:\/\/\S+/g, '')          // URLs
            .replace(/[*_~#>]+/g, '')                // markdown formatting
            .replace(/\n{2,}/g, '. ')                // multiple newlines → pause
            .replace(/\s{2,}/g, ' ')                 // collapse whitespace
            .trim();
    }

    var speakSafetyTimer = null;
    var _speakId = 0; // atomic counter — prevents race condition overlap
    async function speak(text, avatar) {
        if (isSpeaking) stopSpeaking();
        if (!text || !text.trim()) return;
        var thisId = ++_speakId; // capture generation
        isSpeaking = true;
        if (speakSafetyTimer) clearTimeout(speakSafetyTimer);
        speakSafetyTimer = setTimeout(function () {
            if (isSpeaking) { console.warn('[Voice] Safety timeout'); stopSpeaking(); }
        }, 30000);

        try {
            const ttsText = cleanTextForTTS(text);
            if (!ttsText) { isSpeaking = false; resumeWakeDetection(); return; }
            console.log('[Voice] Fetching TTS for:', ttsText.substring(0, 50) + '...');
            const resp = await fetch(API_BASE + '/api/speak', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(window.KAuth ? KAuth.getAuthHeaders() : {}) },
                body: JSON.stringify({ text: ttsText, avatar: avatar || KAvatar.getCurrentAvatar(), language: detectedLanguage })
            });

            // If a newer speak() was called during our fetch, abort
            if (thisId !== _speakId) {
                console.log('[Voice] Stale TTS response (id ' + thisId + ' vs ' + _speakId + '), discarding');
                return;
            }

            if (!resp.ok) {
                console.warn('[Voice] TTS failed:', resp.status);
                isSpeaking = false; resumeWakeDetection(); return;
            }

            const arrayBuf = await resp.arrayBuffer();
            // Check again after arrayBuffer read
            if (thisId !== _speakId) {
                console.log('[Voice] Stale TTS buffer, discarding');
                return;
            }
            console.log('[Voice] TTS received:', arrayBuf.byteLength, 'bytes');

            // FORCE AudioContext running — try shared first, create new if needed
            var ctx = getAudioContext();
            try { await ctx.resume(); } catch (e) { }
            if (ctx.state !== 'running') {
                console.warn('[Voice] Shared AudioContext stuck, creating new one');
                sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
                ctx = sharedAudioCtx;
                try { await ctx.resume(); } catch (e) { }
            }
            console.log('[Voice] AudioContext state:', ctx.state);

            await playAudioBuffer(arrayBuf, ttsText);
        } catch (e) { console.error('[Voice]', e); stopAllLipSync(); isSpeaking = false; resumeWakeDetection(); }
    }

    async function playAudioBuffer(arrayBuf, fallbackText) {
        const ctx = getAudioContext();
        let audioBuf;
        try { audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0)); }
        catch (e) { console.warn('[Voice] Audio decode failed'); fallbackTextLipSync(fallbackText || ''); isSpeaking = false; resumeWakeDetection(); return; }

        currentSourceNode = ctx.createBufferSource();
        currentSourceNode.buffer = audioBuf;

        // Wire FFT lip sync
        const ls = KAvatar.getLipSync();
        let fftOk = false;
        if (ls && ls.connectToContext) {
            try {
                const an = ls.connectToContext(ctx);
                if (an) { currentSourceNode.connect(an); an.connect(ctx.destination); fftOk = true; ls.start(); }
            } catch (e) { }
        }
        if (!fftOk) { currentSourceNode.connect(ctx.destination); fallbackTextLipSync(fallbackText || ''); }

        KAvatar.setExpression('happy', 0.3);
        KAvatar.setPresenting(true);

        // Auto-gestures during speech
        if (fallbackText) {
            var gt = fallbackText.toLowerCase();
            setTimeout(function () { if (window.KAvatar) KAvatar.playGesture('nod'); }, 500);
            if (gt.includes('?')) setTimeout(function () { if (window.KAvatar) KAvatar.playGesture('tilt'); }, 2000);
            if (gt.includes('!')) setTimeout(function () { if (window.KAvatar) KAvatar.playGesture('nod'); }, 1500);
            if (gt.length > 200) {
                setTimeout(function () { if (window.KAvatar) KAvatar.playGesture('lookAway'); }, 3000);
                setTimeout(function () { if (window.KAvatar) KAvatar.playGesture('nod'); }, 5000);
            }
            if (/\b(nu|no|nein|non|niet|imposibil|impossible|unfortunately|din păcate)\b/i.test(gt)) {
                setTimeout(function () { if (window.KAvatar) KAvatar.playGesture('shake'); }, 1000);
            }
        }

        currentSourceNode.onended = () => { stopAllLipSync(); isSpeaking = false; currentSourceNode = null; KAvatar.setExpression('neutral'); KAvatar.setPresenting(false); resumeWakeDetection(); };
        currentSourceNode.start(0);
        // Dispatch event for synchronized text reveal
        window.dispatchEvent(new CustomEvent('audio-start', { detail: { duration: audioBuf.duration } }));
        // Safety timeout: stop lip sync even if onended doesn't fire
        var audioDurationMs = Math.ceil(audioBuf.duration * 1000) + 500;
        setTimeout(function () { if (isSpeaking) { stopAllLipSync(); isSpeaking = false; currentSourceNode = null; KAvatar.setExpression('neutral'); KAvatar.setPresenting(false); resumeWakeDetection(); } }, audioDurationMs);
        console.log('[Voice] ✅ Audio playing (' + arrayBuf.byteLength + 'B, ' + Math.round(audioBuf.duration) + 's)');
    }

    function showAudioUnlockPrompt(arrayBuf, avatar, text) {
        pendingAudioBuffer = arrayBuf;
        pendingAudioAvatar = avatar;
        pendingAudioText = text || '';
        let btn = document.getElementById('audio-unlock-btn');
        if (btn) return;
        btn = document.createElement('button');
        btn.id = 'audio-unlock-btn';
        btn.textContent = '🔊 Click to enable sound';
        btn.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#1a73e8;color:#fff;border:none;border-radius:24px;padding:12px 24px;cursor:pointer;z-index:9999;font-size:14px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,0.4)';
        btn.onclick = async function () {
            btn.remove();
            const buf = pendingAudioBuffer, av = pendingAudioAvatar, txt = pendingAudioText;
            pendingAudioBuffer = null; pendingAudioAvatar = null; pendingAudioText = null;
            if (!buf) return;
            isSpeaking = true;
            const ctx = getAudioContext();
            try { await ctx.resume(); } catch (e) { }
            await playAudioBuffer(buf, txt);
        };
        document.body.appendChild(btn);
        console.log('[Voice] Audio autoplay blocked — showing unlock prompt');
    }

    function stopAllLipSync() {
        var ls = KAvatar.getLipSync(), ts = KAvatar.getTextLipSync();
        if (ls) try { ls.stop(); } catch (e) { }
        if (ts) try { ts.stop(); } catch (e) { }
        KAvatar.setMorph('Smile', 0);
    }

    function fallbackTextLipSync(text) {
        const ts = KAvatar.getTextLipSync();
        if (ts) { ts.speak(text); setTimeout(() => { ts.stop(); KAvatar.setExpression('neutral'); }, text.length * 55 + 500); }
    }

    function stopSpeaking() {
        if (currentSourceNode) try { currentSourceNode.stop(); } catch (e) { } currentSourceNode = null;
        stopAllLipSync(); isSpeaking = false; KAvatar.setExpression('neutral'); KAvatar.setPresenting(false);
    }

    // ─── Mute / Unmute (instant via AudioContext suspend/resume) ─────────
    function mute() {
        if (sharedAudioCtx && sharedAudioCtx.state === 'running') sharedAudioCtx.suspend();
        stopAllLipSync();
    }

    function unmute() {
        if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume();
    }

    // ─── Manual record ───────────────────────────────────────
    async function startListening() {
        if (isRecording) return;
        if (recognition) try { recognition.stop(); } catch (e) { }
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
            audioChunks = [];
            mediaRecorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
            mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
            mediaRecorder.start(100); isRecording = true; KAvatar.setExpression('thinking', 0.4);
            return true;
        } catch (e) { resumeWakeDetection(); return false; }
    }

    function stopListening() {
        return new Promise((resolve) => {
            if (!isRecording || !mediaRecorder) { resolve(null); return; }
            mediaRecorder.onstop = async () => {
                isRecording = false; mediaRecorder.stream.getTracks().forEach(t => t.stop());
                if (!audioChunks.length) { resolve(null); resumeWakeDetection(); return; }
                const blob = new Blob(audioChunks, { type: 'audio/webm' }); audioChunks = [];
                const reader = new FileReader();
                reader.onloadend = async () => {
                    const b64 = reader.result.split(',')[1];
                    try {
                        const r = await fetch(API_BASE + '/api/listen', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ audio: b64 }) });
                        const d = await r.json(); if (d.text) detectLanguage(d.text); resolve(d.text || null);
                    } catch (e) { resolve(null); }
                };
                reader.readAsDataURL(blob);
            };
            mediaRecorder.stop();
        });
    }

    // ─── Camera auto ─────────────────────────────────────────
    async function captureAndAnalyze() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 1280, height: 720 } });
            const v = document.createElement('video'); v.srcObject = stream; v.setAttribute('playsinline', '');
            await v.play(); await new Promise(r => setTimeout(r, 800));
            const c = document.createElement('canvas'); c.width = v.videoWidth; c.height = v.videoHeight;
            c.getContext('2d').drawImage(v, 0, 0); stream.getTracks().forEach(t => t.stop());
            const b64 = c.toDataURL('image/jpeg', 0.95).split(',')[1];
            KAvatar.setExpression('thinking', 0.5);
            const r = await fetch(API_BASE + '/api/vision', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(window.KAuth ? KAuth.getAuthHeaders() : {}) },
                body: JSON.stringify({ image: b64, avatar: KAvatar.getCurrentAvatar(), language: detectedLanguage })
            });
            const d = await r.json(); return d.description || 'Could not analyze.';
        } catch (e) { return e.name === 'NotAllowedError' ? 'Please allow camera access.' : 'Camera error.'; }
    }

    // Auto-start mic monitor on first user interaction
    var micMonitorStarted = false;
    function startMicMonitor() {
        if (micMonitorStarted) return;
        micMonitorStarted = true;
        try {
            navigator.mediaDevices.getUserMedia({ audio: { noiseSuppression: true, echoCancellation: true } }).then(function (stream) {
                var micCtx = new (window.AudioContext || window.webkitAudioContext)();
                micCtx.resume();
                var micSrc = micCtx.createMediaStreamSource(stream);
                var micAn = micCtx.createAnalyser();
                micAn.fftSize = 256;
                micSrc.connect(micAn);
                var micData = new Uint8Array(micAn.frequencyBinCount);
                var micEl = document.getElementById('mic-level');
                if (!micEl) return;
                var bars = micEl.querySelectorAll('span');
                function updateMicLevel() {
                    micAn.getByteFrequencyData(micData);
                    var sum = 0; for (var j = 0; j < 32; j++) sum += micData[j];
                    var vol = sum / 32 / 255;
                    if (vol > 0.05) {
                        micEl.classList.add('active');
                        for (var k = 0; k < bars.length; k++) {
                            var h = Math.max(4, Math.min(22, vol * 22 * (1 + Math.random() * 0.3)));
                            bars[k].style.height = h + 'px';
                        }
                    } else {
                        micEl.classList.remove('active');
                        for (var k = 0; k < bars.length; k++) bars[k].style.height = '4px';
                    }
                    requestAnimationFrame(updateMicLevel);
                }
                updateMicLevel();
                console.log('[Voice] Mic monitor started');
            }).catch(function (e) { console.warn('[Voice] Mic monitor failed:', e.message || e); });
        } catch (e) { }
    }

    // Auto-start mic monitor on first click
    document.addEventListener('click', function () { startMicMonitor(); }, { once: true });

    window.KVoice = {
        speak, stopSpeaking, startListening, stopListening, captureAndAnalyze,
        startWakeWordDetection, stopWakeWordDetection, resumeWakeDetection, ensureAudioUnlocked, mute, unmute,
        getAudioContext, startMicMonitor,
        isRecording: () => isRecording, isSpeaking: () => isSpeaking,
        getLanguage: () => (window.i18n ? i18n.getLanguage() : detectedLanguage),
        setLanguage: (l) => { detectedLanguage = l; }
    };
})();
