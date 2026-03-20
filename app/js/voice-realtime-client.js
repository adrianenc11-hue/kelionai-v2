// KelionAI — Voice-First Client (OpenAI Realtime via Socket.io)
// Socket.io namespace: /voice-realtime
// Audio → Socket.io → Audio + CC Subtitles
(function () {
  ('use strict');

  let socket = null;
  let audioCtx = null;
  let micStream = null;
  let micProcessor = null;
  let isConnected = false;
  let isPlaying = false;
  let ccEnabled = true;

  // Audio playback scheduling
  let nextPlayTime = 0;
  const SAMPLE_RATE = 24000; // OpenAI Realtime uses 24kHz PCM16

  // ── CC Subtitle element ──
  let _ccEl = null;
  let _ccTimer = null;
  let _ccBuffer = '';

  function _ensureCCElement() {
    if (_ccEl && document.body.contains(_ccEl)) return _ccEl;
    _ccEl = document.createElement('div');
    _ccEl.id = 'voice-cc-subtitle';
    _ccEl.className = 'voice-cc-subtitle';
    _ccEl.setAttribute('aria-live', 'polite');
    const parent = document.getElementById('avatar-area') || document.querySelector('.left-panel') || document.body;
    parent.style.position = parent.style.position || 'relative';
    parent.appendChild(_ccEl);
    return _ccEl;
  }

  function _showCC(text) {
    if (!ccEnabled || !text) return;
    const el = _ensureCCElement();
    _ccBuffer += text;
    const display = _ccBuffer.length > 150 ? '...' + _ccBuffer.slice(-147) : _ccBuffer;
    el.textContent = display;
    el.classList.add('visible');
    if (_ccTimer) clearTimeout(_ccTimer);
    _ccTimer = setTimeout(function () {
      el.classList.remove('visible');
      _ccBuffer = '';
    }, 4000);
  }

  function _hideCC() {
    if (_ccEl) _ccEl.classList.remove('visible');
    _ccBuffer = '';
  }

  // ── Audio Context ──
  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  // ── Fallback state ──
  let _fallbackActive = false;
  let _lastAvatar = 'kelion';
  let _lastLanguage = 'ro';

  function _activateFallback(reason) {
    if (_fallbackActive) return;
    _fallbackActive = true;
    isConnected = false;
    stopMic();

    console.warn('[VoiceFirst] ⚠️ Realtime API unavailable:', reason);

    window.dispatchEvent(
      new CustomEvent('admin-alert', {
        detail: {
          type: 'voice-fallback',
          severity: 'warning',
          message: 'Voice-First Realtime API down. Reason: ' + reason,
          timestamp: new Date().toISOString(),
        },
      })
    );

    // 🗣️ button → amber to signal issue
    const vfBtn = document.getElementById('btn-voicefirst');
    if (vfBtn) {
      vfBtn.style.borderColor = '#f59e0b';
      vfBtn.style.color = '#f59e0b';
      vfBtn.style.boxShadow = '0 0 10px rgba(245,158,11,0.4)';
      vfBtn.title = '⚠️ Realtime indisponibil';
    }

    const ccBtn = document.getElementById('btn-cc-toggle');
    if (ccBtn) ccBtn.style.display = 'none';

    // ── Visible toast so user knows what happened ──
    _showErrorToast('⚠️ Voice-First: ' + reason);

    window.dispatchEvent(new CustomEvent('voicefirst-fallback', { detail: { reason: reason } }));
  }

  function _clearFallback() {
    _fallbackActive = false;
    // Reset 🗣️ button to normal
    const vfBtn = document.getElementById('btn-voicefirst');
    if (vfBtn) {
      vfBtn.style.borderColor = '';
      vfBtn.style.color = '';
      vfBtn.style.boxShadow = '';
      vfBtn.title = 'Voice-First Mode';
    }
  }

  // ── Connect via Socket.io ──
  function connect(avatar, language) {
    if (socket && socket.connected) return; // already connected

    _lastAvatar = avatar || 'kelion';
    _lastLanguage = language || 'ro';
    _clearFallback();

    // Socket.io auto-detects protocol and handles transport
    socket = io('/voice-realtime', {
      query: {
        avatar: _lastAvatar,
        language: _lastLanguage,
      },
      transports: ['polling', 'websocket'], // polling first — Railway proxy breaks raw WS
      upgrade: true, // try WS upgrade after polling connects
      reconnection: true,
      reconnectionAttempts: Infinity, // never give up reconnecting
      reconnectionDelay: 1000,
      timeout: 120000, // 2 minutes — keep mic alive
    });

    socket.on('connect', function () {
      console.log('[VoiceFirst] Socket.io connected (id: ' + socket.id + ')');
    });

    // ── Server events ──

    socket.on('ready', function (data) {
      isConnected = true;
      console.log('[VoiceFirst] Ready:', data.engine, data.model);
      window.dispatchEvent(new CustomEvent('voicefirst-ready', { detail: data }));
      startMic();
    });

    socket.on('audio_chunk', function (data) {
      _queueAudio(data.audio);
    });

    socket.on('audio_end', function () {
      isPlaying = false;
      setTimeout(function () {
        if (window.KAvatar) {
          KAvatar.setExpression('neutral');
          KAvatar.setPresenting(false);
        }
      }, 500);
    });

    socket.on('transcript', function (data) {
      if (data.role === 'assistant') {
        _showCC(data.text);
      }
      window.dispatchEvent(new CustomEvent('voicefirst-transcript', { detail: data }));
    });

    socket.on('transcript_done', function (data) {
      window.dispatchEvent(new CustomEvent('voicefirst-transcript-done', { detail: data }));
    });

    socket.on('speech_started', function () {
      if (window.KAvatar) KAvatar.setExpression('thinking', 0.3);
      window.dispatchEvent(new CustomEvent('voicefirst-speech-started'));
    });

    socket.on('speech_stopped', function () {
      if (window.KAvatar) KAvatar.setExpression('thinking', 0.5);
      window.dispatchEvent(new CustomEvent('voicefirst-speech-stopped'));
    });

    socket.on('turn_complete', function (data) {
      _hideCC();
      window.dispatchEvent(new CustomEvent('voicefirst-turn-complete', { detail: data }));
    });

    socket.on('error_msg', function (data) {
      console.error('[VoiceFirst] Server error:', data.error);
      _activateFallback(data.error || 'Server error');
      window.dispatchEvent(new CustomEvent('voicefirst-error', { detail: data }));
    });

    socket.on('disconnected', function () {
      isConnected = false;
    });

    // ── Socket.io built-in events ──

    socket.on('disconnect', function (reason) {
      console.log('[VoiceFirst] Socket.io disconnected:', reason);
      isConnected = false;
      // Don't stop mic or activate fallback — socket.io will auto-reconnect
      // Only stop on intentional client disconnect
      if (reason === 'io client disconnect') {
        stopMic();
      } else {
        console.log('[VoiceFirst] Will auto-reconnect, keeping mic alive...');
      }
      window.dispatchEvent(new CustomEvent('voicefirst-disconnected'));
    });

    socket.on('connect_error', function (err) {
      console.error('[VoiceFirst] Socket.io connect error:', err.message);
      _activateFallback('Connection error: ' + err.message);
    });

    socket.on('reconnect_failed', function () {
      console.error('[VoiceFirst] Socket.io reconnect failed');
      _activateFallback('Reconnect failed after 3 attempts');
    });
  }

  // ── Queue and play PCM audio chunks ──
  function _queueAudio(base64Audio) {
    const ctx = getAudioCtx();

    // Decode base64 → Int16 PCM → Float32
    const raw = atob(base64Audio);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let j = 0; j < int16.length; j++) float32[j] = int16[j] / 32768.0;

    // Create audio buffer
    const audioBuf = ctx.createBuffer(1, float32.length, SAMPLE_RATE);
    audioBuf.getChannelData(0).set(float32);

    // Schedule playback
    const src = ctx.createBufferSource();
    src.buffer = audioBuf;

    // Connect to FFT lip-sync if available
    let fftConnected = false;
    if (window.KAvatar) {
      const ls = KAvatar.getLipSync();
      if (ls && ls.connectToContext) {
        try {
          const analyser = ls.connectToContext(ctx);
          if (analyser) {
            src.connect(analyser);
            analyser.connect(ctx.destination);
            fftConnected = true;
            if (!isPlaying) ls.start();
          }
        } catch (_e) {
          /* ignored */
        }
      }
      if (!isPlaying) {
        KAvatar.setExpression('happy', 0.3);
        KAvatar.setPresenting(true);
      }
    }
    if (!fftConnected) src.connect(ctx.destination);

    // Schedule at the right time (gapless)
    const now = ctx.currentTime;
    if (nextPlayTime < now) nextPlayTime = now;
    src.start(nextPlayTime);
    nextPlayTime += audioBuf.duration;

    isPlaying = true;

    window.dispatchEvent(new CustomEvent('audio-start', { detail: { duration: audioBuf.duration, isRealtime: true } }));
  }

  // ── Resample Float32 audio from inputRate to outputRate (linear interpolation) ──
  function _resample(float32, inputRate, outputRate) {
    if (inputRate === outputRate) return float32;
    const ratio = inputRate / outputRate;
    const outLen = Math.round(float32.length / ratio);
    const result = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const srcIdx = i * ratio;
      const idx = Math.floor(srcIdx);
      const frac = srcIdx - idx;
      const a = float32[idx] || 0;
      const b = float32[Math.min(idx + 1, float32.length - 1)] || 0;
      result[i] = a + frac * (b - a);
    }
    return result;
  }

  // ── Show visible error toast ──
  function _showErrorToast(msg) {
    const toast = document.createElement('div');
    toast.textContent = msg;
    toast.style.cssText =
      'position:fixed;top:80px;left:50%;transform:translateX(-50%);' +
      'background:rgba(245,158,11,0.95);color:#000;padding:10px 24px;border-radius:10px;' +
      'font-size:0.85rem;font-weight:600;z-index:9999;pointer-events:none;' +
      'box-shadow:0 4px 20px rgba(0,0,0,0.3);opacity:0;transition:opacity 0.3s;';
    document.body.appendChild(toast);
    requestAnimationFrame(function () {
      toast.style.opacity = '1';
    });
    setTimeout(function () {
      toast.style.opacity = '0';
      setTimeout(function () {
        toast.remove();
      }, 400);
    }, 5000);
  }

  // ── Microphone capture → send PCM to server ──
  async function startMic() {
    if (micStream) return;

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });

      const ctx = getAudioCtx();
      const nativeRate = ctx.sampleRate; // actual browser rate (44100 or 48000)
      const source = ctx.createMediaStreamSource(micStream);

      // Use ScriptProcessor for broad compatibility
      micProcessor = ctx.createScriptProcessor(4096, 1, 1);
      micProcessor.onaudioprocess = function (e) {
        if (!isConnected || !socket || !socket.connected) return;

        const float32 = e.inputBuffer.getChannelData(0);

        // Resample from browser native rate → 24kHz (OpenAI Realtime requirement)
        const resampled = _resample(float32, nativeRate, SAMPLE_RATE);

        // Convert Float32 → Int16 PCM
        const int16 = new Int16Array(resampled.length);
        for (let i = 0; i < resampled.length; i++) {
          const s = Math.max(-1, Math.min(1, resampled[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        // Send PCM as binary via Socket.io
        socket.emit('audio', int16.buffer);
      };

      source.connect(micProcessor);
      micProcessor.connect(ctx.destination);

      console.log(
        '[VoiceFirst] Mic capture started — native ' + nativeRate + 'Hz → resampled to ' + SAMPLE_RATE + 'Hz'
      );
    } catch (e) {
      console.error('[VoiceFirst] Mic error:', e);
      _showErrorToast('🎙️ Eroare microfon: ' + e.message);
    }
  }

  function stopMic() {
    if (micProcessor) {
      micProcessor.disconnect();
      micProcessor = null;
    }
    if (micStream) {
      micStream.getTracks().forEach(function (t) {
        t.stop();
      });
      micStream = null;
    }
  }

  // ── Disconnect ──
  function disconnect() {
    stopMic();
    _hideCC();
    isConnected = false;
    isPlaying = false;
    if (socket) {
      try {
        socket.disconnect();
      } catch (_e) {
        /* ignored */
      }
      socket = null;
    }
    if (window.KAvatar) {
      KAvatar.setExpression('neutral');
      KAvatar.setPresenting(false);
    }
  }

  // ── CC Toggle ──
  function setCCEnabled(enabled) {
    ccEnabled = !!enabled;
    if (!ccEnabled) _hideCC();
    console.log('[VoiceFirst] CC subtitles:', ccEnabled ? 'ON' : 'OFF');
  }

  // ── Send text (fallback when user types instead of speaking) ──
  function sendText(text) {
    if (!isConnected || !socket || !socket.connected) return;
    socket.emit('text_input', { text: text });
  }

  // ── Public API ──
  window.KVoiceFirst = {
    connect: connect,
    disconnect: disconnect,
    isConnected: function () {
      return isConnected;
    },
    isPlaying: function () {
      return isPlaying;
    },
    setCCEnabled: setCCEnabled,
    isCCEnabled: function () {
      return ccEnabled;
    },
    sendText: sendText,
    startMic: startMic,
    stopMic: stopMic,
  };

  // ── CC Toggle Button handler ──────────────────────────────
  document.addEventListener('DOMContentLoaded', function () {
    var ccBtn = document.getElementById('btn-cc-toggle');
    if (!ccBtn) return;

    // Initial state: CC ON (active)
    var ccActive = true;
    ccBtn.style.borderColor = '#6366f1';
    ccBtn.style.color = '#6366f1';
    ccBtn.title = 'CC Subtitles: ON';

    ccBtn.addEventListener('click', function () {
      ccActive = !ccActive;
      if (ccActive) {
        ccBtn.style.borderColor = '#6366f1';
        ccBtn.style.color = '#6366f1';
        ccBtn.title = 'CC Subtitles: ON';
      } else {
        ccBtn.style.borderColor = '#555';
        ccBtn.style.color = '#888';
        ccBtn.title = 'CC Subtitles: OFF';
        // Ascunde DOAR bara de subtitrare, NU chat-overlay-ul
        var sub = document.getElementById('speech-subtitle');
        if (sub) sub.classList.remove('visible');
        var ccSub = document.getElementById('voice-cc-subtitle');
        if (ccSub) ccSub.classList.remove('visible');
      }
      // Toggle in VoiceFirst (realtime)
      if (window.KVoiceFirst) KVoiceFirst.setCCEnabled(ccActive);
      // Toggle in voice.js subtitle
      window._ccSubtitlesEnabled = ccActive;
      console.log('[CC] Subtitles', ccActive ? 'ON' : 'OFF');
    });
  });
})();
