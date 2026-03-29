// App v2 — Voice Module (AudioContext — FIXED)
(function () {
  ('use strict');
  const API_BASE = window.location.origin;
  let mediaRecorder = null,
    audioChunks = [],
    isRecording = false,
    isSpeaking = false;
  let currentSourceNode = null,
    sharedAudioCtx = null,
    currentHtmlAudio = null,
    detectedLanguage = (window.i18n ? i18n.getLanguage() : null) || navigator.language.split('-')[0] || null;
  let pendingAudioBuffer = null,
    pendingAudioAvatar = null,
    pendingAudioText = null;
  let recognition = null,
    isListeningForWake = false,
    isProcessing = false;

  // ─── VOICE FINGERPRINT SYSTEM ────────────────────────────
  // Captures audio characteristics to identify speakers
  const VOICE_PROFILES_KEY = 'kelion_voice_profiles';
  let _voicePrintStream = null;
  let _voicePrintCtx = null;
  let _voicePrintAnalyser = null;

  function _loadVoiceProfiles() {
    try {
      return JSON.parse(localStorage.getItem(VOICE_PROFILES_KEY) || '{}');
    } catch (_e) {
      return {};
    }
  }
  function _saveVoiceProfiles(profiles) {
    try {
      localStorage.setItem(VOICE_PROFILES_KEY, JSON.stringify(profiles));
    } catch (_e) {
      /* */
    }
  }

  // Capture a voice fingerprint from the current mic stream
  async function _captureVoicePrint() {
    try {
      if (!_voicePrintCtx) {
        _voicePrintStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true },
        });
        _voicePrintCtx = new (window.AudioContext || window.webkitAudioContext)();
        const src = _voicePrintCtx.createMediaStreamSource(_voicePrintStream);
        _voicePrintAnalyser = _voicePrintCtx.createAnalyser();
        _voicePrintAnalyser.fftSize = 2048;
        src.connect(_voicePrintAnalyser);
      }
      const freqData = new Float32Array(_voicePrintAnalyser.frequencyBinCount);
      _voicePrintAnalyser.getFloatFrequencyData(freqData);
      // Extract key features: energy in bands (low/mid/high), spectral centroid
      const sr = _voicePrintCtx.sampleRate;
      const binHz = sr / _voicePrintAnalyser.fftSize;
      let lowE = 0,
        midE = 0,
        highE = 0,
        totalE = 0,
        centroid = 0;
      for (let i = 0; i < freqData.length; i++) {
        const power = Math.pow(10, freqData[i] / 10);
        const freq = i * binHz;
        totalE += power;
        centroid += freq * power;
        if (freq < 300) lowE += power;
        else if (freq < 2000) midE += power;
        else if (freq < 8000) highE += power;
      }
      centroid = totalE > 0 ? centroid / totalE : 0;
      return {
        lowE: Math.round(lowE * 1000),
        midE: Math.round(midE * 1000),
        highE: Math.round(highE * 1000),
        centroid: Math.round(centroid),
        ts: Date.now(),
      };
    } catch (e) {
      console.warn('[Voice] Fingerprint capture failed:', e.message);
      return null;
    }
  }

  // Compare two voice prints — returns similarity 0..1
  function _compareVoicePrint(a, b) {
    if (!a || !b) return 0;
    const dLow = Math.abs(a.lowE - b.lowE) / Math.max(a.lowE, b.lowE, 1);
    const dMid = Math.abs(a.midE - b.midE) / Math.max(a.midE, b.midE, 1);
    const dHigh = Math.abs(a.highE - b.highE) / Math.max(a.highE, b.highE, 1);
    const dCentroid = Math.abs(a.centroid - b.centroid) / Math.max(a.centroid, b.centroid, 1);
    const avgDiff = (dLow + dMid * 2 + dHigh + dCentroid * 2) / 6;
    return Math.max(0, 1 - avgDiff);
  }

  // Find best matching profile for a voice print
  function _matchVoicePrint(print) {
    if (!print) return null;
    const profiles = _loadVoiceProfiles();
    let bestName = null,
      bestScore = 0;
    for (const name in profiles) {
      const profile = profiles[name];
      // Compare against stored prints (use average of last 5)
      let totalSim = 0;
      const prints = profile.prints || [];
      for (const p of prints) {
        totalSim += _compareVoicePrint(print, p);
      }
      const avgSim = prints.length > 0 ? totalSim / prints.length : 0;
      if (avgSim > bestScore) {
        bestScore = avgSim;
        bestName = name;
      }
    }
    return bestScore > 0.55 ? { name: bestName, score: bestScore } : null;
  }

  // Save a voice profile with name
  function saveVoiceProfile(name, print) {
    if (!name || !print) return;
    const profiles = _loadVoiceProfiles();
    if (!profiles[name]) profiles[name] = { prints: [], created: Date.now() };
    profiles[name].prints.push(print);
    // Keep last 10 prints per profile
    if (profiles[name].prints.length > 10) {
      profiles[name].prints = profiles[name].prints.slice(-10);
    }
    profiles[name].lastSeen = Date.now();
    _saveVoiceProfiles(profiles);
    // Also save to server memory
    _saveVoiceProfileToServer(name, print);
  }

  async function _saveVoiceProfileToServer(name, print) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (window.KAuth && KAuth.getAuthHeaders) Object.assign(headers, KAuth.getAuthHeaders());
      await fetch(API_BASE + '/api/memory', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'save',
          key: 'voice_profile_' + name.toLowerCase().replace(/\s+/g, '_'),
          value: JSON.stringify({ name, print, savedAt: new Date().toISOString() }),
        }),
      });
    } catch (_e) {
      /* non-blocking */
    }
  }

  // ── WATCHDOG: reset stuck states every 10s ──
  setInterval(function () {
    // If isProcessing stuck (10s interval), force reset
    if (isProcessing && !isSpeaking) {
      console.warn('[Voice] WATCHDOG: isProcessing stuck, resetting');
      isProcessing = false;
      if (isListeningForWake && recognition) {
        try {
          recognition.start();
        } catch (_e) {
          /* ok */
        }
      }
    }
    // If isSpeaking stuck with no audio node, force reset
    if (isSpeaking && !currentSourceNode) {
      console.warn('[Voice] WATCHDOG: isSpeaking stuck (no audio), resetting');
      isSpeaking = false;
      resumeWakeDetection();
    }
  }, 10000);

  // ─── Subtitle overlay ───────────────────────────────────
  let _subtitleEl = null;
  let _subtitleTimer = null;
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
  function _showSubtitle(text) {
    if (!text) return;
    // Respect global CC toggle
    if (window._ccSubtitlesEnabled === false) return;
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
  function hideSubtitle() {
    if (!_subtitleEl) return;
    _subtitleEl.classList.remove('visible');
    _subtitleTimer = setTimeout(function () {
      if (_subtitleEl) _subtitleEl.textContent = '';
    }, 600);
  }

  function getAudioContext() {
    if (!sharedAudioCtx) sharedAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (sharedAudioCtx.state === 'suspended') sharedAudioCtx.resume();
    return sharedAudioCtx;
  }

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
  function _autoUnlockAudio() {
    if (_audioUnlocked) return;
    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume().then(function () {
        console.log('[Voice] AudioContext unlocked via user gesture');
      });
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
      console.log('[Voice] Audio permanently unlocked');
      // Remove listeners — only need to unlock once
      document.removeEventListener('click', _autoUnlockAudio, true);
      document.removeEventListener('keydown', _autoUnlockAudio, true);
      document.removeEventListener('touchstart', _autoUnlockAudio, true);
    }
  }

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
        if (c < 0.3 || t.length < 2) continue;

        const hasKelion = t.includes('kelion') || t.includes('chelion');
        const hasKira = t.includes('kira') || t.includes('chira');
        const hasFa = /\b(fa|fă|zi|hey|salut|buna|bună|hei)\b/.test(t);
        const hasWakeWord = hasKelion || hasKira;

        // ── WAKE WORD GATE: Only respond if wake word detected ──
        // Without wake word + command verb, ignore all ambient speech
        if (!hasWakeWord && !hasFa) {
          console.log('[Voice] No wake word, ignoring:', t.substring(0, 40));
          continue;
        }

        // ── VOICE FINGERPRINT: Capture and identify speaker ──
        isProcessing = true;
        if (window.KAvatar) window.KAvatar.setAttentive(true);

        // Capture voice print asynchronously
        _captureVoicePrint().then(function (print) {
          if (!print) return;
          const match = _matchVoicePrint(print);
          if (match) {
            console.log('[Voice] Speaker recognized:', match.name, '(' + Math.round(match.score * 100) + '%)');
            // Dispatch speaker identity with the message
            window.dispatchEvent(
              new CustomEvent('speaker-identified', {
                detail: { name: match.name, score: match.score, print: print },
              })
            );
          } else {
            console.log('[Voice] Unknown speaker — will ask for name');
            // Store the print temporarily for later association
            window._pendingVoicePrint = print;
            window.dispatchEvent(
              new CustomEvent('speaker-unknown', {
                detail: { print: print },
              })
            );
          }
        });

        let msg = t;
        if (hasKelion) msg = t.replace(/kelion|chelion/i, '').trim() || t;
        else if (hasKira) msg = t.replace(/kira|chira/i, '').trim() || t;

        // Detect language from spoken text
        if (window.i18n && i18n.detectLanguage) {
          const detected = i18n.detectLanguage(msg);
          if (detected) {
            detectedLanguage = detected;
            i18n.setLanguage(detected);
          }
        }

        window.dispatchEvent(new CustomEvent('wake-message', { detail: { text: msg, language: detectedLanguage } }));

        // Switch avatar if name was mentioned
        if (hasKelion || hasKira) {
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
        return; // Only process first final result — prevent duplicate dispatches
      }
    };
    recognition.onend = () => {
      // ALWAYS try to restart — even if isProcessing (it will be reset by watchdog)
      if (isListeningForWake) {
        const delay = isProcessing ? 3000 : 300; // wait longer if processing
        setTimeout(() => {
          if (isListeningForWake) {
            try {
              recognition.start();
            } catch (_e) {
              /* ok */
            }
          }
        }, delay);
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
      console.log('[Voice] Wake word active');
    } catch (_e) {
      /* ignored */
    }
    // Start mic level monitor (standalone function, no duplicate)
    startMicMonitor();
  }

  function resumeWakeDetection() {
    isProcessing = false;
    window.KAvatar.setAttentive(false);
    // Delay restart to let echo from speakers die down (1.2s for speaker tail)
    if (isListeningForWake && recognition) {
      setTimeout(function () {
        try {
          recognition.start();
        } catch (_e) {
          /* ignored */
        }
        console.log('[Voice] Recognition resumed (post-echo delay)');
      }, 1200);
    }
  }

  function stopWakeWordDetection() {
    isListeningForWake = false;
    isProcessing = false;
    if (recognition)
      try {
        recognition.stop();
      } catch (_e) {
        /* ignored */
      }
    console.log('[Voice] Wake word stopped');
  }

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

  async function speak(text, avatar) {
    // Single voice guard: if Live Chat (Realtime) is active, it handles voice natively
    if (window.KLiveChat && KLiveChat.isConnected()) return;
    // Block ElevenLabs TTS when VoiceFirst (OpenAI Realtime native voice) is active
    if (window.KVoiceFirst && KVoiceFirst.isConnected()) return;
    if (isSpeaking) stopSpeaking();
    if (!text || !text.trim()) return;

    unmute();
    ensureAudioUnlocked();

    const ttsText = cleanTextForTTS(text);
    if (!ttsText) return;

    console.log('[Voice] TTS speak:', ttsText.substring(0, 60) + '...');
    isSpeaking = true;

    // Stop recognition while speaking to prevent echo/feedback
    if (recognition && isListeningForWake) {
      try {
        recognition.stop();
      } catch (_e) {
        /* ignored */
      }
      console.log('[Voice] Recognition paused (anti-echo)');
    }

    if (window.KAvatar) {
      KAvatar.setExpression('happy', 0.3);
      KAvatar.setPresenting(true);
    }

    _showSubtitle(text);

    // ── Call server TTS endpoint (/api/speak) ──
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (window.KAuth && KAuth.getAuthHeaders) Object.assign(headers, KAuth.getAuthHeaders());

      const resp = await fetch(API_BASE + '/api/speak', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          text: ttsText.substring(0, 2000),
          avatar: avatar || (window.KAvatar ? KAvatar.getCurrentAvatar() : 'kira'),
          language: detectedLanguage,
          fingerprint: window._kelionFp || localStorage.getItem('k_visitor_fp') || null,
        }),
      });

      if (!resp.ok) {
        console.warn('[Voice] TTS server error:', resp.status);
        throw new Error('TTS ' + resp.status);
      }

      // Check for alignment data in header (base64-encoded by server)
      let alignment = null;
      const alignHeader = resp.headers.get('X-Alignment');
      if (alignHeader) {
        try {
          alignment = JSON.parse(atob(alignHeader));
          console.log('[Voice] Alignment data decoded:', alignment.characters?.length || 0, 'chars');
        } catch (_e) {
          try {
            alignment = JSON.parse(alignHeader);
          } catch (_e2) {
            console.warn('[Voice] Alignment header decode failed');
          }
        }
      }

      const arrayBuf = await resp.arrayBuffer();
      if (!arrayBuf || arrayBuf.byteLength < 100) {
        throw new Error('Empty audio');
      }

      const ctx = getAudioContext();
      if (ctx.state === 'suspended') {
        // AudioContext blocked — show unlock prompt
        _showAudioUnlockPrompt(arrayBuf, avatar, text);
        return;
      }

      await playAudioBuffer(arrayBuf, text, alignment);
      console.log('[Voice] ✅ TTS audio playing via /api/speak');
    } catch (err) {
      console.warn('[Voice] TTS failed, using text fallback:', err.message);
      speakWithBrowserTTS(ttsText).catch(function (browserErr) {
        console.warn('[Voice] Browser TTS fallback failed:', browserErr.message);
        fallbackTextLipSync(ttsText);
        const readingTime = Math.max(2000, ttsText.length * 55);
        setTimeout(function () {
          stopAllLipSync();
          hideSubtitle();
          isSpeaking = false;
          if (window.KAvatar) {
            KAvatar.setExpression('neutral');
            KAvatar.setPresenting(false);
          }
          resumeWakeDetection();
        }, readingTime);
      });
    }
  }

  // Play a single audio chunk — calls onDone when finished
  function _playAudioChunk(arrayBuf, chunkText, isLast, onDone, alignment) {
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
            console.log('[Voice] 🎬 Using AlignmentLipSync (professional)');
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
              console.warn('[Voice] FFT lip sync connect failed:', _e.message);
            }
          }
          if (!fftOk) {
            currentSourceNode.connect(ctx.destination);
            fallbackTextLipSync(chunkText);
          }
        }

        // Expression already set at speak() start — don't change mid-audio
        // This prevents disrupting lip sync animation

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
          new CustomEvent('audio-start', { detail: { duration: audioBuf.duration, isChunked: true } })
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

  function _finishSpeakingState() {
    stopAllLipSync();
    hideSubtitle();
    isSpeaking = false;
    currentSourceNode = null;
    currentHtmlAudio = null;
    KAvatar.setExpression('neutral');
    KAvatar.setPresenting(false);
    resumeWakeDetection();
  }

  async function playHtmlAudioFallback(arrayBuf, fallbackText) {
    try {
      const blob = new Blob([arrayBuf], { type: 'audio/mpeg' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      currentHtmlAudio = audio;
      audio.preload = 'auto';
      audio.playsInline = true;

      if (fallbackText) fallbackTextLipSync(fallbackText);

      audio.onended = function () {
        URL.revokeObjectURL(url);
        _finishSpeakingState();
      };
      audio.onerror = function () {
        URL.revokeObjectURL(url);
        console.warn('[Voice] HTMLAudio fallback failed');
        _finishSpeakingState();
      };

      await audio.play();
      console.log('[Voice] HTMLAudio fallback playing');
    } catch (e) {
      console.warn('[Voice] HTMLAudio fallback error:', e.message);
      _finishSpeakingState();
    }
  }

  async function playAudioBuffer(arrayBuf, fallbackText, alignment) {
    const ctx = getAudioContext();
    let audioBuf;
    try {
      audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
    } catch (_e) {
      console.warn('[Voice] Audio decode failed, trying HTMLAudio fallback');
      await playHtmlAudioFallback(arrayBuf, fallbackText || '');
      return;
    }

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
        console.log('[Voice] Using AlignmentLipSync (professional)');
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
          console.warn('[Voice] FFT connect failed in playAudioBuffer:', _e.message);
        }
      }
      if (!fftOk) {
        currentSourceNode.connect(ctx.destination);
        fallbackTextLipSync(fallbackText || '');
      }
    }

    KAvatar.setExpression('happy', 0.3);
    KAvatar.setPresenting(true);

    // ══ ENHANCED Auto-gestures during speech ══
    if (fallbackText && window.KAvatar) {
      const gt = fallbackText.toLowerCase();
      const len = gt.length;
      // Opening nod
      setTimeout(function () {
        KAvatar.playGesture('nod');
      }, 500);
      // Question → head tilt
      if (gt.includes('?'))
        setTimeout(function () {
          KAvatar.playGesture('tilt');
        }, 2000);
      // Exclamation → emphatic nod
      if (gt.includes('!'))
        setTimeout(function () {
          KAvatar.playGesture('nod');
        }, 1500);
      // Long text → lookAway + nod (thinking while explaining)
      if (len > 200) {
        setTimeout(function () {
          KAvatar.playGesture('lookAway');
        }, 3000);
        setTimeout(function () {
          KAvatar.playGesture('nod');
        }, 5000);
      }
      // Very long text → extra gestures
      if (len > 400) {
        setTimeout(function () {
          KAvatar.playGesture('think');
        }, 7000);
        setTimeout(function () {
          KAvatar.playGesture('nod');
        }, 9000);
      }
      // Negation → head shake
      if (/\b(nu|no|nein|non|niet|imposibil|impossible|unfortunately|din păcate)\b/i.test(gt))
        setTimeout(function () {
          KAvatar.playGesture('shake');
        }, 1000);
      // Greeting → wave body action
      if (/\b(salut|bună|hello|hi|hey|hei|welcome|bine ai venit)\b/i.test(gt) && KAvatar.playBodyAction)
        setTimeout(function () {
          KAvatar.playBodyAction('wavRight');
        }, 600);
      // Thinking/analysis → think pose
      if (/\b(hmm|gândesc|analizez|thinking|let me think|consider|evaluez)\b/i.test(gt) && KAvatar.playBodyAction)
        setTimeout(function () {
          KAvatar.playBodyAction('thinkPose');
        }, 800);
      // Agreement/success → thumbs up
      if (
        /\b(bravo|excelent|perfect|gata|done|success|reușit|felicitări|congrats)\b/i.test(gt) &&
        KAvatar.playBodyAction
      )
        setTimeout(function () {
          KAvatar.playBodyAction('thumbsUpRight');
        }, 1000);
      // Uncertainty → shrug
      if (/\b(nu știu|nu sunt sigur|maybe|poate|posibil|not sure|uncertain)\b/i.test(gt))
        setTimeout(function () {
          KAvatar.playGesture('shrug');
        }, 1200);
      // Pointing/showing → point gesture
      if (/\b(uite|vezi|look|see|here|aici|arată|check)\b/i.test(gt))
        setTimeout(function () {
          KAvatar.playGesture('point');
        }, 800);
    }

    currentSourceNode.onended = () => {
      _finishSpeakingState();
    };
    currentSourceNode.start(0);
    // Dispatch event for synchronized text reveal
    window.dispatchEvent(new CustomEvent('audio-start', { detail: { duration: audioBuf.duration } }));
    // Safety timeout: stop lip sync even if onended doesn't fire
    const audioDurationMs = Math.ceil(audioBuf.duration * 1000) + 500;
    setTimeout(function () {
      if (isSpeaking) {
        _finishSpeakingState();
      }
    }, audioDurationMs);
    console.log('[Voice] ✅ Audio playing (' + arrayBuf.byteLength + 'B, ' + Math.round(audioBuf.duration) + 's)');
  }

  function _showAudioUnlockPrompt(arrayBuf, avatar, text) {
    pendingAudioBuffer = arrayBuf;
    pendingAudioAvatar = avatar;
    pendingAudioText = text || '';
    let btn = document.getElementById('audio-unlock-btn');
    if (btn) return;
    btn = document.createElement('button');
    btn.id = 'audio-unlock-btn';
    btn.textContent = 'Click to enable sound';
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
    console.log('[Voice] Audio autoplay blocked — showing unlock prompt');
  }

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

  function speakWithBrowserTTS(text) {
    return new Promise(function (resolve, reject) {
      if (!window.speechSynthesis || typeof SpeechSynthesisUtterance === 'undefined') {
        reject(new Error('speechSynthesis unavailable'));
        return;
      }
      try {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang =
          detectedLanguage === 'ro' ? 'ro-RO' : detectedLanguage === 'en' ? 'en-US' : detectedLanguage || navigator.language || 'en-US';
          // default fallback is always en-US
        utterance.rate = 1;
        utterance.pitch = 1;
        utterance.volume = 1;
        utterance.onend = function () {
          _finishSpeakingState();
          resolve();
        };
        utterance.onerror = function (event) {
          _finishSpeakingState();
          reject(new Error((event && event.error) || 'speechSynthesis error'));
        };
        fallbackTextLipSync(text);
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(utterance);
      } catch (e) {
        reject(e);
      }
    });
  }

  function stopSpeaking() {
    // ── GLOBAL STOP: oprește TOATE sursele audio ──
    // 1. Stop voice.js own AudioContext source
    if (currentSourceNode)
      try {
        currentSourceNode.stop();
      } catch (_e) {
        /* ignored */
      }
    currentSourceNode = null;
    if (currentHtmlAudio) {
      try {
        currentHtmlAudio.pause();
        currentHtmlAudio.currentTime = 0;
      } catch (_e) {
        /* ignored */
      }
    }
    currentHtmlAudio = null;
    stopAllLipSync();
    hideSubtitle();
    isSpeaking = false;
    KAvatar.setExpression('neutral');
    KAvatar.setPresenting(false);

    // 2. Stop voice-stream-client (PCM streaming)
    if (window.KVoiceStream && KVoiceStream.stopPlayback) {
      try {
        KVoiceStream.stopPlayback();
      } catch (_e) {
        /* ignored */
      }
    }

    // 3. Stop voice-realtime-client if active
    if (window.KVoiceRealtime && KVoiceRealtime.stopPlayback) {
      try {
        KVoiceRealtime.stopPlayback();
      } catch (_e) {
        /* ignored */
      }
    }

    // 4. Stop browser SpeechSynthesis (fallback TTS)
    if (window.speechSynthesis && speechSynthesis.speaking) {
      try {
        speechSynthesis.cancel();
      } catch (_e) {
        /* ignored */
      }
    }

    // 5. Suspend shared AudioContext briefly to kill any in-flight audio
    if (sharedAudioCtx && sharedAudioCtx.state === 'running') {
      sharedAudioCtx
        .suspend()
        .then(() => {
          setTimeout(() => {
            if (sharedAudioCtx) sharedAudioCtx.resume();
          }, 100);
        })
        .catch(() => {});
    }

    console.log('[Voice] 🛑 GLOBAL STOP: All audio sources stopped');
  }

  // ─── Mute / Unmute (instant via AudioContext suspend/resume) ─────────
  function mute() {
    if (sharedAudioCtx && sharedAudioCtx.state === 'running') sharedAudioCtx.suspend();
    stopAllLipSync();
  }

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
        audio: { echoCancellation: true, noiseSuppression: true, channelCount: 1 },
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
            const listenHeaders = { 'Content-Type': 'application/json' };
            if (window.KAuth && KAuth.getAuthHeaders) Object.assign(listenHeaders, KAuth.getAuthHeaders());
            const r = await fetch(API_BASE + '/api/listen', {
              method: 'POST',
              headers: listenHeaders,
              body: JSON.stringify({ audio: b64, language: detectedLanguage }),
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
        headers: { 'Content-Type': 'application/json', ...(window.KAuth ? KAuth.getAuthHeaders() : {}) },
        body: JSON.stringify({ image: b64, avatar: KAvatar.getCurrentAvatar(), language: detectedLanguage }),
      });
      const d = await r.json();
      return d.description || 'Could not analyze.';
    } catch (e) {
      return e.name === 'NotAllowedError' ? 'Please allow camera access.' : 'Camera error.';
    }
  }

  // Auto-start mic monitor on first user interaction
  let micMonitorStarted = false;
  function startMicMonitor() {
    if (micMonitorStarted) return;
    micMonitorStarted = true;
    try {
      navigator.mediaDevices
        .getUserMedia({ audio: { noiseSuppression: true, echoCancellation: true } })
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
          console.log('[Voice] Mic monitor started');
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

  // ─── Full-Duplex Voice Loop ───────────────────────────────────
  let _voiceLoopActive = false;
  let _voiceLoopRec = null;
  let _waitingForAI = false; // true while AI is processing/speaking

  function _makeLoopRec() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = detectedLanguage === 'ro' ? 'ro-RO' : detectedLanguage === 'en' ? 'en-US' : (detectedLanguage || navigator.language || 'en-US');
    rec.onresult = function (ev) {
      if (!_voiceLoopActive) return;
      const txt = ev.results[0][0].transcript.trim();
      if (txt.length < 2) {
        _loopListen();
        return;
      }
      _waitingForAI = true;
      console.log('[Voice] Loop captured:', txt);
      window.dispatchEvent(new CustomEvent('voice-loop-message', { detail: { text: txt } }));
      // SAFETY: force reset _waitingForAI after 15s max
      setTimeout(function () {
        if (_waitingForAI && _voiceLoopActive) {
          console.warn('[Voice] WATCHDOG: _waitingForAI timeout, forcing resume');
          _waitingForAI = false;
          if (!isSpeaking) _loopListen();
        }
      }, 15000);
    };
    rec.onend = function () {
      // Always try to restart after a delay — even if waiting
      if (_voiceLoopActive && !isSpeaking) {
        const delay = _waitingForAI ? 2000 : 300;
        setTimeout(function () {
          if (_voiceLoopActive && !isSpeaking) _loopListen();
        }, delay);
      }
    };
    rec.onerror = function (_e) {
      if (!_voiceLoopActive) return;
      // Never stop loop on permission errors — mic is always allowed
      setTimeout(_loopListen, 800);
    };
    return rec;
  }

  function _loopListen() {
    if (!_voiceLoopActive || isSpeaking || _waitingForAI) return;
    try {
      if (_voiceLoopRec) {
        try {
          _voiceLoopRec.stop();
        } catch (_e) {
          /* ok */
        }
      }
      _voiceLoopRec = _makeLoopRec();
      if (_voiceLoopRec) _voiceLoopRec.start();
    } catch (_e) {
      setTimeout(_loopListen, 500);
    }
  }

  function startVoiceLoop() {
    if (!(window.SpeechRecognition || window.webkitSpeechRecognition)) return false;
    if (_voiceLoopActive) return true;
    _voiceLoopActive = true;
    _waitingForAI = false;
    _loopListen();
    startMicMonitor();
    console.log('[Voice] Full-duplex loop STARTED');
    return true;
  }

  function stopVoiceLoop() {
    _voiceLoopActive = false;
    _waitingForAI = false;
    if (_voiceLoopRec) {
      try {
        _voiceLoopRec.stop();
      } catch (_e) {
        /* ok */
      }
      _voiceLoopRec = null;
    }
    console.log('[Voice] Full-duplex loop STOPPED');
    window.dispatchEvent(new CustomEvent('voice-loop-stopped'));
  }

  function resumeVoiceLoop() {
    if (!_voiceLoopActive) return;
    _waitingForAI = false;
    if (isSpeaking) {
      const check = setInterval(function () {
        if (!isSpeaking) {
          clearInterval(check);
          _loopListen();
        }
      }, 200);
    } else {
      setTimeout(_loopListen, 300);
    }
  }

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
    startVoiceLoop,
    stopVoiceLoop,
    resumeVoiceLoop,
    saveVoiceProfile,
    captureVoicePrint: _captureVoicePrint,
    matchVoicePrint: _matchVoicePrint,
    isRecording: () => isRecording,
    isSpeaking: () => isSpeaking,
    isVoiceLoopActive: () => _voiceLoopActive,
    getLanguage: () => (window.i18n ? i18n.getLanguage() : detectedLanguage),
    setLanguage: (l) => {
      detectedLanguage = l;
    },
  };
})();
