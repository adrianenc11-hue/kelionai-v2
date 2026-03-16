// ═══════════════════════════════════════════════════════════════
// KelionAI — Translate Mode (Live Interpreter)
// Button T: mic → STT → auto-translate → display on monitor
// When ON: avatar silent, chat disconnected, pure translation
// Noise suppression + echo cancellation enabled
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  let isActive = false;
  let recognition = null;
  let audioStream = null;
  const API_BASE = window.location.origin;

  // User's preferred language (from profile or default)
  function getUserLang() {
    if (window.i18n && i18n.getLanguage) return i18n.getLanguage();
    if (window.KAuth && KAuth.getUser && KAuth.getUser()) {
      return KAuth.getUser().preferred_language || 'ro';
    }
    return 'ro';
  }

  // ── Create/get fullscreen overlay for translations ─────────
  function getTranslateOverlay() {
    let overlay = document.getElementById('translate-overlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'translate-overlay';
      overlay.style.cssText =
        'position:fixed;top:0;left:0;right:0;bottom:80px;' +
        'background:rgba(10,10,20,0.92);z-index:9990;' +
        'display:flex;flex-direction:column;padding:20px;' +
        'overflow-y:auto;font-family:var(--kelion-font,Inter,sans-serif);';
      // Header
      const header = document.createElement('div');
      header.style.cssText =
        'text-align:center;padding:16px;color:#6366f1;font-weight:700;font-size:1.2rem;border-bottom:1px solid rgba(99,102,241,0.3);margin-bottom:12px;flex-shrink:0;';
      header.textContent = '🌐 Live Translation Mode';
      overlay.appendChild(header);
      // Content area
      const content = document.createElement('div');
      content.id = 'translate-content';
      content.style.cssText = 'flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:8px;';
      overlay.appendChild(content);
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  function getContentArea() {
    return document.getElementById('translate-content');
  }

  // ── Translation via server (Gemini — ultrarapid) ───────────
  async function translateText(text, targetLang) {
    try {
      const authHeaders = window.KAuth ? KAuth.getAuthHeaders() : {};
      const r = await fetch(API_BASE + '/api/translate', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, authHeaders),
        body: JSON.stringify({ text, targetLang }),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return text;
      const d = await r.json();
      return d.translated || text;
    } catch (e) {
      console.warn('[Translate] API error:', e.message);
      return text;
    }
  }

  // ── Display translated text on monitor ─────────────────────
  function showTranslation(original, translated) {
    const content = getContentArea();
    if (!content) return;

    const entry = document.createElement('div');
    entry.style.cssText =
      'background:rgba(99,102,241,0.1);border-left:3px solid #6366f1;' +
      'border-radius:8px;padding:12px 16px;animation:fadeInUp 0.3s ease;';
    entry.innerHTML =
      '<div style="opacity:0.45;font-size:0.8rem;margin-bottom:6px;color:#aaa">🎙️ ' +
      escapeHtml(original) +
      '</div>' +
      '<div style="font-size:1.15rem;font-weight:500;color:#f0f0ff">🌐 ' +
      escapeHtml(translated) +
      '</div>';

    content.appendChild(entry);
    content.scrollTop = content.scrollHeight;

    // Keep max 50 entries
    while (content.children.length > 50) content.removeChild(content.firstChild);
  }

  function escapeHtml(s) {
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  // ── Request high-quality mic with noise suppression ────────
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
      console.log('[Translate] Clean mic acquired (noise suppression ON)');
    } catch (e) {
      console.warn('[Translate] Mic request failed:', e.message);
    }
  }

  // ── Start Translation Mode ────────────────────────────────
  async function startTranslateMode() {
    if (isActive) return;
    isActive = true;

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      console.error('[Translate] SpeechRecognition not supported');
      isActive = false;
      return;
    }

    // Mute avatar — set global flag
    window._translateModeActive = true;

    // Stop any existing mic/voice recognition
    if (window._directSpeech) {
      try {
        window._directSpeech.stop();
      } catch (_e) {
        /* ignored */
      }
    }

    // Request clean mic with noise suppression first
    await requestCleanMic();

    // Add fadeInUp animation
    if (!document.getElementById('translate-anim-style')) {
      const style = document.createElement('style');
      style.id = 'translate-anim-style';
      style.textContent =
        '@keyframes fadeInUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}';
      document.head.appendChild(style);
    }

    // Show overlay on monitor
    getTranslateOverlay();

    // Start continuous recognition (auto-detect language)
    recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    // Don't set recognition.lang → browser auto-detects source language

    const targetLang = getUserLang();
    let lastFinal = '';

    recognition.onresult = async function (ev) {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        if (ev.results[i].isFinal) {
          const text = ev.results[i][0].transcript.trim();
          if (text && text.length > 1 && text !== lastFinal) {
            lastFinal = text;
            console.log('[Translate] Heard:', text);

            // Show placeholder
            const content = getContentArea();
            const placeholder = document.createElement('div');
            placeholder.style.cssText = 'opacity:0.4;padding:8px 12px;color:#aaa;font-size:0.9rem;';
            placeholder.textContent = '⏳ ' + text;
            if (content) {
              content.appendChild(placeholder);
              content.scrollTop = content.scrollHeight;
            }

            // Translate
            const translated = await translateText(text, targetLang);
            if (placeholder.parentNode) placeholder.remove();
            showTranslation(text, translated);
          }
        }
      }
    };

    recognition.onerror = function (ev) {
      console.warn('[Translate] Recognition error:', ev.error);
      if (ev.error === 'not-allowed' || ev.error === 'service-not-available') {
        stopTranslateMode();
      }
    };

    recognition.onend = function () {
      if (isActive) {
        try {
          recognition.start();
        } catch (_e) {
          /* ignored */
        }
      }
    };

    try {
      recognition.start();
      console.log('[Translate] Mode ON — noise suppression, translating to', targetLang);
    } catch (e) {
      console.error('[Translate] Cannot start:', e.message);
      isActive = false;
    }
  }

  // ── Stop Translation Mode ─────────────────────────────────
  function stopTranslateMode() {
    isActive = false;
    window._translateModeActive = false;

    if (recognition) {
      try {
        recognition.stop();
      } catch (_e) {
        /* ignored */
      }
      recognition = null;
    }

    // Release mic stream
    if (audioStream) {
      audioStream.getTracks().forEach((t) => t.stop());
      audioStream = null;
    }

    // Remove overlay
    const overlay = document.getElementById('translate-overlay');
    if (overlay) overlay.remove();

    console.log('[Translate] Mode OFF');
  }

  // ── Public API ─────────────────────────────────────────────
  window.KTranslate = {
    start: startTranslateMode,
    stop: stopTranslateMode,
    isActive: function () {
      return isActive;
    },
    toggle: function () {
      if (isActive) stopTranslateMode();
      else startTranslateMode();
      return isActive;
    },
  };
})();
