// ═══════════════════════════════════════════════════════════════
// KelionAI — Voice Stream Client (Browser WebSocket)
// Connects to /api/voice-stream for sub-1s voice-to-voice
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  var ws = null;
  var audioCtx = null;
  var mediaStream = null;
  var audioWorklet = null;
  var isConnected = false;
  var isListening = false;
  var pcmQueue = [];
  var isPlaying = false;
  var currentPlaySource = null; // track current audio source for stop

  var API_BASE = window.location.origin;
  var WS_BASE = API_BASE.replace('https://', 'wss://').replace('http://', 'ws://');

  // ── PCM Player (plays raw PCM16 24kHz from server) ──────────
  function getAudioContext() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  }

  function playPCMChunk(pcmData) {
    var ctx = getAudioContext();
    // PCM16 little-endian → Float32
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
      // Notify voice.js that stream audio ended
      if (window.KVoice) {
        try { window.KVoice.onStreamEnd && window.KVoice.onStreamEnd(); } catch(_e) {}
      }
      return;
    }
    isPlaying = true;
    var ctx = getAudioContext();
    var buffer = pcmQueue.shift();
    var source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = drainQueue;
    currentPlaySource = source;
    source.start();
  }

  // ── STOP all playback immediately ──
  function stopPlayback() {
    pcmQueue = []; // clear pending chunks
    isPlaying = false;
    if (currentPlaySource) {
      try { currentPlaySource.stop(); } catch(_e) {}
      currentPlaySource = null;
    }
    console.log('[VoiceStream] 🛑 Playback stopped (queue cleared)');
  }

  // ── Microphone capture → PCM chunks ────────────────────────
  async function startMicCapture() {
    try {
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });

      var ctx = getAudioContext();
      var source = ctx.createMediaStreamSource(mediaStream);

      // Try AudioWorklet first (modern), fallback to ScriptProcessor (legacy)
      var usingWorklet = false;
      if (ctx.audioWorklet) {
        try {
          // Inline worklet as blob URL to avoid separate file dependency
          var workletCode = `
                        class PCMSender extends AudioWorkletProcessor {
                            process(inputs) {
                                var ch = inputs[0][0];
                                if (!ch) return true;
                                var pcm = new Int16Array(ch.length);
                                for (var i = 0; i < ch.length; i++) {
                                    pcm[i] = Math.max(-1, Math.min(1, ch[i])) * 0x7FFF;
                                }
                                this.port.postMessage(pcm.buffer, [pcm.buffer]);
                                return true;
                            }
                        }
                        registerProcessor('pcm-sender', PCMSender);
                    `;
          var blob = new Blob([workletCode], { type: 'application/javascript' });
          var url = URL.createObjectURL(blob);
          await ctx.audioWorklet.addModule(url);
          URL.revokeObjectURL(url);

          audioWorklet = new AudioWorkletNode(ctx, 'pcm-sender');
          audioWorklet.port.onmessage = function (e) {
            if (!isListening || !ws || ws.readyState !== WebSocket.OPEN) return;
            ws.send(e.data);
          };
          source.connect(audioWorklet);
          audioWorklet.connect(ctx.destination);
          usingWorklet = true;
          console.log('[VoiceStream] 🎤 Mic capture started (AudioWorklet)');
        } catch (workletErr) {
          console.warn('[VoiceStream] AudioWorklet failed, falling back to ScriptProcessor:', workletErr.message);
        }
      }

      if (!usingWorklet) {
        // ScriptProcessor fallback (deprecated but still works)
        var processor = ctx.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = function (e) {
          if (!isListening || !ws || ws.readyState !== WebSocket.OPEN) return;
          var input = e.inputBuffer.getChannelData(0);
          var pcm = new Int16Array(input.length);
          for (var i = 0; i < input.length; i++) {
            pcm[i] = Math.max(-1, Math.min(1, input[i])) * 0x7fff;
          }
          ws.send(pcm.buffer);
        };
        source.connect(processor);
        processor.connect(ctx.destination);
        console.log('[VoiceStream] 🎤 Mic capture started (ScriptProcessor fallback)');
      }

      isListening = true;
    } catch (e) {
      console.error('[VoiceStream] Mic error:', e.message);
      throw e;
    }
  }

  function stopMicCapture() {
    isListening = false;
    if (mediaStream) {
      mediaStream.getTracks().forEach(function (t) {
        t.stop();
      });
      mediaStream = null;
    }
    console.log('[VoiceStream] 🔇 Mic capture stopped');
  }

  // ── WebSocket connection ───────────────────────────────────
  function connect(opts) {
    opts = opts || {};
    var avatar = opts.avatar || (window.KAvatar ? KAvatar.getCurrentAvatar() : 'kelion');
    var language = opts.language || 'ro';

    var token = window.KAuth && KAuth.getToken ? KAuth.getToken() || '' : '';
    var url =
      WS_BASE +
      '/api/voice-stream?avatar=' +
      avatar +
      '&language=' +
      language +
      (token ? '&token=' + encodeURIComponent(token) : '');
    console.log('[VoiceStream] Connecting to', url);

    ws = new WebSocket(url);
    ws.binaryType = 'arraybuffer';

    ws.onopen = function () {
      isConnected = true;
      console.log('[VoiceStream] ✅ Connected');
    };

    ws.onmessage = function (event) {
      // Binary = PCM audio from TTS
      if (event.data instanceof ArrayBuffer) {
        playPCMChunk(new Uint8Array(event.data));
        return;
      }

      // Text = JSON control messages
      try {
        var msg = JSON.parse(event.data);
        handleMessage(msg);
      } catch (e) {
        console.warn('[VoiceStream] Parse error:', e.message);
      }
    };

    ws.onclose = function () {
      isConnected = false;
      console.log('[VoiceStream] Disconnected');
    };

    ws.onerror = function (e) {
      console.error('[VoiceStream] WS error');
      isConnected = false;
    };
  }

  function handleMessage(msg) {
    switch (msg.type) {
      case 'ready':
        console.log('[VoiceStream] Pipeline ready:', msg.stt, '→', msg.llm, '→', msg.tts);
        window.dispatchEvent(new CustomEvent('voice-stream-ready', { detail: msg }));
        break;

      case 'transcript':
        // Show interim/final transcript in chat
        if (!msg.interim) {
          var overlay = document.getElementById('chat-overlay');
          if (overlay) {
            // Remove any interim display
            var interimEl = document.getElementById('vs-interim');
            if (interimEl) interimEl.remove();
            // Add final user message
            var userMsg = document.createElement('div');
            userMsg.className = 'msg user';
            userMsg.textContent = '🎙️ ' + msg.text;
            overlay.appendChild(userMsg);
            overlay.scrollTop = overlay.scrollHeight;
          }
          // Show thinking indicator
          var thinking = document.getElementById('thinking');
          if (thinking) thinking.classList.add('active');
        } else {
          // Show interim text as ghost text
          var overlay = document.getElementById('chat-overlay');
          if (overlay) {
            var interimEl = document.getElementById('vs-interim');
            if (!interimEl) {
              interimEl = document.createElement('div');
              interimEl.id = 'vs-interim';
              interimEl.className = 'msg user';
              interimEl.style.opacity = '0.5';
              overlay.appendChild(interimEl);
            }
            interimEl.textContent = '🎙️ ' + msg.text + '...';
            overlay.scrollTop = overlay.scrollHeight;
          }
        }
        break;

      case 'llm_start':
        console.log('[VoiceStream] LLM TTFT:', msg.ttft, 'ms');
        // Fire audio-start event for avatar lip sync
        window.dispatchEvent(new CustomEvent('audio-start', { detail: { duration: 5 } }));
        break;

      case 'token':
        // Streaming text — append to current assistant message
        var overlay = document.getElementById('chat-overlay');
        if (overlay) {
          var assistEl = document.getElementById('vs-reply');
          if (!assistEl) {
            // Hide thinking
            var thinking = document.getElementById('thinking');
            if (thinking) thinking.classList.remove('active');
            // Create assistant message element
            assistEl = document.createElement('div');
            assistEl.id = 'vs-reply';
            assistEl.className = 'msg assistant';
            overlay.appendChild(assistEl);
          }
          assistEl.textContent += msg.text;
          overlay.scrollTop = overlay.scrollHeight;
        }
        break;

      case 'audio_end':
        console.log('[VoiceStream] Audio stream ended');
        break;

      case 'turn_complete':
        console.log('[VoiceStream] Turn complete:', msg.totalTime, 'ms');
        // Reset the reply element ID so next turn creates a new one
        var replyEl = document.getElementById('vs-reply');
        if (replyEl) replyEl.removeAttribute('id');

        window.dispatchEvent(new CustomEvent('voice-stream-turn', { detail: msg }));
        break;

      case 'error':
        console.error('[VoiceStream] Server error:', msg.error);
        var thinking = document.getElementById('thinking');
        if (thinking) thinking.classList.remove('active');
        break;
    }
  }

  // ── Send text directly (fallback when no Deepgram STT) ─────
  function sendText(text) {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      console.warn('[VoiceStream] Not connected');
      return false;
    }
    ws.send(JSON.stringify({ type: 'text_input', text: text }));
    return true;
  }

  // ── Public API ─────────────────────────────────────────────
  window.KVoiceStream = {
    connect: connect,
    disconnect: function () {
      stopPlayback();
      stopMicCapture();
      if (ws) ws.close();
      ws = null;
      isConnected = false;
    },
    startMic: startMicCapture,
    stopMic: stopMicCapture,
    stopPlayback: stopPlayback,
    sendText: sendText,
    isConnected: function () {
      return isConnected;
    },
    isListening: function () {
      return isListening;
    },
    isPlaying: function () {
      return isPlaying;
    },
  };

  console.log('[VoiceStream] 🔌 Client module loaded');
})();
