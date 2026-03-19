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
        signal: AbortSignal.timeout(5000), // ultrarapid timeout
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

  // ── Advanced mic with AGC + Noise Filter via Web Audio API ──
  let audioContext = null;
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

      // Web Audio API: compressor → highpass → gain normalization
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContext.createMediaStreamSource(audioStream);

      // 1. High-pass filter — eliminates low-frequency noise (hum, rumble)
      const highpass = audioContext.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 85; // cuts below 85Hz
      highpass.Q.value = 0.7;

      // 2. Low-pass filter — eliminates high-frequency hiss
      const lowpass = audioContext.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 8000; // keeps voice band
      lowpass.Q.value = 0.7;

      // 3. Dynamic compressor — auto-levels volume (AGC)
      //    TV distant = boost, close voice = compress
      const compressor = audioContext.createDynamicsCompressor();
      compressor.threshold.value = -40;  // start compressing at -40dB
      compressor.knee.value = 12;
      compressor.ratio.value = 8;        // strong compression ratio
      compressor.attack.value = 0.003;   // fast react
      compressor.release.value = 0.15;   // smooth release

      // 4. Gain boost — raises signal after compression
      const gainNode = audioContext.createGain();
      gainNode.gain.value = 2.5; // +8dB boost for distant TV/film audio

      // Chain: mic → highpass → lowpass → compressor → gain → destination
      source.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(compressor);
      compressor.connect(gainNode);
      gainNode.connect(audioContext.destination);

      console.log('[Translate] Advanced AGC pipeline active: highpass(85Hz) → lowpass(8kHz) → compressor → gain(+8dB)');
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
      const content = getContentArea();
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const text = ev.results[i][0].transcript.trim();
        if (!text || text.length < 2) continue;

        if (!ev.results[i].isFinal) {
          // INTERIM: show live text as user speaks (grey, updating)
          let interim = document.getElementById('translate-interim');
          if (!interim) {
            interim = document.createElement('div');
            interim.id = 'translate-interim';
            interim.style.cssText = 'opacity:0.5;padding:8px 12px;color:#aaa;font-size:0.95rem;border-left:2px solid #444;margin:4px 0;';
            if (content) content.appendChild(interim);
          }
          interim.textContent = '🎙️ ' + text + '...';
          if (content) content.scrollTop = content.scrollHeight;
        } else {
          // FINAL: remove interim, translate
          if (text === lastFinal) continue;
          lastFinal = text;
          const interim = document.getElementById('translate-interim');
          if (interim) interim.remove();

          console.log('[Translate] Heard:', text);
          const translated = await translateText(text, targetLang);
          showTranslation(text, translated);
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

    // Release Web Audio AGC
    if (audioContext) {
      audioContext.close().catch(() => {});
      audioContext = null;
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
      if (isActive) {
        stopTranslateMode();
        return false;
      } else {
        startTranslateMode();
        return true; // will be active (async but we know intent)
      }
    },
  };
})();
