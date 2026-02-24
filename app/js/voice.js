// KelionAI v2 — Voice Module (AudioContext — FIXED)
(function () {
    'use strict';
    const API_BASE = window.location.origin;
    let mediaRecorder = null, audioChunks = [], isRecording = false, isSpeaking = false;
    let currentSourceNode = null, sharedAudioCtx = null, detectedLanguage = 'ro';
    let recognition = null, isListeningForWake = false, isProcessing = false;

    function getAudioContext() {
        if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume();
        return sharedAudioCtx;
    }

    function ensureAudioUnlocked() {
        const ctx = getAudioContext();
        try { const b = ctx.createBuffer(1,1,22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch(e){}
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
                const t = event.results[i][0].transcript.toLowerCase().trim();
                const c = event.results[i][0].confidence;
                if (c < 0.6 && event.results[i].isFinal) continue;
                const hasKelion = t.includes('kelion') || t.includes('chelion');
                const hasKira = t.includes('kira') || t.includes('chira');
                const hasK = t === 'k' || t.startsWith('k ');

                if ((hasKelion || hasKira || hasK) && event.results[i].isFinal) {
                    if (hasKira) { window.KAvatar.loadAvatar('kira'); document.querySelectorAll('.avatar-pill').forEach(b => b.classList.toggle('active', b.dataset.avatar === 'kira')); }
                    else { window.KAvatar.loadAvatar('kelion'); document.querySelectorAll('.avatar-pill').forEach(b => b.classList.toggle('active', b.dataset.avatar === 'kelion')); }

                    let msg = t;
                    if (hasKelion) msg = t.split(/kelion|chelion/i).pop().trim();
                    else if (hasKira) msg = t.split(/kira|chira/i).pop().trim();
                    else if (hasK) msg = t.replace(/^\s*k\s+/, '').trim();

                    if (msg.length > 1) {
                        detectLanguage(t); isProcessing = true; window.KAvatar.setAttentive(true);
                        window.dispatchEvent(new CustomEvent('wake-message', { detail: { text: msg, language: detectedLanguage } }));
                    } else { window.KAvatar.setAttentive(true); }
                }
            }
        };
        recognition.onend = () => { if (isListeningForWake && !isProcessing) try { recognition.start(); } catch(e){} };
        recognition.onerror = (e) => { if (e.error !== 'not-allowed' && isListeningForWake) setTimeout(() => { try { recognition.start(); } catch(e){} }, 1000); };
        try { recognition.start(); isListeningForWake = true; console.log('[Voice] Wake word activ'); } catch(e){}
    }

    function resumeWakeDetection() {
        isProcessing = false; window.KAvatar.setAttentive(false);
        if (isListeningForWake && recognition) try { recognition.start(); } catch(e){}
    }

    function detectLanguage(text) {
        const t = text.toLowerCase();
        if (/\b(și|sau|este|sunt|pentru|care|cum|unde|vreau|poți)\b/.test(t)) { detectedLanguage = 'ro'; return; }
        if (/\b(the|is|are|what|where|how|can|you|please)\b/.test(t)) { detectedLanguage = 'en'; return; }
    }

    // ─── SPEAK — AudioContext (bypass autoplay!) ─────────────
    async function speak(text, avatar) {
        if (isSpeaking) stopSpeaking();
        if (!text || !text.trim()) return;
        isSpeaking = true;

        try {
            const resp = await fetch(API_BASE + '/api/speak', { method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(window.KAuth ? KAuth.getAuthHeaders() : {}) },
                body: JSON.stringify({ text, avatar: avatar || KAvatar.getCurrentAvatar(), language: detectedLanguage }) });

            if (!resp.ok) { fallbackTextLipSync(text); isSpeaking = false; resumeWakeDetection(); return; }

            const arrayBuf = await resp.arrayBuffer();
            const ctx = getAudioContext();
            let audioBuf;
            try { audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0)); }
            catch(e) { fallbackTextLipSync(text); isSpeaking = false; resumeWakeDetection(); return; }

            currentSourceNode = ctx.createBufferSource();
            currentSourceNode.buffer = audioBuf;

            // Wire FFT lip sync
            const ls = KAvatar.getLipSync();
            let fftOk = false;
            if (ls && ls.connectToContext) {
                try {
                    const an = ls.connectToContext(ctx);
                    if (an) { currentSourceNode.connect(an); an.connect(ctx.destination); fftOk = true; ls.start(); }
                } catch(e){}
            }
            if (!fftOk) { currentSourceNode.connect(ctx.destination); fallbackTextLipSync(text); }

            KAvatar.setExpression('happy', 0.3);
            currentSourceNode.onended = () => { stopAllLipSync(); isSpeaking = false; currentSourceNode = null; KAvatar.setExpression('neutral'); resumeWakeDetection(); };
            currentSourceNode.start(0);
            console.log('[Voice] ✅ Audio playing (' + arrayBuf.byteLength + 'B)');
        } catch(e) { console.error('[Voice]', e); stopAllLipSync(); isSpeaking = false; resumeWakeDetection(); }
    }

    function stopAllLipSync() {
        var ls = KAvatar.getLipSync(), ts = KAvatar.getTextLipSync();
        if (ls) try { ls.stop(); } catch(e){}
        if (ts) try { ts.stop(); } catch(e){}
        KAvatar.setMorph('Smile', 0);
    }

    function fallbackTextLipSync(text) {
        const ts = KAvatar.getTextLipSync();
        if (ts) { ts.speak(text); setTimeout(() => { ts.stop(); KAvatar.setExpression('neutral'); }, text.length * 55 + 500); }
    }

    function stopSpeaking() {
        if (currentSourceNode) try { currentSourceNode.stop(); } catch(e){} currentSourceNode = null;
        stopAllLipSync(); isSpeaking = false; KAvatar.setExpression('neutral');
    }

    // ─── Manual record ───────────────────────────────────────
    async function startListening() {
        if (isRecording) return;
        if (recognition) try { recognition.stop(); } catch(e){}
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 } });
            audioChunks = [];
            mediaRecorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm' });
            mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) audioChunks.push(e.data); };
            mediaRecorder.start(100); isRecording = true; KAvatar.setExpression('thinking', 0.4);
            return true;
        } catch(e) { resumeWakeDetection(); return false; }
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
                    } catch(e) { resolve(null); }
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
            const r = await fetch(API_BASE + '/api/vision', { method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(window.KAuth ? KAuth.getAuthHeaders() : {}) },
                body: JSON.stringify({ image: b64, avatar: KAvatar.getCurrentAvatar(), language: detectedLanguage }) });
            const d = await r.json(); return d.description || 'Nu am putut analiza.';
        } catch(e) { return e.name === 'NotAllowedError' ? 'Permite accesul la cameră.' : 'Eroare cameră.'; }
    }

    window.KVoice = { speak, stopSpeaking, startListening, stopListening, captureAndAnalyze,
        startWakeWordDetection, resumeWakeDetection, ensureAudioUnlocked,
        isRecording: () => isRecording, isSpeaking: () => isSpeaking,
        getLanguage: () => detectedLanguage, setLanguage: (l) => { detectedLanguage = l; } };
})();
