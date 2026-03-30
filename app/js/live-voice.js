// ═══════════════════════════════════════════════════════════════
// App — Live Voice Client: True Audio-to-Audio
// Pipeline: Mic PCM → WebSocket → OpenAI Realtime (audio native)
//   → PCM audio back → Speaker + Lip Sync
// Text extracted on background for subtitles + brain memory
// Audio filtering: HighPass + LowPass + Compressor + AGC + NoiseGate
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  let ws = null;
  let audioCtx = null;
  let mediaStream = null;
  let isConnected = false;
  let _active = false;
  let _connecting = false;
  let isPlaying = false;

  // Audio processing nodes
  let micSource = null;
  let highPass = null;
  let lowPass = null;
  let compressor = null;
  let gainNode = null;
  let analyserNode = null;
  let workletNode = null;
  let scriptProcessor = null;

  // AGC
  let _agcInterval = null;
  const AGC_TARGET_RMS = 0.15;
  const AGC_MIN_GAIN = 0.5;
  const AGC_MAX_GAIN = 4.0;
  const AGC_SMOOTHING = 0.05;

  // Noise gate
  const NOISE_GATE_THRESHOLD = -45; // dB
  const NOISE_GATE_ATTACK = 0.005;
  const NOISE_GATE_RELEASE = 0.08;

  // Playback scheduling
  let nextPlayTime = 0;
  const SAMPLE_RATE = 24000; // OpenAI Realtime = 24kHz PCM16

  // Camera sync
  let _cameraInterval = null;

  var API_BASE = window.location.origin;
  var WS_BASE = API_BASE.replace('https://', 'wss://').replace('http://', 'ws://');

  // ══════════════════════════════════════════════════════════
  // AUDIO CONTEXT
  // ══════════════════════════════════════════════════════════
  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: SAMPLE_RATE });
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  // ══════════════════════════════════════════════════════════
  // AUDIO PROCESSING CHAIN
  // Mic → HighPass(80Hz) → LowPass(8kHz) → Compressor → Gain(AGC) → Analyser
  // ══════════════════════════════════════════════════════════
  function buildAudioChain(ctx, source) {
    highPass = ctx.createBiquadFilter();
    highPass.type = 'highpass';
    highPass.frequency.value = 80;
    highPass.Q.value = 0.7;

    lowPass = ctx.createBiquadFilter();
    lowPass.type = 'lowpass';
    lowPass.frequency.value = 8000;
    lowPass.Q.value = 0.7;

    compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -30;
    compressor.knee.value = 12;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.15;

    gainNode = ctx.createGain();
    gainNode.gain.value = 1.0;

    analyserNode = ctx.createAnalyser();
    analyserNode.fftSize = 2048;
    analyserNode.smoothingTimeConstant = 0.8;

    source.connect(highPass);
    highPass.connect(lowPass);
    lowPass.connect(compressor);
    compressor.connect(gainNode);
    gainNode.connect(analyserNode);

    startAGC();
    return analyserNode;
  }

  function startAGC() {
    if (_agcInterval) return;
    var dataArray = new Float32Array(2048);
    _agcInterval = setInterval(function () {
      if (!analyserNode || !gainNode) return;
      analyserNode.getFloatTimeDomainData(dataArray);
      var sumSq = 0;
      for (var i = 0; i < dataArray.length; i++) sumSq += dataArray[i] * dataArray[i];
      var rms = Math.sqrt(sumSq / dataArray.length);
      var rmsDb = 20 * Math.log10(Math.max(rms, 1e-10));
      if (rmsDb < NOISE_GATE_THRESHOLD) return;
      if (rms > 0.001) {
        var target = AGC_TARGET_RMS / rms;
        target = Math.max(AGC_MIN_GAIN, Math.min(AGC_MAX_GAIN, target));
        gainNode.gain.value += (target - gainNode.gain.value) * AGC_SMOOTHING;
      }
    }, 50);
  }

  function stopAGC() {
    if (_agcInterval) { clearInterval(_agcInterval); _agcInterval = null; }
  }

  // ══════════════════════════════════════════════════════════
  // RESAMPLE: browser native rate → 24kHz
  // ══════════════════════════════════════════════════════════
  function resample(float32, inputRate, outputRate) {
    if (inputRate === outputRate) return float32;
    var ratio = inputRate / outputRate;
    var outLen = Math.round(float32.length / ratio);
    var result = new Float32Array(outLen);
    for (var i = 0; i < outLen; i++) {
      var srcIdx = i * ratio;
      var idx = Math.floor(srcIdx);
      var frac = srcIdx - idx;
      var a = float32[idx] || 0;
      var b = float32[Math.min(idx + 1, float32.length - 1)] || 0;
      result[i] = a + frac * (b - a);
    }
    return result;
  }

  // ══════════════════════════════════════════════════════════
  // PCM PLAYBACK (OpenAI Realtime audio → speaker)
  // ══════════════════════════════════════════════════════════
  function playAudioChunk(base64Audio) {
    var ctx = getAudioCtx();
    var raw = atob(base64Audio);
    var bytes = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    var int16 = new Int16Array(bytes.buffer);
    var float32 = new Float32Array(int16.length);
    for (var j = 0; j < int16.length; j++) float32[j] = int16[j] / 32768.0;

    var buffer = ctx.createBuffer(1, float32.length, SAMPLE_RATE);
    buffer.getChannelData(0).set(float32);

    var src = ctx.createBufferSource();
    src.buffer = buffer;

    // FFT lip sync
    var fftConnected = false;
    if (window.KAvatar) {
      var ls = KAvatar.getLipSync ? KAvatar.getLipSync() : null;
      if (ls && ls.connectToContext) {
        try {
          var an = ls.connectToContext(ctx);
          if (an) { src.connect(an); an.connect(ctx.destination); fftConnected = true; if (!isPlaying && ls.start) ls.start(); }
        } catch (_e) { /* */ }
      }
      if (!isPlaying) {
        try { KAvatar.setExpression('happy', 0.3); } catch (_e) { /* */ }
        try { KAvatar.setPresenting(true); } catch (_e) { /* */ }
      }
    }
    if (!fftConnected) src.connect(ctx.destination);

    var now = ctx.currentTime;
    if (nextPlayTime < now) nextPlayTime = now;
    src.start(nextPlayTime);
    nextPlayTime += buffer.duration;
    isPlaying = true;
  }

  // ══════════════════════════════════════════════════════════
  // MIC CAPTURE with full audio chain
  // ══════════════════════════════════════════════════════════
  async function startMic() {
    var ctx = getAudioCtx();
    var nativeRate = ctx.sampleRate;

    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        latency: { ideal: 0.01 },
      },
    });

    micSource = ctx.createMediaStreamSource(mediaStream);
    var chainOutput = buildAudioChain(ctx, micSource);

    // ScriptProcessor — broad compatibility, noise gate built-in
    var gateGain = 0;
    var attackRate = 1.0 / (NOISE_GATE_ATTACK * nativeRate);
    var releaseRate = 1.0 / (NOISE_GATE_RELEASE * nativeRate);

    scriptProcessor = ctx.createScriptProcessor(4096, 1, 1);
    scriptProcessor.onaudioprocess = function (e) {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;

      var input = e.inputBuffer.getChannelData(0);

      // Noise gate
      var sumSq = 0;
      for (var i = 0; i < input.length; i++) sumSq += input[i] * input[i];
      var rms = Math.sqrt(sumSq / input.length);
      var rmsDb = 20 * Math.log10(Math.max(rms, 1e-10));
      var shouldOpen = rmsDb > NOISE_GATE_THRESHOLD;

      // Resample to 24kHz
      var resampled = resample(input, nativeRate, SAMPLE_RATE);

      // Apply gate + convert to PCM16
      var pcm = new Int16Array(resampled.length);
      for (var i = 0; i < resampled.length; i++) {
        if (shouldOpen) gateGain = Math.min(1, gateGain + attackRate);
        else gateGain = Math.max(0, gateGain - releaseRate);
        var s = Math.max(-1, Math.min(1, resampled[i] * gateGain));
        pcm[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
      }

      // Send binary PCM to server
      ws.send(pcm.buffer);
    };

    chainOutput.connect(scriptProcessor);
    scriptProcessor.connect(ctx.destination);

    console.log('[LiveVoice] 🎤 Mic ON — ' + nativeRate + 'Hz → ' + SAMPLE_RATE + 'Hz (filtered + gated)');
  }

  function stopMic() {
    stopAGC();
    if (scriptProcessor) { try { scriptProcessor.disconnect(); } catch (_e) {} scriptProcessor = null; }
    if (mediaStream) {
      mediaStream.getTracks().forEach(function (t) { t.stop(); t.enabled = false; });
      mediaStream = null;
    }
    micSource = null; highPass = null; lowPass = null; compressor = null; gainNode = null; analyserNode = null;
  }

  // ══════════════════════════════════════════════════════════
  // CAMERA SYNC — send frames for brain vision
  // ══════════════════════════════════════════════════════════
  function startCameraSync() {
    if (_cameraInterval) return;
    // 1s interval — critical for blind user safety (danger detection every second)
    _cameraInterval = setInterval(function () {
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (!window.KAutoCamera || !KAutoCamera.isActive()) return;
      var frame = KAutoCamera.captureFrame();
      if (frame && frame.base64) {
        ws.send(JSON.stringify({ type: 'camera_frame', image: frame.base64 }));
      }
    }, 1000);
  }

  function stopCameraSync() {
    if (_cameraInterval) { clearInterval(_cameraInterval); _cameraInterval = null; }
  }

  // ══════════════════════════════════════════════════════════
  // STATE
  // ══════════════════════════════════════════════════════════
  function emitState(status) {
    window.dispatchEvent(new CustomEvent('live-voice-state', {
      detail: { active: _active, connected: isConnected, connecting: _connecting, playing: isPlaying, status: status || (_active ? 'active' : 'inactive') },
    }));
  }

  // ══════════════════════════════════════════════════════════
  // WEBSOCKET CONNECTION
  // ══════════════════════════════════════════════════════════
  function connect() {
    if (_active || _connecting) return;
    _connecting = true;
    emitState('connecting');

    var avatar = window.KAvatar ? KAvatar.getCurrentAvatar() : 'kira';
    var language = window.i18n ? i18n.getLanguage() : 'ro';
    var token = '';
    if (window.KAuth && KAuth.getToken) token = KAuth.getToken() || '';

    var url = WS_BASE + '/api/voice-live?avatar=' + encodeURIComponent(avatar) +
      '&language=' + encodeURIComponent(language) +
      (token ? '&token=' + encodeURIComponent(token) : '');

    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = function () {
      console.log('[LiveVoice] ✅ WebSocket connected');
    };

    ws.onmessage = function (event) {
      if (event.data instanceof ArrayBuffer) return; // not expected from this server

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
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'ready':
        isConnected = true;
        _connecting = false;
        _active = true;
        console.log('[LiveVoice] Pipeline:', msg.engine, msg.model);
        if (msg.userName) console.log('[LiveVoice] User:', msg.userName);
        emitState('connected');
        // Start mic after ready
        startMic().then(function () {
          emitState('listening');
          startCameraSync();
        }).catch(function (err) {
          console.error('[LiveVoice] Mic error:', err.message);
          emitState('mic_error');
        });
        break;

      case 'audio':
        // OpenAI Realtime audio chunk (base64 PCM) → play directly
        if (msg.data) {
          emitState('speaking');
          playAudioChunk(msg.data);
        }
        break;

      case 'audio_end':
        isPlaying = false;
        setTimeout(function () {
          if (window.KAvatar) {
            try { KAvatar.setExpression('neutral'); } catch (_e) {}
            try { KAvatar.setPresenting(false); } catch (_e) {}
            var ls = KAvatar.getLipSync ? KAvatar.getLipSync() : null;
            if (ls && ls.stop) ls.stop();
          }
          emitState('listening');
        }, 500);
        break;

      case 'cc':
        // Background text extraction — show as subtitle
        if (msg.role === 'user') {
          var overlay = document.getElementById('chat-overlay');
          if (overlay) { overlay.textContent = '🎤 ' + msg.text; overlay.style.display = 'block'; }
        }
        if (msg.role === 'assistant' && window.KVoice && KVoice.showSubtitle) {
          KVoice.showSubtitle(msg.text);
        }
        window.dispatchEvent(new CustomEvent('live-voice-cc', { detail: msg }));
        break;

      case 'cc_done':
        if (msg.role === 'user') {
          var overlay2 = document.getElementById('chat-overlay');
          if (overlay2) setTimeout(function () { overlay2.style.display = 'none'; }, 2000);
        }
        console.log('[LiveVoice] ' + (msg.role === 'user' ? 'YOU' : 'AI') + ': ' + (msg.text || '').substring(0, 80));
        break;

      case 'speech_started':
        if (window.KAvatar) try { KAvatar.setExpression('thinking', 0.3); } catch (_e) {}
        emitState('user_speaking');
        break;

      case 'speech_stopped':
        if (window.KAvatar) try { KAvatar.setExpression('thinking', 0.5); } catch (_e) {}
        emitState('thinking');
        break;

      case 'turn_complete':
        emitState('listening');
        break;

      case 'danger':
        // Real-time danger alert from server — haptic + visual feedback
        console.warn('[LiveVoice] 🚨 DANGER:', msg.level, msg.text);
        if (window.KAvatar) {
          try { KAvatar.setExpression('concerned', 0.8); } catch (_e) {}
        }
        // Haptic vibration for blind users (short urgent pattern)
        if (navigator.vibrate) {
          navigator.vibrate(msg.level === 'immediate' ? [200, 100, 200, 100, 400] : [150, 100, 150]);
        }
        // Dispatch for any UI handler
        window.dispatchEvent(new CustomEvent('live-voice-danger', { detail: msg }));
        emitState('danger');
        break;

      case 'error':
        console.error('[LiveVoice] Error:', msg.error);
        emitState('error');
        break;
    }
  }

  function cleanup() {
    isConnected = false;
    _active = false;
    _connecting = false;
    isPlaying = false;
    nextPlayTime = 0;
    stopMic();
    stopCameraSync();
    if (ws) { try { ws.close(); } catch (_e) {} ws = null; }
    if (window.KAvatar) {
      try { KAvatar.setExpression('neutral'); } catch (_e) {}
      try { KAvatar.setPresenting(false); } catch (_e) {}
    }
    emitState('inactive');
  }

  function disconnect() {
    console.log('[LiveVoice] Disconnecting...');
    cleanup();
  }

  function toggle() {
    if (_active) { disconnect(); return false; }
    connect();
    return true;
  }

  window.KLiveVoice = {
    toggle: toggle,
    connect: connect,
    disconnect: disconnect,
    isActive: function () { return _active && isConnected; },
    isConnecting: function () { return _connecting; },
  };

  console.log('[LiveVoice] Module loaded — True Audio-to-Audio (OpenAI Realtime + Brain + Noise Filter)');
})();
