// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — Main App Logic
// UI, chat, wake words, smart vision, drag & drop, file in/out
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const API_BASE = window.location.origin;
    let chatHistory = [];
    let textInputVisible = false;
    let savedFiles = []; // in/out file list

    // ─── Vision trigger phrases ──────────────────────────────
    const VISION_TRIGGERS = [
        'ce e în față', 'ce e in fata', 'ce este în față', 'ce este in fata',
        'ce ai în față', 'ce ai in fata', 'ce se vede', 'ce e acolo',
        'mă vezi', 'ma vezi', 'ce vezi', 'uită-te', 'uita-te',
        'arată-mi', 'arata-mi', 'privește', 'priveste', 'see me',
        'look at', 'what do you see', 'can you see', 'vezi ceva',
        'ce e în jurul meu', 'ce e in jurul meu', 'descrie ce vezi',
        'spune-mi ce vezi', 'spunemi ce vezi', 'ce observi',
        'sunt în siguranță', 'sunt in siguranta', 'e periculos',
        'ce e pe stradă', 'ce e pe strada'
    ];

    // Check if text matches a vision trigger
    function isVisionRequest(text) {
        const lower = text.toLowerCase();
        return VISION_TRIGGERS.some(t => lower.includes(t));
    }

    // Auto-activate camera + real-time detection
    async function triggerVision() {
        showThinking(false);
        if (typeof RealtimeVision === 'undefined') {
            addMessage('assistant', 'Modulul de viziune nu este disponibil.');
            return;
        }

        if (!RealtimeVision.active) {
            addMessage('assistant', 'Activez camera... Un moment.');
            const ok = await RealtimeVision.start(1000);
            if (ok) {
                addMessage('assistant', '👁️ Viziunea în timp real este activată. Îți spun ce văd.');
                // Update button state if exists
                const btn = document.getElementById('btn-vision');
                if (btn) {
                    btn.classList.add('active-vision');
                    btn.textContent = '👁️‍🗨️';
                }
            } else {
                addMessage('assistant', 'Nu am putut accesa camera. Te rog să permiți accesul.');
            }
        } else {
            // Already running — just confirm
            addMessage('assistant', '👁️ Viziunea este deja activă. Îți descriu ce văd.');
        }
    }

    // ─── Initialize ──────────────────────────────────────────
    function init() {
        KAvatar.init();

        // Controls
        document.getElementById('btn-mic').addEventListener('mousedown', onMicDown);
        document.getElementById('btn-mic').addEventListener('mouseup', onMicUp);
        document.getElementById('btn-mic').addEventListener('touchstart', (e) => { e.preventDefault(); onMicDown(); });
        document.getElementById('btn-mic').addEventListener('touchend', (e) => { e.preventDefault(); onMicUp(); });
        const kbBtn = document.getElementById('btn-keyboard');
        if (kbBtn) kbBtn.addEventListener('click', toggleTextInput);
        const filesBtn = document.getElementById('btn-files');
        if (filesBtn) filesBtn.addEventListener('click', toggleFilesPanel);
        document.getElementById('btn-send').addEventListener('click', onSendText);

        // Real-time vision toggle
        const visionBtn = document.getElementById('btn-vision');
        if (visionBtn) {
            visionBtn.addEventListener('click', async () => {
                if (typeof RealtimeVision !== 'undefined') {
                    const started = await RealtimeVision.toggle(1000);
                    visionBtn.classList.toggle('active-vision', RealtimeVision.active);
                    visionBtn.textContent = RealtimeVision.active ? '👁️‍🗨️' : '👁️';
                }
            });
        }

        document.getElementById('text-input').addEventListener('keydown', (e) => {
            if (e.key === 'Enter') onSendText();
        });

        // Avatar switcher
        document.querySelectorAll('.avatar-pill').forEach(btn => {
            btn.addEventListener('click', () => switchAvatar(btn.dataset.avatar));
        });

        // Wake word listener
        window.addEventListener('wake-message', (e) => {
            const { text, language } = e.detail;
            hideWelcome();
            addMessage('user', text);
            showThinking(true);

            // Check if it's a vision request — auto-activate camera
            if (isVisionRequest(text)) {
                triggerVision();
            } else {
                sendToAI(text, language);
            }
        });

        // Drag & drop on display panel
        setupDragDrop();

        // Start wake word detection
        KVoice.startWakeWordDetection();
        checkHealth();

        console.log('[App] KelionAI v2 initialized');
    }

    // ─── Smart Vision Detection ──────────────────────────────
    function isVisionRequest(text) {
        const lower = text.toLowerCase();
        return VISION_TRIGGERS.some(t => lower.includes(t));
    }

    async function triggerVision() {
        KAvatar.setExpression('thinking', 0.5);
        const description = await KVoice.captureAndAnalyze();
        showThinking(false);

        addMessage('ai', description);
        chatHistory.push({ role: 'assistant', content: description });

        KAvatar.setExpression('happy', 0.3);
        await KVoice.speak(description);
    }

    // ─── Drag & Drop ─────────────────────────────────────────
    function setupDragDrop() {
        const displayPanel = document.getElementById('display-panel');
        const dropZone = document.getElementById('drop-zone');
        if (!displayPanel || !dropZone) return;

        displayPanel.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.remove('hidden');
        });

        displayPanel.addEventListener('dragleave', (e) => {
            if (!displayPanel.contains(e.relatedTarget)) {
                dropZone.classList.add('hidden');
            }
        });

        displayPanel.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.add('hidden');
            handleDroppedFiles(e.dataTransfer.files);
        });
    }

    async function handleDroppedFiles(fileList) {
        hideWelcome();
        for (const file of fileList) {
            const fileInfo = {
                name: file.name,
                size: file.size,
                type: file.type,
                date: new Date().toISOString(),
                data: null
            };

            // Read file
            const reader = new FileReader();
            reader.onload = () => {
                fileInfo.data = reader.result;
                savedFiles.push(fileInfo);

                const sizeKB = Math.round(file.size / 1024);
                addMessage('user', `📎 ${file.name} (${sizeKB} KB)`);

                // If it's an image, analyze it
                if (file.type.startsWith('image/')) {
                    const base64 = reader.result.split(',')[1];
                    analyzeDroppedImage(base64, file.name);
                } else if (file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.md') || file.name.endsWith('.json') || file.name.endsWith('.csv')) {
                    // Text file — read and summarize
                    addMessage('ai', `Fișier text primit: ${file.name}. L-am salvat. Pot să-l analizez sau să-l prelucrez.`);
                } else {
                    addMessage('ai', `Am primit fișierul: ${file.name}. L-am salvat. Ce vrei să fac cu el?`);
                }
            };

            if (file.type.startsWith('text/') || file.name.endsWith('.txt') || file.name.endsWith('.json')) {
                reader.readAsText(file);
            } else {
                reader.readAsDataURL(file);
            }
        }
    }

    async function analyzeDroppedImage(base64, filename) {
        showThinking(true);
        KAvatar.setExpression('thinking', 0.5);

        try {
            const resp = await fetch(`${API_BASE}/api/vision`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    image: base64,
                    avatar: KAvatar.getCurrentAvatar(),
                    language: KVoice.getLanguage()
                })
            });
            const data = await resp.json();
            showThinking(false);
            addMessage('ai', data.description || 'Nu am putut analiza imaginea.');
            KAvatar.setExpression('happy', 0.3);
            await KVoice.speak(data.description);
        } catch (e) {
            showThinking(false);
            addMessage('ai', 'Eroare la analiza imaginii.');
        }
    }

    // ─── Files In/Out Panel ──────────────────────────────────
    function toggleFilesPanel() {
        hideWelcome();

        // Always open file picker
        const fileInput = document.createElement('input');
        fileInput.type = 'file';
        fileInput.multiple = true;
        fileInput.accept = '*/*';
        fileInput.style.display = 'none';
        document.body.appendChild(fileInput);

        fileInput.addEventListener('change', () => {
            if (fileInput.files.length > 0) {
                handleDroppedFiles(fileInput.files);
            }
            document.body.removeChild(fileInput);
        });

        fileInput.click();

        // Also show saved files if any
        if (savedFiles.length > 0) {
            const overlay = document.getElementById('chat-overlay');
            let html = '<div class="msg ai"><strong>📁 Fișiere salvate:</strong><br>';
            savedFiles.forEach((f, i) => {
                const sizeKB = Math.round(f.size / 1024);
                html += `<div style="margin:6px 0; display:flex; align-items:center; gap:8px;">
                    <span>${f.name} (${sizeKB} KB)</span>
                    <button onclick="window.KApp.downloadFile(${i})" style="background:var(--accent-gradient);border:none;color:white;padding:4px 12px;border-radius:12px;cursor:pointer;font-size:0.8rem;">💾 Salvează</button>
                </div>`;
            });
            html += '</div>';
            overlay.innerHTML = html;
        }
    }

    function downloadFile(index) {
        const file = savedFiles[index];
        if (!file || !file.data) return;

        const link = document.createElement('a');
        if (typeof file.data === 'string' && file.data.startsWith('data:')) {
            link.href = file.data;
        } else {
            const blob = new Blob([file.data], { type: file.type || 'text/plain' });
            link.href = URL.createObjectURL(blob);
        }
        link.download = file.name;
        link.click();
    }

    // ─── Avatar Switch ───────────────────────────────────────
    function switchAvatar(name) {
        KVoice.stopSpeaking();
        KAvatar.loadAvatar(name);
        document.querySelectorAll('.avatar-pill').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.avatar === name);
        });
    }

    // ─── Microphone ──────────────────────────────────────────
    async function onMicDown() {
        const btn = document.getElementById('btn-mic');
        const started = await KVoice.startListening();
        if (started) {
            btn.classList.add('recording');
            btn.textContent = '⏹';
        }
    }

    async function onMicUp() {
        const btn = document.getElementById('btn-mic');
        btn.classList.remove('recording');
        btn.textContent = '🎤';

        if (!KVoice.isRecording()) return;

        showThinking(true);
        const text = await KVoice.stopListening();

        if (text && text.trim().length > 0) {
            hideWelcome();
            addMessage('user', text);

            if (isVisionRequest(text)) {
                triggerVision();
            } else {
                await sendToAI(text, KVoice.getLanguage());
            }
        } else {
            showThinking(false);
            KVoice.resumeWakeDetection();
        }
    }

    // ─── Keyboard ────────────────────────────────────────────
    function toggleTextInput() {
        textInputVisible = !textInputVisible;
        const container = document.getElementById('text-input-container');
        container.classList.toggle('active', textInputVisible);
        if (textInputVisible) document.getElementById('text-input').focus();
    }

    async function onSendText() {
        const input = document.getElementById('text-input');
        let text = input.value.trim();
        if (!text) return;
        input.value = '';

        // Wake word detection from text
        const lower = text.toLowerCase();
        if (/^(kira|chira)[,.\s]/i.test(lower) || /^(kira|chira)$/i.test(lower)) {
            switchAvatar('kira');
            text = text.replace(/^(kira|chira)[,.\s]*/i, '').trim();
        } else if (/^(kelion|chelion|kelian)[,.\s]/i.test(lower) || /^(kelion|chelion|kelian)$/i.test(lower)) {
            switchAvatar('kelion');
            text = text.replace(/^(kelion|chelion|kelian)[,.\s]*/i, '').trim();
        } else if (/^k[,.\s]+/i.test(lower)) {
            text = text.replace(/^k[,.\s]+/i, '').trim();
        }

        if (!text) return;

        hideWelcome();
        KAvatar.setAttentive(true);
        addMessage('user', text);
        showThinking(true);

        if (isVisionRequest(text)) {
            triggerVision();
        } else {
            await sendToAI(text, KVoice.getLanguage());
        }
    }

    function hideWelcome() {
        var w = document.getElementById('welcome');
        if (w) w.classList.add('hidden');
    }

    // ─── Send to AI ──────────────────────────────────────────
    async function sendToAI(message, language) {
        KAvatar.setExpression('thinking', 0.5);

        try {
            const resp = await fetch(`${API_BASE}/api/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message,
                    avatar: KAvatar.getCurrentAvatar(),
                    history: chatHistory.slice(-20),
                    language: language || 'ro'
                })
            });

            showThinking(false);

            if (!resp.ok) {
                const errData = await resp.json().catch(() => ({}));
                addMessage('ai', errData.error || 'Eroare de conectare.');
                KAvatar.setExpression('concerned', 0.4);
                setTimeout(() => KAvatar.setExpression('neutral'), 3000);
                KVoice.resumeWakeDetection();
                return;
            }

            const data = await resp.json();
            const reply = data.reply;

            chatHistory.push({ role: 'user', content: message });
            chatHistory.push({ role: 'assistant', content: reply });
            addMessage('ai', reply);

            console.log(`[App] ${data.engine} | lang: ${language || 'ro'}`);

            KAvatar.setExpression('happy', 0.3);
            await KVoice.speak(reply, data.avatar);

        } catch (e) {
            showThinking(false);
            console.error('[App] Chat error:', e);
            addMessage('ai', 'Scuze, am o problemă de conectare.');
            KAvatar.setExpression('concerned', 0.4);
            setTimeout(() => KAvatar.setExpression('neutral'), 3000);
            KVoice.resumeWakeDetection();
        }
    }

    // ─── UI Helpers ──────────────────────────────────────────
    function addMessage(type, text) {
        const overlay = document.getElementById('chat-overlay');
        if (type === 'user') overlay.innerHTML = '';

        const msg = document.createElement('div');
        msg.className = `msg ${type}`;
        msg.textContent = text;
        overlay.appendChild(msg);

        // Scroll display content
        const displayContent = document.getElementById('display-content');
        if (displayContent) displayContent.scrollTop = displayContent.scrollHeight;
    }

    function showThinking(visible) {
        document.getElementById('thinking').classList.toggle('active', visible);
    }

    // ─── Health Check ────────────────────────────────────────
    async function checkHealth() {
        try {
            const resp = await fetch(`${API_BASE}/api/health`);
            const data = await resp.json();
            if (data.status === 'online') {
                document.getElementById('status-text').textContent = 'Online';
                document.getElementById('status-dot').style.background = '#00ff88';
                document.getElementById('status-dot').style.boxShadow = '0 0 8px #00ff88';
            }
            console.log('[App] Services:', data.services);
        } catch (e) {
            document.getElementById('status-text').textContent = 'Offline';
            document.getElementById('status-dot').style.background = '#ff4444';
            document.getElementById('status-dot').style.boxShadow = '0 0 8px #ff4444';
        }
    }

    // ─── Expose for file download buttons ────────────────────
    window.KApp = { downloadFile };

    // ─── Start ───────────────────────────────────────────────
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
