// KelionAI v2.1 — Main App (SUPER AUTOMATION — zero buttons needed)
(function () {
    'use strict';
    const API_BASE = window.location.origin;
    let chatHistory = [], storedFiles = [], audioUnlocked = false, currentConversationId = null;

    function authHeaders() { return { 'Content-Type': 'application/json', ...(window.KAuth ? KAuth.getAuthHeaders() : {}) }; }

    function unlockAudio() {
        if (audioUnlocked) return; audioUnlocked = true;
        try { const c = new (window.AudioContext || window.webkitAudioContext)(), b = c.createBuffer(1,1,22050), s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0); c.resume(); } catch(e){}
        if (window.KVoice) KVoice.ensureAudioUnlocked();
    }

    function showOnMonitor(content, type) {
        const dc = document.getElementById('display-content'); if (!dc) return;
        KAvatar.setPresenting(true);
        if (type === 'image') dc.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;padding:20px"><img src="'+content+'" style="max-width:100%;max-height:100%;border-radius:12px;box-shadow:0 4px 30px rgba(0,0,0,0.5)"></div>';
        else if (type === 'map') dc.innerHTML = '<iframe src="'+content+'" style="width:100%;height:100%;border:none;border-radius:12px"></iframe>';
        else if (type === 'html') dc.innerHTML = content;
        else dc.innerHTML = '<div style="padding:30px;color:rgba(255,255,255,0.8);font-size:1rem;line-height:1.6">'+content+'</div>';
    }

    // ─── AUTO-DETECT request types ───────────────────────────
    const VISION_TRIGGERS = ['ce e în față','ce e in fata','ce vezi','mă vezi','ma vezi','uită-te','uita-te','arată-mi','arata-mi','privește','priveste','see me','look at','what do you see','descrie ce vezi','ce observi','ce e pe stradă','ce e pe strada','ce e în jurul','ce e in jurul'];
    function isVisionRequest(t) { const l = t.toLowerCase(); return VISION_TRIGGERS.some(v => l.includes(v)); }
    function isWeatherRequest(t) { return /\b(vreme|meteo|temperatură|temperatura|grad|ploaie|soare|ninge|vânt|weather|forecast|prognoz)\b/i.test(t); }
    function isSearchRequest(t) { return /\b(caută|cauta|search|găsește|gaseste|informații|informatii|știri|stiri|ce e |cine e|cât costă|cat costa|când|cand|unde |how |what |who |when )\b/i.test(t); }
    function isImageGenRequest(t) { return /\b(generează|genereaza|creează|creeaza|desenează|deseneaza|picture|draw|generate|fă-mi|fa-mi)\b/i.test(t) && /\b(imagine|poza|foto|poză|picture|image|desen)\b/i.test(t); }
    function isMapRequest(t) { return /\b(hartă|harta|map|rută|ruta|drum|direcți|directi|navigare|navigate|unde e |unde se|locație|locatie)\b/i.test(t); }

    // ─── AUTO VISION (camera se pornește singură) ─────────────
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

    // ─── SEND TO AI (cu auto-search, auto-weather, auto-image, auto-map) ──
    async function sendToAI(message, language) {
        KAvatar.setExpression('thinking', 0.5);
        let extraContext = '';

        try {
            // AUTO-WEATHER
            if (isWeatherRequest(message)) {
                try {
                    const m = message.match(/(?:în|in|la|din|for|at)\s+(\w+)/i);
                    const city = m ? m[1] : 'Manchester';
                    const wr = await fetch(API_BASE+'/api/weather', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ city }) });
                    if (wr.ok) { const w = await wr.json(); extraContext = '\n[METEO REAL '+w.city+': '+w.description+']';
                        showOnMonitor('<div style="padding:40px;text-align:center"><h2 style="color:#fff;margin-bottom:20px">'+w.city+', '+w.country+'</h2><div style="font-size:4rem">'+w.condition+'</div><div style="font-size:2.5rem;color:#00ffff;margin:15px 0">'+w.temperature+'°C</div><div style="color:rgba(255,255,255,0.6)">Umiditate: '+w.humidity+'% | Vânt: '+w.wind+' km/h</div></div>', 'html'); }
                } catch(e){}
            }

            // AUTO-SEARCH
            if (isSearchRequest(message) && !isWeatherRequest(message)) {
                try {
                    const sr = await fetch(API_BASE+'/api/search', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ query: message }) });
                    if (sr.ok) { const s = await sr.json(); extraContext = '\n[CĂUTARE WEB: '+JSON.stringify(s).substring(0,2000)+']'; }
                } catch(e){}
            }

            // AUTO-IMAGE
            if (isImageGenRequest(message)) {
                try {
                    addMessage('assistant', '🎨 Generez imaginea...');
                    const ir = await fetch(API_BASE+'/api/imagine', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ prompt: message }) });
                    if (ir.ok) { const i = await ir.json(); if (i.image) { showOnMonitor(i.image, 'image'); extraContext += '\n[Imagine generată pe monitor.]'; } }
                } catch(e){}
            }

            // AUTO-MAP
            if (isMapRequest(message)) {
                const pm = message.match(/(?:hartă|harta|map|unde e|locație|navigare)\s+(.+)/i);
                if (pm) { const p = pm[1].replace(/[?.!]/g,'').trim();
                    showOnMonitor('https://www.google.com/maps/embed/v1/place?key=AIzaSyBFw0Qbyq9zTFTd-tUY6dZWTgaQzuU17R8&q='+encodeURIComponent(p), 'map');
                    extraContext += '\n[Hartă "'+p+'" pe monitor.]'; }
            }

            // SEND TO AI
            const resp = await fetch(API_BASE+'/api/chat', { method: 'POST', headers: authHeaders(),
                body: JSON.stringify({ message: extraContext ? message + extraContext : message, avatar: KAvatar.getCurrentAvatar(),
                    history: chatHistory.slice(-20), language: language || 'ro', conversationId: currentConversationId }) });

            showThinking(false);
            if (!resp.ok) { const e = await resp.json().catch(()=>({})); addMessage('assistant', e.error || 'Eroare.'); KVoice.resumeWakeDetection(); return; }

            const data = await resp.json();
            chatHistory.push({ role: 'user', content: message });
            chatHistory.push({ role: 'assistant', content: data.reply });
            addMessage('assistant', data.reply);

            // Auto-show images from reply
            const imgMatch = data.reply.match(/https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp)/i);
            if (imgMatch) showOnMonitor(imgMatch[0], 'image');

            KAvatar.setExpression('happy', 0.3);
            await KVoice.speak(data.reply, data.avatar);
        } catch(e) { showThinking(false); addMessage('assistant', 'Eroare conectare.'); KVoice.resumeWakeDetection(); }
    }

    // ─── UI ──────────────────────────────────────────────────
    function addMessage(type, text) {
        const o = document.getElementById('chat-overlay');
        if (type === 'user') o.innerHTML = '';
        const m = document.createElement('div'); m.className = 'msg ' + type; m.textContent = text; o.appendChild(m);
    }
    function showThinking(v) { document.getElementById('thinking').classList.toggle('active', v); }
    function hideWelcome() { const w = document.getElementById('welcome'); if (w) w.classList.add('hidden'); }

    function switchAvatar(name) {
        KVoice.stopSpeaking(); KAvatar.loadAvatar(name);
        document.querySelectorAll('.avatar-pill').forEach(b => b.classList.toggle('active', b.dataset.avatar === name));
        const n = document.getElementById('avatar-name'); if (n) n.textContent = name.charAt(0).toUpperCase() + name.slice(1);
        chatHistory = []; currentConversationId = null;
        const o = document.getElementById('chat-overlay'); if (o) o.innerHTML = '';
    }

    // ─── Input handlers ──────────────────────────────────────
    async function onMicDown() { const b = document.getElementById('btn-mic'); if (await KVoice.startListening()) { b.classList.add('recording'); b.textContent = '⏹'; } }
    async function onMicUp() {
        const b = document.getElementById('btn-mic'); b.classList.remove('recording'); b.textContent = '🎤';
        if (!KVoice.isRecording()) return; showThinking(true);
        const text = await KVoice.stopListening();
        if (text?.trim()) { hideWelcome(); addMessage('user', text);
            if (isVisionRequest(text)) triggerVision(); else await sendToAI(text, KVoice.getLanguage());
        } else { showThinking(false); KVoice.resumeWakeDetection(); }
    }

    async function onSendText() {
        const inp = document.getElementById('text-input'); let text = inp.value.trim(); if (!text) return; inp.value = '';
        // Auto wake word from text
        const l = text.toLowerCase();
        if (/^(kira|chira)[,.\s]/i.test(l)) { switchAvatar('kira'); text = text.replace(/^(kira|chira)[,.\s]*/i, '').trim(); }
        else if (/^(kelion|chelion)[,.\s]/i.test(l)) { switchAvatar('kelion'); text = text.replace(/^(kelion|chelion)[,.\s]*/i, '').trim(); }
        if (!text) return;
        hideWelcome(); KAvatar.setAttentive(true); addMessage('user', text); showThinking(true);
        if (isVisionRequest(text)) triggerVision(); else await sendToAI(text, KVoice.getLanguage());
    }

    // ─── Drag & Drop ─────────────────────────────────────────
    function setupDragDrop() {
        const dp = document.getElementById('display-panel'), dz = document.getElementById('drop-zone'); if (!dp || !dz) return;
        dp.addEventListener('dragover', (e) => { e.preventDefault(); dz.classList.remove('hidden'); });
        dp.addEventListener('dragleave', (e) => { if (!dp.contains(e.relatedTarget)) dz.classList.add('hidden'); });
        dp.addEventListener('drop', (e) => { e.preventDefault(); dz.classList.add('hidden'); handleFiles(e.dataTransfer.files); });
    }

    async function handleFiles(fileList) {
        hideWelcome();
        for (const file of fileList) {
            const reader = new FileReader();
            reader.onload = async () => {
                storedFiles.push({ name: file.name, size: file.size, type: file.type, data: reader.result });
                addMessage('user', '📎 ' + file.name + ' (' + Math.round(file.size/1024) + ' KB)');
                if (file.type.startsWith('image/')) {
                    const b64 = reader.result.split(',')[1];
                    KAvatar.setExpression('thinking', 0.5); showThinking(true);
                    try {
                        const r = await fetch(API_BASE+'/api/vision', { method: 'POST', headers: authHeaders(), body: JSON.stringify({ image: b64, avatar: KAvatar.getCurrentAvatar(), language: KVoice.getLanguage() }) });
                        const d = await r.json(); showThinking(false); addMessage('assistant', d.description || 'Nu am putut analiza.');
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
        try { const r = await fetch(API_BASE+'/api/health'); const d = await r.json();
            if (d.status === 'online') { document.getElementById('status-text').textContent = 'Online'; document.getElementById('status-dot').style.background = '#00ff88'; }
        } catch(e) { document.getElementById('status-text').textContent = 'Offline'; document.getElementById('status-dot').style.background = '#ff4444'; }
    }

    // ─── INIT ────────────────────────────────────────────────
    function init() {
        if (window.KAuth) KAuth.init();
        KAvatar.init();

        // Unlock audio on ANY interaction
        ['click','touchstart','keydown'].forEach(e => document.addEventListener(e, unlockAudio, { once: false, passive: true }));

        // Mic
        document.getElementById('btn-mic').addEventListener('mousedown', onMicDown);
        document.getElementById('btn-mic').addEventListener('mouseup', onMicUp);
        document.getElementById('btn-mic').addEventListener('touchstart', (e) => { e.preventDefault(); onMicDown(); });
        document.getElementById('btn-mic').addEventListener('touchend', (e) => { e.preventDefault(); onMicUp(); });

        // Vision button (auto-trigger camera)
        const vb = document.getElementById('btn-vision');
        if (vb) vb.addEventListener('click', () => { hideWelcome(); addMessage('user', 'Ce e în fața mea?'); showThinking(true); triggerVision(); });

        // Text
        document.getElementById('btn-send').addEventListener('click', onSendText);
        document.getElementById('text-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') onSendText(); });

        // Avatar switcher
        document.querySelectorAll('.avatar-pill').forEach(b => b.addEventListener('click', () => switchAvatar(b.dataset.avatar)));

        // Wake word — FULLY AUTOMATIC
        window.addEventListener('wake-message', (e) => {
            const { text, language } = e.detail; hideWelcome(); addMessage('user', text); showThinking(true);
            if (isVisionRequest(text)) triggerVision(); else sendToAI(text, language);
        });

        // Drag & drop
        setupDragDrop();

        // Start everything automatically
        KVoice.startWakeWordDetection();
        checkHealth();
        console.log('[App] ✅ KelionAI v2.1 — FULL AUTO');
    }

    window.KApp = {};
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
