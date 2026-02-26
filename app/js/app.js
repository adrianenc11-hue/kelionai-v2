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

    function persistConvId(id) { currentConversationId = id; try { if (id) localStorage.setItem('kelion_conv_id', id); else localStorage.removeItem('kelion_conv_id'); } catch(e){ console.warn('[App] localStorage write:', e.message); } }
    function restoreConvId() { try { return localStorage.getItem('kelion_conv_id') || null; } catch(e){ console.warn('[App] localStorage read:', e.message); return null; } }

    function unlockAudio() {
        if (!audioUnlocked) {
            audioUnlocked = true;
            try { const c = new (window.AudioContext || window.webkitAudioContext)(), b = c.createBuffer(1,1,22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); c.resume(); } catch(e){}
        }
        if (window.KVoice) KVoice.ensureAudioUnlocked();
    }

    function showOnMonitor(content, type) {
        if (window.MonitorManager) MonitorManager.show(content, type);
    }

    // ─── Vision (client-side camera) ────────────────────────
    const VISION_TRIGGERS = ['ce e în față','ce e in fata','ce vezi','mă vezi','ma vezi','uită-te','uita-te','arată-mi','arata-mi','privește','priveste','see me','look at','what do you see','descrie ce vezi','ce observi','ce e pe stradă','ce e pe strada','ce e în jurul','ce e in jurul'];
    function isVisionRequest(t) { const l = t.toLowerCase(); return VISION_TRIGGERS.some(v => l.includes(v)); }

    async function triggerVision() {
        showThinking(false);
        addMessage('assistant', '👁️ Activez camera...');
        KAvatar.setExpression('thinking', 0.5);
        const desc = await KVoice.captureAndAnalyze();
        addMessage('assistant', desc);
        chatHistory.push({ role: 'assistant', content: desc });
        KAvatar.setExpression('happy', 0.3);
        await KVoice.speak(desc);
    }

    // ═══════════════════════════════════════════════════════════
    // STREAMING CHAT — SSE (Server-Sent Events)
    // Response comes word-by-word instead of waiting for full block
    // ═══════════════════════════════════════════════════════════
    async function sendToAI_Stream(message, language) {
        KAvatar.setExpression('thinking', 0.5);

        try {
            const resp = await fetch(API_BASE + '/api/chat/stream', {
                method: 'POST', headers: authHeaders(),
                body: JSON.stringify({
                    message,
                    avatar: KAvatar.getCurrentAvatar(),
                    history: chatHistory.slice(-20),
                    language: language || 'ro',
                    conversationId: currentConversationId
                })
            });

            showThinking(false);

            if (!resp.ok) {
                const e = await resp.json().catch(() => ({}));
                if (resp.status === 429 && e.upgrade) {
                    const planName = e.plan ? (e.plan.charAt(0).toUpperCase() + e.plan.slice(1)) : 'Free';
                    addMessage('assistant', 'Ai atins limita zilnică pentru planul ' + planName + '. Spune \'Kelion, upgrade\' pentru mai multe.');
                    setTimeout(function() { if (window.KPayments) KPayments.showUpgradePrompt(); }, 2000);
                } else if (resp.status === 429) {
                    addMessage('assistant', '⏳ Prea multe mesaje. Așteaptă un moment.');
                } else addMessage('assistant', e.error || 'Eroare.');
                KVoice.resumeWakeDetection();
                return;
            }

            // Create streaming message element
            const overlay = document.getElementById('chat-overlay');
            const msgEl = document.createElement('div');
            msgEl.className = 'msg assistant streaming';
            msgEl.textContent = '';
            overlay.appendChild(msgEl);

            let fullReply = '';

            // Read SSE stream
            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.startsWith('data: ')) continue;
                    try {
                        const data = JSON.parse(line.slice(6));

                        if (data.type === 'monitor') {
                            showOnMonitor(data.content, data.monitorType);
                        } else if (data.type === 'search_results') {
                            if (window.MonitorManager) MonitorManager.showSearchResults(data.results);
                        } else if (data.type === 'weather') {
                            if (window.MonitorManager) MonitorManager.showWeather(data.data);
                        } else if (data.type === 'chunk') {
                            fullReply += data.text;
                            msgEl.textContent = fullReply;
                            overlay.scrollTop = overlay.scrollHeight;
                        } else if (data.type === 'done') {
                            msgEl.classList.remove('streaming');
                            if (data.reply && !fullReply) {
                                fullReply = data.reply;
                                msgEl.textContent = fullReply;
                            }
                            if (data.conversationId) persistConvId(data.conversationId);
                        }
                    } catch(e) { /* skip parse errors */ }
                }
            }

            // Update state
            chatHistory.push({ role: 'user', content: message });
            chatHistory.push({ role: 'assistant', content: fullReply });

            const imgMatch = fullReply.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)/i);
            if (imgMatch) showOnMonitor(imgMatch[0], 'image');

            const coordMatch = fullReply.match(/(-?\d+\.?\d*)[°\s,]+([NS])?\s*,?\s*(-?\d+\.?\d*)[°\s,]+([EW])?/i);
            if (!imgMatch && coordMatch) {
                const lat = parseFloat(coordMatch[1]);
                const lng = parseFloat(coordMatch[3]);
                if (!isNaN(lat) && !isNaN(lng) && window.MonitorManager) MonitorManager.showMap(lat, lng);
            }

            KAvatar.setExpression('happy', 0.3);
            await KVoice.speak(fullReply, KAvatar.getCurrentAvatar());

        } catch (e) {
            showThinking(false);
            console.warn('[Stream] Fallback to regular:', e.message);
            await sendToAI_Regular(message, language);
        }
    }

    // ═══════════════════════════════════════════════════════════
    // REGULAR CHAT — Fallback (single response)
    // ═══════════════════════════════════════════════════════════
    async function sendToAI_Regular(message, language) {
        KAvatar.setExpression('thinking', 0.5);

        try {
            const resp = await fetch(API_BASE + '/api/chat', {
                method: 'POST', headers: authHeaders(),
                body: JSON.stringify({
                    message,
                    avatar: KAvatar.getCurrentAvatar(),
                    history: chatHistory.slice(-20),
                    language: language || 'ro',
                    conversationId: currentConversationId
                })
            });

            showThinking(false);
            if (!resp.ok) {
                const e = await resp.json().catch(() => ({}));
                if (resp.status === 429 && e.upgrade) {
                    const planName = e.plan ? (e.plan.charAt(0).toUpperCase() + e.plan.slice(1)) : 'Free';
                    addMessage('assistant', 'Ai atins limita zilnică pentru planul ' + planName + '. Spune \'Kelion, upgrade\' pentru mai multe.');
                    setTimeout(function() { if (window.KPayments) KPayments.showUpgradePrompt(); }, 2000);
                } else if (resp.status === 429) {
                    addMessage('assistant', '⏳ Prea multe mesaje. Așteaptă un moment.');
                } else addMessage('assistant', e.error || 'Eroare.');
                KVoice.resumeWakeDetection();
                return;
            }

            const data = await resp.json();
            if (data.conversationId) persistConvId(data.conversationId);
            chatHistory.push({ role: 'user', content: message });
            chatHistory.push({ role: 'assistant', content: data.reply });
            addMessage('assistant', data.reply);

            if (data.monitor && data.monitor.content) {
                showOnMonitor(data.monitor.content, data.monitor.type);
            } else if (data.monitor && data.monitor.search_results) {
                if (window.MonitorManager) MonitorManager.showSearchResults(data.monitor.search_results);
            } else if (data.monitor && data.monitor.weather) {
                if (window.MonitorManager) MonitorManager.showWeather(data.monitor.weather);
            }

            const imgMatch = data.reply.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)/i);
            if (imgMatch && !data.monitor?.content) showOnMonitor(imgMatch[0], 'image');

            const coordMatch2 = data.reply.match(/(-?\d+\.?\d*)[°\s,]+([NS])?\s*,?\s*(-?\d+\.?\d*)[°\s,]+([EW])?/i);
            if (!imgMatch && !data.monitor?.content && coordMatch2) {
                const lat2 = parseFloat(coordMatch2[1]);
                const lng2 = parseFloat(coordMatch2[3]);
                if (!isNaN(lat2) && !isNaN(lng2) && window.MonitorManager) MonitorManager.showMap(lat2, lng2);
            }

            KAvatar.setExpression('happy', 0.3);
            await KVoice.speak(data.reply, data.avatar);
        } catch (e) {
            showThinking(false);
            addMessage('assistant', 'Eroare conectare.');
            KVoice.resumeWakeDetection();
        }
    }

    // ─── Route to streaming or regular ─────────────────────
    async function sendToAI(message, language) {
        let msg = message;
        if (window.KelionTools) {
            try {
                const ctx = await KelionTools.preprocessMessage(message);
                if (ctx) msg = message + ctx;
            } catch(e) { console.warn('[Tools] preprocessMessage error:', e.message); }
        }
        if (useStreaming) await sendToAI_Stream(msg, language);
        else await sendToAI_Regular(msg, language);
        if (window.KPayments) KPayments.showUsageBar();
    }

    // ═══════════════════════════════════════════════════════════
    // CONVERSATION HISTORY UI
    // ═══════════════════════════════════════════════════════════
    async function loadConversations() {
        const list = document.getElementById('history-list');
        if (!list) return;
        list.innerHTML = '<div class="history-empty">Se încarcă...</div>';

        try {
            const r = await fetch(API_BASE + '/api/conversations', { headers: authHeaders() });
            if (!r.ok) throw new Error('Eroare');
            const data = await r.json();
            const convs = data.conversations || data || [];

            if (convs.length === 0) {
                list.innerHTML = '<div class="history-empty">Nicio conversație încă.<br>Începe să vorbești!</div>';
                return;
            }

            list.innerHTML = '';
            for (const c of convs) {
                const item = document.createElement('div');
                item.className = 'history-item' + (c.id === currentConversationId ? ' active' : '');
                const date = new Date(c.updated_at || c.created_at);
                const timeAgo = formatTimeAgo(date);
                item.innerHTML = '<div class="history-item-title">' + escapeHtml(c.title || 'Conversație') + '</div>' +
                    '<div class="history-item-meta"><span class="history-item-avatar">' + (c.avatar || 'kelion') + '</span> · ' + timeAgo + '</div>';
                item.addEventListener('click', () => resumeConversation(c.id, c.avatar));
                list.appendChild(item);
            }
        } catch (e) {
            list.innerHTML = '<div class="history-empty">Nu pot încărca istoricul.<br>Verifică autentificarea.</div>';
        }
    }

    async function resumeConversation(convId, avatar) {
        try {
            if (avatar && avatar !== KAvatar.getCurrentAvatar()) switchAvatar(avatar);
            persistConvId(convId);

            const r = await fetch(API_BASE + '/api/conversations/' + convId + '/messages', { headers: authHeaders() });
            if (!r.ok) throw new Error('Eroare');
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

            document.querySelectorAll('.history-item').forEach(function(el) { el.classList.remove('active'); });
            if (window.innerWidth < 768) toggleHistory(false);
        } catch (e) {
            addMessage('assistant', 'Nu am putut încărca conversația.');
        }
    }

    function startNewChat() {
        persistConvId(null);
        chatHistory = [];
        var overlay = document.getElementById('chat-overlay');
        if (overlay) overlay.innerHTML = '';
        document.querySelectorAll('.history-item').forEach(function(el) { el.classList.remove('active'); });
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
        if (mins < 1) return 'acum';
        if (mins < 60) return mins + ' min';
        var hours = Math.floor(mins / 60);
        if (hours < 24) return hours + 'h';
        var days = Math.floor(hours / 24);
        if (days < 7) return days + 'z';
        return date.toLocaleDateString('ro-RO', { day: 'numeric', month: 'short' });
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
        KVoice.stopSpeaking(); KAvatar.loadAvatar(name);
        document.querySelectorAll('.avatar-pill').forEach(function(b) { b.classList.toggle('active', b.dataset.avatar === name); });
        var n = document.getElementById('avatar-name'); if (n) n.textContent = name.charAt(0).toUpperCase() + name.slice(1);
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
    async function onMicDown() { var b = document.getElementById('btn-mic'); if (await KVoice.startListening()) { b.classList.add('recording'); b.textContent = '⏹'; } }
    async function onMicUp() {
        var b = document.getElementById('btn-mic'); b.classList.remove('recording'); b.textContent = '🎤';
        if (!KVoice.isRecording()) return; showThinking(true);
        var text = await KVoice.stopListening();
        if (text && text.trim()) { hideWelcome(); addMessage('user', text);
            if (isUpgradeRequest(text)) { showThinking(false); if (window.KPayments) KPayments.showUpgradePrompt(); }
            else if (isVisionRequest(text)) triggerVision(); else await sendToAI(text, KVoice.getLanguage());
        } else { showThinking(false); KVoice.resumeWakeDetection(); }
    }

    async function onSendText() {
        var inp = document.getElementById('text-input'); var text = inp.value.trim(); if (!text) return; inp.value = '';
        var l = text.toLowerCase();
        if (/^(kira|chira)[,.\s]/i.test(l)) { switchAvatar('kira'); text = text.replace(/^(kira|chira)[,.\s]*/i, '').trim(); }
        else if (/^(kelion|chelion)[,.\s]/i.test(l)) { switchAvatar('kelion'); text = text.replace(/^(kelion|chelion)[,.\s]*/i, '').trim(); }
        if (!text) return;
        if (isUpgradeRequest(text)) { if (window.KPayments) KPayments.showUpgradePrompt(); return; }
        hideWelcome(); KAvatar.setAttentive(true); addMessage('user', text); showThinking(true);
        if (isVisionRequest(text)) triggerVision(); else await sendToAI(text, KVoice.getLanguage());
    }

    // ─── Drag & Drop ─────────────────────────────────────────
    function setupDragDrop() {
        var dp = document.getElementById('display-panel'), dz = document.getElementById('drop-zone'); if (!dp || !dz) return;
        dp.addEventListener('dragover', function(e) { e.preventDefault(); dz.classList.remove('hidden'); });
        dp.addEventListener('dragleave', function(e) { if (!dp.contains(e.relatedTarget)) dz.classList.add('hidden'); });
        dp.addEventListener('drop', function(e) { e.preventDefault(); dz.classList.add('hidden'); handleFiles(e.dataTransfer.files); });
    }

    async function handleFiles(fileList) {
        hideWelcome();
        for (var i = 0; i < fileList.length; i++) {
            var file = fileList[i];
            var reader = new FileReader();
            reader.onload = async function() {
                storedFiles.push({ name: file.name, size: file.size, type: file.type, data: reader.result });
                addMessage('user', '📎 ' + file.name + ' (' + Math.round(file.size/1024) + ' KB)');
                if (file.type.startsWith('image/')) {
                    var b64 = reader.result.split(',')[1];
                    KAvatar.setExpression('thinking', 0.5); showThinking(true);
                    try {
                        var r = await fetch(API_BASE+'/api/vision', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ image: b64, avatar: KAvatar.getCurrentAvatar(), language: KVoice.getLanguage() }) });
                        var d = await r.json(); showThinking(false); addMessage('assistant', d.description || 'Nu am putut analiza.');
                        KAvatar.setExpression('happy', 0.3); await KVoice.speak(d.description);
                    } catch(e) { showThinking(false); addMessage('assistant', 'Eroare analiză.'); }
                } else { addMessage('assistant', 'Am primit ' + file.name + '. Ce fac cu el?'); }
            };
            if (file.type.startsWith('text/') || file.name.match(/\.(txt|md|json|csv)$/)) reader.readAsText(file);
            else reader.readAsDataURL(file);
        }
    }

    // ─── Health check ────────────────────────────────────────
    async function checkHealth() {
        try {
            var r = await fetch(API_BASE+'/api/health');
            var d = await r.json();
            if (d.status === 'online') {
                document.getElementById('status-text').textContent = 'Online' + (d.brain !== 'healthy' ? ' ⚠️' : '');
                document.getElementById('status-dot').style.background = d.brain === 'healthy' ? '#00ff88' : '#ffaa00';
                if (d.tools && !d.tools.ai_claude) useStreaming = false;
            }
        } catch(e) {
            document.getElementById('status-text').textContent = 'Offline';
            document.getElementById('status-dot').style.background = '#ff4444';
            useStreaming = false;
        }
    }

    // ─── INIT ────────────────────────────────────────────────
    function init() {
        if (window.KAuth) KAuth.init();
        KAvatar.init();

        ['click','touchstart','keydown'].forEach(function(e) { document.addEventListener(e, unlockAudio, { once: false, passive: true }); });

        document.getElementById('btn-mic').addEventListener('mousedown', onMicDown);
        document.getElementById('btn-mic').addEventListener('mouseup', onMicUp);
        document.getElementById('btn-mic').addEventListener('touchstart', function(e) { e.preventDefault(); onMicDown(); });
        document.getElementById('btn-mic').addEventListener('touchend', function(e) { e.preventDefault(); onMicUp(); });

        var vb = document.getElementById('btn-vision');
        if (vb) vb.addEventListener('click', function() { hideWelcome(); addMessage('user', 'Ce e în fața mea?'); showThinking(true); triggerVision(); });

        document.getElementById('btn-send').addEventListener('click', onSendText);
        document.getElementById('text-input').addEventListener('keydown', function(e) { if (e.key === 'Enter') onSendText(); });

        document.querySelectorAll('.avatar-pill').forEach(function(b) { b.addEventListener('click', function() { switchAvatar(b.dataset.avatar); }); });

        // History buttons
        var histBtn = document.getElementById('btn-history');
        if (histBtn) histBtn.addEventListener('click', function() { toggleHistory(); });
        var closeHist = document.getElementById('btn-close-history');
        if (closeHist) closeHist.addEventListener('click', function() { toggleHistory(false); });
        var newChat = document.getElementById('btn-new-chat');
        if (newChat) newChat.addEventListener('click', startNewChat);

        window.addEventListener('wake-message', function(e) {
            var detail = e.detail; hideWelcome(); addMessage('user', detail.text); showThinking(true);
            if (isVisionRequest(detail.text)) triggerVision(); else sendToAI(detail.text, detail.language);
        });

        setupDragDrop();
        KVoice.startWakeWordDetection();
        checkHealth();
        if (window.KPayments) KPayments.showUsageBar();
        if (window.KTicker) KTicker.init();

        // Restore last conversation from localStorage
        var savedConvId = restoreConvId();
        if (savedConvId) {
            currentConversationId = savedConvId;
            fetch(API_BASE + '/api/conversations/' + savedConvId + '/messages', { headers: authHeaders() })
                .then(function(r) { return r.ok ? r.json() : null; })
                .then(function(data) {
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
                .catch(function(e) { console.warn('[App] restore conversation:', e.message); persistConvId(null); });
        }

        console.log('[App] ✅ KelionAI v2.3 — STREAMING + HISTORY');
    }

    window.KApp = { loadConversations: loadConversations, toggleHistory: toggleHistory, startNewChat: startNewChat };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
