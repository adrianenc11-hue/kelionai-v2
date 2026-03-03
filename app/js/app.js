// ═══════════════════════════════════════════════════════════════
// KelionAI v2.3 — STREAMING + HISTORY + BRAIN
// SSE streaming (word-by-word), Conversation History UI,
// Rate limiting awareness, 4-tier search
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';
    const API_BASE = window.location.origin;
    let chatHistory = [], storedFiles = [], audioUnlocked = false;
    let currentConversationId = null, useStreaming = true, historyOpen = false;

    function authHeaders() { return { 'Content-Type': 'application/json', ...(window.KAuth ? KAuth.getAuthHeaders() : {}) }; }

    function persistConvId(id) { currentConversationId = id; try { if (id) localStorage.setItem('kelion_conv_id', id); else localStorage.removeItem('kelion_conv_id'); } catch (e) { console.warn('[App] localStorage write:', e.message); } }
    function restoreConvId() { try { return localStorage.getItem('kelion_conv_id') || null; } catch (e) { console.warn('[App] localStorage read:', e.message); return null; } }

    function unlockAudio() {
        if (!audioUnlocked) {
            audioUnlocked = true;
            try { const c = new (window.AudioContext || window.webkitAudioContext)(), b = c.createBuffer(1, 1, 22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); c.resume(); } catch (e) { }
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
    var WEB_SITES = {
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
    var WEB_CMDS = /\b(deschide|pune|open|play|start|go to|du-te pe|arata|arată|mergi pe|porneste|pornește|navighează|navigheaza)\b/i;
    function tryWebCommand(text) {
        var lower = text.toLowerCase();
        if (!WEB_CMDS.test(lower)) return null;
        // Check for direct URL in message
        var urlMatch = lower.match(/https?:\/\/[^\s]+/);
        if (urlMatch) return urlMatch[0];
        // Check for known sites
        for (var name in WEB_SITES) {
            if (lower.includes(name)) return WEB_SITES[name];
        }
        return null;
    }

    async function triggerVision() {
        showThinking(false);
        addMessage('assistant', '👁️ Activating camera...');
        try { KAvatar.setExpression('thinking', 0.5); } catch (e) { console.warn('[App] Expression change failed:', e.message); }
        try {
            const desc = await KVoice.captureAndAnalyze();
            addMessage('assistant', desc);
            chatHistory.push({ role: 'assistant', content: desc });
            try { KAvatar.setExpression('happy', 0.3); } catch (e) { console.warn('[App] Expression change failed:', e.message); }
            if (window.KVoice) await KVoice.speak(desc);
        } catch (e) {
            addMessage('assistant', 'Camera not available.');
        }
    }



    // ═══════════════════════════════════════════════════════════
    // SYNCED CHAT — Voice + Text synchronized
    // Flow: get AI reply → create empty div → speak() → on audio-start → reveal text char-by-char
    // ═══════════════════════════════════════════════════════════
    var _speakGeneration = 0; // atomic counter to prevent voice overlap

    async function sendToAI_Regular(message, language) {
        showThinking(true);
        // Stop any ongoing speech BEFORE starting new request
        if (window.KVoice) KVoice.stopSpeaking();
        KAvatar.setExpression('thinking', 0.5);

        try {
            const resp = await fetch(API_BASE + '/api/chat', {
                method: 'POST', headers: authHeaders(),
                body: JSON.stringify({
                    message,
                    avatar: KAvatar.getCurrentAvatar(),
                    history: chatHistory.slice(-20),
                    language: language || (window.i18n ? i18n.getLanguage() : 'en'),
                    conversationId: currentConversationId,
                    geo: window.KGeo ? KGeo.getCached() : null
                })
            });

            showThinking(false);
            if (!resp.ok) {
                const e = await resp.json().catch(() => ({}));
                if (resp.status === 429 && e.upgrade) {
                    const planName = e.plan ? (e.plan.charAt(0).toUpperCase() + e.plan.slice(1)) : 'Free';
                    addMessage('assistant', 'You have reached the daily limit for the ' + planName + ' plan. Say \'Kelion, upgrade\' for more.');
                    setTimeout(function () { if (window.KPayments) KPayments.showUpgradePrompt(); }, 2000);
                } else if (resp.status === 429) {
                    addMessage('assistant', '⏳ Too many messages. Please wait a moment.');
                } else addMessage('assistant', e.error || 'Error.');
                if (window.KVoice) KVoice.resumeWakeDetection();
                return;
            }

            const data = await resp.json();
            const fullReply = data.reply || '';
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
            const msgEl = document.createElement('div');
            msgEl.className = 'msg assistant';
            msgEl.textContent = '';
            overlay.appendChild(msgEl);
            overlay.scrollTop = overlay.scrollHeight;

            KAvatar.setExpression('happy', 0.3);

            // Increment generation counter to prevent overlap
            var thisGen = ++_speakGeneration;

            // Listen for audio-start event to sync text reveal
            var revealHandler = function (e) {
                window.removeEventListener('audio-start', revealHandler);
                if (thisGen !== _speakGeneration) return; // stale, skip
                var duration = e.detail.duration;
                var msPerChar = (duration * 1000) / fullReply.length;
                var charIdx = 0;
                var timer = setInterval(function () {
                    if (thisGen !== _speakGeneration) { clearInterval(timer); return; }
                    charIdx++;
                    if (charIdx >= fullReply.length) {
                        clearInterval(timer);
                        msgEl.textContent = fullReply;
                        overlay.scrollTop = overlay.scrollHeight;
                        return;
                    }
                    msgEl.textContent = fullReply.substring(0, charIdx);
                    overlay.scrollTop = overlay.scrollHeight;
                }, msPerChar);
            };
            window.addEventListener('audio-start', revealHandler);

            // Speak — triggers 'audio-start' event when audio actually starts
            if (window.KVoice) {
                KVoice.speak(fullReply, data.avatar || KAvatar.getCurrentAvatar());
            }

            // Fallback: if audio doesn't start in 6s, show text anyway
            setTimeout(function () {
                window.removeEventListener('audio-start', revealHandler);
                if (!msgEl.textContent) {
                    msgEl.textContent = fullReply;
                    overlay.scrollTop = overlay.scrollHeight;
                }
            }, 6000);

        } catch (e) {
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
                if (ctx) msg = message + ctx;
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
        } catch (e) {
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
        } catch (e) {
            addMessage('assistant', 'Failed to load conversation.');
        }
    }

    function startNewChat() {
        persistConvId(null);
        chatHistory = [];
        var overlay = document.getElementById('chat-overlay');
        if (overlay) overlay.innerHTML = '';
        document.querySelectorAll('.history-item').forEach(function (el) { el.classList.remove('active'); });
        if (window.innerWidth < 768) toggleHistory(false);
    }

    function toggleHistory(forceState) {
        var sidebar = document.getElementById('history-sidebar');
        if (!sidebar) return;
        historyOpen = forceState !== undefined ? forceState : !historyOpen;
        sidebar.classList.toggle('hidden', !historyOpen);
        if (historyOpen) loadConversations();
    }

    function formatTimeAgo(date) {
        var now = new Date(), diff = now - date;
        var mins = Math.floor(diff / 60000);
        if (mins < 1) return 'just now';
        if (mins < 60) return mins + ' min';
        var hours = Math.floor(mins / 60);
        if (hours < 24) return hours + 'h';
        var days = Math.floor(hours / 24);
        if (days < 7) return days + 'd';
        return date.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
    }

    function escapeHtml(t) { var d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

    // ─── UI ──────────────────────────────────────────────────
    function addMessage(type, text) {
        var o = document.getElementById('chat-overlay');
        var m = document.createElement('div');
        m.className = 'msg ' + type;
        m.textContent = text;
        o.appendChild(m);
        o.scrollTop = o.scrollHeight;
    }
    function showThinking(v) { document.getElementById('thinking').classList.toggle('active', v); }
    function hideWelcome() { var w = document.getElementById('welcome'); if (w) w.classList.add('hidden'); }

    function switchAvatar(name) {
        if (window.KVoice) KVoice.stopSpeaking();
        try { KAvatar.loadAvatar(name); } catch (e) { console.warn('[App] Avatar load failed:', e.message); }
        document.querySelectorAll('.avatar-pill').forEach(function (b) { b.classList.toggle('active', b.dataset.avatar === name); });
        var displayName = name.charAt(0).toUpperCase() + name.slice(1);
        var n = document.getElementById('avatar-name'); if (n) n.textContent = displayName;
        var navName = document.getElementById('navbar-avatar-name'); if (navName) navName.textContent = displayName;
        document.title = displayName + 'AI';
        chatHistory = []; persistConvId(null);
        var o = document.getElementById('chat-overlay'); if (o) o.innerHTML = '';
    }

    // ─── Upgrade voice command detection ─────────────────────
    // Matches: "Kelion/Chelion, upgrade/abonament", "vreau pro/premium", "upgrade plan"
    function isUpgradeRequest(t) {
        var l = t.toLowerCase();
        return /(kelion|chelion)[,.\s]+(upgrade|abonament)|vreau\s+(pro|premium)|upgrade\s+plan/.test(l);
    }

    // ─── Input handlers ──────────────────────────────────────
    async function onSendText() {
        var inp = document.getElementById('text-input'); var text = inp.value.trim(); if (!text) return; inp.value = '';
        var l = text.toLowerCase();
        if (/^(kira|chira)[,.\s]/i.test(l)) { switchAvatar('kira'); text = text.replace(/^(kira|chira)[,.\s]*/i, '').trim(); }
        else if (/^(kelion|chelion)[,.\s]/i.test(l)) { switchAvatar('kelion'); text = text.replace(/^(kelion|chelion)[,.\s]*/i, '').trim(); }
        if (!text) return;
        if (isUpgradeRequest(text)) { if (window.KPayments) KPayments.showUpgradePrompt(); return; }
        // Web command — show on monitor + open in new tab backup
        var webUrl = tryWebCommand(text);
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
        hideWelcome(); KAvatar.setAttentive(true); addMessage('user', text); showThinking(true);
        if (isVisionRequest(text)) triggerVision(); else await sendToAI(text, 'en');
    }

    // ─── Drag & Drop ─────────────────────────────────────────
    function setupDragDrop() {
        var dp = document.getElementById('display-panel'), dz = document.getElementById('drop-zone'); if (!dp || !dz) return;
        dp.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.remove('hidden'); });
        dp.addEventListener('dragleave', function (e) { if (!dp.contains(e.relatedTarget)) dz.classList.add('hidden'); });
        dp.addEventListener('drop', function (e) { e.preventDefault(); dz.classList.add('hidden'); handleFiles(e.dataTransfer.files); });
    }

    async function handleFiles(fileList) {
        hideWelcome();
        for (let i = 0; i < fileList.length; i++) {
            let file = fileList[i];
            var reader = new FileReader();
            reader.onload = async function () {
                storedFiles.push({ name: file.name, size: file.size, type: file.type, data: reader.result });
                addMessage('user', '📎 ' + file.name + ' (' + Math.round(file.size / 1024) + ' KB)');
                if (file.type.startsWith('image/')) {
                    var b64 = reader.result.split(',')[1];
                    KAvatar.setExpression('thinking', 0.5); showThinking(true);
                    try {
                        var r = await fetch(API_BASE + '/api/vision', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ image: b64, avatar: KAvatar.getCurrentAvatar(), language: window.KVoice ? KVoice.getLanguage() : 'en' }) });
                        var d = await r.json(); showThinking(false); addMessage('assistant', d.description || 'Could not analyze.');
                        KAvatar.setExpression('happy', 0.3); if (window.KVoice) await KVoice.speak(d.description);
                    } catch (e) { showThinking(false); addMessage('assistant', 'Analysis error.'); }
                } else { addMessage('assistant', 'I received ' + file.name + '. What should I do with it?'); }
            };
            if (file.type.startsWith('text/') || file.name.match(/\.(txt|md|json|csv)$/)) reader.readAsText(file);
            else reader.readAsDataURL(file);
        }
    }

    // ─── Health check ────────────────────────────────────────
    async function checkHealth() {
        try {
            var r = await fetch(API_BASE + '/api/health');
            var d = await r.json();
            if (d.status === 'ok' || d.status === 'online') {
                var statusText = document.getElementById('status-text');
                var statusDot = document.getElementById('status-dot');
                if (statusText) statusText.textContent = 'Online' + (d.brain !== 'healthy' ? ' ⚠️' : '');
                if (statusDot) statusDot.style.background = d.brain === 'healthy' ? '#00ff88' : '#ffaa00';
                if (d.services && !d.services.ai_claude) useStreaming = false;
            }
        } catch (e) {
            var statusText = document.getElementById('status-text');
            var statusDot = document.getElementById('status-dot');
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
        var splashEl = document.getElementById('splash-screen');
        function dismissSplash() {
            if (splashEl && splashEl.parentNode) {
                splashEl.style.opacity = '0';
                splashEl.style.pointerEvents = 'none';
                setTimeout(function () { if (splashEl && splashEl.parentNode) splashEl.parentNode.removeChild(splashEl); }, 600);
            }
        }
        var splashTimer = setTimeout(dismissSplash, 3000);
        // NO auth safety auto-show — START button is the only gate

        if (window.KAuth) KAuth.init();
        try {
            KAvatar.init();
        } catch (e) {
            console.error('[App] Avatar init failed:', e.message);
            var canvas = document.getElementById('avatar-canvas');
            if (canvas) canvas.style.display = 'none';
        }

        ['click', 'touchstart', 'keydown'].forEach(function (e) { document.addEventListener(e, unlockAudio, { once: true, passive: true }); });

        var sendBtn = document.getElementById('btn-send');
        if (sendBtn) sendBtn.addEventListener('click', onSendText);
        document.getElementById('text-input').addEventListener('keydown', function (e) { if (e.key === 'Enter') onSendText(); });


        document.querySelectorAll('.avatar-pill').forEach(function (b) { b.addEventListener('click', function () { switchAvatar(b.dataset.avatar); }); });

        // Mic toggle button — explicit permission request
        var micToggle = document.getElementById('btn-mic-toggle');
        var micOn = false;
        if (micToggle) {
            micToggle.addEventListener('click', async function () {
                if (!micOn) {
                    micToggle.style.borderColor = '#ffaa00';
                    micToggle.style.color = '#ffaa00';
                    micToggle.title = 'Requesting mic permission...';
                    try {
                        var stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                        stream.getTracks().forEach(function (t) { t.stop(); });
                        micOn = true;
                        if (window.KVoice) { KVoice.ensureAudioUnlocked(); if (KVoice.stopWakeWordDetection) KVoice.stopWakeWordDetection(); }
                        // Start DIRECT speech recognition — no wake word needed
                        var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
                        if (SR) {
                            window._directSpeech = new SR();
                            window._directSpeech.continuous = true;
                            window._directSpeech.interimResults = false;
                            window._directSpeech.lang = (window.i18n && i18n.getLanguage && i18n.getLanguage()) || navigator.language || 'ro-RO';
                            window._directSpeech.onresult = function (ev) {
                                for (var i = ev.resultIndex; i < ev.results.length; i++) {
                                    if (ev.results[i].isFinal) {
                                        var text = ev.results[i][0].transcript.trim();
                                        if (text && text.length > 1) {
                                            console.log('[Mic] Heard:', text);
                                            hideWelcome(); addMessage('user', '🎙️ ' + text); showThinking(true);
                                            KAvatar.setAttentive(true);
                                            sendToAI(text, (window.i18n && i18n.getLanguage()) || 'en');
                                        }
                                    }
                                }
                            };
                            window._directSpeech.onend = function () {
                                if (micOn) try { window._directSpeech.start(); } catch (e) { }
                            };
                            window._directSpeech.onerror = function (e) {
                                console.warn('[Mic] Error:', e.error);
                                if (micOn && e.error !== 'not-allowed') {
                                    setTimeout(function () { try { window._directSpeech.start(); } catch (e) { } }, 1000);
                                }
                            };
                            window._directSpeech.start();
                        }
                        micToggle.style.borderColor = '#00ff88';
                        micToggle.style.color = '#00ff88';
                        micToggle.style.boxShadow = '0 0 12px rgba(0,255,136,0.4)';
                        micToggle.title = '🟢 Mic ON — vorbește liber!';
                        console.log('[App] Mic ON — direct speech mode');
                    } catch (e) {
                        micToggle.style.borderColor = '#ff4444';
                        micToggle.style.color = '#ff4444';
                        micToggle.style.boxShadow = 'none';
                        micToggle.title = '🔴 Mic blocked — check browser permissions';
                        console.error('[App] Mic permission denied:', e.message);
                    }
                } else {
                    micOn = false;
                    if (window._directSpeech) { try { window._directSpeech.stop(); } catch (e) { } window._directSpeech = null; }
                    if (window.KVoice && KVoice.startWakeWordDetection) KVoice.startWakeWordDetection();
                    micToggle.style.borderColor = '#555';
                    micToggle.style.color = '#888';
                    micToggle.style.boxShadow = 'none';
                    micToggle.title = 'Microphone OFF — click to turn on';
                    console.log('[App] Mic OFF');
                }
            });
        }

        // History buttons
        var histBtn = document.getElementById('btn-history');
        if (histBtn) histBtn.addEventListener('click', function () { toggleHistory(); });
        var closeHist = document.getElementById('btn-close-history');
        if (closeHist) closeHist.addEventListener('click', function () { toggleHistory(false); });
        var newChat = document.getElementById('btn-new-chat');
        if (newChat) newChat.addEventListener('click', startNewChat);

        // Pricing close
        var pricingClose = document.getElementById('pricing-close');
        if (pricingClose) pricingClose.addEventListener('click', function () { var m = document.getElementById('pricing-modal'); if (m) m.classList.add('hidden'); });

        // ➕ button — popup with IN (import) / OUT (export ZIP)
        var plusBtn = document.getElementById('btn-plus');
        var fileInput = document.getElementById('file-input-hidden');
        if (plusBtn) {
            plusBtn.addEventListener('click', function () {
                // Remove existing popup if any
                var old = document.getElementById('plus-popup');
                if (old) { old.remove(); return; }
                var popup = document.createElement('div');
                popup.id = 'plus-popup';
                popup.style.cssText = 'position:absolute;bottom:44px;right:0;background:#1a1a2e;border:1px solid #333;border-radius:8px;padding:6px;z-index:100;display:flex;gap:6px;box-shadow:0 4px 16px rgba(0,0,0,0.5);';
                popup.innerHTML = '<button id="plus-import" style="background:#2a2a4a;color:#a5b4fc;border:1px solid #444;border-radius:6px;padding:8px 16px;cursor:pointer;font-size:0.85rem;">📂 Adaugă fișier</button>' +
                    '<button id="plus-export" style="background:#2a2a4a;color:#86efac;border:1px solid #444;border-radius:6px;padding:8px 16px;cursor:pointer;font-size:0.85rem;">💾 Salvează tot</button>';
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
            var detail = e.detail; hideWelcome(); addMessage('user', detail.text); showThinking(true);
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
            var token = sessionStorage.getItem('kelion_token');
            if (token) {
                try { navigator.sendBeacon('/api/auth/logout', JSON.stringify({ token: token })); } catch (e) { }
            }
            sessionStorage.clear();
            if (window.KVoice) {
                try { KVoice.stopSpeaking(); } catch (e) { }
                try { KVoice.stopListening(); } catch (e) { }
                try { KVoice.mute(); } catch (e) { }
            }
            if (window.i18n) { try { i18n.setLanguage('en'); } catch (e) { } }
        });

        // ─── Idle detection: logout after 30 min of inactivity ───────
        var idleTimer = null;
        function resetIdleTimer() {
            clearTimeout(idleTimer);
            if (sessionStorage.getItem('kelion_token')) {
                idleTimer = setTimeout(function () {
                    if (window.KAuth && KAuth.isLoggedIn()) {
                        KAuth.logout().then(function () {
                            sessionStorage.clear();
                            if (window.KVoice) try { KVoice.stopSpeaking(); } catch (e) { }
                            var authScr = document.getElementById('auth-screen');
                            var appLayout = document.getElementById('app-layout');
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
                            var authScr = document.getElementById('auth-screen');
                            var appLayout = document.getElementById('app-layout');
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
        var savedConvId = restoreConvId();
        if (savedConvId) {
            currentConversationId = savedConvId;
            fetch(API_BASE + '/api/conversations/' + savedConvId + '/messages', { headers: authHeaders() })
                .then(function (r) { return r.ok ? r.json() : null; })
                .then(function (data) {
                    if (!data) return;
                    var msgs = data.messages || data || [];
                    if (msgs.length === 0) return;
                    hideWelcome();
                    var overlay = document.getElementById('chat-overlay');
                    overlay.innerHTML = '';
                    chatHistory = [];
                    for (var i = 0; i < msgs.length; i++) {
                        var role = msgs[i].role === 'assistant' ? 'assistant' : 'user';
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
