// ═══════════════════════════════════════════════════════════════
// KelionAI — Live Audio Client (GPT 5.4 Native Audio)
// Connects to /live namespace via Socket.io
// Zero STT. Zero TTS. Directly streams mic PCM and plays WAV repsonses.
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  let socket = null;
  let audioCtx = null;
  let micStream = null;
  let micProcessor = null;
  let isConnected = false;
  let isPlaying = false;
  let vadTimer = null; // Basic Voice Activity Detection timer on client side

  const SAMPLE_RATE = 24000;

  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  // ── CC Subtitle UI (paralel with audio) ──
  let _ccEl = null;
  let _ccTimer = null;

  function _showCC(text) {
    if (!text) return;
    if (!_ccEl) {
      _ccEl = document.createElement('div');
      _ccEl.id = 'voice-cc-subtitle';
      _ccEl.className = 'voice-cc-subtitle';
      const parent = document.getElementById('avatar-area') || document.body;
      parent.style.position = parent.style.position || 'relative';
      parent.appendChild(_ccEl);
    }
    _ccEl.textContent = text;
    _ccEl.classList.add('visible');

    // Add to chat overlay too
    const overlay = document.getElementById('chat-overlay');
    if (overlay) {
      const msgEl = document.createElement('div');
      msgEl.className = 'msg assistant';
      msgEl.textContent = text;
      overlay.appendChild(msgEl);
      overlay.scrollTop = overlay.scrollHeight;

      const thinking = document.getElementById('thinking');
      if (thinking) thinking.classList.remove('active');
    }

    if (_ccTimer) clearTimeout(_ccTimer);
    _ccTimer = setTimeout(
      () => {
        _ccEl.classList.remove('visible');
      },
      Math.max(text.length * 60, 4000)
    );
  }

  function connect(avatar, language) {
    if (socket && socket.connected) return;

    avatar = avatar || 'kelion';
    language = language || 'ro';

    socket = io('/live', {
      query: { avatar, language },
      transports: ['polling', 'websocket'],
      upgrade: true,
      reconnection: true,
    });

    socket.on('connect', () => {
      console.log('[LiveChat] Socket.io connected (id: ' + socket.id + ')');
    });

    socket.on('ready', (data) => {
      isConnected = true;
      console.log('[LiveChat] Ready:', data.engine);
    });

    socket.on('audio_chunk', (data) => {
      _playWAV(data.audio);
    });

    socket.on('transcript', (data) => {
      if (data.role === 'assistant') {
        _showCC(data.text);
      }
    });

    socket.on('speech_started', () => {
      if (window.KAvatar) KAvatar.setExpression('thinking', 0.4);
      const thinking = document.getElementById('thinking');
      if (thinking) thinking.classList.add('active');
    });

    socket.on('turn_complete', () => {
      console.log('[LiveChat] AI Turn complete');
    });

    socket.on('audio_end', () => {
      // Wait for audio to finish playing, then clear expressions
      setTimeout(() => {
        if (!isPlaying && window.KAvatar) {
          KAvatar.setExpression('neutral');
          KAvatar.setPresenting(false);
        }
      }, 1000);
    });

    socket.on('error_msg', (data) => {
      console.error('[LiveChat] Server error:', data.error);
      const thinking = document.getElementById('thinking');
      if (thinking) thinking.classList.remove('active');
    });

    socket.on('disconnect', () => {
      isConnected = false;
      stopMic();
    });
  }

  // ── Queue and play WAV Base64 ──
  async function _playWAV(base64Audio) {
    const ctx = getAudioCtx();

    // Convert Base64 back to ArrayBuffer
    const raw = atob(base64Audio);
    const buffer = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) buffer[i] = raw.charCodeAt(i);

    // Decode WAV audio data
    try {
      const audioBuf = await ctx.decodeAudioData(buffer.buffer);
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
          } catch (e) {
            /* ignored */
          }
        }
        KAvatar.setExpression('happy', 0.3);
        KAvatar.setPresenting(true);
      }

      if (!fftConnected) src.connect(ctx.destination);

      src.onended = () => {
        isPlaying = false;
      };

      src.start(0);
      isPlaying = true;

      // Trigger the lip sync animation
      window.dispatchEvent(
        new CustomEvent('audio-start', { detail: { duration: audioBuf.duration, isRealtime: true } })
      );
    } catch (err) {
      console.error('[LiveChat] Decode audio failed:', err);
    }
  }

  // Resampling helper
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

  // ── Microphone capture ──
  async function startMic() {
    if (micStream) return;

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });

      const ctx = getAudioCtx();
      const nativeRate = ctx.sampleRate;
      const source = ctx.createMediaStreamSource(micStream);

      micProcessor = ctx.createScriptProcessor(4096, 1, 1);
      micProcessor.onaudioprocess = (e) => {
        if (!isConnected || !socket || !socket.connected) return;

        const float32 = e.inputBuffer.getChannelData(0);

        // Better VAD (Voice Activity Detection) using RMS
        let sumSq = 0;
        for (let i = 0; i < float32.length; i++) {
          sumSq += float32[i] * float32[i];
        }
        let rms = Math.sqrt(sumSq / float32.length);

        if (rms > 0.015) {
          // Speech detected
          if (vadTimer) {
            clearTimeout(vadTimer);
            vadTimer = null;
          }
        } else {
          // Silence detected
          if (!vadTimer) {
            vadTimer = setTimeout(() => {
              if (isConnected) {
                console.log('[LiveChat] VAD auto-commit (800ms silence)');
                socket.emit('commit');
                vadTimer = null;
              }
            }, 800);
          }
        }

        // We can optionally block silent chunks, but OpenAI is fine with them.
        const resampled = _resample(float32, nativeRate, SAMPLE_RATE);

        const int16 = new Int16Array(resampled.length);
        for (let i = 0; i < resampled.length; i++) {
          const s = Math.max(-1, Math.min(1, resampled[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }

        socket.emit('audio', int16.buffer);
      };

      source.connect(micProcessor);
      micProcessor.connect(ctx.destination);

      console.log('[LiveChat] Mic started, streaming PCM to server');

      // Visual indicator
      const overlay = document.getElementById('chat-overlay');
      if (overlay) {
        const umsg = document.createElement('div');
        umsg.className = 'msg user';
        umsg.id = 'temp-live-msg';
        umsg.textContent = '🎙️ Ascult...';
        umsg.style.opacity = '0.6';
        overlay.appendChild(umsg);
        overlay.scrollTop = overlay.scrollHeight;
      }
    } catch (e) {
      console.error('[LiveChat] Mic error:', e);
    }
  }

  function stopMic(commit = true) {
    if (vadTimer) {
      clearTimeout(vadTimer);
      vadTimer = null;
    }

    if (micProcessor) {
      micProcessor.disconnect();
      micProcessor = null;
    }
    if (micStream) {
      micStream.getTracks().forEach((t) => t.stop());
      micStream = null;
    }

    console.log('[LiveChat] Mic stopped');

    const tempMsg = document.getElementById('temp-live-msg');
    if (tempMsg) tempMsg.remove();

    if (commit && socket && socket.connected) {
      socket.emit('commit');
    }
  }

  function disconnect() {
    stopMic(false);
    isConnected = false;
    isPlaying = false;
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  }

  window.KLiveChat = {
    connect,
    disconnect,
    startMic,
    stopMic,
    isConnected: () => isConnected,
    isPlaying: () => isPlaying,
  };

  // Watchdog reset loop to ensure no stuck states
  setInterval(() => {
    if (isConnected && socket && !socket.connected) {
      isConnected = false;
    }
  }, 10000);
})();
