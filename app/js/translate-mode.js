// ═══════════════════════════════════════════════════════════════
// KelionAI — Translate Mode v2.0 (Live Interpreter)
// Modes: audio-to-audio | audio-to-text | both
// Pipeline: Mic → WebSpeech STT → /api/translate → display + TTS
// Available to all authenticated users
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  let isActive = false;
  let recognition = null;
  let audioStream = null;
  let audioContext = null;
  const API_BASE = window.location.origin;

  // ── Config (set by dialog) ──────────────────────────────────
  let _targetLang = 'English';
  let _outputMode = 'both'; // 'audio' | 'text' | 'both'
  let _avatar = 'kira';
  let _ttsLanguage = null; // resolved dynamically

  // ── Language code map for TTS ───────────────────────────────
  const LANG_CODE_MAP = {
    english: 'en', română: 'ro', romanian: 'ro', french: 'fr', français: 'fr',
    german: 'de', deutsch: 'de', spanish: 'es', español: 'es', italian: 'it',
    italiano: 'it', portuguese: 'pt', português: 'pt', russian: 'ru', русский: 'ru',
    japanese: 'ja', chinese: 'zh', korean: 'ko', arabic: 'ar', hindi: 'hi',
    turkish: 'tr', polish: 'pl', dutch: 'nl', swedish: 'sv', norwegian: 'no',
    danish: 'da', finnish: 'fi', czech: 'cs', slovak: 'sk', hungarian: 'hu',
    croatian: 'hr', bulgarian: 'bg', greek: 'el', hebrew: 'he', ukrainian: 'uk',
  };

  function getLangCode(langName) {
    const key = (langName || 'english').toLowerCase().trim();
    return LANG_CODE_MAP[key] || key.slice(0, 2).toLowerCase();
  }

  // ── Get current avatar from app ─────────────────────────────
  function getCurrentAvatar() {
    if (window.KAvatar && KAvatar.getCurrentAvatar) return KAvatar.getCurrentAvatar();
    const sel = document.getElementById('avatar-select');
    if (sel) return sel.value || 'kira';
    return 'kira';
  }

  // ── Auth headers ────────────────────────────────────────────
  function authHeaders() {
    if (window.KAuth && KAuth.getAuthHeaders) return KAuth.getAuthHeaders();
    return {};
  }

  // ── Overlay management ──────────────────────────────────────
  function getTranslateOverlay() {
    let overlay = document.getElementById('translate-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'translate-overlay';
      overlay.style.cssText =
        'position:fixed;top:0;left:0;right:0;bottom:0;' +
        'background:rgba(5,5,16,0.97);z-index:9990;' +
        'display:flex;flex-direction:column;' +
        'font-family:var(--kelion-font,Inter,sans-serif);' +
        'animation:translateFadeIn 0.25s ease;';
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  function injectAnimStyles() {
    if (document.getElementById('translate-anim-style')) return;
    const style = document.createElement('style');
    style.id = 'translate-anim-style';
    style.textContent = `
      @keyframes translateFadeIn{from{opacity:0}to{opacity:1}}
      @keyframes fadeInUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}
      @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
      .translate-entry{animation:fadeInUp 0.3s ease;}
      .translate-interim{animation:pulse 1.5s ease infinite;}
      #translate-overlay *{box-sizing:border-box;}
    `;
    document.head.appendChild(style);
  }

  // ═══════════════════════════════════════════════════════════
  // DIALOG — Config before starting
  // ═══════════════════════════════════════════════════════════
  function showConfigDialog() {
    return new Promise(function (resolve, reject) {
      injectAnimStyles();
      const overlay = getTranslateOverlay();
      overlay.innerHTML = '';

      // Detect user language
      const userLang = (window.i18n && i18n.getLanguage ? i18n.getLanguage() : null) ||
        (window.KAuth && KAuth.getUser && KAuth.getUser() ? KAuth.getUser().preferred_language : null) ||
        navigator.language.split('-')[0] || null;
      const detectedLabel = userLang.toUpperCase();

      overlay.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;padding:32px;gap:0;">
          <!-- Header -->
          <div style="text-align:center;margin-bottom:32px;">
            <div style="font-size:2.5rem;margin-bottom:8px;">🌐</div>
            <h2 style="color:#f0f0ff;font-size:1.5rem;font-weight:700;margin:0 0 6px;">Live Translator</h2>
            <p style="color:#888;font-size:0.88rem;margin:0;">Configure your translation session</p>
          </div>

          <!-- Card -->
          <div style="background:rgba(15,15,40,0.8);border:1px solid rgba(99,102,241,0.25);border-radius:16px;padding:28px 32px;width:100%;max-width:440px;display:flex;flex-direction:column;gap:20px;">

            <!-- Input Language (auto-detect) -->
            <div>
              <label style="display:block;font-size:0.78rem;font-weight:600;color:#9090b0;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px;">
                🎙️ Input Language
              </label>
              <div style="display:flex;align-items:center;gap:10px;padding:11px 14px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:10px;">
                <span style="color:#6366f1;font-size:1rem;">🔍</span>
                <span style="color:#c7d2fe;font-size:0.9rem;font-weight:500;">Auto-detect</span>
                <span style="margin-left:auto;background:rgba(99,102,241,0.2);color:#a5b4fc;font-size:0.72rem;font-weight:700;padding:2px 8px;border-radius:20px;">${detectedLabel} detected</span>
              </div>
              <p style="color:#666;font-size:0.75rem;margin-top:5px;">Browser automatically detects the spoken language</p>
            </div>

            <!-- Output Mode -->
            <div>
              <label style="display:block;font-size:0.78rem;font-weight:600;color:#9090b0;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px;">
                📤 Output Mode
              </label>
              <div style="display:flex;gap:8px;" id="translate-mode-btns">
                <button data-mode="text" style="flex:1;padding:10px 8px;border-radius:10px;border:1px solid rgba(99,102,241,0.2);background:transparent;color:#9090b0;font-size:0.82rem;font-weight:600;cursor:pointer;transition:all 0.2s;">
                  📝 Text only
                </button>
                <button data-mode="audio" style="flex:1;padding:10px 8px;border-radius:10px;border:1px solid rgba(99,102,241,0.2);background:transparent;color:#9090b0;font-size:0.82rem;font-weight:600;cursor:pointer;transition:all 0.2s;">
                  🔊 Audio only
                </button>
                <button data-mode="both" style="flex:1;padding:10px 8px;border-radius:10px;border:1px solid rgba(99,102,241,0.4);background:rgba(99,102,241,0.15);color:#c7d2fe;font-size:0.82rem;font-weight:600;cursor:pointer;transition:all 0.2s;">
                  ✨ Both
                </button>
              </div>
            </div>

            <!-- Target Language -->
            <div>
              <label style="display:block;font-size:0.78rem;font-weight:600;color:#9090b0;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:8px;">
                🌍 Translate To
              </label>
              <input id="translate-target-input" type="text" value="English"
                placeholder="e.g. English, Romanian, French, Spanish..."
                style="width:100%;padding:11px 14px;border-radius:10px;border:1px solid rgba(99,102,241,0.25);background:rgba(10,10,27,0.8);color:#f0f0ff;font-size:0.92rem;outline:none;transition:border-color 0.2s;font-family:inherit;" />
              <!-- Quick picks -->
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:8px;" id="translate-quick-langs">
                ${['English','Romanian','French','German','Spanish','Italian','Russian','Arabic'].map(l =>
                  `<button data-lang="${l}" style="padding:4px 10px;border-radius:20px;border:1px solid rgba(99,102,241,0.2);background:transparent;color:#888;font-size:0.75rem;cursor:pointer;transition:all 0.2s;">${l}</button>`
                ).join('')}
              </div>
            </div>

            <!-- Start Button -->
            <button id="translate-start-btn"
              style="width:100%;padding:14px;border-radius:12px;border:none;background:linear-gradient(135deg,#6366f1,#06b6d4);color:#fff;font-size:1rem;font-weight:700;cursor:pointer;transition:all 0.25s;margin-top:4px;">
              🚀 Start Translation
            </button>
          </div>

          <!-- Cancel -->
          <button id="translate-cancel-btn"
            style="margin-top:16px;background:none;border:none;color:#666;font-size:0.85rem;cursor:pointer;padding:8px 16px;">
            Cancel
          </button>
        </div>
      `;

      // Mode button selection
      let selectedMode = 'both';
      const modeBtns = overlay.querySelectorAll('[data-mode]');
      modeBtns.forEach(function (btn) {
        btn.addEventListener('click', function () {
          selectedMode = this.dataset.mode;
          modeBtns.forEach(function (b) {
            b.style.background = 'transparent';
            b.style.borderColor = 'rgba(99,102,241,0.2)';
            b.style.color = '#9090b0';
          });
          this.style.background = 'rgba(99,102,241,0.15)';
          this.style.borderColor = 'rgba(99,102,241,0.4)';
          this.style.color = '#c7d2fe';
        });
      });

      // Quick language picks
      const quickLangs = overlay.querySelectorAll('[data-lang]');
      const targetInput = overlay.querySelector('#translate-target-input');
      quickLangs.forEach(function (btn) {
        btn.addEventListener('click', function () {
          targetInput.value = this.dataset.lang;
          quickLangs.forEach(function (b) {
            b.style.background = 'transparent';
            b.style.color = '#888';
            b.style.borderColor = 'rgba(99,102,241,0.2)';
          });
          this.style.background = 'rgba(99,102,241,0.15)';
          this.style.color = '#c7d2fe';
          this.style.borderColor = 'rgba(99,102,241,0.4)';
        });
      });

      // Focus input
      if (targetInput) {
        setTimeout(function () { targetInput.focus(); }, 100);
        targetInput.addEventListener('focus', function () {
          this.style.borderColor = 'rgba(99,102,241,0.6)';
        });
        targetInput.addEventListener('blur', function () {
          this.style.borderColor = 'rgba(99,102,241,0.25)';
        });
      }

      // Start button
      const startBtn = overlay.querySelector('#translate-start-btn');
      if (startBtn) {
        startBtn.addEventListener('mouseenter', function () {
          this.style.transform = 'translateY(-1px)';
          this.style.boxShadow = '0 8px 24px rgba(99,102,241,0.35)';
        });
        startBtn.addEventListener('mouseleave', function () {
          this.style.transform = '';
          this.style.boxShadow = '';
        });
        startBtn.addEventListener('click', function () {
          const lang = (targetInput ? targetInput.value.trim() : '') || 'English';
          resolve({ targetLang: lang, outputMode: selectedMode });
        });
      }

      // Cancel button
      const cancelBtn = overlay.querySelector('#translate-cancel-btn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
          reject(new Error('cancelled'));
        });
      }

      // Enter key
      if (targetInput) {
        targetInput.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') {
            e.preventDefault();
            const lang = this.value.trim() || 'English';
            resolve({ targetLang: lang, outputMode: selectedMode });
          }
        });
      }
    });
  }

  // ═══════════════════════════════════════════════════════════
  // TRANSLATION SCREEN — after config
  // ═══════════════════════════════════════════════════════════
  function buildTranslationScreen(targetLang, outputMode) {
    const overlay = getTranslateOverlay();
    overlay.innerHTML = '';

    const modeLabel = outputMode === 'audio' ? '🔊 Audio' : outputMode === 'text' ? '📝 Text' : '✨ Audio + Text';

    overlay.innerHTML = `
      <!-- Header -->
      <div style="display:flex;align-items:center;padding:14px 20px;border-bottom:1px solid rgba(99,102,241,0.15);background:rgba(10,10,27,0.9);flex-shrink:0;gap:12px;">
        <button id="translate-back-btn" style="background:rgba(99,102,241,0.1);border:1px solid rgba(99,102,241,0.25);color:#a5b4fc;padding:7px 14px;border-radius:8px;cursor:pointer;font-size:0.82rem;font-weight:600;">
          ← Back
        </button>
        <div style="flex:1;">
          <div style="color:#f0f0ff;font-weight:700;font-size:1rem;">🌐 Live Translator</div>
          <div style="color:#666;font-size:0.75rem;margin-top:1px;">→ <span style="color:#6366f1;">${escapeHtml(targetLang)}</span> · ${modeLabel}</div>
        </div>
        <!-- Status indicator -->
        <div id="translate-status-dot" style="display:flex;align-items:center;gap:6px;font-size:0.78rem;color:#888;">
          <div style="width:8px;height:8px;border-radius:50%;background:#10b981;animation:pulse 1.5s ease infinite;"></div>
          <span id="translate-status-text">Listening...</span>
        </div>
      </div>

      <!-- Content area -->
      <div id="translate-content" style="flex:1;overflow-y:auto;padding:16px 20px;display:flex;flex-direction:column;gap:10px;">
        <div style="text-align:center;color:#444;font-size:0.85rem;margin-top:20px;">
          🎙️ Start speaking — translation will appear here
        </div>
      </div>

      <!-- Bottom bar -->
      <div style="padding:12px 20px;border-top:1px solid rgba(99,102,241,0.1);background:rgba(10,10,27,0.9);flex-shrink:0;">
        <div id="translate-interim" style="color:#666;font-size:0.85rem;min-height:20px;font-style:italic;"></div>
      </div>
    `;

    // Back button
    const backBtn = overlay.querySelector('#translate-back-btn');
    if (backBtn) {
      backBtn.addEventListener('click', function () {
        stopTranslateMode();
        const tBtn = document.getElementById('btn-translate-toggle');
        if (tBtn) {
          tBtn.style.borderColor = '';
          tBtn.style.color = '';
          tBtn.title = 'Translate Mode: OFF';
          tBtn.classList.remove('active');
        }
      });
    }
  }

  function getContentArea() {
    return document.getElementById('translate-content');
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = String(s || '');
    return div.innerHTML;
  }

  // ═══════════════════════════════════════════════════════════
  // TRANSLATE API
  // ═══════════════════════════════════════════════════════════
  async function translateText(text, targetLang) {
    try {
      const r = await fetch(API_BASE + '/api/translate', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify({ text: text, targetLang: targetLang }),
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) {
        if (r.status === 401) {
          showAuthError();
          return null;
        }
        return text;
      }
      const d = await r.json();
      return d.translated || text;
    } catch (e) {
      console.warn('[Translate] API error:', e.message);
      return text;
    }
  }

  function showAuthError() {
    const content = getContentArea();
    if (!content) return;
    const err = document.createElement('div');
    err.style.cssText = 'background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:10px;padding:14px 16px;color:#fca5a5;font-size:0.88rem;text-align:center;';
    err.innerHTML = '🔒 Please <a href="/" style="color:#f87171;text-decoration:underline;">sign in</a> to use the translator.';
    content.appendChild(err);
  }

  // ═══════════════════════════════════════════════════════════
  // TTS — Text to Speech via /api/speak
  // ═══════════════════════════════════════════════════════════
  let _ttsQueue = [];
  let _ttsPlaying = false;

  async function speakTranslation(text, lang) {
    if (_outputMode === 'text') return; // text-only mode — skip TTS
    _ttsQueue.push({ text: text, lang: lang });
    if (!_ttsPlaying) processQueue();
  }

  async function processQueue() {
    if (_ttsQueue.length === 0) { _ttsPlaying = false; return; }
    _ttsPlaying = true;
    const item = _ttsQueue.shift();
    try {
      const r = await fetch(API_BASE + '/api/speak', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders()),
        body: JSON.stringify({
          text: item.text,
          avatar: _avatar,
          language: item.lang,
          mood: 'neutral',
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (r.ok) {
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = function () {
          URL.revokeObjectURL(url);
          processQueue();
        };
        audio.onerror = function () {
          URL.revokeObjectURL(url);
          processQueue();
        };
        await audio.play();
      } else {
        processQueue();
      }
    } catch (e) {
      console.warn('[Translate] TTS error:', e.message);
      processQueue();
    }
  }

  // ═══════════════════════════════════════════════════════════
  // DISPLAY translated entry
  // ═══════════════════════════════════════════════════════════
  function showTranslation(original, translated) {
    if (_outputMode === 'audio') return; // audio-only — don't show text
    const content = getContentArea();
    if (!content) return;

    // Remove placeholder
    const placeholder = content.querySelector('div[style*="Start speaking"]');
    if (placeholder) placeholder.remove();

    const entry = document.createElement('div');
    entry.className = 'translate-entry';
    entry.style.cssText =
      'background:rgba(99,102,241,0.08);border-left:3px solid #6366f1;' +
      'border-radius:10px;padding:12px 16px;';
    entry.innerHTML =
      '<div style="opacity:0.45;font-size:0.78rem;margin-bottom:6px;color:#aaa;display:flex;align-items:center;gap:6px;">' +
      '<span>🎙️</span><span>' + escapeHtml(original) + '</span></div>' +
      '<div style="font-size:1.05rem;font-weight:500;color:#f0f0ff;display:flex;align-items:flex-start;gap:8px;">' +
      '<span style="color:#6366f1;flex-shrink:0;">🌐</span><span>' + escapeHtml(translated) + '</span></div>';

    content.appendChild(entry);
    content.scrollTop = content.scrollHeight;

    // Keep max 60 entries
    while (content.children.length > 60) content.removeChild(content.firstChild);
  }

  // ═══════════════════════════════════════════════════════════
  // MIC — Advanced AGC pipeline
  // ═══════════════════════════════════════════════════════════
  async function requestCleanMic() {
    try {
      audioStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        },
      });

      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(audioStream);

      const highpass = audioContext.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 85;
      highpass.Q.value = 0.7;

      const lowpass = audioContext.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 8000;
      lowpass.Q.value = 0.7;

      const compressor = audioContext.createDynamicsCompressor();
      compressor.threshold.value = -40;
      compressor.knee.value = 12;
      compressor.ratio.value = 8;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.15;

      const gainNode = audioContext.createGain();
      gainNode.gain.value = 2.5;

      source.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(compressor);
      compressor.connect(gainNode);
      gainNode.connect(audioContext.destination);

      console.log('[Translate] AGC pipeline active');
    } catch (e) {
      console.warn('[Translate] Mic request failed:', e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // START Translation Mode
  // ═══════════════════════════════════════════════════════════
  async function startTranslateMode() {
    if (isActive) return;

    // Show config dialog
    let config;
    try {
      config = await showConfigDialog();
    } catch (e) {
      // User cancelled
      const overlay = document.getElementById('translate-overlay');
      if (overlay) overlay.remove();
      const tBtn = document.getElementById('btn-translate-toggle');
      if (tBtn) tBtn.classList.remove('active');
      return;
    }

    _targetLang = config.targetLang;
    _outputMode = config.outputMode;
    _ttsLanguage = getLangCode(_targetLang);
    _avatar = getCurrentAvatar();
    _ttsQueue = [];
    _ttsPlaying = false;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert('Speech recognition is not supported in this browser. Please use Chrome or Edge.');
      const overlay = document.getElementById('translate-overlay');
      if (overlay) overlay.remove();
      return;
    }

    isActive = true;
    window._translateModeActive = true;

    // Disconnect chat voice
    _disconnectChatVoice();

    // Build translation screen
    buildTranslationScreen(_targetLang, _outputMode);

    // Request mic
    await requestCleanMic();

    // Start recognition
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    // No lang set → browser auto-detects source language

    let lastFinal = '';

    recognition.onresult = async function (ev) {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const text = ev.results[i][0].transcript.trim();
        if (!text || text.length < 2) continue;

        if (!ev.results[i].isFinal) {
          // Show interim
          const interimEl = document.getElementById('translate-interim');
          if (interimEl) {
            interimEl.textContent = '🎙️ ' + text + '...';
          }
          const statusText = document.getElementById('translate-status-text');
          if (statusText) statusText.textContent = 'Listening...';
        } else {
          // Final result
          if (text === lastFinal) continue;
          lastFinal = text;

          // Clear interim
          const interimEl = document.getElementById('translate-interim');
          if (interimEl) interimEl.textContent = '';

          // Update status
          const statusText = document.getElementById('translate-status-text');
          if (statusText) statusText.textContent = 'Translating...';

          console.log('[Translate] Heard:', text);
          const translated = await translateText(text, _targetLang);
          if (!translated) continue;

          // Show on monitor (text/both modes)
          showTranslation(text, translated);

          // Speak (audio/both modes)
          if (_outputMode === 'audio' || _outputMode === 'both') {
            speakTranslation(translated, _ttsLanguage);
          }

          if (statusText) statusText.textContent = 'Listening...';
        }
      }
    };

    recognition.onerror = function (ev) {
      console.warn('[Translate] Recognition error:', ev.error);
      const statusText = document.getElementById('translate-status-text');
      if (ev.error === 'not-allowed' || ev.error === 'service-not-available') {
        if (statusText) statusText.textContent = 'Mic error';
        stopTranslateMode();
      } else if (ev.error === 'no-speech') {
        if (statusText) statusText.textContent = 'Waiting...';
      }
    };

    recognition.onend = function () {
      if (isActive) {
        try { recognition.start(); } catch (_e) { /* ignored */ }
      }
    };

    try {
      recognition.start();
      console.log('[Translate] Mode ON → target:', _targetLang, '| output:', _outputMode);
    } catch (e) {
      console.error('[Translate] Cannot start:', e.message);
      isActive = false;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // STOP Translation Mode
  // ═══════════════════════════════════════════════════════════
  function stopTranslateMode() {
    isActive = false;
    window._translateModeActive = false;
    _ttsQueue = [];
    _ttsPlaying = false;

    if (recognition) {
      try { recognition.stop(); } catch (_e) { /* ignored */ }
      recognition = null;
    }

    if (audioStream) {
      audioStream.getTracks().forEach(function (t) { t.stop(); });
      audioStream = null;
    }

    if (audioContext) {
      audioContext.close().catch(function () {});
      audioContext = null;
    }

    const overlay = document.getElementById('translate-overlay');
    if (overlay) overlay.remove();

    // Re-activate chat mic
    const chatMic = document.getElementById('btn-mic');
    if (chatMic && chatMic.classList.contains('is-off')) {
      chatMic.click();
    }

    console.log('[Translate] Mode OFF');
  }

  // ── Disconnect chat voice systems ───────────────────────────
  function _disconnectChatVoice() {
    if (window.KVoiceFirst && KVoiceFirst.isConnected && KVoiceFirst.isConnected()) {
      try { KVoiceFirst.disconnect(); } catch (_e) { /* ignored */ }
    }
    if (window.KVoice) {
      if (KVoice.stopVoiceLoop) try { KVoice.stopVoiceLoop(); } catch (_e) { /* */ }
      if (KVoice.stopWakeWordDetection) try { KVoice.stopWakeWordDetection(); } catch (_e) { /* */ }
      if (KVoice.stopSpeaking) try { KVoice.stopSpeaking(); } catch (_e) { /* */ }
      if (KVoice.stopListening) try { KVoice.stopListening(); } catch (_e) { /* */ }
    }
    if (window.KVoiceStream && KVoiceStream.isConnected && KVoiceStream.isConnected()) {
      try { KVoiceStream.stopMic(); KVoiceStream.disconnect(); } catch (_e) { /* */ }
    }
    if (window._directSpeech) {
      try { window._directSpeech.stop(); } catch (_e) { /* ignored */ }
    }
    const chatMic = document.getElementById('btn-mic');
    if (chatMic) {
      chatMic.textContent = 'OFF';
      chatMic.classList.add('is-off');
      chatMic.classList.remove('is-on');
      chatMic.title = 'Microphone OFF (Translate Mode active)';
    }
  }

  // ── Public API ──────────────────────────────────────────────
  window.KTranslate = {
    start: startTranslateMode,
    stop: stopTranslateMode,
    isActive: function () { return isActive; },
    toggle: function () {
      if (isActive) {
        stopTranslateMode();
        return false;
      } else {
        startTranslateMode();
        return true;
      }
    },
  };
})();