// App — Voice-First Client (OpenAI Realtime via Socket.io)
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
  let ccEnabled = true; // Re-enabled as requested
  let cameraInterval = null; // periodic camera capture for brain vision

  // ── Debug log (console only) ──
  function _dbg(msg) {
    console.log('[VoiceFirst] ' + msg);
  }

  // Audio playback scheduling
  let nextPlayTime = 0;
  const SAMPLE_RATE = 24000; // OpenAI Realtime uses 24kHz PCM16

  // ── CC Subtitle (disabled — buttons removed) ──
  function _ensureCCElement() { return null; }
  function _showCC() {}
  function _hideCC() {}

  // ── Audio Context ──
  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  // ── Fallback state ──
  let _fallbackActive = false;
  let _lastAvatar = 'kelion';
  let _lastLanguage = null; // resolved dynamically from i18n or browser

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

    // ── Visible toast so user knows what happened ──
    _showErrorToast('⚠️ Voice-First: ' + reason);

    window.dispatchEvent(new CustomEvent('voicefirst-fallback', { detail: { reason: reason } }));
  }

  function _clearFallback() {
    _fallbackActive = false;
  }

  // ── Connect via Socket.io ──
  function connect(avatar, language) {
    if (socket && socket.connected) return; // already connected

    _lastAvatar = avatar || 'kira';
    _lastLanguage = language || (window.i18n ? i18n.getLanguage() : null) || navigator.language.split('-')[0] || null;
    _clearFallback();

    // Get auth token if available
    let token = null;
    if (window.KAuth && KAuth.getAuthHeaders) {
      const h = KAuth.getAuthHeaders();
      if (h && h.Authorization) token = h.Authorization.replace('Bearer ', '');
    }

    // Socket.io auto-detects protocol and handles transport
    socket = io('/voice-realtime', {
      query: {
        avatar: _lastAvatar,
        language: _lastLanguage,
        token: token || '',
      },
      transports: ['websocket'], // websocket only — polling causes transport close on Railway
      upgrade: false,
      reconnection: true,
      reconnectionAttempts: Infinity, // never give up reconnecting
      reconnectionDelay: 1000,
      timeout: 120000, // 2 minutes — keep mic alive
    });

    socket.on('connect', function () {
      _dbg('Socket connected (id: ' + socket.id + ')');
    });

    // ── Server events ──

    socket.on('ready', function (data) {
      isConnected = true;
      _dbg('READY: ' + data.engine + ' ' + data.model);
      window.dispatchEvent(new CustomEvent('voicefirst-ready', { detail: data }));
      startMic();
      _startCameraCapture(); // start sending camera frames to brain
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
      if (data.role === 'user') {
        _showCC('Tu: ' + data.text);
      } else if (data.role === 'assistant') {
        _showCC('Kelion: ' + data.text);
      }
      window.dispatchEvent(new CustomEvent('voicefirst-transcript', { detail: data }));
    });

    socket.on('transcript_done', function (data) {
      if (data.role === 'user') _dbg('YOU: ' + (data.text || '').substring(0, 60));
      if (data.role === 'assistant') _dbg('AI: ' + (data.text || '').substring(0, 60));
      window.dispatchEvent(new CustomEvent('voicefirst-transcript-done', { detail: data }));
    });

    socket.on('speech_started', function () {
      _dbg('SPEECH DETECTED');
      if (window.KAvatar) KAvatar.setExpression('thinking', 0.3);
      window.dispatchEvent(new CustomEvent('voicefirst-speech-started'));
    });

    socket.on('speech_stopped', function () {
      _dbg('SPEECH ENDED — transcribing...');
      if (window.KAvatar) KAvatar.setExpression('thinking', 0.5);
      window.dispatchEvent(new CustomEvent('voicefirst-speech-stopped'));
    });

    socket.on('turn_complete', function (data) {
      _hideCC();
      window.dispatchEvent(new CustomEvent('voicefirst-turn-complete', { detail: data }));
    });

    socket.on('error_msg', function (data) {
      _dbg('ERROR: ' + (data.error || 'unknown'));
      console.error('[VoiceFirst] Server error:', data.error);
      _activateFallback(data.error || 'Server error');
      window.dispatchEvent(new CustomEvent('voicefirst-error', { detail: data }));
    });

    socket.on('disconnected', function () {
      isConnected = false;
    });

    // ── Socket.io built-in events ──

    socket.on('disconnect', function (reason) {
      _dbg('DISCONNECTED: ' + reason);
      console.log('[VoiceFirst] Socket.io disconnected:', reason);
      isConnected = false;
      stopMic(); // always stop mic on disconnect to prevent broken audio state
      // Don't activate fallback — infinite reconnect will auto-reconnect
      // and 'ready' event at line 148 will call startMic() again
      if (reason === 'io server disconnect') {
        // Server kicked us — force reconnect
        socket.connect();
      }
      window.dispatchEvent(new CustomEvent('voicefirst-disconnected'));
    });

    socket.on('connect_error', function (err) {
      _dbg('CONNECT ERROR: ' + err.message);
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
      const ls = KAvatar.getLipSync ? KAvatar.getLipSync() : null;
      if (ls && ls.connectToContext) {
        try {
          const analyser = ls.connectToContext(ctx);
          if (analyser) {
            src.connect(analyser);
            analyser.connect(ctx.destination);
            fftConnected = true;
            if (!isPlaying && ls.start) ls.start();
          }
        } catch (e) {
          console.warn('[VoiceFirst] LipSync connect failed:', e.message);
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
      let _chunkCount = 0;
      let _lastLevel = 0;
      micProcessor.onaudioprocess = function (e) {
        if (!isConnected || !socket || !socket.connected) return;

        const float32 = e.inputBuffer.getChannelData(0);

        // Calculate audio level (RMS)
        let sum = 0;
        for (let k = 0; k < float32.length; k++) sum += float32[k] * float32[k];
        _lastLevel = Math.sqrt(sum / float32.length);

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
        _chunkCount++;
        if (_chunkCount % 50 === 0) {
          _dbg('MIC: ' + _chunkCount + ' chunks, level=' + _lastLevel.toFixed(4));
        }
      };

      source.connect(micProcessor);
      micProcessor.connect(ctx.destination);

      console.log(
        '[VoiceFirst] Mic capture started — native ' + nativeRate + 'Hz → resampled to ' + SAMPLE_RATE + 'Hz'
      );
      _dbg('MIC ON — ' + nativeRate + 'Hz → ' + SAMPLE_RATE + 'Hz');
    } catch (e) {
      console.warn('[VoiceFirst] Mic error:', e.message);
      _dbg('MIC ERROR: ' + e.message);
      _showErrorToast('Microphone error: ' + e.message);
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

  // ── Camera capture for brain vision during voice-realtime ──
  function _startCameraCapture() {
    _stopCameraCapture();
    cameraInterval = setInterval(function () {
      if (!isConnected || !socket || !socket.connected) return;
      if (!window.KAutoCamera || !KAutoCamera.isActive()) return;
      var frame = KAutoCamera.captureFrame();
      if (frame && frame.base64) {
        socket.emit('camera_frame', { image: frame.base64 });
      }
    }, 3000); // un frame la 3 secunde
    _dbg('Camera capture started (3s interval)');
  }

  function _stopCameraCapture() {
    if (cameraInterval) {
      clearInterval(cameraInterval);
      cameraInterval = null;
    }
  }

  // ── Disconnect ──
  function disconnect() {
    stopMic();
    _stopCameraCapture();
    _hideCC();
    isConnected = false;
    isPlaying = false;
    nextPlayTime = 0;
    if (socket) {
      try {
        socket.disconnect();
      } catch (_e) {
        /* ignored */
      }
      socket = null;
    }
    // Release AudioContext resources (thread + ~30MB RAM)
    if (audioCtx) { try { audioCtx.close(); } catch (_e) {} audioCtx = null; }
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

})();
