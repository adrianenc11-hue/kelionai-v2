// ═══════════════════════════════════════════════════════════════
// KelionAI v2.3 — STREAMING + HISTORY + BRAIN
// SSE streaming (word-by-word), Conversation History UI,
// Rate limiting awareness, 4-tier search
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const API_BASE = window.location.origin;
    let chatHistory = [], audioUnlocked = false;
    const storedFiles = [];
    let currentConversationId = null, historyOpen = false;
    const _useStreaming = true;
    let adminSecret = null; // stored when admin mode is active

    // ── #155: FRONTEND ERROR CAPTURE → Brain ──
    let _errCount = 0, _errResetTimer = null;
    function reportError(type, message, source, line, col) {
        if (_errCount >= 5) return; // max 5 per minute
        _errCount++;
        if (!_errResetTimer) _errResetTimer = setTimeout(function () { _errCount = 0; _errResetTimer = null; }, 60000);
        try {
            navigator.sendBeacon(API_BASE + '/api/brain/errors', JSON.stringify({
                type: type, message: String(message).substring(0, 500),
                source: source || '', line: line || 0, col: col || 0,
                url: location.pathname, timestamp: new Date().toISOString(), ua: navigator.userAgent.substring(0, 100)
            }));
        } catch (_e) { /* silent */ }
    }
    window.onerror = function (msg, src, line, col) { reportError('uncaught', msg, src, line, col); };
    window.addEventListener('unhandledrejection', function (e) { reportError('promise', e.reason?.message || String(e.reason), '', 0, 0); });

    function _adminHeaders() { return { ...authHeaders(), 'x-admin-secret': adminSecret || '' }; }

    function authHeaders() { return { 'Content-Type': 'application/json', ...(window.KAuth ? KAuth.getAuthHeaders() : {}) }; }

    function persistConvId(id) { currentConversationId = id; try { if (id) localStorage.setItem('kelion_conv_id', id); else localStorage.removeItem('kelion_conv_id'); } catch (e) { console.warn('[App] localStorage write:', e.message); } }
    function restoreConvId() { try { return localStorage.getItem('kelion_conv_id') || null; } catch (e) { console.warn('[App] localStorage read:', e.message); return null; } }

    function unlockAudio() {
        if (!audioUnlocked) {
            audioUnlocked = true;
            try { const c = new (window.AudioContext || window.webkitAudioContext)(), b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); c.resume(); } catch (_e) { /* ignored */ }
        }
        if (window.KVoice) KVoice.ensureAudioUnlocked();
    }

    function showOnMonitor(content, type) {
        if (window.MonitorManager) MonitorManager.show(content, type);
    }

    // ─── Vision (client-side camera) ────────────────────────
    // Triggers include both English and Romanian for multilingual support
    const VISION_TRIGGERS = ['what is ahead', 'what do you see', 'look at', 'see me', 'identify', 'what is this', 'describe what you see', 'what is around', 'ce e în față', 'ce e in fata', 'ce vezi', 'mă vezi', 'ma vezi', 'uită-te', 'uita-te', 'arată-mi', 'arata-mi', 'privește', 'priveste', 'identifică', 'identifica', 'ce e asta', 'descrie ce vezi', 'ce observi', 'ce e pe stradă', 'ce e pe strada', 'ce e în jurul', 'ce e in jurul'];
    function isVisionRequest(t) { const l = t.toLowerCase(); return VISION_TRIGGERS.some(v => l.includes(v)); }

    // ─── Web commands — open sites via chat ──────────────────
    const WEB_SITES = {
        'youtube': 'https://www.youtube.com', 'netflix': 'https://www.netflix.com',
        'radiozu': 'https://www.radiozu.ro', 'radio zu': 'https://www.radiozu.ro',
        'kissfm': 'https://www.kissfm.ro', 'kiss fm': 'https://www.kissfm.ro',
        'spotify': 'https://open.spotify.com', 'twitch': 'https://www.twitch.tv',
        'facebook': 'https://www.facebook.com', 'instagram': 'https://www.instagram.com',
        'twitter': 'https://www.twitter.com', 'tiktok': 'https://www.tiktok.com',
        'google': 'https://www.google.com', 'gmail': 'https://mail.google.com',
        'whatsapp': 'https://web.whatsapp.com', 'telegram': 'https://web.telegram.org',
        'hbo': 'https://www.max.com', 'disney': 'https://www.disneyplus.com',
        'prime video': 'https://www.primevideo.com', 'amazon': 'https://www.amazon.com'
    };
    const WEB_CMDS = /\b(deschide|pune|open|play|start|go to|du-te pe|arata|arată|mergi pe|porneste|pornește|navighează|navigheaza)\b/i;
    function tryWebCommand(text) {
        const lower = text.toLowerCase();
        if (!WEB_CMDS.test(lower)) return null;
        // Check for direct URL in message
        const urlMatch = lower.match(/https?:\/\/[^\s]+/);
        if (urlMatch) return urlMatch[0];
        // Check for known sites
        for (const name in WEB_SITES) {
            if (lower.includes(name)) return WEB_SITES[name];
        }
        return null;
    }

    // ─── Monitor clear commands ──────────────────────────────
    const CLEAR_TRIGGERS = ['goleste monitorul', 'golește monitorul', 'sterge monitorul', 'șterge monitorul', 'clear monitor', 'curata monitorul', 'curăță monitorul', 'inchide monitorul', 'închide monitorul'];
    function isMonitorClear(t) { const l = t.toLowerCase(); return CLEAR_TRIGGERS.some(v => l.includes(v)); }


    async function triggerVision() {
        showThinking(false);
        addMessage('assistant', '👁️ Activating camera...');
        try { KAvatar.setExpression('thinking', 0.5); } catch (e) { console.warn('[App] Expression change failed:', e.message); }
        try {
            const desc = await KVoice.captureAndAnalyze();
            addMessage('assistant', desc);
            chatHistory.push({ role: 'assistant', content: desc });

            // Save vision description to Supabase memory for future reference
            try {
                fetch(API_BASE + '/api/memory', {
                    method: 'POST', headers: authHeaders(),
                    body: JSON.stringify({ action: 'save', key: 'last_vision_' + Date.now(), value: desc })
                }).catch(function (e) { console.warn('[Vision] Memory save failed:', e.message); });
            } catch (_e) { /* non-blocking */ }

            // Send vision context to brain for enriched follow-up
            try {
                await sendToAI_Regular('[VISION_CONTEXT: ' + desc + '] Am văzut prin cameră. Confirmă scurt ce am văzut și întreabă dacă vrea detalii despre ceva anume. NU descrie din nou tot.', 'ro');
            } catch (_e) { /* fallback: just speak the raw description */ }

            try { KAvatar.setExpression('happy', 0.3); } catch (e) { console.warn('[App] Expression change failed:', e.message); }
            if (window.KVoice) await KVoice.speak(desc);
        } catch (_e) {
            addMessage('assistant', 'Camera not available. Please allow camera access in your browser settings.');
        }
    }

    // ═══════════════════════════════════════════════════════════
    // MEDIA UPLOAD SYSTEM — Images, Files, Paste, Drag & Drop
    // Sends imageBase64 to /api/chat → brain-v4 → Gemini Vision
    // ═══════════════════════════════════════════════════════════
    let pendingMedia = null; // { base64, mimeType, name, size, previewUrl }

    function handleFileAttach(file) {
        if (!file) return;
        // Max 20MB for direct base64 (Gemini limit ~20MB inline)
        if (file.size > 20 * 1024 * 1024) {
            addMessage('assistant', '⚠️ Fișierul e prea mare (max 20MB). Încearcă un fișier mai mic.');
            return;
        }
        const reader = new FileReader();
        reader.onload = function (e) {
            const dataUrl = e.target.result;
            const base64 = dataUrl.split(',')[1];
            const mimeType = file.type || 'application/octet-stream';
            pendingMedia = {
                base64: base64,
                mimeType: mimeType,
                name: file.name,
                size: file.size,
                previewUrl: file.type.startsWith('image/') ? dataUrl : null
            };
            showMediaPreview();
        };
        reader.readAsDataURL(file);
    }

    function showMediaPreview() {
        removeMediaPreview(); // clean previous
        if (!pendingMedia) return;
        const preview = document.createElement('div');
        preview.id = 'media-preview';
        preview.style.cssText = 'display:flex;align-items:center;gap:8px;padding:6px 12px;margin:0 16px 4px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:10px;font-size:0.8rem;color:#a5b4fc;';
        let content = '';
        if (pendingMedia.previewUrl) {
            content += '<img src="' + pendingMedia.previewUrl + '" style="width:40px;height:40px;object-fit:cover;border-radius:6px">';
        } else {
            content += '<span style="font-size:1.4rem">📎</span>';
        }
        const sizeStr = pendingMedia.size > 1024 * 1024
            ? (pendingMedia.size / (1024 * 1024)).toFixed(1) + ' MB'
            : (pendingMedia.size / 1024).toFixed(0) + ' KB';
        content += '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + pendingMedia.name + ' (' + sizeStr + ')</span>';
        content += '<button onclick="window._clearPendingMedia()" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:1rem;padding:2px 6px" title="Elimină">✕</button>';
        preview.innerHTML = content;
        const inputRow = document.getElementById('input-row');
        if (inputRow) inputRow.parentNode.insertBefore(preview, inputRow);
    }

    function removeMediaPreview() {
        const el = document.getElementById('media-preview');
        if (el) el.remove();
    }

    window._clearPendingMedia = function () {
        pendingMedia = null;
        removeMediaPreview();
        const fi = document.getElementById('file-input-hidden');
        if (fi) fi.value = '';
    };

    // Wire btn-plus → file picker
    (function () {
        const btnPlus = document.getElementById('btn-plus');
        const fileInput = document.getElementById('file-input-hidden');
        if (btnPlus && fileInput) {
            btnPlus.title = 'Atașează fișier (imagine, PDF, audio, arhivă)';
            btnPlus.textContent = '📎';
            btnPlus.addEventListener('click', function (e) {
                e.preventDefault();
                fileInput.click();
            });
            fileInput.addEventListener('change', function () {
                if (fileInput.files && fileInput.files[0]) {
                    handleFileAttach(fileInput.files[0]);
                }
            });
        }
    })();

    // Paste handler — paste images from clipboard
    document.addEventListener('paste', function (e) {
        if (!e.clipboardData || !e.clipboardData.items) return;
        for (let i = 0; i < e.clipboardData.items.length; i++) {
            const item = e.clipboardData.items[i];
            if (item.type.indexOf('image') !== -1) {
                e.preventDefault();
                const blob = item.getAsFile();
                if (blob) {
                    blob.name = blob.name || 'clipboard-image.png';
                    handleFileAttach(blob);
                }
                break;
            }
        }
    });

    // Drag & drop handler — connected to existing drop-zone
    (function () {
        const dropZone = document.getElementById('drop-zone');
        const body = document.body;
        let dragCounter = 0;

        body.addEventListener('dragenter', function (e) {
            e.preventDefault();
            dragCounter++;
            if (dropZone) dropZone.classList.remove('hidden');
        });
        body.addEventListener('dragleave', function (e) {
            e.preventDefault();
            dragCounter--;
            if (dragCounter <= 0) {
                dragCounter = 0;
                if (dropZone) dropZone.classList.add('hidden');
            }
        });
        body.addEventListener('dragover', function (e) {
            e.preventDefault();
        });
        body.addEventListener('drop', function (e) {
            e.preventDefault();
            dragCounter = 0;
            if (dropZone) dropZone.classList.add('hidden');
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
                handleFileAttach(e.dataTransfer.files[0]);
            }
        });
    })();



    // ═══════════════════════════════════════════════════════════
    // SYNCED CHAT — Voice + Text synchronized
    // Flow: get AI reply → create empty div → speak() → on audio-start → reveal text char-by-char
    // ═══════════════════════════════════════════════════════════
    let _speakGeneration = 0; // atomic counter to prevent voice overlap

    async function sendToAI_Regular(message, language) {
        showThinking(true);
        // Stop any ongoing speech BEFORE starting new request
        if (window.KVoice) KVoice.stopSpeaking();
        KAvatar.setExpression('thinking', 0.5);

        // Capture pending media before clearing
        const mediaToSend = pendingMedia;
        if (mediaToSend) {
            window._clearPendingMedia();
            // If no text message, add default
            if (!message || !message.trim()) {
                message = 'Analizează această imagine';
            }
            // Show image preview in chat
            if (mediaToSend.previewUrl) {
                addMessage('user', message + '\n<img src="' + mediaToSend.previewUrl + '" style="max-width:200px;max-height:150px;border-radius:8px;margin-top:6px;display:block">');
            } else {
                addMessage('user', message + ' 📎 ' + mediaToSend.name);
            }
        }

        try {
            const payload = {
                message,
                avatar: KAvatar.getCurrentAvatar(),
                history: chatHistory.slice(-50),
                language: language || (window.i18n ? i18n.getLanguage() : 'ro'),
                conversationId: currentConversationId,
                geo: window.KGeo ? KGeo.getCached() : null
            };
            // Attach media if present (manual upload)
            if (mediaToSend) {
                payload.imageBase64 = mediaToSend.base64;
                payload.imageMimeType = mediaToSend.mimeType;
            }
            // Auto-camera: if active and no manual image, snap a frame
            else if (window.KAutoCamera && KAutoCamera.isActive()) {
                const frame = KAutoCamera.captureFrame();
                if (frame) {
                    payload.imageBase64 = frame.base64;
                    payload.imageMimeType = frame.mimeType;
                    payload.isAutoCamera = true; // flag for concise vision responses
                }
            }

            const resp = await fetch(API_BASE + '/api/chat', {
                method: 'POST', headers: authHeaders(),
                body: JSON.stringify(payload)
            });

            showThinking(false);
            if (!resp.ok) {
                const e = await resp.json().catch(() => ({}));
                if (resp.status === 429 && e.upgrade) {
                    const planName = e.plan ? (e.plan.charAt(0).toUpperCase() + e.plan.slice(1)) : 'Free';
                    addMessage('assistant', 'You have reached the daily limit for the ' + planName + ' plan. Say \'Kelion, upgrade\' or click ⭐ Plans to see options.');
                } else if (resp.status === 429) {
                    addMessage('assistant', '⏳ Too many messages. Please wait a moment.');
                } else addMessage('assistant', e.error || 'Error.');
                if (window.KVoice) KVoice.resumeWakeDetection();
                return;
            }

            const data = await resp.json();
            const fullReply = (data.reply || '').replace(/\[SYSTEM INSTRUCTION[^\]]*\][\s\S]*?\[END SYSTEM INSTRUCTION\]\s*/gi, '').replace(/\[AGENT ACTIV[^\]]*\]\s*/gi, '').trim();
            if (data.conversationId) persistConvId(data.conversationId);

            if (!fullReply) {
                addMessage('assistant', '...');
                if (window.KVoice) KVoice.resumeWakeDetection();
                return;
            }

            chatHistory.push({ role: 'user', content: message });
            chatHistory.push({ role: 'assistant', content: fullReply });

            // Monitor content
            if (data.monitor && data.monitor.content) {
                showOnMonitor(data.monitor.content, data.monitor.type);
            } else if (data.monitor && data.monitor.search_results) {
                if (window.MonitorManager) MonitorManager.showSearchResults(data.monitor.search_results);
            } else if (data.monitor && data.monitor.weather) {
                if (window.MonitorManager) MonitorManager.showWeather(data.monitor.weather);
            }

            const imgMatch = fullReply.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)/i);
            if (imgMatch && !data.monitor?.content) showOnMonitor(imgMatch[0], 'image');

            const coordMatch2 = fullReply.match(/(-?\d+\.?\d*)[°\s,]+([NS])?\s*,?\s*(-?\d+\.?\d*)[°\s,]+([EW])?/i);
            if (!imgMatch && !data.monitor?.content && coordMatch2) {
                const lat2 = parseFloat(coordMatch2[1]);
                const lng2 = parseFloat(coordMatch2[3]);
                if (!isNaN(lat2) && !isNaN(lng2) && window.MonitorManager) MonitorManager.showMap(lat2, lng2);
            }

            // ── SYNCED VOICE + TEXT ──
            // Create empty message — text will be revealed with voice
            const overlay = document.getElementById('chat-overlay');
            overlay.innerHTML = ''; // Clear previous — max 1 phrase on screen

            // ── COPY + SAVE BUTTONS (top-right of monitor) ──
            const actionBar = document.createElement('div');
            actionBar.className = 'msg-actions';
            actionBar.innerHTML = '<button class="msg-action-btn" id="btn-copy-msg" title="Copiază text">📋</button>' +
                '<button class="msg-action-btn" id="btn-save-msg" title="Salvează ca fișier">💾</button>';
            overlay.appendChild(actionBar);
            // Wire copy button
            actionBar.querySelector('#btn-copy-msg').onclick = function () {
                navigator.clipboard.writeText(fullReply).then(function () {
                    actionBar.querySelector('#btn-copy-msg').textContent = '✅';
                    setTimeout(function () { actionBar.querySelector('#btn-copy-msg').textContent = '📋'; }, 1500);
                }).catch(function () {
                    // Fallback: textarea copy
                    const ta = document.createElement('textarea'); ta.value = fullReply; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
                    actionBar.querySelector('#btn-copy-msg').textContent = '✅';
                    setTimeout(function () { actionBar.querySelector('#btn-copy-msg').textContent = '📋'; }, 1500);
                });
            };
            // Wire save button
            actionBar.querySelector('#btn-save-msg').onclick = function () {
                const blob = new Blob([fullReply], { type: 'text/plain;charset=utf-8' });
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = 'kelion-response-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.txt';
                a.click();
                URL.revokeObjectURL(a.href);
            };

            const msgEl = document.createElement('div');
            msgEl.className = 'msg assistant';
            msgEl.style.userSelect = 'text';
            msgEl.innerHTML = '';
            overlay.appendChild(msgEl);
            overlay.scrollTop = overlay.scrollHeight;

            // ── BRAIN-DIRECTED AVATAR CONTROL ──
            // Emotion from brain (replaces hardcoded 'happy')
            const brainEmotion = data.emotion || 'happy';
            KAvatar.setExpression(brainEmotion, 0.5);

            // Gestures from brain (nod, shake, wave, tilt, etc.)
            if (data.gestures && data.gestures.length > 0) {
                data.gestures.forEach(function (g, i) {
                    setTimeout(function () { KAvatar.playGesture(g); }, i * 800);
                });
            }

            // Pose from brain (relaxed, presenting, crossed, open)
            if (data.pose && KAvatar.setPose) {
                KAvatar.setPose(data.pose);
            }

            // Body actions from brain (per-limb IK: raiseLeftHand, wavRight, etc.)
            if (data.bodyActions && data.bodyActions.length > 0 && KAvatar.playBodyAction) {
                data.bodyActions.forEach(function (ba, i) {
                    setTimeout(function () { KAvatar.playBodyAction(ba); }, i * 1500);
                });
            }

            // Eye gaze from brain (center, left, right, up, down, up-left, etc.)
            if (data.gaze && KAvatar.setEyeGaze) {
                KAvatar.setEyeGaze(data.gaze);
                // Return to natural idle after 3 seconds
                setTimeout(function () { try { KAvatar.startEyeIdle(); } catch (_e) { /* ok */ } }, 3000);
            }

            // ── AUTO-DISPLAY: Show reply on monitor if it has structured content ──
            if (window.MonitorManager && fullReply) {
                const hasStructure = /^[\-\*\d]\s|^#{1,3}\s|\*\*|```|\n\n/m.test(fullReply);
                const isLong = fullReply.length > 80;
                if (hasStructure || isLong) {
                    MonitorManager.showMarkdown(fullReply);
                }
            }

            // ── #53 BRAIN-MAP: Populate brain thinking panel ──
            if (typeof addBrainNode === 'function') {
                const now = new Date().toLocaleTimeString();
                addBrainNode('Response · ' + now, fullReply.substring(0, 80) + (fullReply.length > 80 ? '…' : ''));
                if (brainEmotion && brainEmotion !== 'happy') addBrainNode('Emotion', '🎭 ' + brainEmotion);
                if (data.gestures && data.gestures.length) addBrainNode('Gestures', '👋 ' + data.gestures.join(', '));
                if (data.bodyActions && data.bodyActions.length) addBrainNode('Body', '🏃 ' + data.bodyActions.join(', '));
                if (data.tools_used && data.tools_used.length) addBrainNode('Tools', '🔧 ' + data.tools_used.join(', '));
            }

            // Increment generation counter to prevent overlap
            const thisGen = ++_speakGeneration;
            let _textRevealed = false; // guard: only ONE source writes text

            // Listen for audio-start event to sync text reveal
            const revealHandler = function (e) {
                window.removeEventListener('audio-start', revealHandler);
                if (thisGen !== _speakGeneration) return; // stale, skip
                if (_textRevealed) return; // already shown by fallback
                _textRevealed = true;
                const duration = e.detail.duration;
                const msPerChar = (duration * 1000) / fullReply.length;
                let charIdx = 0;
                const timer = setInterval(function () {
                    if (thisGen !== _speakGeneration) { clearInterval(timer); return; }
                    charIdx++;
                    if (charIdx >= fullReply.length) {
                        clearInterval(timer);
                        msgEl.innerHTML = parseMarkdown(fullReply);
                        overlay.scrollTop = overlay.scrollHeight;
                        return;
                    }
                    msgEl.innerHTML = parseMarkdown(fullReply.substring(0, charIdx));
                    overlay.scrollTop = overlay.scrollHeight;
                }, msPerChar);
            };
            window.addEventListener('audio-start', revealHandler);

            // Speak — triggers 'audio-start' event when audio actually starts
            if (window.KVoice) {
                // Auto-switch TTS voice to match AI response language
                if (data.language && KVoice.setLanguage) {
                    KVoice.setLanguage(data.language);
                }
                KVoice.speak(fullReply, data.avatar || KAvatar.getCurrentAvatar());
            }

            // Fallback: if audio doesn't start in 15s, show text anyway
            // (increased from 4s because TTS fetch for long texts can take 5-10s)
            setTimeout(function () {
                window.removeEventListener('audio-start', revealHandler);
                if (_textRevealed) return; // audio handler already revealed
                _textRevealed = true;
                if (!msgEl.innerHTML || msgEl.innerHTML === '') {
                    msgEl.innerHTML = parseMarkdown(fullReply);
                    overlay.scrollTop = overlay.scrollHeight;
                }
            }, 15000);




        } catch (_e) {
            showThinking(false);
            addMessage('assistant', 'Connection error.');
            if (window.KVoice) KVoice.resumeWakeDetection();
        }
    }

    // ─── Route to streaming or regular ─────────────────────
    async function sendToAI(message, language) {
        let msg = message;
        if (window.KelionTools) {
            try {
                const ctx = await KelionTools.preprocessMessage(message);
                // Strip base64 image data — it's already on monitor, don't send to chat API
                // (sending 500KB+ base64 data exceeds chatSchema.message.max(10000) → "Validation failed")
                if (ctx) {
                    const cleanCtx = ctx.replace(/!\[.*?\]\(data:[^)]+\)/g, '').trim();
                    if (cleanCtx) msg = message + cleanCtx;
                }
            } catch (e) { console.warn('[Tools] preprocessMessage error:', e.message); }
        }
        await sendToAI_Regular(msg, language);
    }

    // ═══════════════════════════════════════════════════════════
    // CONVERSATION HISTORY UI
    // ═══════════════════════════════════════════════════════════
    async function loadConversations() {
        const list = document.getElementById('history-list');
        if (!list) return;
        list.innerHTML = '<div class="history-empty">Loading...</div>';

        try {
            const r = await fetch(API_BASE + '/api/conversations', { headers: authHeaders() });
            if (!r.ok) throw new Error('Error');
            const data = await r.json();
            const convs = data.conversations || data || [];

            if (convs.length === 0) {
                list.innerHTML = '<div class="history-empty">No conversations yet.<br>Start chatting!</div>';
                return;
            }

            list.innerHTML = '';
            for (const c of convs) {
                const item = document.createElement('div');
                item.className = 'history-item' + (c.id === currentConversationId ? ' active' : '');
                const date = new Date(c.updated_at || c.created_at);
                const timeAgo = formatTimeAgo(date);
                item.innerHTML = '<div class="history-item-title">' + escapeHtml(c.title || 'Conversation') + '</div>' +
                    '<div class="history-item-meta"><span class="history-item-avatar">' + (c.avatar || 'kelion') + '</span> · ' + timeAgo + '</div>';
                item.addEventListener('click', () => resumeConversation(c.id, c.avatar));
                list.appendChild(item);
            }
        } catch (_e) {
            list.innerHTML = '<div class="history-empty">Unable to load history.<br>Check authentication.</div>';
        }
    }

    async function resumeConversation(convId, avatar) {
        try {
            if (avatar && avatar !== KAvatar.getCurrentAvatar()) switchAvatar(avatar);
            persistConvId(convId);

            const r = await fetch(API_BASE + '/api/conversations/' + convId + '/messages', { headers: authHeaders() });
            if (!r.ok) throw new Error('Error');
            const data = await r.json();
            const msgs = data.messages || data || [];

            chatHistory = [];
            const overlay = document.getElementById('chat-overlay');
            overlay.innerHTML = '';

            for (const m of msgs) {
                const role = m.role === 'assistant' ? 'assistant' : 'user';
                addMessage(role, m.content);
                chatHistory.push({ role: role, content: m.content });
            }

            document.querySelectorAll('.history-item').forEach(function (el) { el.classList.remove('active'); });
            if (window.innerWidth < 768) toggleHistory(false);
        } catch (_e) {
            addMessage('assistant', 'Failed to load conversation.');
        }
    }

    function startNewChat() {
        persistConvId(null);
        chatHistory = [];
        const overlay = document.getElementById('chat-overlay');
        if (overlay) overlay.innerHTML = '';
        document.querySelectorAll('.history-item').forEach(function (el) { el.classList.remove('active'); });
        if (window.innerWidth < 768) toggleHistory(false);
    }

    function toggleHistory(forceState) {
        const sidebar = document.getElementById('history-sidebar');
        if (!sidebar) return;
        historyOpen = forceState !== undefined ? forceState : !historyOpen;
        sidebar.classList.toggle('hidden', !historyOpen);
        if (historyOpen) loadConversations();
    }

    function formatTimeAgo(date) {
        const now = new Date(), diff = now - date;
        const mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + ' min';
        const hours = Math.floor(mins / 60);
        if (hours < 24) return hours + 'h';
        const days = Math.floor(hours / 24);
        if (days < 7) return days + 'd';
        return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    }

    function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

    // ─── Markdown parser for chat messages ─────────────────────
    function parseMarkdown(text) {
        if (!text) return '';
        let html = escapeHtml(text);
        // Bold: **text** or __text__
        html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
        // Italic: *text* or _text_
        html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
        // Inline code: `code`
        html = html.replace(/`([^`]+)`/g, '<code style="background:#1a1a2e;padding:2px 6px;border-radius:4px;font-size:0.9em">$1</code>');
        // Horizontal rules: --- or ___
        html = html.replace(/^(---|___)$/gm, '<hr style="border:none;border-top:1px solid #444;margin:8px 0">');
        // Bullet lists: - item or * item
        html = html.replace(/^[\-\*]\s+(.+)$/gm, '<li style="margin-left:16px;list-style:disc">$1</li>');
        // Numbered lists: 1. item
        html = html.replace(/^\d+\.\s+(.+)$/gm, '<li style="margin-left:16px;list-style:decimal">$1</li>');
        // Line breaks
        html = html.replace(/\n/g, '<br>');
        return html;
    }

    // ─── UI ──────────────────────────────────────────────────
    function addMessage(type, text) {
        // Strip any leaked system instructions from display
        text = (text || '').replace(/\[SYSTEM INSTRUCTION[^\]]*\][\s\S]*?\[END SYSTEM INSTRUCTION\]\s*/gi, '').replace(/\[AGENT ACTIV[^\]]*\]\s*/gi, '').trim();
        if (!text) return; // Don't show empty messages
        const o = document.getElementById('chat-overlay');
        o.innerHTML = ''; // Clear previous — max 1 phrase on screen at a time
        const m = document.createElement('div');
        m.className = 'msg ' + type;
        if (type === 'assistant') {
            m.innerHTML = parseMarkdown(text);
        } else {
            m.textContent = text;
        }
        o.appendChild(m);
        o.scrollTop = o.scrollHeight;
        // Auto-clear text after 5 seconds
        setTimeout(function () { if (o.contains(m)) o.removeChild(m); }, 5000);
    }
    function _updateSubtitle(/* type, text */) {
        // Disabled — messages already visible in chat overlay, subtitle caused duplicate display
        return;
    }
    function showThinking(v) { document.getElementById('thinking').classList.toggle('active', v); }
    function hideWelcome() { const w = document.getElementById('welcome'); if (w) w.classList.add('hidden'); }

    function switchAvatar(name) {
        if (window.KVoice) KVoice.stopSpeaking();
        try { KAvatar.loadAvatar(name); } catch (e) { console.warn('[App] Avatar load failed:', e.message); }
        document.querySelectorAll('.avatar-pill').forEach(function (b) { b.classList.toggle('active', b.dataset.avatar === name); });
        const displayName = name.charAt(0).toUpperCase() + name.slice(1);
        const n = document.getElementById('avatar-name'); if (n) n.textContent = displayName;
        const navName = document.getElementById('navbar-avatar-name'); if (navName) navName.textContent = displayName;
        document.title = displayName + 'AI';
        // DO NOT clear chat history or chat overlay when switching avatars
        // chatHistory = []; persistConvId(null);
        // var o = document.getElementById('chat-overlay'); if (o) o.innerHTML = '';
    }

    // ─── Upgrade voice command detection ─────────────────────
    // Matches: "Kelion/Chelion, upgrade/abonament", "vreau pro/premium", "upgrade plan"
    function isUpgradeRequest(t) {
        const l = t.toLowerCase();
        return /(kelion|chelion)[,.\s]+(upgrade|abonament)|vreau\s+(pro|premium)|upgrade\s+plan/.test(l);
    }

    // ─── Input handlers ──────────────────────────────────────
    async function onSendText() {
        const inp = document.getElementById('text-input'); let text = inp.value.trim(); if (!text) return; inp.value = '';
        const l = text.toLowerCase();
        if (/^(kira|chira)[,.\s]/i.test(l)) { switchAvatar('kira'); text = text.replace(/^(kira|chira)[,.\s]*/i, '').trim(); }
        else if (/^(kelion|chelion)[,.\s]/i.test(l)) { switchAvatar('kelion'); text = text.replace(/^(kelion|chelion)[,.\s]*/i, '').trim(); }
        if (!text) return;
        if (isUpgradeRequest(text)) { if (window.KPayments) KPayments.showUpgradePrompt(); return; }
        // ─── Admin code detection (only for short code-like messages) ─────
        const looksLikeCode = text.length < 40 && !/\b(ce|cum|de|la|si|sau|nu|da|eu|tu|el|ea|am|ai|are|sunt|esti|este|vreau|vrei|fa|pune|arata|spune|caut|deschide|salut|buna|hey|hi|hello|what|how|when|where)\b/i.test(text);
        if (looksLikeCode) {
            try {
                const codeResp = await fetch(API_BASE + '/api/admin/verify-code', {
                    method: 'POST', headers: authHeaders(),
                    body: JSON.stringify({ code: text })
                });
                if (codeResp.ok) {
                    const codeData = await codeResp.json();
                    hideWelcome(); addMessage('user', '🔑 •••••');
                    if (codeData.action === 'enter') {
                        adminSecret = codeData.secret;
                        sessionStorage.setItem('kelion_admin_secret', codeData.secret);
                        // Unlock admin button
                        const ab = document.getElementById('btn-admin');
                        if (ab) {
                            ab.dataset.locked = 'false';
                            ab.style.cssText = 'padding:8px 14px;font-size:0.85rem;background:rgba(16,185,129,0.2);border:1px solid rgba(16,185,129,0.5);border-radius:8px;color:#34d399;cursor:pointer;font-family:var(--kelion-font);transition:all 0.4s;opacity:1;';
                            ab.title = 'Admin Panel — Unlocked';
                            ab.textContent = '🛡️ Admin';
                            ab.onclick = function () { window.open('/admin/', '_blank'); };
                        }
                    } else if (codeData.action === 'exit') {
                        adminSecret = null;
                        sessionStorage.removeItem('kelion_admin_secret');
                        // Re-lock admin button
                        const ab2 = document.getElementById('btn-admin');
                        if (ab2) {
                            ab2.dataset.locked = 'true';
                            ab2.style.cssText = 'padding:8px 14px;font-size:0.85rem;background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.3);border-radius:8px;color:#fca5a5;cursor:not-allowed;font-family:var(--kelion-font);transition:all 0.4s;opacity:0.7;';
                            ab2.title = 'Admin Panel — Locked';
                            ab2.textContent = '🔒 Admin';
                            ab2.onclick = null;
                        }
                    }
                    return;
                }
            } catch (_e) { /* continue normally */ }
        }
        // Web command — show on monitor + open in new tab backup
        const webUrl = tryWebCommand(text);
        if (webUrl) {
            hideWelcome(); addMessage('user', text);
            // Show on monitor
            if (window.MonitorManager) MonitorManager.showWebContent(webUrl);
            // Also open in new tab (backup for sites that block iframes)
            window.open(webUrl, '_blank');
            addMessage('assistant', '🌐 Am deschis ' + webUrl + ' pe monitor și într-un tab nou!');
            if (window.KVoice) KVoice.speak('Gata, am deschis pentru tine!');
            return;
        }
        // Monitor clear command
        if (isMonitorClear(text)) {
            hideWelcome(); addMessage('user', text);
            if (window.MonitorManager) MonitorManager.clear();
            addMessage('assistant', 'Am golit monitorul!');
            if (window.KVoice) KVoice.speak('Gata, am golit monitorul!');
            return;
        }
        hideWelcome(); KAvatar.setAttentive(true); addMessage('user', text); showThinking(true);
        // Unlock AudioContext on text send — ensures voice plays without needing mic press
        if (window.KVoice && KVoice.ensureAudioUnlocked) KVoice.ensureAudioUnlocked();
        if (isVisionRequest(text)) triggerVision(); else await sendToAI(text, 'ro');
    }

    // ─── Drag & Drop ─────────────────────────────────────────
    function setupDragDrop() {
        const dp = document.getElementById('display-panel'), dz = document.getElementById('drop-zone'); if (!dp || !dz) return;
        dp.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.remove('hidden'); });
        dp.addEventListener('dragleave', function (e) { if (!dp.contains(e.relatedTarget)) dz.classList.add('hidden'); });
        dp.addEventListener('drop', function (e) { e.preventDefault(); dz.classList.add('hidden'); handleFiles(e.dataTransfer.files); });
    }

    async function handleFiles(fileList) {
        hideWelcome();
        for (let i = 0; i < fileList.length; i++) {
            const file = fileList[i];
            const reader = new FileReader();
            reader.onload = async function () {
                storedFiles.push({ name: file.name, size: file.size, type: file.type, data: reader.result });
                addMessage('user', '📎 ' + file.name + ' (' + Math.round(file.size / 1024) + ' KB)');
                if (file.type.startsWith('image/')) {
                    const b64 = reader.result.split(',')[1];
                    KAvatar.setExpression('thinking', 0.5); showThinking(true);
                    try {
                        const r = await fetch(API_BASE + '/api/vision', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ image: b64, avatar: KAvatar.getCurrentAvatar(), language: window.KVoice ? KVoice.getLanguage() : 'en' }) });
                        const d = await r.json(); showThinking(false); addMessage('assistant', d.description || 'Could not analyze.');
                        KAvatar.setExpression('happy', 0.3); if (window.KVoice) await KVoice.speak(d.description);
                    } catch (_e) { showThinking(false); addMessage('assistant', 'Analysis error.'); }
                } else { addMessage('assistant', 'I received ' + file.name + '. What should I do with it?'); }
            };
            if (file.type.startsWith('text/') || file.name.match(/\.(txt|md|json|csv)$/)) reader.readAsText(file);
            else reader.readAsDataURL(file);
        }
    }

    // ─── Health check ────────────────────────────────────────
    async function checkHealth() {
        try {
            const r = await fetch(API_BASE + '/api/health');
            const d = await r.json();
            if (d.status === 'ok' || d.status === 'online') {
                const statusText = document.getElementById('status-text');
                const statusDot = document.getElementById('status-dot');
                if (statusText) statusText.textContent = 'Online' + (d.brain !== 'healthy' ? ' ⚠️' : '');
                if (statusDot) statusDot.style.background = d.brain === 'healthy' ? '#00ff88' : '#ffaa00';
                if (d.services && !d.services.ai_gemini) useStreaming = false;
            }
        } catch (_e) {
            const statusText = document.getElementById('status-text');
            const statusDot = document.getElementById('status-dot');
            if (statusText) statusText.textContent = 'Offline';
            if (statusDot) statusDot.style.background = '#ff4444';
            useStreaming = false;
        }
    }

    // ─── INIT ────────────────────────────────────────────────
    function init() {
        // ─── Splash: loading animation, auto-dismissed after 3s ──
        // NOTE: This is just the loading overlay. Auth-screen (with START button) stays visible
        // until user clicks START — that click is the user gesture needed for AudioContext
        const splashEl = document.getElementById('splash-screen');
        function dismissSplash() {
            if (splashEl && splashEl.parentNode) {
                splashEl.style.opacity = '0';
                splashEl.style.pointerEvents = 'none';
                setTimeout(function () { if (splashEl && splashEl.parentNode) splashEl.parentNode.removeChild(splashEl); }, 600);
            }
        }
        const splashTimer = setTimeout(dismissSplash, 3000);
        // NO auth safety auto-show — START button is the only gate

        if (window.KAuth) KAuth.init();
        try {
            KAvatar.init();
            // Auto-start natural eye movement
            setTimeout(function () { try { KAvatar.startEyeIdle(); } catch (_e) { /* ok */ } }, 3000);
        } catch (e) {
            console.error('[App] Avatar init failed:', e.message);
            const canvas = document.getElementById('avatar-canvas');
            if (canvas) canvas.style.display = 'none';
        }

        ['click', 'touchstart', 'keydown'].forEach(function (e) { document.addEventListener(e, unlockAudio, { once: true, passive: true }); });

        const sendBtn = document.getElementById('btn-send');
        if (sendBtn) sendBtn.addEventListener('click', onSendText);
        document.getElementById('text-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') onSendText(); });

        // ─── Clipboard paste — Ctrl+V images into chat ──────────
        document.addEventListener('paste', function (e) {
            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
            if (!items) return;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image') !== -1) {
                    e.preventDefault();
                    const blob = items[i].getAsFile();
                    const reader = new FileReader();
                    reader.onload = function (ev) {
                        const b64 = ev.target.result;
                        // Show preview in chat
                        addMessage('user', '📷 [Screenshot pasted]');
                        const overlay = document.getElementById('chat-overlay');
                        const imgEl = document.createElement('div');
                        imgEl.className = 'msg user';
                        imgEl.innerHTML = '<img src="' + b64 + '" style="max-width:200px;border-radius:8px;margin:4px 0;">';
                        overlay.appendChild(imgEl);
                        overlay.scrollTop = overlay.scrollHeight;
                        // Send to vision API for analysis
                        showThinking(true);
                        const rawB64 = b64.replace(/^data:image\/[a-z+]+;base64,/, '');
                        fetch(API_BASE + '/api/vision', {
                            method: 'POST',
                            headers: authHeaders(),
                            body: JSON.stringify({
                                image: rawB64,
                                avatar: window.KAvatar ? KAvatar.getCurrentAvatar() : 'kelion',
                                language: 'ro'
                            })
                        })
                            .then(function (r) { return r.json(); })
                            .then(function (data) {
                                showThinking(false);
                                const desc = data.description || data.reply || 'Nu am putut analiza imaginea.';
                                addMessage('assistant', desc);
                                chatHistory.push({ role: 'user', content: '[User pasted a screenshot]' });
                                chatHistory.push({ role: 'assistant', content: desc });
                                if (window.KVoice) KVoice.speak(desc);
                            })
                            .catch(function (err) {
                                showThinking(false);
                                addMessage('assistant', 'Eroare la analiza imaginii: ' + err.message);
                            });
                    };
                    reader.readAsDataURL(blob);
                    break;
                }
            }
        });

        document.querySelectorAll('.avatar-pill').forEach(function (b) { b.addEventListener('click', function () { switchAvatar(b.dataset.avatar); }); });

        // Mic toggle button — explicit permission request
        const micToggle = document.getElementById('btn-mic-toggle');
        let micOn = false;
        let _micRetryCount = 0;
        let _micNoSpeechTimer = null;
        if (micToggle) {
            micToggle.addEventListener('click', async function () {
                if (!micOn) {
                    micToggle.style.borderColor = '#ffaa00';
                    micToggle.style.color = '#ffaa00';
                    micToggle.title = 'Requesting mic permission...';
                    try {
                        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                        stream.getTracks().forEach(function (t) { t.stop(); });
                        micOn = true;
                        _micRetryCount = 0;
                        if (window.KVoice) { KVoice.ensureAudioUnlocked(); if (KVoice.stopWakeWordDetection) KVoice.stopWakeWordDetection(); }
                        // Start DIRECT speech recognition — no wake word needed
                        const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
                        if (SR) {
                            window._directSpeech = new SR();
                            window._directSpeech.continuous = true;
                            window._directSpeech.interimResults = true;
                            // DEFAULT: Romanian (ro-RO) — primary user language
                            // Falls back to i18n language if explicitly set to something else
                            const i18nLang = (window.i18n && i18n.getLanguage && i18n.getLanguage()) || null;
                            let micLang = 'ro-RO'; // DEFAULT Romanian
                            if (i18nLang && i18nLang !== 'en') {
                                // Only override if user explicitly chose a non-English language
                                micLang = i18nLang;
                            }
                            // Ensure full locale format for better recognition
                            if (micLang === 'ro') micLang = 'ro-RO';
                            if (micLang === 'en') micLang = 'en-US';
                            if (micLang === 'de') micLang = 'de-DE';
                            if (micLang === 'fr') micLang = 'fr-FR';
                            if (micLang === 'es') micLang = 'es-ES';
                            window._directSpeech.lang = micLang;
                            console.log('[Mic] ✅ SpeechRecognition language:', micLang);
                            window._directSpeech.onresult = function (ev) {
                                _micRetryCount = 0; // reset on successful result
                                // Clear no-speech warning timer
                                if (_micNoSpeechTimer) { clearTimeout(_micNoSpeechTimer); _micNoSpeechTimer = null; }
                                for (let i = ev.resultIndex; i < ev.results.length; i++) {
                                    if (ev.results[i].isFinal) {
                                        const text = ev.results[i][0].transcript.trim();
                                        const confidence = ev.results[i][0].confidence;
                                        console.log('[Mic] ✅ Final result:', text, 'confidence:', confidence.toFixed(2));
                                        if (text && text.length > 1) {
                                            // Auto-detect language from transcript
                                            if (window.KVoice && KVoice.setLanguage) {
                                                const detLang = /[ăîâșț]/i.test(text) ? 'ro' : 'en';
                                                KVoice.setLanguage(detLang);
                                            }
                                            hideWelcome(); addMessage('user', '🎙️ ' + text); showThinking(true);
                                            KAvatar.setAttentive(true);
                                            sendToAI(text, micLang.split('-')[0]);
                                        }
                                    } else {
                                        // Interim result — show user that mic is hearing
                                        const interim = ev.results[i][0].transcript.trim();
                                        if (interim.length > 2) {
                                            console.log('[Mic] 🔄 Hearing:', interim);
                                        }
                                    }
                                }
                            };
                            window._directSpeech.onaudiostart = function () {
                                console.log('[Mic] 🎤 Audio capture started');
                                // Start no-speech warning timer (8s)
                                _micNoSpeechTimer = setTimeout(function () {
                                    console.warn('[Mic] ⚠️ No speech detected for 8 seconds — mic may not be picking up audio');
                                }, 8000);
                            };
                            window._directSpeech.onspeechstart = function () {
                                console.log('[Mic] 🗣️ Speech detected');
                                if (_micNoSpeechTimer) { clearTimeout(_micNoSpeechTimer); _micNoSpeechTimer = null; }
                            };
                            window._directSpeech.onsoundstart = function () { console.log('[Mic] 🔊 Sound detected'); };
                            window._directSpeech.onnomatch = function () { console.warn('[Mic] ⚠️ No match — speech not recognized (try speaking louder or clearer)'); };
                            window._directSpeech.onend = function () {
                                console.log('[Mic] Recognition ended, micOn:', micOn, 'retries:', _micRetryCount);
                                if (micOn && _micRetryCount < 50) {
                                    // Don't restart while AI is speaking — wait for it to finish
                                    if (window.KVoice && KVoice.isSpeaking && KVoice.isSpeaking()) {
                                        console.log('[Mic] ⏸️ AI is speaking, waiting to restart...');
                                        const waitForSpeech = setInterval(function () {
                                            if (!KVoice.isSpeaking()) {
                                                clearInterval(waitForSpeech);
                                                if (micOn) {
                                                    try { window._directSpeech.start(); console.log('[Mic] ▶️ Restarted after AI speech'); } catch (e) { console.warn('[Mic] Restart failed:', e.message); }
                                                }
                                            }
                                        }, 500);
                                        return;
                                    }
                                    _micRetryCount++;
                                    try { window._directSpeech.start(); } catch (e) { console.warn('[Mic] Restart failed:', e.message); }
                                } else if (_micRetryCount >= 50) {
                                    console.error('[Mic] ❌ Too many restarts, stopping mic');
                                    micOn = false;
                                    micToggle.style.borderColor = '#ff4444';
                                    micToggle.style.color = '#ff4444';
                                    micToggle.title = '🔴 Mic crashed — click to retry';
                                }
                            };
                            window._directSpeech.onerror = function (e) {
                                console.warn('[Mic] Error:', e.error, e.message || '');
                                if (e.error === 'no-speech') {
                                    console.log('[Mic] ℹ️ No speech detected — this is normal, will auto-restart');
                                }
                                if (e.error === 'not-allowed') {
                                    micOn = false;
                                    micToggle.style.borderColor = '#ff4444';
                                    micToggle.style.color = '#ff4444';
                                    micToggle.title = '🔴 Mic permission denied — check browser settings';
                                    console.error('[Mic] ❌ Permission denied by browser');
                                    return;
                                }
                                if (micOn && _micRetryCount < 50) {
                                    _micRetryCount++;
                                    setTimeout(function () { try { window._directSpeech.start(); } catch (_e) { /* ignored */ } }, 1000);
                                }
                            };
                            window._directSpeech.start();
                            console.log('[Mic] ▶️ SpeechRecognition started successfully');
                        } else {
                            console.error('[Mic] ❌ SpeechRecognition API not available in this browser');
                            micToggle.style.borderColor = '#ff4444';
                            micToggle.style.color = '#ff4444';
                            micToggle.title = '🔴 Browser does not support speech recognition';
                            micOn = false;
                            return;
                        }
                        micToggle.style.borderColor = '#00ff88';
                        micToggle.style.color = '#00ff88';
                        micToggle.style.boxShadow = '0 0 12px rgba(0,255,136,0.4)';
                        micToggle.title = '🟢 Mic ON — vorbește liber! (ro-RO)';
                        console.log('[App] ✅ Mic ON — direct speech mode, lang:', micLang);
                        // Start mic monitor for visual feedback
                        if (window.KVoice && KVoice.startMicMonitor) KVoice.startMicMonitor();
                        // Show bargraph indicator
                        const micLevelEl = document.getElementById('mic-level');
                        if (micLevelEl) micLevelEl.style.display = 'flex';
                    } catch (e) {
                        micToggle.style.borderColor = '#ff4444';
                        micToggle.style.color = '#ff4444';
                        micToggle.style.boxShadow = 'none';
                        micToggle.title = '🔴 Mic blocked — check browser permissions';
                        console.error('[App] Mic permission denied:', e.message);
                    }
                } else {
                    micOn = false;
                    if (_micNoSpeechTimer) { clearTimeout(_micNoSpeechTimer); _micNoSpeechTimer = null; }
                    if (window._directSpeech) { try { window._directSpeech.stop(); } catch (_e) { /* ignored */ } window._directSpeech = null; }
                    if (window.KVoice && KVoice.startWakeWordDetection) KVoice.startWakeWordDetection();
                    micToggle.style.borderColor = '#555';
                    micToggle.style.color = '#888';
                    micToggle.style.boxShadow = 'none';
                    micToggle.title = 'Microphone OFF — click to turn on';
                    // Hide bargraph indicator
                    const micLevelEl = document.getElementById('mic-level');
                    if (micLevelEl) micLevelEl.style.display = 'none';
                    console.log('[App] Mic OFF');
                }
            });
        }

        // History buttons
        const histBtn = document.getElementById('btn-history');
        if (histBtn) histBtn.addEventListener('click', function () { toggleHistory(); });
        const closeHist = document.getElementById('btn-close-history');
        if (closeHist) closeHist.addEventListener('click', function () { toggleHistory(false); });
        const newChat = document.getElementById('btn-new-chat');
        if (newChat) newChat.addEventListener('click', startNewChat);

        // Pricing close
        const pricingClose = document.getElementById('pricing-close');
        if (pricingClose) pricingClose.addEventListener('click', function () { const m = document.getElementById('pricing-modal'); if (m) m.classList.add('hidden'); });

        // ➕ button — popup with IN (import) / OUT (export ZIP)
        const plusBtn = document.getElementById('btn-plus');
        const fileInput = document.getElementById('file-input-hidden');
        if (plusBtn) {
            plusBtn.addEventListener('click', function () {
                // Remove existing popup if any
                const old = document.getElementById('plus-popup');
                if (old) { old.remove(); return; }
                const popup = document.createElement('div');
                popup.id = 'plus-popup';
                popup.style.cssText = 'position:absolute;bottom:44px;right:0;background:#1a1a2e;border:1px solid #333;border-radius:8px;padding:6px;z-index:100;display:flex;gap:6px;box-shadow:0 4px 16px rgba(0,0,0,0.5);';
                popup.innerHTML = '<button id="plus-import" style="background:#2a2a4a;color:#a5b4fc;border:1px solid #444;border-radius:6px;padding:8px 16px;cursor:pointer;font-size:0.85rem;">📂 Adaugă fișier</button>' +
                    '<button id="plus-export" style="background:#2a2a4a;color:#86efac;border:1px solid #444;border-radius:6px;padding:8px 16px;cursor:pointer;font-size:0.85rem;">💾 Salvează tot</button>' +
                    '<button id="plus-export-chat" style="background:#2a2a4a;color:#fbbf24;border:1px solid #444;border-radius:6px;padding:8px 16px;cursor:pointer;font-size:0.85rem;">📥 Export chat</button>';
                plusBtn.parentElement.style.position = 'relative';
                plusBtn.parentElement.appendChild(popup);
                document.getElementById('plus-import').addEventListener('click', function () {
                    popup.remove();
                    if (fileInput) fileInput.click();
                });
                document.getElementById('plus-export').addEventListener('click', function () {
                    popup.remove();
                    if (window.MonitorManager) MonitorManager.downloadAsZip();
                });
                document.getElementById('plus-export-chat').addEventListener('click', function () {
                    popup.remove();
                    const blob = new Blob([JSON.stringify(chatHistory, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = 'kelion-chat-' + new Date().toISOString().slice(0, 10) + '.json'; a.click();
                    setTimeout(function () { URL.revokeObjectURL(url); }, 100);
                });
                // Close popup on click outside
                setTimeout(function () {
                    document.addEventListener('click', function closePopup(e) {
                        if (!popup.contains(e.target) && e.target !== plusBtn) {
                            popup.remove();
                            document.removeEventListener('click', closePopup);
                        }
                    });
                }, 50);
            });
        }
        if (fileInput) {
            fileInput.addEventListener('change', function () {
                if (fileInput.files.length > 0) handleFiles(fileInput.files);
                fileInput.value = '';
            });
        }

        window.addEventListener('wake-message', function (e) {
            const detail = e.detail; hideWelcome(); addMessage('user', detail.text); showThinking(true);
            if (isVisionRequest(detail.text)) triggerVision(); else sendToAI(detail.text, detail.language);
        });

        setupDragDrop();
        // Wake word NOT auto-started — user controls via 🎙️ button
        // Request geolocation so AI can see user's location
        if (window.KGeo) KGeo.getLocation().then(function (pos) { if (pos) console.log('[Geo] Location:', pos.lat.toFixed(2), pos.lng.toFixed(2)); });
        checkHealth();
        if (window.KTicker) KTicker.init();

        // ─── Session exit: cleanup on tab/window close ────────────────
        window.addEventListener('beforeunload', function () {
            const token = sessionStorage.getItem('kelion_token');
            if (token) {
                try { navigator.sendBeacon('/api/auth/logout', JSON.stringify({ token: token })); } catch (_e) { /* ignored */ }
            }
            sessionStorage.clear();
            if (window.KVoice) {
                try { KVoice.stopSpeaking(); } catch (_e) { /* ignored */ }
                try { KVoice.stopListening(); } catch (_e) { /* ignored */ }
                try { KVoice.mute(); } catch (_e) { /* ignored */ }
            }
            if (window.i18n) { try { i18n.setLanguage('en'); } catch (_e) { /* ignored */ } }
        });

        // ─── Idle detection: logout after 30 min of inactivity ───────
        let idleTimer = null;
        function resetIdleTimer() {
            clearTimeout(idleTimer);
            if (sessionStorage.getItem('kelion_token')) {
                idleTimer = setTimeout(function () {
                    if (window.KAuth && KAuth.isLoggedIn()) {
                        KAuth.logout().then(function () {
                            sessionStorage.clear();
                            if (window.KVoice) try { KVoice.stopSpeaking(); } catch (_e) { /* ignored */ }
                            const authScr = document.getElementById('auth-screen');
                            const appLayout = document.getElementById('app-layout');
                            if (authScr) authScr.classList.remove('hidden');
                            if (appLayout) appLayout.classList.add('hidden');
                        });
                    }
                }, 30 * 60 * 1000);
            }
        }
        document.addEventListener('visibilitychange', function () {
            if (document.hidden) {
                idleTimer = setTimeout(function () {
                    if (window.KAuth && KAuth.isLoggedIn()) {
                        KAuth.logout().then(function () {
                            sessionStorage.clear();
                            const authScr = document.getElementById('auth-screen');
                            const appLayout = document.getElementById('app-layout');
                            if (authScr) authScr.classList.remove('hidden');
                            if (appLayout) appLayout.classList.add('hidden');
                        });
                    }
                }, 30 * 60 * 1000);
            } else {
                clearTimeout(idleTimer);
            }
        });
        ['click', 'keydown', 'touchstart', 'mousemove'].forEach(function (ev) {
            document.addEventListener(ev, resetIdleTimer, { passive: true });
        });
        resetIdleTimer();

        // Restore last conversation from localStorage
        const savedConvId = restoreConvId();
        if (savedConvId) {
            currentConversationId = savedConvId;
            fetch(API_BASE + '/api/conversations/' + savedConvId + '/messages', { headers: authHeaders() })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (data) {
                    if (!data) return;
                    const msgs = data.messages || data || [];
                    if (msgs.length === 0) return;
                    hideWelcome();
                    const overlay = document.getElementById('chat-overlay');
                    overlay.innerHTML = '';
                    chatHistory = [];
                    for (let i = 0; i < msgs.length; i++) {
                        const role = msgs[i].role === 'assistant' ? 'assistant' : 'user';
                        addMessage(role, msgs[i].content);
                        chatHistory.push({ role: role, content: msgs[i].content });
                    }
                })
                .catch(function (e) { console.warn('[App] restore conversation:', e.message); persistConvId(null); });
        }

        // ─── Dismiss splash loading overlay ─────────────────────
        clearTimeout(splashTimer);
        dismissSplash();

        console.log('[App] ✅ KelionAI v2.3 — STREAMING + HISTORY');
    }

    window.KApp = { loadConversations: loadConversations, toggleHistory: toggleHistory, startNewChat: startNewChat };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
