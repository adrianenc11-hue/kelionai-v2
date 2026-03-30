// ═══════════════════════════════════════════════════════════════
// App — Live Voice Client (Brain-Powered Audio Chat)
// Pipeline: Mic → Noise Gate + AGC + Filter → Deepgram STT
//   → Brain.think() (GPT-5.4 + visual context) → ElevenLabs TTS → Speaker
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  let ws = null;
  let audioCtx = null;
  let mediaStream = null;
  let isConnected = false;
  let isListening = false;
  let _active = false;
  let _connecting = false;

  // Audio processing nodes
  let micSource = null;
  let noiseGate = null;
  let compressor = null;
  let highPass = null;
  let lowPass = null;
  let gainNode = null;
  let analyserNode = null;
  let workletNode = null;

  // Playback
  let pcmQueue = [];
  let isPlaying = false;
  let currentPlaySource = null;
  let streamAnalyser = null;

  // AGC (Automatic Gain Control)
  let _agcInterval = null;
  const AGC_TARGET_RMS = 0.15;   // target RMS level
  const AGC_MIN_GAIN = 0.5;
  const AGC_MAX_GAIN = 4.0;
  const AGC_SMOOTHING = 0.05;    // slow adjustment

  // Noise gate
  const NOISE_GATE_THRESHOLD = -45; // dB — below this = silence
  const NOISE_GATE_ATTACK = 0.005;  // seconds
  const NOISE_GATE_RELEASE = 0.08;  // seconds

  const API_BASE = window.location.origin;
  const WS_BASE = API_BASE.replace('https://', 'wss://').replace('http://', 'ws://');

  // ══════════════════════════════════════════════════════════
  // AUDIO CONTEXT + PROCESSING CHAIN
  // ══════════════════════════════════════════════════════════
  function getAudioContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  /**
   * Build professional audio processing chain:
   * Mic → HighPass(80Hz) → LowPass(8kHz) → Compressor → NoiseGate → AGC → PCM output
   */
  function buildAudioChain(ctx, source) {
    // 1. High-pass filter — removes rumble, wind noise, handling noise (<80Hz)
    highPass = ctx.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = 80;
    highPass.Q.value = 0.7;

    // 2. Low-pass filter — removes hiss, electronic noise (>8kHz)
    //    Voice is 85-8000Hz, we keep that range clean
    lowPass = ctx.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.value = 8000;
    lowPass.Q.value = 0.7;

    // 3. Compressor — evens out volume (loud/soft normalization)
    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -30;   // dB
    compressor.knee.value = 12;         // soft knee
    compressor.ratio.value = 4;         // 4:1 compression
    compressor.attack.value = 0.003;    // 3ms attack
    compressor.release.value = 0.15;    // 150ms release

    // 4. Gain node (controlled by AGC)
    gainNode = ctx.createGain();
    gainNode.gain.value = 1.0;

    // 5. Analyser for AGC monitoring + noise gate
    analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.smoothingTimeConstant = 0.8;

    // Chain: source → highPass → lowPass → compressor → gain → analyser
    source.connect(highPass);
    highPass.connect(lowPass);
    lowPass.connect(compressor);
    compressor.connect(gainNode);
    gainNode.connect(analyserNode);

    // Start AGC loop
    startAGC();

    return analyserNode; // connect worklet to this
  }

  /**
   * Automatic Gain Control — monitors RMS and adjusts gain smoothly
   */
  function startAGC() {
    if (_agcInterval) return;
    const dataArray = new Float32Array(analyserNode.fftSize);

    _agcInterval = setInterval(function () {
      if (!analyserNode || !gainNode || !isListening) return;

      analyserNode.getFloatTimeDomainData(dataArray);

      // Calculate RMS
      let sumSq = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sumSq += dataArray[i] * dataArray[i];
      }
      var rms = Math.sqrt(sumSq / dataArray.length);

      // Noise gate: if RMS is below threshold, don't adjust
      var rmsDb = 20 * Math.log10(Math.max(rms, 1e-10));
      if (rmsDb < NOISE_GATE_THRESHOLD) return;

      // Calculate target gain adjustment
      if (rms > 0.001) {
        var targetGain = AGC_TARGET_RMS / rms;
        targetGain = Math.max(AGC_MIN_GAIN, Math.min(AGC_MAX_GAIN, targetGain));
        // Smooth interpolation
        var current = gainNode.gain.value;
        gainNode.gain.value = current + (targetGain - current) * AGC_SMOOTHING;
      }
    }, 50); // 50ms = 20x/sec
  }

  function stopAGC() {
    if (_agcInterval) {
      clearInterval(_agcInterval);
      _agcInterval = null;
    }
  }

  // ══════════════════════════════════════════════════════════
  // NOISE GATE — implemented in AudioWorklet for precision
  // Mutes audio below threshold, with smooth attack/release
  // ══════════════════════════════════════════════════════════
  function getWorkletCode() {
    return `
      class LiveVoiceProcessor extends AudioWorkletProcessor {
        constructor() {
          super();
          this._gateOpen = false;
          this._gateGain = 0;
          this._threshold = ${NOISE_GATE_THRESHOLD};
          this._attackRate = 1.0 / (${NOISE_GATE_ATTACK} * sampleRate);
          this._releaseRate = 1.0 / (${NOISE_GATE_RELEASE} * sampleRate);
          this._sendBuffer = [];
          this._sendSize = 2400; // 100ms at 24kHz
        }

        process(inputs) {
          var ch = inputs[0][0];
          if (!ch) return true;

          // Calculate RMS for noise gate
          var sumSq = 0;
          for (var i = 0; i < ch.length; i++) sumSq += ch[i] * ch[i];
          var rms = Math.sqrt(sumSq / ch.length);
          var rmsDb = 20 * Math.log10(Math.max(rms, 1e-10));

          // Gate logic
          var shouldOpen = rmsDb > this._threshold;
          var pcm = new Int16Array(ch.length);

          for (var i = 0; i < ch.length; i++) {
            // Smooth gate gain
            if (shouldOpen) {
              this._gateGain = Math.min(1, this._gateGain + this._attackRate);
            } else {
              this._gateGain = Math.max(0, this._gateGain - this._releaseRate);
            }
            // Apply gate and convert to PCM16
            var sample = ch[i] * this._gateGain;
            pcm[i] = Math.max(-1, Math.min(1, sample)) * 0x7FFF;
          }

          // Buffer and send in chunks for network efficiency
          for (var i = 0; i < pcm.length; i++) {
            this._sendBuffer.push(pcm[i]);
          }
          while (this._sendBuffer.length >= this._sendSize) {
            var chunk = new Int16Array(this._sendSize);
            for (var j = 0; j < this._sendSize; j++) {
              chunk[j] = this._sendBuffer.shift();
            }
            this.port.postMessage(chunk.buffer, [chunk.buffer]);
          }

          return true;
        }
      }
      registerProcessor('live-voice-processor', LiveVoiceProcessor);
    `;
  }

  // ══════════════════════════════════════════════════════════
  // PCM PLAYBACK (ElevenLabs audio from server)
  // ══════════════════════════════════════════════════════════
  function playPCMChunk(pcmData) {
    var ctx = getAudioContext();
    var samples = new Float32Array(pcmData.byteLength / 2);
    var view = new DataView(pcmData.buffer || pcmData);
    for (var i = 0; i < samples.length; i++) {
      samples[i] = view.getInt16(i * 2, true) / 32768;
    }

    var buffer = ctx.createBuffer(1, samples.length, 24000);
    buffer.getChannelData(0).set(samples);
    pcmQueue.push(buffer);
    if (!isPlaying) drainQueue();
  }

  function drainQueue() {
    if (pcmQueue.length === 0) {
      isPlaying = false;
      currentPlaySource = null;
      if (window.KAvatar) {
        var ls = KAvatar.getLipSync();
        if (ls && ls.stop) ls.stop();
        try { KAvatar.setPresenting(false); } catch (_e) { /* */ }
        try { KAvatar.setExpression('neutral'); } catch (_e) { /* */ }
      }
      // Resume listening after AI finishes speaking
      emitState('listening');
      return;
    }
    var wasPlaying = isPlaying;
    isPlaying = true;
    var ctx = getAudioContext();
    var buffer = pcmQueue.shift();
    var source = ctx.createBufferSource();
    source.buffer = buffer;

    // FFT lip sync
    var fftConnected = false;
    if (window.KAvatar) {
      var ls = KAvatar.getLipSync();
      if (ls && ls.connectToContext) {
        try {
          if (!streamAnalyser) {
            streamAnalyser = ls.connectToContext(ctx);
            if (streamAnalyser) streamAnalyser.connect(ctx.destination);
          }
          if (streamAnalyser) {
            source.connect(streamAnalyser);
            fftConnected = true;
            if (!wasPlaying) ls.start();
          }
        } catch (_e) { /* */ }
      }
      if (!wasPlaying) {
        try { KAvatar.setExpression('happy', 0.3); } catch (_e) { /* */ }
        try { KAvatar.setPresenting(true); } catch (_e) { /* */ }
      }
    }
    if (!fftConnected) source.connect(ctx.destination);

    source.onended = drainQueue;
    currentPlaySource = source;
    source.start();
  }

  function stopPlayback() {
    pcmQueue = [];
    isPlaying = false;
    if (currentPlaySource) {
      try { currentPlaySource.stop(); } catch (_e) { /* */ }
      currentPlaySource = null;
    }
    streamAnalyser = null;
    if (window.KAvatar) {
      var ls = KAvatar.getLipSync();
      if (ls && ls.stop) ls.stop();
      try { KAvatar.setPresenting(false); } catch (_e) { /* */ }
    }
  }

  // ══════════════════════════════════════════════════════════
  // VISUAL CONTEXT — send camera analysis to brain with audio
  // ══════════════════════════════════════════════════════════
  let _visionInterval = null;
  let _lastVisualSent = 0;
  const VISION_SEND_INTERVAL = 4000; // send camera context every 4s

  function startVisualSync() {
    if (_visionInterval) return;
    _visionInterval = setInterval(function () {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (!window.KAutoCamera || !KAutoCamera.isActive()) return;
      if (Date.now() - _lastVisualSent < VISION_SEND_INTERVAL) return;

      // Get last vision analysis result (from auto-camera deep scan)
      var lastVision = window._lastVisionResult || null;
      if (lastVision) {
        ws.send(JSON.stringify({
          type: 'visual_context',
          description: lastVision.description || lastVision,
        }));
        _lastVisualSent = Date.now();
      }
    }, 2000);
  }

  function stopVisualSync() {
    if (_visionInterval) {
      clearInterval(_visionInterval);
      _visionInterval = null;
    }
  }

  // ══════════════════════════════════════════════════════════
  // MICROPHONE CAPTURE with full audio processing chain
  // ══════════════════════════════════════════════════════════
  async function startMicCapture() {
    var ctx = getAudioContext();

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: { ideal: 24000, min: 16000 },
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,      // browser-level noise suppression
        autoGainControl: true,       // browser-level AGC
        latency: { ideal: 0.01 },    // low latency
      },
    });

    micSource = ctx.createMediaStreamSource(mediaStream);

    // Build pro audio chain: highpass → lowpass → compressor → gain → analyser
    var chainOutput = buildAudioChain(ctx, micSource);

    // AudioWorklet with noise gate + PCM conversion
    var usingWorklet = false;
    if (ctx.audioWorklet) {
      try {
        var blob = new Blob([getWorkletCode()], { type: 'application/javascript' });
        var url = URL.createObjectURL(blob);
        await ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);

        workletNode = new AudioWorkletNode(ctx, 'live-voice-processor');
        workletNode.port.onmessage = function (e) {
          if (!isListening || !ws || ws.readyState !== WebSocket.OPEN) return;
          ws.send(e.data);
        };
        chainOutput.connect(workletNode);
        workletNode.connect(ctx.destination); // needed to keep worklet alive
        usingWorklet = true;
        console.log('[LiveVoice] 🎤 Mic: AudioWorklet + NoiseGate + AGC');
      } catch (wErr) {
        console.warn('[LiveVoice] AudioWorklet failed:', wErr.message);
      }
    }

    if (!usingWorklet) {
      // ScriptProcessor fallback with manual noise gate
      var processor = ctx.createScriptProcessor(4096, 1, 1);
      var gateGain = 0;
      var attackRate = 1.0 / (NOISE_GATE_ATTACK * ctx.sampleRate);
      var releaseRate = 1.0 / (NOISE_GATE_RELEASE * ctx.sampleRate);
      processor.onaudioprocess = function (e) {
        if (!isListening || !ws || ws.readyState !== WebSocket.OPEN) return;
        var input = e.inputBuffer.getChannelData(0);
        // RMS check
        var sumSq = 0;
        for (var i = 0; i < input.length; i++) sumSq += input[i] * input[i];
        var rms = Math.sqrt(sumSq / input.length);
        var rmsDb = 20 * Math.log10(Math.max(rms, 1e-10));
        var shouldOpen = rmsDb > NOISE_GATE_THRESHOLD;

        var pcm = new Int16Array(input.length);
        for (var i = 0; i < input.length; i++) {
          if (shouldOpen) gateGain = Math.min(1, gateGain + attackRate);
          else gateGain = Math.max(0, gateGain - releaseRate);
          pcm[i] = Math.max(-1, Math.min(1, input[i] * gateGain)) * 0x7fff;
        }
        ws.send(pcm.buffer);
      };
      chainOutput.connect(processor);
      processor.connect(ctx.destination);
      console.log('[LiveVoice] 🎤 Mic: ScriptProcessor fallback + NoiseGate');
    }

    isListening = true;
  }

  function stopMicCapture() {
    isListening = false;
    stopAGC();
    if (mediaStream) {
      mediaStream.getTracks().forEach(function (t) { t.stop(); t.enabled = false; });
      mediaStream = null;
    }
    micSource = null;
    workletNode = null;
    highPass = null;
    lowPass = null;
    compressor = null;
    gainNode = null;
    analyserNode = null;
  }

  // ══════════════════════════════════════════════════════════
  // STATE MANAGEMENT + UI EVENTS
  // ══════════════════════════════════════════════════════════
  function emitState(status) {
    window.dispatchEvent(new CustomEvent('live-voice-state', {
      detail: {
        active: _active,
        connected: isConnected,
        connecting: _connecting,
        listening: isListening,
        playing: isPlaying,
        status: status || (_active ? 'active' : 'inactive'),
      },
    }));
  }

  // ══════════════════════════════════════════════════════════
  // WEBSOCKET CONNECTION
  // ══════════════════════════════════════════════════════════
  async function connect() {
    if (_active || _connecting) return true;
    _connecting = true;
    emitState('connecting');

    try {
      var avatar = window.KAvatar ? KAvatar.getCurrentAvatar() : 'kira';
      var language = window.i18n ? i18n.getLanguage() : 'multi';
      var token = '';
      if (window.KAuth && KAuth.getToken) {
        token = KAuth.getToken() || '';
      }

      var url = WS_BASE + '/api/voice-live?avatar=' + encodeURIComponent(avatar) +
        '&language=' + encodeURIComponent(language) +
        (token ? '&token=' + encodeURIComponent(token) : '');

      ws = new WebSocket(url);
      ws.binaryType = 'arraybuffer';

      ws.onopen = function () {
        isConnected = true;
        _connecting = false;
        _active = true;
        console.log('[LiveVoice] ✅ Connected');
        emitState('connected');
        // Start mic after connection
        startMicCapture().then(function () {
          emitState('listening');
          // Start visual sync if camera is on
          startVisualSync();
        }).catch(function (err) {
          console.error('[LiveVoice] Mic error:', err.message);
          emitState('mic_error');
        });
      };

      ws.onmessage = function (event) {
        // Binary = PCM audio from ElevenLabs TTS
        if (event.data instanceof ArrayBuffer) {
          emitState('speaking');
          playPCMChunk(new Uint8Array(event.data));
          return;
        }

        // Text = JSON control messages
        try {
          var msg = JSON.parse(event.data);
          handleMessage(msg);
        } catch (e) {
          console.warn('[LiveVoice] Parse error:', e.message);
        }
      };

      ws.onclose = function () {
        console.log('[LiveVoice] Disconnected');
        cleanup();
      };

      ws.onerror = function () {
        console.error('[LiveVoice] WS error');
        cleanup();
      };

      return true;
    } catch (e) {
      console.error('[LiveVoice] Connect error:', e.message);
      _connecting = false;
      emitState('error');
      return false;
    }
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'ready':
        console.log('[LiveVoice] Pipeline:', msg.stt, '→', msg.llm, '→', msg.tts);
        if (msg.userName) {
          console.log('[LiveVoice] User:', msg.userName);
        }
        break;

      case 'transcript':
        // Show what user is saying (live subtitle)
        window.dispatchEvent(new CustomEvent('live-voice-transcript', {
          detail: {
            text: msg.text,
            interim: msg.interim,
            confidence: msg.confidence,
            language: msg.language,
          },
        }));
        // Show in chat overlay
        if (!msg.interim) {
          var overlay = document.getElementById('chat-overlay');
          if (overlay) {
            overlay.textContent = '🎤 ' + msg.text;
            overlay.style.display = 'block';
            setTimeout(function () { overlay.style.display = 'none'; }, 3000);
          }
        }
        break;

      case 'thinking':
        // Show thinking indicator
        var thinking = document.getElementById('thinking');
        if (thinking) thinking.style.display = 'flex';
        emitState('thinking');
        break;

      case 'reply':
        // Hide thinking, show reply
        var thinking2 = document.getElementById('thinking');
        if (thinking2) thinking2.style.display = 'none';
        // Show reply in chat
        var overlay2 = document.getElementById('chat-overlay');
        if (overlay2) {
          overlay2.textContent = msg.text;
          overlay2.style.display = 'block';
        }
        // Show subtitle
        if (window.KVoice && KVoice.showSubtitle) {
          KVoice.showSubtitle(msg.text);
        }
        // Update detected language for i18n
        if (msg.language && window.i18n && i18n.setLanguage) {
          // Don't override if same
        }
        console.log('[LiveVoice] Reply (' + msg.duration + 'ms):', msg.text.substring(0, 80) + '...');
        break;

      case 'emotion':
        if (window.KAvatar) {
          try { KAvatar.setExpression(msg.emotion, 0.6); } catch (_e) { /* */ }
        }
        break;

      case 'alignment':
        // ElevenLabs alignment data for precise lip sync
        if (window.KAvatar) {
          var ls = KAvatar.getLipSync();
          if (ls && ls.setAlignment) {
            try { ls.setAlignment(msg.data); } catch (_e) { /* */ }
          }
        }
        break;

      case 'audio_end':
        // TTS finished speaking
        emitState('listening');
        break;

      case 'error':
        console.error('[LiveVoice] Server error:', msg.error);
        break;
    }
  }

  function cleanup() {
    isConnected = false;
    _active = false;
    _connecting = false;
    stopMicCapture();
    stopPlayback();
    stopVisualSync();
    if (ws) {
      try { ws.close(); } catch (_e) { /* */ }
      ws = null;
    }
    emitState('inactive');
  }

  function disconnect() {
    console.log('[LiveVoice] Disconnecting...');
    cleanup();
  }

  // ══════════════════════════════════════════════════════════
  // PUBLIC API — toggle on/off
  // ══════════════════════════════════════════════════════════
  function toggle() {
    if (_active) {
      disconnect();
      return false;
    } else {
      connect();
      return true;
    }
  }

  function isActive() {
    return _active && isConnected;
  }

  function isCurrentlyConnecting() {
    return _connecting;
  }

  // Expose globally
  window.KLiveVoice = {
    toggle: toggle,
    connect: connect,
    disconnect: disconnect,
    isActive: isActive,
    isConnecting: isCurrentlyConnecting,
    stopPlayback: stopPlayback,
  };

  console.log('[LiveVoice] Module loaded — Mic → NoiseGate → AGC → Deepgram → Brain → ElevenLabs');
})();
