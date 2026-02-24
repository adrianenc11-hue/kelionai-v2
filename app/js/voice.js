// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — Voice Module
// Handles: TTS, STT, wake words, continuous listening, camera
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const API_BASE = window.location.origin;
    let mediaRecorder = null;
    let audioChunks = [];
    let isRecording = false;
    let isSpeaking = false;
    let currentAudio = null;
    let detectedLanguage = 'ro'; // default Romanian

    // ─── Wake Word Detection (always-on mic) ─────────────────
    let recognition = null;
    let isListeningForWake = false;
    let isProcessing = false;

    function startWakeWordDetection() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!SpeechRecognition) {
            console.warn('[Voice] SpeechRecognition not supported — use mic button');
            return;
        }

        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.maxAlternatives = 3;
        // Don't set language — let it auto-detect

        recognition.onresult = (event) => {
            if (isProcessing || isSpeaking) return;

            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript.toLowerCase().trim();
                const confidence = event.results[i][0].confidence;

                // Skip low confidence results (background noise)
                if (confidence < 0.6 && event.results[i].isFinal) continue;

                // Detect wake words
                const hasKelion = transcript.includes('kelion') || transcript.includes('chelion') || transcript.includes('kelian');
                const hasKira = transcript.includes('kira') || transcript.includes('chira');
                const hasK = transcript === 'k' || transcript.startsWith('k ') || transcript.includes(' k ');

                if (hasKelion || hasKira || hasK) {
                    if (event.results[i].isFinal) {
                        // Switch avatar if needed
                        if (hasKira) {
                            window.KAvatar.loadAvatar('kira');
                            document.querySelectorAll('.avatar-pill').forEach(btn => {
                                btn.classList.toggle('active', btn.dataset.avatar === 'kira');
                            });
                        } else {
                            window.KAvatar.loadAvatar('kelion');
                            document.querySelectorAll('.avatar-pill').forEach(btn => {
                                btn.classList.toggle('active', btn.dataset.avatar === 'kelion');
                            });
                        }

                        // Extract the message after the wake word
                        let message = transcript;
                        if (hasKelion) message = transcript.split(/kelion|chelion|kelian/i).pop().trim();
                        else if (hasKira) message = transcript.split(/kira|chira/i).pop().trim();
                        else if (hasK) message = transcript.replace(/^\s*k\s+/, '').trim();

                        if (message.length > 1) {
                            detectLanguage(transcript);

                            isProcessing = true;
                            window.KAvatar.setAttentive(true);
                            console.log(`[Voice] Wake word detected! Message: "${message}", Language: ${detectedLanguage}`);

                            // Dispatch event for app.js to handle
                            window.dispatchEvent(new CustomEvent('wake-message', {
                                detail: { text: message, language: detectedLanguage }
                            }));
                        } else {
                            window.KAvatar.setAttentive(true);
                            console.log('[Voice] Wake word heard, listening for message...');
                        }
                    }
                }
            }
        };

        recognition.onend = () => {
            // Restart continuously unless we're processing
            if (isListeningForWake && !isProcessing) {
                try { recognition.start(); } catch (e) { /* already started */ }
            }
        };

        recognition.onerror = (e) => {
            if (e.error === 'not-allowed') {
                console.error('[Voice] Mic permission denied');
                return;
            }
            // Auto-restart on other errors
            if (isListeningForWake) {
                setTimeout(() => {
                    try { recognition.start(); } catch (e) { /* ok */ }
                }, 1000);
            }
        };

        try {
            recognition.start();
            isListeningForWake = true;
            console.log('[Voice] Wake word detection active — say "Kelion" or "Kira"');
        } catch (e) {
            console.error('[Voice] Could not start wake detection:', e);
        }
    }

    function resumeWakeDetection() {
        isProcessing = false;
        window.KAvatar.setAttentive(false);
        if (isListeningForWake && recognition) {
            try { recognition.start(); } catch (e) { /* already running */ }
        }
    }

    // ─── Language Detection ──────────────────────────────────
    function detectLanguage(text) {
        // Simple heuristic based on common words
        const lowerText = text.toLowerCase();

        // Romanian indicators
        if (/\b(și|sau|este|sunt|pentru|care|cum|unde|când|dacă|ești|vreau|poți|te rog|bună|salut|mulțumesc)\b/.test(lowerText)) {
            detectedLanguage = 'ro';
            return;
        }
        // English indicators
        if (/\b(the|is|are|and|what|where|how|can|you|please|hello|thank|want|need|tell)\b/.test(lowerText)) {
            detectedLanguage = 'en';
            return;
        }
        // Spanish
        if (/\b(el|la|los|las|es|son|para|como|donde|cuando|por favor|hola|gracias)\b/.test(lowerText)) {
            detectedLanguage = 'es';
            return;
        }
        // French
        if (/\b(le|la|les|est|sont|pour|comment|où|quand|bonjour|merci|s'il vous plaît)\b/.test(lowerText)) {
            detectedLanguage = 'fr';
            return;
        }
        // German
        if (/\b(der|die|das|ist|sind|für|wie|wo|wann|hallo|danke|bitte)\b/.test(lowerText)) {
            detectedLanguage = 'de';
            return;
        }
        // Italian
        if (/\b(il|la|gli|le|è|sono|per|come|dove|quando|ciao|grazie|per favore)\b/.test(lowerText)) {
            detectedLanguage = 'it';
            return;
        }
        // Default: keep current
    }

    // ─── SPEAK — TTS with lip sync ───────────────────────────
    async function speak(text, avatar) {
        if (isSpeaking) stopSpeaking();
        if (!text || text.trim().length === 0) return;

        isSpeaking = true;

        try {
            const resp = await fetch(`${API_BASE}/api/speak`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text,
                    avatar: avatar || KAvatar.getCurrentAvatar(),
                    language: detectedLanguage
                })
            });

            if (!resp.ok) {
                console.error('[Voice] TTS failed:', resp.status);
                fallbackTextLipSync(text);
                isSpeaking = false;
                resumeWakeDetection();
                return;
            }

            const audioBlob = await resp.blob();
            const audioUrl = URL.createObjectURL(audioBlob);

            currentAudio = new Audio(audioUrl);
            currentAudio.volume = 1;

            // Use text-based lip sync ONLY (FFT/createMediaElementSource breaks audio)
            fallbackTextLipSync(text);

            KAvatar.setExpression('happy', 0.3);

            currentAudio.addEventListener('ended', () => {
                stopAllLipSync();
                URL.revokeObjectURL(audioUrl);
                isSpeaking = false;
                currentAudio = null;
                KAvatar.setExpression('neutral');
                resumeWakeDetection();
            });

            currentAudio.addEventListener('error', (e) => {
                console.error('[Voice] Audio error:', e);
                stopAllLipSync();
                isSpeaking = false;
                currentAudio = null;
                KAvatar.setExpression('neutral');
                resumeWakeDetection();
            });

            await currentAudio.play();
            console.log('[Voice] Audio playing');
        } catch (e) {
            console.error('[Voice] Speak error:', e);
            stopAllLipSync();
            isSpeaking = false;
            resumeWakeDetection();
        }
    }

    // Force-close mouth — stops BOTH lip syncs
    function stopAllLipSync() {
        var ls = KAvatar.getLipSync();
        var ts = KAvatar.getTextLipSync();
        if (ls) try { ls.stop(); } catch (e) { }
        if (ts) try { ts.stop(); } catch (e) { }
        // Force Smile morph to 0
        KAvatar.setMorph('Smile', 0);
    }

    function fallbackTextLipSync(text) {
        const textSync = KAvatar.getTextLipSync();
        if (textSync) {
            textSync.speak(text);
            const duration = text.length * 55;
            setTimeout(() => {
                textSync.stop();
                KAvatar.setExpression('neutral');
            }, duration + 500);
        }
    }

    function stopSpeaking() {
        if (currentAudio) {
            currentAudio.pause();
            currentAudio.currentTime = 0;
            currentAudio = null;
        }
        const lipSync = KAvatar.getLipSync();
        if (lipSync) lipSync.stop();
        const textSync = KAvatar.getTextLipSync();
        if (textSync) textSync.stop();
        isSpeaking = false;
        KAvatar.setExpression('neutral');
    }

    // ─── MANUAL LISTEN (button press) ────────────────────────
    async function startListening() {
        if (isRecording) return;
        // Pause wake detection while manually recording
        if (recognition) try { recognition.stop(); } catch (e) { }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    echoCancellation: true,
                    noiseSuppression: true,
                    autoGainControl: true,
                    channelCount: 1,
                    sampleRate: 16000
                }
            });

            audioChunks = [];
            mediaRecorder = new MediaRecorder(stream, {
                mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
                    ? 'audio/webm;codecs=opus' : 'audio/webm'
            });

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) audioChunks.push(e.data);
            };

            mediaRecorder.start(100);
            isRecording = true;
            KAvatar.setExpression('thinking', 0.4);
            return true;
        } catch (e) {
            console.error('[Voice] Mic denied:', e);
            resumeWakeDetection();
            return false;
        }
    }

    function stopListening() {
        return new Promise((resolve) => {
            if (!isRecording || !mediaRecorder) { resolve(null); return; }

            mediaRecorder.onstop = async () => {
                isRecording = false;
                mediaRecorder.stream.getTracks().forEach(t => t.stop());

                if (audioChunks.length === 0) { resolve(null); resumeWakeDetection(); return; }

                const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
                audioChunks = [];

                const reader = new FileReader();
                reader.onloadend = async () => {
                    const base64 = reader.result.split(',')[1];
                    try {
                        const resp = await fetch(`${API_BASE}/api/listen`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ audio: base64 })
                        });
                        const data = await resp.json();
                        if (data.text) detectLanguage(data.text);
                        resolve(data.text || null);
                    } catch (e) {
                        console.error('[Voice] STT error:', e);
                        resolve(null);
                    }
                };
                reader.readAsDataURL(audioBlob);
            };

            mediaRecorder.stop();
        });
    }

    // ─── CAMERA ──────────────────────────────────────────────
    async function captureAndAnalyze() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user', width: 1280, height: 720 }
            });

            const video = document.createElement('video');
            video.srcObject = stream;
            video.setAttribute('playsinline', '');
            await video.play();
            await new Promise(r => setTimeout(r, 800)); // more time for camera to adjust exposure

            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            canvas.getContext('2d').drawImage(video, 0, 0);
            stream.getTracks().forEach(t => t.stop());

            const base64 = canvas.toDataURL('image/jpeg', 0.95).split(',')[1];
            KAvatar.setExpression('thinking', 0.5);

            const resp = await fetch(`${API_BASE}/api/vision`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: base64, avatar: KAvatar.getCurrentAvatar(), language: detectedLanguage })
            });

            const data = await resp.json();
            return data.description || 'Nu am putut analiza imaginea.';
        } catch (e) {
            console.error('[Voice] Camera error:', e);
            return e.name === 'NotAllowedError'
                ? 'Nu am acces la cameră. Te rog să permiți accesul.'
                : 'Eroare la accesarea camerei.';
        }
    }

    // ─── Public API ──────────────────────────────────────────
    window.KVoice = {
        speak,
        stopSpeaking,
        startListening,
        stopListening,
        captureAndAnalyze,
        startWakeWordDetection,
        resumeWakeDetection,
        isRecording: () => isRecording,
        isSpeaking: () => isSpeaking,
        getLanguage: () => detectedLanguage,
        setLanguage: (lang) => { detectedLanguage = lang; }
    };
})();
