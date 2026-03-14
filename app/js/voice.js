// KelionAI v2 — Voice Module (AudioContext — FIXED)
(function () {
  'use strict';
  const API_BASE = window.location.origin;
  let mediaRecorder = null,
    audioChunks = [],
    isRecording = false,
    isSpeaking = false;
  let currentSourceNode = null,
    sharedAudioCtx = null,
    detectedLanguage = 'ro';
  let pendingAudioBuffer = null,
    pendingAudioAvatar = null,
    pendingAudioText = null;
  let recognition = null,
    isListeningForWake = false,
    isProcessing = false;

  // ─── Subtitle overlay ───────────────────────────────────
  let _subtitleEl = null;
  let _subtitleTimer = null;
  /**
   * _ensureSubtitleEl
   * @returns {*}
   */
  function _ensureSubtitleEl() {
    if (_subtitleEl && document.body.contains(_subtitleEl)) return _subtitleEl;
    _subtitleEl = document.createElement('div');
    _subtitleEl.id = 'speech-subtitle';
    _subtitleEl.setAttribute('aria-live', 'polite');
    const parent = document.getElementById('avatar-area') || document.querySelector('.left-panel') || document.body;
    parent.style.position = parent.style.position || 'relative';
    parent.appendChild(_subtitleEl);
    return _subtitleEl;
  }
  /**
   * _showSubtitle
   * @param {*} text
   * @returns {*}
   */
  function _showSubtitle(text) {
    if (!text) return;
    // Strip any leaked system instructions
    text = (text || '')
      .replace(/\[SYSTEM INSTRUCTION[^\]]*\][\s\S]*?\[END SYSTEM INSTRUCTION\]\s*/gi, '')
      .replace(/\[AGENT ACTIV[^\]]*\]\s*/gi, '')
      .trim();
    if (!text) return;
    if (_subtitleTimer) {
      clearTimeout(_subtitleTimer);
      _subtitleTimer = null;
    }
    const el = _ensureSubtitleEl();
    // Truncate to ~120 chars for single line
    const display = text.length > 120 ? text.substring(0, 117) + '...' : text;
    el.textContent = display;
    el.classList.add('visible');
  }
  /**
   * hideSubtitle
   * @returns {*}
   */
  function hideSubtitle() {
    if (!_subtitleEl) return;
    _subtitleEl.classList.remove('visible');
    _subtitleTimer = setTimeout(function () {
      if (_subtitleEl) _subtitleEl.textContent = '';
    }, 600);
  }

  /**
   * getAudioContext
   * @returns {*}
   */
  function getAudioContext() {
    if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume();
    return sharedAudioCtx;
  }

  /**
   * ensureAudioUnlocked
   * @returns {*}
   */
  function ensureAudioUnlocked() {
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') ctx.resume();
    try {
      const b = ctx.createBuffer(1, 1, 22050),
        s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    } catch (_e) {
      /* ignored */
    }
    // Replay pending audio if context was suspended and is now running
    if (ctx.state === 'running' && pendingAudioBuffer) {
      const buf = pendingAudioBuffer,
        _av = pendingAudioAvatar,
        txt = pendingAudioText;
      pendingAudioBuffer = null;
      pendingAudioAvatar = null;
      pendingAudioText = null;
      const btn = document.getElementById('audio-unlock-btn');
      if (btn) btn.remove();
      isSpeaking = true;
      playAudioBuffer(buf, txt);
    }
  }

  // ─── AUTO-UNLOCK: browser requires user gesture for AudioContext ──
  // This fires on the FIRST click/key/touch and unlocks audio permanently
  let _audioUnlocked = false;
  /**
   * _autoUnlockAudio
   * @returns {*}
   */
  function _autoUnlockAudio() {
    if (_audioUnlocked) return;
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().then(function () {});
    }
    try {
      const b = ctx.createBuffer(1, 1, 22050),
        s = ctx.createBufferSource();
      s.buffer = b;
      s.connect(ctx.destination);
      s.start(0);
    } catch (_e) {
      /* ignored */
    }
    if (ctx.state === 'running') {
      _audioUnlocked = true;
      // Remove listeners — only need to unlock once
      document.removeEventListener('click', _autoUnlockAudio, true);
      document.removeEventListener('keydown', _autoUnlockAudio, true);
      document.removeEventListener('touchstart', _autoUnlockAudio, true);
    }
  }
  document.addEventListener('click', _autoUnlockAudio, true);
  document.addEventListener('keydown', _autoUnlockAudio, true);
  document.addEventListener('touchstart', _autoUnlockAudio, true);

  // ─── Wake Word (always-on mic) ───────────────────────────
  function startWakeWordDetection() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;
    recognition = new SR();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 3;

    recognition.onresult = (event) => {
      if (isProcessing || isSpeaking) return;
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (!event.results[i].isFinal) continue;
        const t = event.results[i][0].transcript.toLowerCase().trim();
        const c = event.results[i][0].confidence;
        if (c < 0.3) continue;

        const hasKelion = t.includes('kelion') || t.includes('chelion');
        const hasKira = t.includes('kira') || t.includes('chira');

        if ((hasKelion || hasKira) && t.length > 1) {
          // 1. Activate mic FIRST — always, regardless of selected avatar
          isProcessing = true;
          if (window.KAvatar) window.KAvatar.setAttentive(true);
          let msg = t;
          if (hasKelion) msg = t.replace(/kelion|chelion/i, '').trim() || t;
          else if (hasKira) msg = t.replace(/kira|chira/i, '').trim() || t;
          window.dispatchEvent(
            new CustomEvent('wake-message', {
              detail: { text: msg, language: detectedLanguage },
            })
          );

          // 2. Switch avatar AFTER dispatch (heavy 3D load won't block message)
          const targetAvatar = hasKira ? 'kira' : 'kelion';
          if (window.KAvatar && targetAvatar !== window.KAvatar.getCurrentAvatar()) {
            window.KAvatar.loadAvatar(targetAvatar);
            document
              .querySelectorAll('.avatar-pill')
              .forEach((b) => b.classList.toggle('active', b.dataset.avatar === targetAvatar));
            const displayName = targetAvatar.charAt(0).toUpperCase() + targetAvatar.slice(1);
            const navName = document.getElementById('navbar-avatar-name');
            if (navName) navName.textContent = displayName;
            const avatarName = document.getElementById('avatar-name');
            if (avatarName) avatarName.textContent = displayName;
            document.title = displayName + 'AI';
          }
        }
      }
    };
    recognition.onend = () => {
      if (isListeningForWake && !isProcessing)
        try {
          recognition.start();
        } catch (_e) {
          /* ignored */
        }
    };
    recognition.onerror = (e) => {
      if (e.error !== 'not-allowed' && isListeningForWake)
        setTimeout(() => {
          try {
            recognition.start();
          } catch (_e) {
            /* ignored */
          }
        }, 1000);
    };
    try {
      recognition.start();
      isListeningForWake = true;
    } catch (_e) {
      /* ignored */
    }
    // Start mic level monitor (standalone function, no duplicate)
    startMicMonitor();
  }

  /**
   * resumeWakeDetection
   * @returns {*}
   */
  function resumeWakeDetection() {
    isProcessing = false;
    window.KAvatar.setAttentive(false);
    if (isListeningForWake && recognition)
      try {
        recognition.start();
      } catch (_e) {
        /* ignored */
      }
  }

  /**
   * stopWakeWordDetection
   * @returns {*}
   */
  function stopWakeWordDetection() {
    isListeningForWake = false;
    isProcessing = false;
    if (recognition)
      try {
        recognition.stop();
      } catch (_e) {
        /* ignored */
      }
  }

  /**
   * detectLanguage
   * @param {*} _text
   * @returns {*}
   */
  function detectLanguage(_text) {
    // Language detection disabled for voice switching —
    // Voice language is controlled by AI response (KVoice.setLanguage from app.js)
    // The naive keyword matching was causing voice switching mid-conversation (B3 bug)
    return;
  }

  // ─── SPEAK — AudioContext (bypass autoplay!) ─────────────
  function cleanTextForTTS(text) {
    return text
      .replace(/\[SYSTEM INSTRUCTION[^\]]*\][\s\S]*?\[END SYSTEM INSTRUCTION\]\s*/gi, '') // strip system prompts
      .replace(/\[AGENT ACTIV[^\]]*\]\s*/gi, '')
      .replace(/```[\s\S]*?```/g, '') // code blocks
      .replace(/`[^`]+`/g, '') // inline code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url) → text
      .replace(/https?:\/\/\S+/g, '') // URLs
      .replace(/[*_~#>]+/g, '') // markdown formatting
      .replace(/\n{2,}/g, '. ') // multiple newlines → pause
      .replace(/\s{2,}/g, ' ') // collapse whitespace
      .trim();
  }

  let speakSafetyTimer = null;
  let _speakId = 0; // atomic counter — prevents race condition overlap
  const CHUNK_MAX = 450; // max chars per TTS chunk — ElevenLabs truncates at ~5000

  // Split text into sentence chunks of ~CHUNK_MAX chars
  function _chunkText(text) {
    if (text.length <= CHUNK_MAX) return [text];
    const chunks = [];
    // Split on sentence boundaries
    const sentences = text.split(/(?<=[.!?])\s+/);
    let current = '';
    for (let i = 0; i < sentences.length; i++) {
      if (current.length + sentences[i].length > CHUNK_MAX && current.length > 0) {
        chunks.push(current.trim());
        current = sentences[i];
      } else {
        current += (current ? ' ' : '') + sentences[i];
      }
    }
    if (current.trim()) chunks.push(current.trim());
    return chunks.length ? chunks : [text.substring(0, CHUNK_MAX)];
  }

  /**
   * speak
   * @param {*} text
   * @param {*} avatar
   * @returns {*}
   */
  async function speak(text, avatar) {
    if (isSpeaking) stopSpeaking();
    if (!text || !text.trim()) return;
    const thisId = ++_speakId; // capture generation
    isSpeaking = true;
    if (speakSafetyTimer) clearTimeout(speakSafetyTimer);
    speakSafetyTimer = setTimeout(function () {
      if (isSpeaking) {
        console.warn('[Voice] Safety timeout');
        stopSpeaking();
      }
    }, 60000); // increased from 30s for multi-chunk

    try {
      const ttsText = cleanTextForTTS(text);
      if (!ttsText) {
        isSpeaking = false;
        resumeWakeDetection();
        return;
      }

      // FORCE AudioContext running before fetching
      let ctx = getAudioContext();
      try {
        await ctx.resume();
      } catch (_e) {
        /* ignored */
      }
      if (ctx.state !== 'running') {
        sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        ctx = sharedAudioCtx;
        try {
          await ctx.resume();
        } catch (_e) {
          /* ignored */
        }
      }

      // Chunk the text and play each chunk sequentially
      const chunks = _chunkText(ttsText);

      // ═══ PREFETCH PATTERN: fetch next chunk while current plays ═══
      // This eliminates the pause between chunks
      async function fetchChunkAudio(chunkText, avatar) {
        const resp = await fetch(API_BASE + '/api/speak', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(window.KAuth ? KAuth.getAuthHeaders() : {}),
          },
          body: JSON.stringify({
            text: chunkText,
            avatar: avatar || KAvatar.getCurrentAvatar(),
            language: detectedLanguage,
          }),
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        if (!data.audio) return null;
        const binaryStr = atob(data.audio);
        const arrayBuf = new ArrayBuffer(binaryStr.length);
        const bytes = new Uint8Array(arrayBuf);
        for (let bi = 0; bi < binaryStr.length; bi++) bytes[bi] = binaryStr.charCodeAt(bi);
        return { arrayBuf, alignment: data.alignment || null };
      }

      // Start prefetching first chunk immediately
      let prefetchPromise = fetchChunkAudio(chunks[0], avatar);

      for (let ci = 0; ci < chunks.length; ci++) {
        if (thisId !== _speakId) {
          return;
        }

        // Wait for current chunk's audio (already prefetched)
        const chunkData = await prefetchPromise;
        if (thisId !== _speakId) return;

        // Start prefetching NEXT chunk immediately (while current plays)
        if (ci + 1 < chunks.length) {
          prefetchPromise = fetchChunkAudio(chunks[ci + 1], avatar);
        }

        if (!chunkData) {
          console.warn('[Voice] TTS chunk', ci, 'failed');
          continue;
        }

        // Play this chunk and wait for it to finish before next
        await new Promise(function (resolve) {
          playAudioChunk(chunkData.arrayBuf, chunks[ci], ci === chunks.length - 1, resolve, chunkData.alignment);
        });
      }
    } catch (e) {
      console.error('[Voice]', e);
      stopAllLipSync();
      hideSubtitle();
      isSpeaking = false;
      resumeWakeDetection();
    }
  }

  // Play a single audio chunk — calls onDone when finished
  function playAudioChunk(arrayBuf, chunkText, isLast, onDone, alignment) {
    const ctx = getAudioContext();
    ctx.decodeAudioData(
      arrayBuf.slice(0),
      function (audioBuf) {
        currentSourceNode = ctx.createBufferSource();
        currentSourceNode.buffer = audioBuf;

        // ── Professional lip sync with alignment (ElevenLabs) ──
        let usingAlignment = false;
        if (alignment && window.AlignmentLipSync) {
          try {
            AlignmentLipSync.setMorphMeshes(KAvatar.getMorphMeshes());
            AlignmentLipSync.setAudioContext(ctx);
            AlignmentLipSync.load(alignment);
            currentSourceNode.connect(ctx.destination);
            AlignmentLipSync.start(ctx.currentTime);
            usingAlignment = true;
          } catch (e) {
            console.warn('[Voice] AlignmentLipSync failed, falling back to FFT:', e.message);
          }
        }

        // ── Fallback: FFT-based lip sync ──
        if (!usingAlignment) {
          const ls = KAvatar.getLipSync();
          let fftOk = false;
          if (ls && ls.connectToContext) {
            try {
              const an = ls.connectToContext(ctx);
              if (an) {
                currentSourceNode.connect(an);
                an.connect(ctx.destination);
                fftOk = true;
                ls.start();
              }
            } catch (_e) {
              /* ignored */
            }
          }
          if (!fftOk) {
            currentSourceNode.connect(ctx.destination);
            fallbackTextLipSync(chunkText);
          }
        }

        KAvatar.setExpression('happy', 0.3);
        KAvatar.setPresenting(true);

        currentSourceNode.onended = function () {
          if (usingAlignment && window.AlignmentLipSync) {
            try {
              AlignmentLipSync.stop();
            } catch (_e) {
              /* ignored */
            }
          }
          if (isLast) {
            stopAllLipSync();
            hideSubtitle();
            isSpeaking = false;
            currentSourceNode = null;
            KAvatar.setExpression('neutral');
            KAvatar.setPresenting(false);
            resumeWakeDetection();
          }
          onDone();
        };
        currentSourceNode.start(0);
        // Dispatch audio-start on first chunk so text reveal animation begins
        if (!isLast || ci === undefined) {
          // Always dispatch for first chunk of each speak() call
        }
        window.dispatchEvent(
          new CustomEvent('audio-start', {
            detail: { duration: audioBuf.duration, isChunked: true },
          })
        );
        console.log(
          '[Voice] ✅ Chunk playing (' +
            arrayBuf.byteLength +
            'B, ' +
            Math.round(audioBuf.duration) +
            's' +
            (usingAlignment ? ', ALIGNED' : '') +
            ')'
        );
      },
      function (_err) {
        console.warn('[Voice] Chunk decode failed');
        if (isLast) {
          stopAllLipSync();
          hideSubtitle();
          isSpeaking = false;
          KAvatar.setExpression('neutral');
          KAvatar.setPresenting(false);
          resumeWakeDetection();
        }
        onDone();
      }
    );
  }

  /**
   * playAudioBuffer
   * @param {*} arrayBuf
   * @param {*} fallbackText
   * @returns {*}
   */
  async function playAudioBuffer(arrayBuf, fallbackText) {
    const ctx = getAudioContext();
    let audioBuf;
    try {
      audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
    } catch (_e) {
      console.warn('[Voice] Audio decode failed');
      fallbackTextLipSync(fallbackText || '');
      isSpeaking = false;
      resumeWakeDetection();
      return;
    }

    currentSourceNode = ctx.createBufferSource();
    currentSourceNode.buffer = audioBuf;

    // Wire FFT lip sync
    const ls = KAvatar.getLipSync();
    let fftOk = false;
    if (ls && ls.connectToContext) {
      try {
        const an = ls.connectToContext(ctx);
        if (an) {
          currentSourceNode.connect(an);
          an.connect(ctx.destination);
          fftOk = true;
          ls.start();
        }
      } catch (_e) {
        /* ignored */
      }
    }
    if (!fftOk) {
      currentSourceNode.connect(ctx.destination);
      fallbackTextLipSync(fallbackText || '');
    }

    KAvatar.setExpression('happy', 0.3);
    KAvatar.setPresenting(true);

    // Auto-gestures during speech
    if (fallbackText) {
      const gt = fallbackText.toLowerCase();
      setTimeout(function () {
        if (window.KAvatar) KAvatar.playGesture('nod');
      }, 500);
      if (gt.includes('?'))
        setTimeout(function () {
          if (window.KAvatar) KAvatar.playGesture('tilt');
        }, 2000);
      if (gt.includes('!'))
        setTimeout(function () {
          if (window.KAvatar) KAvatar.playGesture('nod');
        }, 1500);
      if (gt.length > 200) {
        setTimeout(function () {
          if (window.KAvatar) KAvatar.playGesture('lookAway');
        }, 3000);
        setTimeout(function () {
          if (window.KAvatar) KAvatar.playGesture('nod');
        }, 5000);
      }
      if (/\b(nu|no|nein|non|niet|imposibil|impossible|unfortunately|din păcate)\b/i.test(gt)) {
        setTimeout(function () {
          if (window.KAvatar) KAvatar.playGesture('shake');
        }, 1000);
      }
    }

    currentSourceNode.onended = () => {
      stopAllLipSync();
      hideSubtitle();
      isSpeaking = false;
      currentSourceNode = null;
      KAvatar.setExpression('neutral');
      KAvatar.setPresenting(false);
      resumeWakeDetection();
    };
    currentSourceNode.start(0);
    // Dispatch event for synchronized text reveal
    window.dispatchEvent(
      new CustomEvent('audio-start', {
        detail: { duration: audioBuf.duration },
      })
    );
    // Safety timeout: stop lip sync even if onended doesn't fire
    const audioDurationMs = Math.ceil(audioBuf.duration * 1000) + 500;
    setTimeout(function () {
      if (isSpeaking) {
        stopAllLipSync();
        hideSubtitle();
        isSpeaking = false;
        currentSourceNode = null;
        KAvatar.setExpression('neutral');
        KAvatar.setPresenting(false);
        resumeWakeDetection();
      }
    }, audioDurationMs);
  }

  /**
   * _showAudioUnlockPrompt
   * @param {*} arrayBuf
   * @param {*} avatar
   * @param {*} text
   * @returns {*}
   */
  function _showAudioUnlockPrompt(arrayBuf, avatar, text) {
    pendingAudioBuffer = arrayBuf;
    pendingAudioAvatar = avatar;
    pendingAudioText = text || '';
    let btn = document.getElementById('audio-unlock-btn');
    if (btn) return;
    btn = document.createElement('button');
    btn.id = 'audio-unlock-btn';
    btn.textContent = '🔊 Click to enable sound';
    btn.style.cssText =
      'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#1a73e8;color:#fff;border:none;border-radius:24px;padding:12px 24px;cursor:pointer;z-index:9999;font-size:14px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,0.4)';
    btn.onclick = async function () {
      btn.remove();
      const buf = pendingAudioBuffer,
        _av = pendingAudioAvatar,
        txt = pendingAudioText;
      pendingAudioBuffer = null;
      pendingAudioAvatar = null;
      pendingAudioText = null;
      if (!buf) return;
      isSpeaking = true;
      const ctx = getAudioContext();
      try {
        await ctx.resume();
      } catch (_e) {
        /* ignored */
      }
      await playAudioBuffer(buf, txt);
    };
    document.body.appendChild(btn);
  }

  /**
   * stopAllLipSync
   * @returns {*}
   */
  function stopAllLipSync() {
    const ls = KAvatar.getLipSync(),
      ts = KAvatar.getTextLipSync();
    if (ls)
      try {
        ls.stop();
      } catch (_e) {
        /* ignored */
      }
    if (ts)
      try {
        ts.stop();
      } catch (_e) {
        /* ignored */
      }
    if (window.AlignmentLipSync)
      try {
        AlignmentLipSync.stop();
      } catch (_e) {
        /* ignored */
      }
    KAvatar.setMorph('Smile', 0);
  }

  /**
   * fallbackTextLipSync
   * @param {*} text
   * @returns {*}
   */
  function fallbackTextLipSync(text) {
    const ts = KAvatar.getTextLipSync();
    if (ts) {
      ts.speak(text);
      setTimeout(
        () => {
          ts.stop();
          KAvatar.setExpression('neutral');
        },
        text.length * 55 + 500
      );
    }
  }

  /**
   * stopSpeaking
   * @returns {*}
   */
  function stopSpeaking() {
    if (currentSourceNode)
      try {
        currentSourceNode.stop();
      } catch (_e) {
        /* ignored */
      }
    currentSourceNode = null;
    stopAllLipSync();
    hideSubtitle();
    isSpeaking = false;
    KAvatar.setExpression('neutral');
    KAvatar.setPresenting(false);
  }

  // ─── Mute / Unmute (instant via AudioContext suspend/resume) ─────────
  function mute() {
    if (sharedAudioCtx && sharedAudioCtx.state === 'running') sharedAudioCtx.suspend();
    stopAllLipSync();
  }

  /**
   * unmute
   * @returns {*}
   */
  function unmute() {
    if (sharedAudioCtx && sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume();
  }

  // ─── Manual record ───────────────────────────────────────
  async function startListening() {
    if (isRecording) return;
    if (recognition)
      try {
        recognition.stop();
      } catch (_e) {
        /* ignored */
      }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          channelCount: 1,
        },
      });
      audioChunks = [];
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm',
      });
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };
      mediaRecorder.start(100);
      isRecording = true;
      KAvatar.setExpression('thinking', 0.4);
      return true;
    } catch (_e) {
      resumeWakeDetection();
      return false;
    }
  }

  /**
   * stopListening
   * @returns {*}
   */
  function stopListening() {
    return new Promise((resolve) => {
      if (!isRecording || !mediaRecorder) {
        resolve(null);
        return;
      }
      mediaRecorder.onstop = async () => {
        isRecording = false;
        mediaRecorder.stream.getTracks().forEach((t) => t.stop());
        if (!audioChunks.length) {
          resolve(null);
          resumeWakeDetection();
          return;
        }
        const blob = new Blob(audioChunks, { type: 'audio/webm' });
        audioChunks = [];
        const reader = new FileReader();
        reader.onloadend = async () => {
          const b64 = reader.result.split(',')[1];
          try {
            const r = await fetch(API_BASE + '/api/listen', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ audio: b64 }),
            });
            const d = await r.json();
            if (d.text) detectLanguage(d.text);
            resolve(d.text || null);
          } catch (_e) {
            resolve(null);
          }
        };
        reader.readAsDataURL(blob);
      };
      mediaRecorder.stop();
    });
  }

  // ─── Camera auto ─────────────────────────────────────────
  async function captureAndAnalyze() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 1280, height: 720 },
      });
      const v = document.createElement('video');
      v.srcObject = stream;
      v.setAttribute('playsinline', '');
      await v.play();
      await new Promise((r) => setTimeout(r, 800));
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext('2d').drawImage(v, 0, 0);
      stream.getTracks().forEach((t) => t.stop());
      const b64 = c.toDataURL('image/jpeg', 0.95).split(',')[1];
      KAvatar.setExpression('thinking', 0.5);
      const r = await fetch(API_BASE + '/api/vision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(window.KAuth ? KAuth.getAuthHeaders() : {}),
        },
        body: JSON.stringify({
          image: b64,
          avatar: KAvatar.getCurrentAvatar(),
          language: detectedLanguage,
        }),
      });
      const d = await r.json();
      return d.description || 'Could not analyze.';
    } catch (e) {
      return e.name === 'NotAllowedError' ? 'Please allow camera access.' : 'Camera error.';
    }
  }

  // Auto-start mic monitor on first user interaction
  let micMonitorStarted = false;
  /**
   * startMicMonitor
   * @returns {*}
   */
  function startMicMonitor() {
    if (micMonitorStarted) return;
    micMonitorStarted = true;
    try {
      navigator.mediaDevices
        .getUserMedia({
          audio: { noiseSuppression: true, echoCancellation: true },
        })
        .then(function (stream) {
          const micCtx = new (window.AudioContext || window.webkitAudioContext)();
          micCtx.resume();
          const micSrc = micCtx.createMediaStreamSource(stream);
          const micAn = micCtx.createAnalyser();
          micAn.fftSize = 256;
          micSrc.connect(micAn);
          const micData = new Uint8Array(micAn.frequencyBinCount);
          const micEl = document.getElementById('mic-level');
          if (!micEl) return;
          const bars = micEl.querySelectorAll('span');
          /**
           * updateMicLevel
           * @returns {*}
           */
          function updateMicLevel() {
            micAn.getByteFrequencyData(micData);
            let sum = 0;
            for (let j = 0; j < 32; j++) sum += micData[j];
            const vol = sum / 32 / 255;
            if (vol > 0.05) {
              micEl.classList.add('active');
              for (let k = 0; k < bars.length; k++) {
                const h = Math.max(4, Math.min(22, vol * 22 * (1 + Math.random() * 0.3)));
                bars[k].style.height = h + 'px';
              }
            } else {
              micEl.classList.remove('active');
              for (let k = 0; k < bars.length; k++) bars[k].style.height = '4px';
            }
            requestAnimationFrame(updateMicLevel);
          }
          updateMicLevel();
        })
        .catch(function (e) {
          console.warn('[Voice] Mic monitor failed:', e.message || e);
        });
    } catch (_e) {
      /* ignored */
    }
  }

  // Auto-start mic monitor on first click
  document.addEventListener(
    'click',
    function () {
      startMicMonitor();
    },
    { once: true }
  );

  window.KVoice = {
    speak,
    stopSpeaking,
    startListening,
    stopListening,
    captureAndAnalyze,
    startWakeWordDetection,
    stopWakeWordDetection,
    resumeWakeDetection,
    ensureAudioUnlocked,
    mute,
    unmute,
    getAudioContext,
    startMicMonitor,
    isRecording: () => isRecording,
    isSpeaking: () => isSpeaking,
    getLanguage: () => (window.i18n ? i18n.getLanguage() : detectedLanguage),
    setLanguage: (l) => {
      detectedLanguage = l;
    },
  };
})();
