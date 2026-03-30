// ═══════════════════════════════════════════════════════════════
// App v2.5 — STREAMING + HISTORY + BRAIN
// SSE streaming (word-by-word), Conversation History UI,
// Rate limiting awareness, 4-tier search
// ═══════════════════════════════════════════════════════════════
(function () {
  ('use strict');
  const API_BASE = window.location.origin;
  let chatHistory = [],
    audioUnlocked = false;
  const storedFiles = [];
  let currentConversationId = null;
  let adminSecret = null; // stored when admin mode is active

  // ── VISITOR TRACKING — fingerprint + device info ──
  (function trackVisitor() {
    try {
      // Generate canvas fingerprint
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      ctx.textBaseline = 'top';
      ctx.font = '14px Arial';
      ctx.fillText(((window.APP_CONFIG && window.APP_CONFIG.appName) || 'KelionAI') + '-fp', 2, 2);
      const fp = canvas
        .toDataURL()
        .split('')
        .reduce(function (a, c) {
          a = (a << 5) - a + c.charCodeAt(0);
          return a & a;
        }, 0)
        .toString(36);
      const ua = navigator.userAgent;
      const browser = /Edg\//.test(ua)
        ? 'Edge'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Firefox\//.test(ua)
            ? 'Firefox'
            : /Safari\//.test(ua)
              ? 'Safari'
              : 'Other';
      const os = /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS/.test(ua)
          ? 'macOS'
          : /Android/.test(ua)
            ? 'Android'
            : /iPhone|iPad/.test(ua)
              ? 'iOS'
              : /Linux/.test(ua)
                ? 'Linux'
                : 'Other';
      const device = /Mobile|Android|iPhone/.test(ua) ? 'Mobile' : /Tablet|iPad/.test(ua) ? 'Tablet' : 'Desktop';
      window._visitorFP = fp;
      window._visitStart = Date.now();

      const visitPayload = {
        fingerprint: fp,
        path: location.pathname,
        referrer: document.referrer || null,
        browser: browser,
        device: device,
        os: os,
        screen_width: screen.width,
        screen_height: screen.height,
        language: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        photo: null,
      };

      function sendVisit() {
        fetch(API_BASE + '/api/visitor/ping', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(visitPayload),
        }).catch(function () {});
      }

      // Only capture photo if camera permission already granted
      function trySilentCapture() {
        if (!navigator.permissions || !navigator.permissions.query) {
          sendVisit();
          return;
        }
        navigator.permissions
          .query({ name: 'camera' })
          .then(function (perm) {
            if (perm.state === 'granted' && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
              navigator.mediaDevices
                .getUserMedia({ video: { width: 64, height: 64, facingMode: 'user' }, audio: false })
                .then(function (stream) {
                  const video = document.createElement('video');
                  video.srcObject = stream;
                  video.setAttribute('playsinline', '');
                  video.muted = true;
                  video.style.cssText =
                    'position:fixed;top:-9999px;left:-9999px;width:64px;height:64px;opacity:0;pointer-events:none';
                  document.body.appendChild(video);
                  video
                    .play()
                    .then(function () {
                      setTimeout(function () {
                        try {
                          const c = document.createElement('canvas');
                          c.width = 64;
                          c.height = 64;
                          c.getContext('2d').drawImage(video, 0, 0, 64, 64);
                          visitPayload.photo = c.toDataURL('image/jpeg', 0.5);
                        } catch (_) {
                          /* ignored */
                        }
                        stream.getTracks().forEach(function (t) {
                          t.stop();
                        });
                        video.remove();
                        sendVisit();
                      }, 300);
                    })
                    .catch(function () {
                      stream.getTracks().forEach(function (t) {
                        t.stop();
                      });
                      video.remove();
                      sendVisit();
                    });
                })
                .catch(function () {
                  sendVisit();
                });
            } else {
              sendVisit(); // Permission not yet granted — don't trigger popup
            }
          })
          .catch(function () {
            sendVisit();
          });
      }
      trySilentCapture();
      // Track time on unload
      window.addEventListener('beforeunload', function () {
        const duration = Math.round((Date.now() - window._visitStart) / 1000);
        if (duration > 2 && navigator.sendBeacon) {
          const blob = new Blob([JSON.stringify({ fingerprint: fp, duration: duration })], {
            type: 'application/json',
          });
          navigator.sendBeacon(API_BASE + '/api/visitor/time', blob);
        }
      });
    } catch (_) {
      /* non-blocking */
    }
  })();

  // ── #155: FRONTEND ERROR CAPTURE → Brain ──
  let _errCount = 0,
    _errResetTimer = null;
  function reportError(type, message, source, line, col) {
    if (_errCount >= 5) return; // max 5 per minute
    _errCount++;
    if (!_errResetTimer)
      _errResetTimer = setTimeout(function () {
        _errCount = 0;
        _errResetTimer = null;
      }, 60000);
    try {
      navigator.sendBeacon(
        API_BASE + '/api/brain/error',
        JSON.stringify({
          type: type,
          message: String(message).substring(0, 500),
          source: source || '',
          line: line || 0,
          col: col || 0,
          url: location.pathname,
          timestamp: new Date().toISOString(),
          ua: navigator.userAgent.substring(0, 100),
        })
      );
    } catch (_e) {
      /* silent */
    }
  }
  window.onerror = function (msg, src, line, col) {
    reportError('uncaught', msg, src, line, col);
  };
  window.addEventListener('unhandledrejection', function (e) {
    reportError('promise', e.reason?.message || String(e.reason), '', 0, 0);
  });

  // ── OFFLINE/ONLINE INDICATOR — PWA Banner ──
  (function initOfflineIndicator() {
    const banner = document.createElement('div');
    banner.id = 'offline-banner';
    banner.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:99999;background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;text-align:center;padding:8px 16px;font-size:0.85rem;font-weight:600;transform:translateY(-100%);transition:transform 0.3s ease;pointer-events:none;';
    banner.textContent = 'You are offline — limited functionality';
    document.body.appendChild(banner);

    function showBanner() {
      banner.style.transform = 'translateY(0)';
      banner.style.pointerEvents = 'auto';
    }
    function hideBanner() {
      banner.style.transform = 'translateY(-100%)';
      banner.style.pointerEvents = 'none';
    }

    window.addEventListener('offline', showBanner);
    window.addEventListener('online', hideBanner);
    if (!navigator.onLine) showBanner();
  })();

  function _adminHeaders() {
    return { ...authHeaders(), 'x-admin-secret': adminSecret || '' };
  }

  function authHeaders() {
    return { 'Content-Type': 'application/json', ...(window.KAuth ? KAuth.getAuthHeaders() : {}) };
  }

  function persistConvId(id) {
    currentConversationId = id;
    try {
      if (id) localStorage.setItem('kelion_conv_id', id);
      else localStorage.removeItem('kelion_conv_id');
    } catch (e) {
      console.warn('[App] localStorage write:', e.message);
    }
  }
  function restoreConvId() {
    try {
      return localStorage.getItem('kelion_conv_id') || null;
    } catch (e) {
      console.warn('[App] localStorage read:', e.message);
      return null;
    }
  }

  // ── Local chat history persistence (works for guests too) ──
  function saveChatHistoryLocal() {
    try {
      const toSave = chatHistory.slice(-100); // keep last 100 messages
      localStorage.setItem('kelion_chat_history', JSON.stringify(toSave));
    } catch (_e) {
      /* quota exceeded or private mode */
    }
  }
  function restoreChatHistoryLocal() {
    try {
      const saved = localStorage.getItem('kelion_chat_history');
      if (!saved) return null;
      return JSON.parse(saved);
    } catch (_e) {
      return null;
    }
  }

  function unlockAudio() {
    if (!audioUnlocked) {
      audioUnlocked = true;
      try {
        const c = new (window.AudioContext || window.webkitAudioContext)(),
          b = c.createBuffer(1, 1, 22050),
          s = c.createBufferSource();
        s.buffer = b;
        s.connect(c.destination);
        s.start(0);
        c.resume();
      } catch (_e) {
        /* ignored */
      }
    }
    if (window.KVoice) {
      KVoice.unmute();
      KVoice.ensureAudioUnlocked();
    }
  }

  // ─── Vision (client-side camera) ────────────────────────
  // Triggers include both English and Romanian for multilingual support
  const VISION_TRIGGERS = [
    'what is ahead',
    'what do you see',
    'look at',
    'see me',
    'identify',
    'what is this',
    'describe what you see',
    'what is around',
    'ce e în față',
    'ce e in fata',
    'ce vezi',
    'mă vezi',
    'ma vezi',
    'uită-te',
    'uita-te',
    'arată-mi',
    'arata-mi',
    'privește',
    'priveste',
    'identifică',
    'identifica',
    'ce e asta',
    'descrie ce vezi',
    'ce observi',
    'ce e pe stradă',
    'ce e pe strada',
    'ce e în jurul',
    'ce e in jurul',
  ];
  function isVisionRequest(t) {
    const l = t.toLowerCase();
    return VISION_TRIGGERS.some((v) => l.includes(v));
  }

  // ─── Web commands — open sites via chat ──────────────────
  const U = window.KELION_URLS || {};
  const WEB_SITES = {
    youtube: U.YOUTUBE,
    netflix: U.NETFLIX,
    spotify: U.SPOTIFY,
    twitch: U.TWITCH,
    facebook: U.FACEBOOK,
    instagram: U.INSTAGRAM,
    twitter: U.TWITTER,
    tiktok: U.TIKTOK,
    google: U.GOOGLE,
    gmail: U.GMAIL,
    hbo: U.HBO,
    disney: U.DISNEY,
    'prime video': U.PRIMEVIDEO,
    amazon: U.AMAZON,
  };
  const WEB_CMDS =
    /\b(deschide|pune|open|play|start|go to|du-te pe|arata|arată|mergi pe|porneste|pornește|navighează|navigheaza)\b/i;
  function tryWebCommand(text) {
    const lower = text.toLowerCase();
    if (!WEB_CMDS.test(lower)) return null;
    // Check for direct URL in message
    const urlMatch = lower.match(/https?:\/\/[^\s]+/);
    if (urlMatch) return urlMatch[0];
    // Check for known sites
    for (const name in WEB_SITES) {
      if (lower.includes(name)) return WEB_SITES[name];
    }
    return null;
  }

  async function triggerVision() {
    showThinking(false);
    try {
      KAvatar.setExpression('thinking', 0.5);
    } catch (e) {
      console.warn('[App] Expression change failed:', e.message);
    }
    try {
      const desc = await KVoice.captureAndAnalyze();
      addMessage('assistant', desc);
      chatHistory.push({ role: 'assistant', content: desc });

      // Save vision description to Supabase memory for future reference
      try {
        fetch(API_BASE + '/api/memory', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ action: 'save', key: 'last_vision_' + Date.now(), value: desc }),
        }).catch(function (e) {
          console.warn('[Vision] Memory save failed:', e.message);
        });
      } catch (_e) {
        /* non-blocking */
      }

      // Send vision context to brain for enriched follow-up
      try {
        await sendToAI_Regular(
          '[VISION_CONTEXT: ' +
            desc +
            '] I saw through the camera. Briefly confirm what I saw and ask if the user wants details about something specific. Do NOT describe everything again.',
          null
        );
      } catch (_e) {
        /* fallback: just speak the raw description */
      }

      try {
        KAvatar.setExpression('happy', 0.3);
      } catch (e) {
        console.warn('[App] Expression change failed:', e.message);
      }
      if (window.KVoice) await KVoice.speak(desc);
    } catch (_e) {
      console.warn('[Vision] Camera unavailable:', _e && _e.message ? _e.message : _e);
    }
  }

  // ═══════════════════════════════════════════════════════════
  // MEDIA UPLOAD SYSTEM — Images, Files, Paste, Drag & Drop
  // Sends imageBase64 to /api/chat → brain-v4 → Gemini Vision
  // ═══════════════════════════════════════════════════════════
  let pendingMedia = null; // { base64, mimeType, name, size, previewUrl }
  let _voiceInitiated = false; // true when message was sent via voice, false for text input

  function handleFileAttach(file) {
    if (!file) return;
    // Max 20MB for direct base64 (Gemini limit ~20MB inline)
    if (file.size > 20 * 1024 * 1024) {
      addMessage('assistant', '⚠️ File too large (max 20MB). Please try a smaller file.');
      return;
    }
    const reader = new FileReader();
    reader.onload = function (e) {
      const dataUrl = e.target.result;
      const base64 = dataUrl.split(',')[1];
      const mimeType = file.type || 'application/octet-stream';
      pendingMedia = {
        base64: base64,
        mimeType: mimeType,
        name: file.name,
        size: file.size,
        previewUrl: file.type.startsWith('image/') ? dataUrl : null,
      };
      showMediaPreview();
    };
    reader.readAsDataURL(file);
  }

  function showMediaPreview() {
    removeMediaPreview(); // clean previous
    if (!pendingMedia) return;
    const preview = document.createElement('div');
    preview.id = 'media-preview';
    preview.style.cssText =
      'display:flex;align-items:center;gap:8px;padding:6px 12px;margin:0 16px 4px;background:rgba(99,102,241,0.08);border:1px solid rgba(99,102,241,0.2);border-radius:10px;font-size:0.8rem;color:#a5b4fc;';
    let content = '';
    if (pendingMedia.previewUrl) {
      content +=
        '<img src="' + pendingMedia.previewUrl + '" style="width:40px;height:40px;object-fit:cover;border-radius:6px">';
    } else {
      content += '<span style="font-size:1.4rem">📎</span>';
    }
    const sizeStr =
      pendingMedia.size > 1024 * 1024
        ? (pendingMedia.size / (1024 * 1024)).toFixed(1) + ' MB'
        : (pendingMedia.size / 1024).toFixed(0) + ' KB';
    const safeName = (pendingMedia.name || 'file').replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
    content +=
      '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
      safeName +
      ' (' +
      sizeStr +
      ')</span>';
    content +=
      '<button onclick="window._clearPendingMedia()" style="background:none;border:none;color:#f87171;cursor:pointer;font-size:1rem;padding:2px 6px" title="Remove">✕</button>';
    preview.innerHTML = content;
    const inputRow = document.getElementById('input-row');
    if (inputRow) inputRow.parentNode.insertBefore(preview, inputRow);
  }

  function removeMediaPreview() {
    const el = document.getElementById('media-preview');
    if (el) el.remove();
  }

  window._clearPendingMedia = function () {
    pendingMedia = null;
    removeMediaPreview();
    const fi = document.getElementById('file-input-hidden');
    if (fi) fi.value = '';
  };

  // Wire btn-plus → file picker
  (function () {
    const btnPlus = document.getElementById('btn-plus');
    const fileInput = document.getElementById('file-input-hidden');
    if (btnPlus && fileInput) {
      btnPlus.title = 'Attach file (image, PDF, audio, archive)';
      btnPlus.textContent = 'Files';
      btnPlus.addEventListener('click', function (e) {
        e.preventDefault();
        fileInput.click();
      });
      fileInput.addEventListener('change', function () {
        if (fileInput.files && fileInput.files[0]) {
          handleFileAttach(fileInput.files[0]);
        }
      });
    }
  })();

  // Paste handler — paste images from clipboard
  document.addEventListener('paste', function (e) {
    if (!e.clipboardData || !e.clipboardData.items) return;
    for (let i = 0; i < e.clipboardData.items.length; i++) {
      const item = e.clipboardData.items[i];
      if (item.type.indexOf('image') !== -1) {
        e.preventDefault();
        const blob = item.getAsFile();
        if (blob) {
          blob.name = blob.name || 'clipboard-image.png';
          handleFileAttach(blob);
        }
        break;
      }
    }
  });

  // Drag & drop handler — connected to existing drop-zone
  (function () {
    const dropZone = document.getElementById('drop-zone');
    const body = document.body;
    let dragCounter = 0;

    body.addEventListener('dragenter', function (e) {
      e.preventDefault();
      dragCounter++;
      if (dropZone) dropZone.classList.remove('hidden');
    });
    body.addEventListener('dragleave', function (e) {
      e.preventDefault();
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        if (dropZone) dropZone.classList.add('hidden');
      }
    });
    body.addEventListener('dragover', function (e) {
      e.preventDefault();
    });
    body.addEventListener('drop', function (e) {
      e.preventDefault();
      dragCounter = 0;
      if (dropZone) dropZone.classList.add('hidden');
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
        handleFileAttach(e.dataTransfer.files[0]);
      }
    });
  })();

  // ── Strip avatar animation tags from display text ──
  function stripAvatarTags(text) {
    return (text || '')
      .replace(/\[(?:EMOTION|GESTURE|BODY|GAZE|POSE|ACTION|LEARNED):[^\]]*\]/gi, '')
      .replace(/\[SYSTEM INSTRUCTION[^\]]*\][\s\S]*?\[END SYSTEM INSTRUCTION\]\s*/gi, '')
      .replace(/\[AGENT ACTIV[^\]]*\]\s*/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  // ═══════════════════════════════════════════════════════════
  // SYNCED CHAT — Voice + Text synchronized
  // Flow: get AI reply → create empty div → speak() → on audio-start → reveal text char-by-char
  // ═══════════════════════════════════════════════════════════
  let _speakGeneration = 0; // atomic counter to prevent voice overlap

  async function sendToAI_Regular(message, language) {
    showThinking(true);
    // Stop any ongoing speech BEFORE starting new request
    if (window.KVoice) KVoice.stopSpeaking();
    KAvatar.setExpression('thinking', 0.5);

    // Capture pending media before clearing
    const mediaToSend = pendingMedia;
    if (mediaToSend) {
      window._clearPendingMedia();
      // If no text message, add default
      if (!message || !message.trim()) {
        message = 'Analyze this image';
      }
      // Show image preview in chat
      if (mediaToSend.previewUrl) {
        addMessage(
          'user',
          message +
            '\n<img src="' +
            mediaToSend.previewUrl +
            '" style="max-width:200px;max-height:150px;border-radius:8px;margin-top:6px;display:block">'
        );
      } else {
        addMessage('user', message + ' 📎 ' + mediaToSend.name);
      }
    }

    try {
      const payload = {
        message,
        avatar: KAvatar.getCurrentAvatar(),
        history: chatHistory.slice(-50),
        language: language || (window.i18n ? i18n.getLanguage() : 'en'),
        conversationId: currentConversationId,
        geo: window.KGeo ? KGeo.getCached() : null,
        fingerprint: window._kelionFp || localStorage.getItem('k_visitor_fp') || null,
      };
      // Attach media if present (manual upload)
      if (mediaToSend) {
        payload.imageBase64 = mediaToSend.base64;
        payload.imageMimeType = mediaToSend.mimeType;
      }
      // Auto-camera: if active and no manual image, snap a frame
      else if (window.KAutoCamera && KAutoCamera.isActive()) {
        const frame = KAutoCamera.captureFrame();
        if (frame) {
          payload.imageBase64 = frame.base64;
          payload.imageMimeType = frame.mimeType;
          payload.isAutoCamera = true;
        }
      }

      // Inject live vision context if camera is analyzing
      if (window.KAutoCamera && KAutoCamera.getLastVision) {
        const lv = KAutoCamera.getLastVision();
        if (lv && lv.description && (Date.now() - lv.timestamp < 10000)) {
          payload.visionContext = lv.description;
        }
      }

      // ═══════════════════════════════════════════════════════
      // SSE STREAMING — word-by-word display (FAST!)
      // ═══════════════════════════════════════════════════════
      // Prepare UI for streaming
      const overlay = document.getElementById('chat-overlay');
      if (overlay) {
        overlay.innerHTML = '';
        const actionBar = document.createElement('div');
        actionBar.className = 'msg-actions';
        actionBar.style.display = 'none'; // Moved to input bar
        actionBar.innerHTML =
          '<button class="msg-action-btn" id="btn-copy-msg" title="Copy text">📋</button>' +
          '<button class="msg-action-btn" id="btn-save-msg" title="Save as file">💾</button>';
        overlay.appendChild(actionBar);
        const msgEl = document.createElement('div');
        msgEl.className = 'msg assistant';
        msgEl.style.userSelect = 'text';
        msgEl.innerHTML = '<span style="color:#6366f1;opacity:0.6">⏳</span>';
        overlay.appendChild(msgEl);
      }

      let fullReply = '';
      let streamEngine = 'Gemini';
      let streamSuccess = false;

      // Try SSE streaming first (if no media — stream doesn't support images)
      if (!mediaToSend && !payload.imageBase64) {
        try {
          const hdrs = authHeaders();
          hdrs['Content-Type'] = 'application/json';
          // Retry on 503 (brain degraded / server overloaded)
          let resp = null;
          for (let _retry = 0; _retry < 3; _retry++) {
            resp = await fetch(API_BASE + '/api/chat/stream', {
              method: 'POST',
              headers: hdrs,
              body: JSON.stringify(payload),
            });
            if (resp.status !== 503) break;
            // Wait before retry: 1s, 2s
            console.warn('[App] 503 — brain degraded, retry ' + (_retry + 1) + '/2');
            if (_retry < 2) await new Promise((r) => setTimeout(r, (_retry + 1) * 1000));
          }

          // Handle trial expired or rate limit on stream endpoint
          if (!resp.ok) {
            const streamErr = await resp.json().catch(() => ({}));
            if (streamErr.trialExpired || (resp.status === 403 && streamErr.upgrade)) {
              showThinking(false);
              showGuestExpiry('trial');
              if (window.KVoice) KVoice.resumeWakeDetection();
              return;
            } else if (resp.status === 429 && streamErr.upgrade) {
              showThinking(false);
              showGuestExpiry('daily');
              if (window.KVoice) KVoice.resumeWakeDetection();
              return;
            }
          }

          if (resp.ok && resp.body) {
            showThinking(false);
            const reader = resp.body.getReader();
            const decoder = new TextDecoder();
            let buffer = '';

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const jsonStr = line.slice(6).trim();
                if (!jsonStr || jsonStr === '[DONE]') continue;
                try {
                  const evt = JSON.parse(jsonStr);
                  if (evt.type === 'chunk' && evt.text) {
                    fullReply += evt.text;
                    // Progressive display — show text as it arrives (stripped of avatar tags)
                    const displayText = stripAvatarTags(fullReply);
                    if (displayText) {
                      msgEl.innerHTML = parseMarkdown(displayText);
                      overlay.scrollTop = overlay.scrollHeight;
                      _updateSubtitle('ai', displayText);
                    }
                  } else if (evt.type === 'start') {
                    streamEngine = evt.engine || 'Gemini';
                  } else if (evt.type === 'progress' && evt.detail) {
                    // SuperThink pipeline progress — show status to user
                    msgEl.innerHTML =
                      '<span style="color:#6366f1;opacity:0.7">🧠 ' + escapeHtml(evt.detail) + '</span>';
                  } else if (evt.type === 'thinking') {
                    msgEl.innerHTML = '<span style="color:#6366f1;opacity:0.6">🧠 Thinking...</span>';
                  } else if (evt.type === 'actions' && evt.actions) {
                    // AI controlează funcțiile aplicației
                    evt.actions.forEach(function (action) {
                      const a = action.toLowerCase();
                      if (a === 'camera_on' && window.KAutoCamera && !KAutoCamera.isActive()) KAutoCamera.toggle();
                      else if (a === 'camera_off' && window.KAutoCamera && KAutoCamera.isActive()) KAutoCamera.stop();
                      else if (a === 'scan_on' && window.KScanner && !KScanner.isActive()) KScanner.start();
                      else if (a.startsWith('navigate:')) {
                        const dest = a.split(':')[1];
                        if (dest && window.KMobile) KMobile.navigate(dest);
                      }
                    });
                  } else if (evt.type === 'done') {
                    if (evt.conversationId) persistConvId(evt.conversationId);
                    // ── Emotion ──
                    if (evt.emotion) KAvatar.setExpression(evt.emotion, 0.5);
                    // ── Gestures ──
                    if (evt.gestures && evt.gestures.length > 0) {
                      evt.gestures.forEach(function (g, i) {
                        setTimeout(function () {
                          KAvatar.playGesture(g);
                        }, i * 800);
                      });
                    }
                    // ── Body Actions ──
                    if (evt.bodyActions && evt.bodyActions.length > 0 && KAvatar.playBodyAction) {
                      evt.bodyActions.forEach(function (ba, i) {
                        setTimeout(function () {
                          KAvatar.playBodyAction(ba);
                        }, i * 1500);
                      });
                    }
                    // ── Pose ──
                    if (evt.pose && KAvatar.setPose) KAvatar.setPose(evt.pose);
                    // ── Gaze ──
                    if (evt.gaze && KAvatar.setEyeGaze) {
                      KAvatar.setEyeGaze(evt.gaze);
                      setTimeout(function () {
                        try {
                          KAvatar.setEyeGaze('center');
                        } catch (_e) {
                          /* ignored */
                        }
                      }, 3000);
                    }
                    // ── Guest counter ──
                    if (evt.remaining !== undefined) updateGuestCounter(evt.remaining, evt.limit);
                  } // end done
                } catch (_pe) {
                  /* skip bad JSON */
                }
              }
            }
            streamSuccess = fullReply.length > 0;
          }
        } catch (_streamErr) {
          console.warn('[App] Stream failed, falling back to regular:', _streamErr.message);
        }
      }

      // ═══════════════════════════════════════════════════════
      // FALLBACK: Regular fetch (for media uploads or stream failure)
      // ═══════════════════════════════════════════════════════
      if (!streamSuccess) {
        let resp = null;
        for (let _retry = 0; _retry < 3; _retry++) {
          resp = await fetch(API_BASE + '/api/chat', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(payload),
          });
          if (resp.status !== 503) break;
          console.warn('[App] 503 fallback — brain degraded, retry ' + (_retry + 1) + '/2');
          if (_retry < 2) await new Promise((r) => setTimeout(r, (_retry + 1) * 1000));
        }

        showThinking(false);
        if (!resp.ok) {
          const e = await resp.json().catch(() => ({}));
          if (e.trialExpired || (resp.status === 403 && e.upgrade)) {
            showGuestExpiry('trial');
          } else if (resp.status === 429 && e.upgrade) {
            showGuestExpiry('daily');
          } else if (resp.status === 429) {
            addMessage('assistant', i18n.t('app.tooManyMessages'));
          } else addMessage('assistant', e.error || i18n.t('app.genericError'));
          if (window.KVoice) KVoice.resumeWakeDetection();
          return;
        }

        const data = await resp.json();
        fullReply = (data.reply || '')
          .replace(/\[SYSTEM INSTRUCTION[^\]]*\][\s\S]*?\[END SYSTEM INSTRUCTION\]\s*/gi, '')
          .replace(/\[AGENT ACTIV[^\]]*\]\s*/gi, '')
          .trim();
        if (data.conversationId) persistConvId(data.conversationId);
        streamEngine = data.engine || 'Gemini';
        if (data.remaining !== undefined) updateGuestCounter(data.remaining, data.limit);

        // Avatar control from tags
        const brainEmotion = data.emotion || 'happy';
        KAvatar.setExpression(brainEmotion, 0.5);
        if (data.gestures && data.gestures.length > 0) {
          data.gestures.forEach(function (g, i) {
            setTimeout(function () {
              KAvatar.playGesture(g);
            }, i * 800);
          });
        }
        if (data.pose && KAvatar.setPose) KAvatar.setPose(data.pose);
        if (data.bodyActions && data.bodyActions.length > 0 && KAvatar.playBodyAction) {
          data.bodyActions.forEach(function (ba, i) {
            setTimeout(function () {
              KAvatar.playBodyAction(ba);
            }, i * 1500);
          });
        }
        if (data.gaze && KAvatar.setEyeGaze) {
          KAvatar.setEyeGaze(data.gaze);
          setTimeout(function () {
            try {
              KAvatar.startEyeIdle();
            } catch (_e) {
              /* ok */
            }
          }, 3000);
        }

      }

      // ═══════════════════════════════════════════════════════
      // POST-STREAM: Extract tags from streamed text, final display
      // ═══════════════════════════════════════════════════════
      // Clean system instruction leaks
      fullReply = fullReply
        .replace(/\[SYSTEM INSTRUCTION[^\]]*\][\s\S]*?\[END SYSTEM INSTRUCTION\]\s*/gi, '')
        .replace(/\[AGENT ACTIV[^\]]*\]\s*/gi, '')
        .trim();

      // Extract avatar tags from streamed text (if streaming was used)
      if (streamSuccess) {
        // Emotion
        const emotionMatch = fullReply.match(/\[EMOTION:\s*(\w+)\]/i);
        if (emotionMatch) KAvatar.setExpression(emotionMatch[1].toLowerCase(), 0.5);
        else KAvatar.setExpression('happy', 0.5);
        // Gestures
        const gestureMatches = [...fullReply.matchAll(/\[GESTURE:\s*(\w+)\]/gi)];
        gestureMatches.forEach(function (gm, i) {
          setTimeout(function () {
            KAvatar.playGesture(gm[1].toLowerCase());
          }, i * 800);
        });
        // Body
        const bodyMatches = [...fullReply.matchAll(/\[BODY:\s*(\w+)\]/gi)];
        bodyMatches.forEach(function (bm, i) {
          setTimeout(function () {
            if (KAvatar.playBodyAction) KAvatar.playBodyAction(bm[1]);
          }, i * 1500);
        });
        // Gaze
        const gazeMatch = fullReply.match(/\[GAZE:\s*([\w-]+)\]/i);
        if (gazeMatch && KAvatar.setEyeGaze) {
          KAvatar.setEyeGaze(gazeMatch[1].toLowerCase());
          setTimeout(function () {
            try {
              KAvatar.startEyeIdle();
            } catch (_e) {
              /* ok */
            }
          }, 3000);
        }
        // ── [ACTION:xxx] — AI controlează funcțiile aplicației ──
        const actionMatches = [...fullReply.matchAll(/\[ACTION:([^\]]+)\]/gi)];
        actionMatches.forEach(function (am) {
          const action = am[1].trim().toLowerCase();
          if (action === 'camera_on') {
            if (window.KAutoCamera && !KAutoCamera.isActive()) KAutoCamera.toggle();
          } else if (action === 'camera_off') {
            if (window.KAutoCamera && KAutoCamera.isActive()) KAutoCamera.stop();
          } else if (action === 'scan_on') {
            if (window.KScanner && !KScanner.isActive()) KScanner.start();
          } else if (action === 'scan_off') {
            if (window.KScanner && KScanner.isActive()) KScanner.stop();
          } else if (action === 'deploy' || action === 'admin_deploy') {
            // Afișează clepsidra de deploy și monitorizează server restart
            if (window.DeployStatus) DeployStatus.start();
          } else if (action === 'save_file') {
            // Salvează ultimul răspuns AI ca fişier text
            const saveBtn = document.getElementById('btn-save-last');
            if (saveBtn) saveBtn.click();
          } else if (action === 'upload_file') {
            // Deschide dialogul de upload fişier
            const fi = document.getElementById('file-input-hidden');
            if (fi) fi.click();
          } else if (action.startsWith('navigate:')) {
            const dest = am[1].replace(/^navigate:/i, '').trim();
            if (dest && window.KMobile) KMobile.navigate(dest);
          }
        });
        // Strip all tags from display
        fullReply = fullReply
          .replace(/\[EMOTION:\s*\w+\]/gi, '')
          .replace(/\[GESTURE:\s*\w+\]/gi, '')
          .replace(/\[BODY:\s*\w+\]/gi, '')
          .replace(/\[GAZE:\s*[\w-]+\]/gi, '')
          .replace(/\[POSE:\s*\w+\]/gi, '')
          .replace(/\[ACTION:[^\]]+\]/gi, '')
          .trim();
      }

      if (!fullReply) {
        addMessage('assistant', '...');
        if (window.KVoice) KVoice.resumeWakeDetection();
        return;
      }

      // VOICE-FIRST: speak immediately, before text display
      const _thisGen = ++_speakGeneration;
      if (window.KVoice) {
        // Strip image URLs so avatar doesn't speak them aloud
        const ttsReply = fullReply
          .replace(
            /https?:\/\/[^\s<>"']+(?:\.(?:jpg|jpeg|png|gif|webp|svg|bmp)|(?:pollinations\.ai|oaidalleapiprodscus|cdn\.openai\.com|dalle\.com)[^\s<>"']*)/gi,
            ''
          )
          .replace(/\s{2,}/g, ' ')
          .trim();
        KVoice.speak(ttsReply, KAvatar.getCurrentAvatar());
      }

      chatHistory.push({ role: 'user', content: message });
      chatHistory.push({ role: 'assistant', content: fullReply });
      saveChatHistoryLocal();

      // Final display (clean text without tags)
      msgEl.innerHTML = parseMarkdown(fullReply);
      overlay.scrollTop = overlay.scrollHeight;
      // Update subtitle under avatar with final clean AI response
      _updateSubtitle('ai', fullReply);

      // Wire copy/save buttons
      const copyBtn = actionBar.querySelector('#btn-copy-msg');
      const saveBtn = actionBar.querySelector('#btn-save-msg');
      if (copyBtn)
        copyBtn.onclick = function () {
          navigator.clipboard
            .writeText(fullReply)
            .then(function () {
              copyBtn.textContent = 'OK';
              setTimeout(function () {
                copyBtn.textContent = 'Copy';
              }, 1500);
            })
            .catch(function () {
              const ta = document.createElement('textarea');
              ta.value = fullReply;
              document.body.appendChild(ta);
              ta.select();
              document.execCommand('copy');
              document.body.removeChild(ta);
              copyBtn.textContent = 'OK';
              setTimeout(function () {
                copyBtn.textContent = 'Copy';
              }, 1500);
            });
        };
      if (saveBtn)
        saveBtn.onclick = function () {
          const blob = new Blob([fullReply], { type: 'text/plain;charset=utf-8' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'kelion-response-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.txt';
          a.click();
          URL.revokeObjectURL(a.href);
        };

      // Image/map detection — PRIORITATE MAXIMĂ, înainte de auto-display
      const IMG_DETECT =
        /https?:\/\/[^\s<>"']+(?:\.(?:jpg|jpeg|png|gif|webp|svg|bmp)|(?:pollinations\.ai|oaidalleapiprodscus\.blob\.core\.windows\.net|cdn\.openai\.com|dalle\.com|midjourney\.com|stability\.ai|ideogram\.ai)[^\s<>"']*)/i;
      const imgMatch = fullReply.match(IMG_DETECT);
      // Images detected in reply are displayed inline in chat

      // Voice-first: speak() already called above, before text display
    } catch (_e) {
      console.error('[App] sendToAI_Regular CATCH:', _e);
      showThinking(false);
      addMessage('assistant', i18n.t('app.connectionError'));
      if (window.KVoice) KVoice.resumeWakeDetection();
    }
  }

  // ─── Guest counter & expiry helpers ─────────────────────
  function updateGuestCounter(remaining, limit) {
    const el = document.getElementById('guest-counter');
    if (!el) return;
    const session = { access_token: localStorage.getItem('kelion_token') };
    if (session.access_token || (window.KAuth && KAuth.isAdmin && KAuth.isAdmin())) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'inline';
    if (remaining <= 0) {
      el.textContent = i18n.t('app.messagesCount', { remaining: 0, limit: limit });
      el.style.color = '#ef4444';
      el.style.background = 'rgba(239,68,68,0.12)';
    } else if (remaining <= 3) {
      el.textContent = i18n.t('app.remaining', { remaining: remaining, limit: limit });
      el.style.color = '#f59e0b';
      el.style.background = 'rgba(245,158,11,0.12)';
    } else {
      el.textContent = i18n.t('app.remaining', { remaining: remaining, limit: limit });
      el.style.color = '#8888aa';
      el.style.background = 'rgba(136,136,170,0.1)';
    }
  }

  function showGuestExpiry(type) {
    // Never show expiry for logged-in users or admins
    const _s = { access_token: localStorage.getItem('kelion_token') };
    if (_s.access_token || (window.KAuth && KAuth.isAdmin && KAuth.isAdmin())) return;
    const overlay = document.getElementById('guest-expiry-overlay');
    const title = document.getElementById('expiry-title');
    const msg = document.getElementById('expiry-message');
    if (!overlay) return;
    if (type === 'trial') {
      if (title) title.textContent = i18n.t('app.trialExpiredTitle');
      if (msg) msg.textContent = i18n.t('app.trialExpiredMessage');
    } else {
      if (title) title.textContent = i18n.t('app.dailyLimitTitle');
      if (msg) msg.textContent = i18n.t('app.dailyLimitMessage');
    }
    overlay.style.display = 'flex';
    updateGuestCounter(0, 15);
  }

  // ─── Route to streaming or regular ─────────────────────
  async function sendToAI(message, language) {
    // ═══ TOKEN REFRESH: Ensure valid token before every request ═══
    if (window.KAuth && KAuth.isTokenExpired && KAuth.isTokenExpired()) {
      console.log('[App] Token expired, refreshing before chat...');
      if (KAuth.refreshToken) await KAuth.refreshToken();
    }

    // ═══ SPEAKER CONTEXT: Inject known speaker greeting ═══
    if (window._speakerContext && message.indexOf('[SYSTEM') === -1) {
      message = window._speakerContext + ' ' + message;
      window._speakerContext = null;
    }

    // ═══ GUEST TIME LIMITS: 15min/day, 7-day trial ═══
    const guestKey = 'kelion_guest_usage';
    const session = { access_token: localStorage.getItem('kelion_token') };
    const _isAdmin = window.KAuth && KAuth.isAdmin && KAuth.isAdmin();
    if (!session.access_token && !_isAdmin) {
      const guest = JSON.parse(localStorage.getItem(guestKey) || '{}');
      const now = Date.now();
      const today = new Date().toISOString().slice(0, 10);
      // First visit — set trial start
      if (!guest.trialStart) guest.trialStart = now;
      // 7-day trial expired?
      const trialDays = (now - guest.trialStart) / (1000 * 60 * 60 * 24);
      if (trialDays > 7) {
        showGuestExpiry('trial');
        localStorage.setItem(guestKey, JSON.stringify(guest));
        return;
      }
      // Daily 15min limit
      if (guest.date !== today) {
        guest.date = today;
        guest.usedMs = 0;
      }
      if (guest.usedMs >= 15 * 60 * 1000) {
        showGuestExpiry('daily');
        return;
      }
      // Track start time for this message
      guest._msgStart = now;
      localStorage.setItem(guestKey, JSON.stringify(guest));
    }

    let msg = message;
    if (window.KelionTools) {
      try {
        const ctx = await KelionTools.preprocessMessage(message);
        if (ctx) {
          const cleanCtx = ctx.replace(/!\[.*?\]\(data:[^)]+\)/g, '').trim();
          if (cleanCtx) msg = message + cleanCtx;
        }
      } catch (e) {
        console.warn('[Tools] preprocessMessage error:', e.message);
      }
    }
    await sendToAI_Regular(msg, language);

    // Update guest usage time after response
    if (!session.access_token) {
      const guest = JSON.parse(localStorage.getItem(guestKey) || '{}');
      if (guest._msgStart) {
        guest.usedMs = (guest.usedMs || 0) + (Date.now() - guest._msgStart);
        delete guest._msgStart;
        localStorage.setItem(guestKey, JSON.stringify(guest));
      }
    }
  }

  function escapeHtml(t) {
    const d = document.createElement('div');
    d.textContent = t;
    return d.innerHTML;
  }

  // ─── Markdown parser for chat messages ─────────────────────
  function parseMarkdown(text) {
    if (!text) return '';
    let html = escapeHtml(text);
    // Bold: **text** or __text__
    html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
    // Italic: *text* or _text_
    html = html.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
    // Inline code: `code`
    html = html.replace(
      /`([^`]+)`/g,
      '<code style="background:#1a1a2e;padding:2px 6px;border-radius:4px;font-size:0.9em">$1</code>'
    );
    // Horizontal rules: --- or ___
    html = html.replace(/^(---|___)$/gm, '<hr style="border:none;border-top:1px solid #444;margin:8px 0">');
    // Bullet lists: - item or * item
    html = html.replace(/^[\-\*]\s+(.+)$/gm, '<li style="margin-left:16px;list-style:disc">$1</li>');
    // Numbered lists: 1. item
    html = html.replace(/^\d+\.\s+(.+)$/gm, '<li style="margin-left:16px;list-style:decimal">$1</li>');
    // Line breaks
    html = html.replace(/\n/g, '<br>');
    return html;
  }

  // ─── UI ──────────────────────────────────────────────────
  function addMessage(type, text) {
    // Strip avatar tags and leaked system instructions from display
    text = stripAvatarTags(text);
    if (!text) return; // Don't show empty messages

    // Persist in #chat-messages for E2E tests and history export
    const chatMsgs = document.getElementById('chat-messages');
    if (chatMsgs) {
      const pm = document.createElement('div');
      pm.className = 'msg ' + type;
      if (type === 'assistant') {
        pm.innerHTML = parseMarkdown(text);
      } else {
        pm.textContent = text;
      }
      chatMsgs.appendChild(pm);
      while (chatMsgs.children.length > 50) chatMsgs.removeChild(chatMsgs.firstChild);
    }

    if (type === 'user') {
      // Show user message under avatar (will be replaced by AI response)
      _updateSubtitle('user', text);
      return;
    }

    // ALL text goes ONLY to subtitle under avatar
    _updateSubtitle('ai', text);
  }
  function _updateSubtitle(type, text) {
    const el = document.getElementById('live-subtitle');
    const speaker = document.getElementById('subtitle-speaker');
    const txt = document.getElementById('subtitle-text');
    if (!el || !speaker || !txt) return;
    // Show subtitle with CSS fade-in
    el.classList.add('visible');
    speaker.textContent = type === 'user' ? '🗣️' : '🤖';
    // Full text — markdown for AI, plain for user
    if (type === 'user') {
      txt.textContent = text;
    } else {
      txt.innerHTML = parseMarkdown(text);
    }
    // Scroll to bottom if content overflows
    el.scrollTop = el.scrollHeight;
    // No auto-hide — stays until next message replaces it
    if (window._subtitleTimer) clearTimeout(window._subtitleTimer);
  }
  function showThinking(v) {
    document.getElementById('thinking').classList.toggle('active', v);
  }
  function hideWelcome() {
    const w = document.getElementById('welcome');
    if (w) w.classList.add('hidden');
  }
  // Expose hideWelcome globally so ButtonBind (index.html) can call it
  window.hideWelcome = hideWelcome;

  function switchAvatar(name) {
    if (window.KVoice) KVoice.stopSpeaking();
    try {
      KAvatar.loadAvatar(name);
    } catch (e) {
      console.warn('[App] Avatar load failed:', e.message);
    }
    document.querySelectorAll('.avatar-pill').forEach(function (b) {
      b.classList.toggle('active', b.dataset.avatar === name);
    });
    const displayName = name.charAt(0).toUpperCase() + name.slice(1);
    const n = document.getElementById('avatar-name');
    if (n) n.textContent = displayName;
    const navName = document.getElementById('navbar-avatar-name');
    if (navName) navName.textContent = displayName;
    document.title = displayName + 'AI';
    // DO NOT clear chat history or chat overlay when switching avatars
    // chatHistory = []; persistConvId(null);
    // var o = document.getElementById('chat-overlay'); if (o) o.innerHTML = '';
  }

  // ─── Upgrade voice command detection ─────────────────────
  // Matches: "Kelion/Chelion, upgrade/abonament", "vreau pro/premium", "upgrade plan"
  function isUpgradeRequest(t) {
    const l = t.toLowerCase();
    return /(kelion|chelion)[,.\s]+(upgrade|abonament)|vreau\s+(pro|premium)|upgrade\s+plan/.test(l);
  }

  // ─── Input handlers ──────────────────────────────────────
  async function onSendText() {
    // ── CRITICAL: Unlock audio on EVERY send (user gesture) ──
    unlockAudio();
    const inp = document.getElementById('text-input');
    let text = inp.value.trim();
    if (!text) return;
    inp.value = '';
    _voiceInitiated = false; // text input — don't auto-speak response
    const l = text.toLowerCase();
    if (/^(kira|chira)[,.\s]/i.test(l)) {
      switchAvatar('kira');
      text = text.replace(/^(kira|chira)[,.\s]*/i, '').trim();
    } else if (/^(kelion|chelion)[,.\s]/i.test(l)) {
      switchAvatar('kelion');
      text = text.replace(/^(kelion|chelion)[,.\s]*/i, '').trim();
    }
    if (!text) return;
    if (isUpgradeRequest(text)) {
      if (window.KPayments) KPayments.showUpgradePrompt();
      return;
    }
    // ─── Admin code detection (only for short code-like messages) ─────
    const looksLikeCode =
      text.length < 40 &&
      !/\b(ce|cum|de|la|si|sau|nu|da|eu|tu|el|ea|am|ai|are|sunt|esti|este|vreau|vrei|fa|pune|arata|spune|caut|deschide|salut|buna|hey|hi|hello|what|how|when|where)\b/i.test(
        text
      );
    if (looksLikeCode) {
      try {
        const codeResp = await fetch(API_BASE + '/api/admin/verify', {
          method: 'POST',
          headers: authHeaders(),
          body: JSON.stringify({ code: text }),
        });
        if (codeResp.ok) {
          const codeData = await codeResp.json();
          hideWelcome();
          addMessage('user', '🔑 •••••');
          if (codeData.action === 'enter') {
            adminSecret = codeData.secret;
            sessionStorage.setItem('kelion_admin_secret', codeData.secret);
            // Admin unlocked — btn-admin-nav in navbar handles dashboard access
            console.log('[Admin] Admin code accepted — use Admin button in navbar');
          } else if (codeData.action === 'exit') {
            adminSecret = null;
            sessionStorage.removeItem('kelion_admin_secret');
            // Re-lock — user-name returns to normal
            const un2 = document.getElementById('user-name');
            if (un2) {
              un2.style.cssText = 'cursor:default;border:none;background:transparent;';
              un2.title = '';
              un2.onclick = null;
            }
          }
          return;
        }
      } catch (_e) {
        /* continue normally */
      }
    }
    // Web command — open in new tab
    const webUrl = tryWebCommand(text);
    if (webUrl) {
      hideWelcome();
      addMessage('user', text);
      window.open(webUrl, '_blank');
      addMessage('assistant', '🌐 Opened ' + webUrl + ' in a new tab!');
      if (window.KVoice) KVoice.speak('Done, I opened it for you!');
      return;
    }
    hideWelcome();
    KAvatar.setAttentive(true);
    addMessage('user', text);
    showThinking(true);
    // Unlock AudioContext on text send — ensures voice plays without needing mic press
    if (window.KVoice && KVoice.ensureAudioUnlocked) KVoice.ensureAudioUnlocked();
    // Detect language from text and use it (persists until user changes it)
    if (window.i18n && i18n.detectLanguage) {
      const detected = i18n.detectLanguage(text);
      if (detected) i18n.setLanguage(detected);
    }
    const chatLang = window.i18n ? i18n.getLanguage() : 'en';
    if (isVisionRequest(text)) triggerVision();
    else await sendToAI(text, chatLang);
  }

  // ─── Drag & Drop ─────────────────────────────────────────
  function setupDragDrop() {
    const dp = document.getElementById('display-panel'),
      dz = document.getElementById('drop-zone');
    if (!dp || !dz) return;
    dp.addEventListener('dragover', function (e) {
      e.preventDefault();
      dz.classList.remove('hidden');
    });
    dp.addEventListener('dragleave', function (e) {
      if (!dp.contains(e.relatedTarget)) dz.classList.add('hidden');
    });
    dp.addEventListener('drop', function (e) {
      e.preventDefault();
      dz.classList.add('hidden');
      handleFiles(e.dataTransfer.files);
    });
  }

  async function handleFiles(fileList) {
    hideWelcome();
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const reader = new FileReader();
      reader.onload = async function () {
        storedFiles.push({ name: file.name, size: file.size, type: file.type, data: reader.result });
        addMessage('user', '📎 ' + file.name + ' (' + Math.round(file.size / 1024) + ' KB)');
        if (file.type.startsWith('image/')) {
          const b64 = reader.result.split(',')[1];
          KAvatar.setExpression('thinking', 0.5);
          showThinking(true);
          try {
            const r = await fetch(API_BASE + '/api/vision', {
              method: 'POST',
              headers: authHeaders(),
              body: JSON.stringify({
                image: b64,
                avatar: KAvatar.getCurrentAvatar(),
                language: window.KVoice ? KVoice.getLanguage() : 'en',
              }),
            });
            const d = await r.json();
            showThinking(false);
            addMessage('assistant', d.description || 'Could not analyze.');
            KAvatar.setExpression('happy', 0.3);
            if (window.KVoice) await KVoice.speak(d.description);
          } catch (_e) {
            showThinking(false);
            addMessage('assistant', 'Analysis error.');
          }
        } else {
          addMessage('assistant', 'I received ' + file.name + '. What should I do with it?');
        }
      };
      if (file.type.startsWith('text/') || file.name.match(/\.(txt|md|json|csv)$/)) reader.readAsText(file);
      else reader.readAsDataURL(file);
    }
  }

  // ─── Health check ────────────────────────────────────────
  async function checkHealth() {
    try {
      const r = await fetch(API_BASE + '/api/health');
      const d = await r.json();
      if (d.status === 'ok' || d.status === 'online') {
        const statusText = document.getElementById('status-text');
        const statusDot = document.getElementById('status-dot');
        if (statusText) statusText.textContent = 'Online' + (d.brain !== 'healthy' ? ' ⚠️' : '');
        if (statusDot) statusDot.style.background = d.brain === 'healthy' ? '#00ff88' : '#ffaa00';
        if (d.services && !d.services.ai_gemini) useStreaming = false;
      }
    } catch (_e) {
      const statusText = document.getElementById('status-text');
      const statusDot = document.getElementById('status-dot');
      if (statusText) statusText.textContent = 'Offline';
      if (statusDot) statusDot.style.background = '#ff4444';
      useStreaming = false;
    }
  }

  // ─── INIT ────────────────────────────────────────────────
  function init() {
    // ─── Splash: loading animation, auto-dismissed after 3s ──
    // NOTE: This is just the loading overlay. Auth-screen (with START button) stays visible
    // until user clicks START — that click is the user gesture needed for AudioContext
    const splashEl = document.getElementById('splash-screen');
    function dismissSplash() {
      if (splashEl && splashEl.parentNode) {
        splashEl.style.opacity = '0';
        splashEl.style.pointerEvents = 'none';
        setTimeout(function () {
          if (splashEl && splashEl.parentNode) splashEl.parentNode.removeChild(splashEl);
        }, 600);
      }
    }
    const splashTimer = setTimeout(dismissSplash, 3000);
    // NO auth safety auto-show — START button is the only gate

    if (window.KAuth) KAuth.init();
    try {
      KAvatar.init();
      // Auto-start natural eye movement
      setTimeout(function () {
        try {
          KAvatar.startEyeIdle();
        } catch (_e) {
          /* ok */
        }
      }, 3000);
    } catch (e) {
      console.error('[App] Avatar init failed:', e.message);
      // Keep canvas visible even without WebGL — shows fallback gradient
    }

    ['click', 'touchstart', 'keydown'].forEach(function (e) {
      document.addEventListener(e, unlockAudio, { once: true, passive: true });
    });

    const sendBtn = document.getElementById('btn-send');
    if (sendBtn) sendBtn.addEventListener('click', onSendText);
    document.getElementById('text-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') onSendText();
    });

    // ─── Clipboard paste — Ctrl+V images into chat ──────────
    document.addEventListener('paste', function (e) {
      const items = (e.clipboardData || e.originalEvent.clipboardData).items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          e.preventDefault();
          const blob = items[i].getAsFile();
          const reader = new FileReader();
          reader.onload = function (ev) {
            const b64 = ev.target.result;
            // Show preview in chat
            addMessage('user', '📷 [Screenshot pasted]');
            const overlay = document.getElementById('chat-overlay');
            if (overlay) {
              const imgEl = document.createElement('div');
              imgEl.className = 'msg user';
              const img = document.createElement('img');
              img.src = b64;
              img.style.cssText = 'max-width:200px;border-radius:8px;margin:4px 0;';
              imgEl.appendChild(img);
              overlay.appendChild(imgEl);
              overlay.scrollTop = overlay.scrollHeight;
            }
            // Send to vision API for analysis
            showThinking(true);
            const rawB64 = b64.replace(/^data:image\/[a-z+]+;base64,/, '');
            fetch(API_BASE + '/api/vision', {
              method: 'POST',
              headers: authHeaders(),
              body: JSON.stringify({
                image: rawB64,
                avatar: window.KAvatar ? KAvatar.getCurrentAvatar() : 'kelion',
                language: window.i18n ? i18n.getLanguage() : 'en',
              }),
            })
              .then(function (r) {
                return r.json();
              })
              .then(function (data) {
                showThinking(false);
                const desc = data.description || data.reply || 'Could not analyze the image.';
                addMessage('assistant', desc);
                chatHistory.push({ role: 'user', content: '[User pasted a screenshot]' });
                chatHistory.push({ role: 'assistant', content: desc });
                if (window.KVoice) KVoice.speak(desc);
              })
              .catch(function (err) {
                showThinking(false);
                addMessage('assistant', 'Image analysis error: ' + err.message);
              });
          };
          reader.readAsDataURL(blob);
          break;
        }
      }
    });

    document.querySelectorAll('.avatar-pill').forEach(function (b) {
      b.addEventListener('click', function () {
        switchAvatar(b.dataset.avatar);
      });
    });

    // Mic toggle — handled by unified IIFE handler below (voice loop pipeline)
    // No separate handler here — prevents duplicate wake-word + voice-stream conflict



    // Pricing close
    const pricingClose = document.getElementById('pricing-close');
    if (pricingClose)
      pricingClose.addEventListener('click', function () {
        const m = document.getElementById('pricing-modal');
        if (m) m.classList.add('hidden');
      });

    // ➕ button — popup with IN (import) / OUT (export ZIP)
    const plusBtn = document.getElementById('btn-plus');
    const fileInput = document.getElementById('file-input-hidden');
    if (plusBtn) {
      plusBtn.addEventListener('click', function () {
        // Remove existing popup if any
        const old = document.getElementById('plus-popup');
        if (old) {
          old.remove();
          return;
        }
        const popup = document.createElement('div');
        popup.id = 'plus-popup';
        popup.style.cssText =
          'position:absolute;bottom:44px;right:0;background:#1a1a2e;border:1px solid #333;border-radius:8px;padding:6px;z-index:100;display:flex;gap:6px;box-shadow:0 4px 16px rgba(0,0,0,0.5);';
        popup.innerHTML =
          '<button id="plus-import" style="background:#2a2a4a;color:#a5b4fc;border:1px solid #444;border-radius:6px;padding:8px 16px;cursor:pointer;font-size:0.85rem;">📂 Add file</button>' +
          '<button id="plus-export" style="background:#2a2a4a;color:#86efac;border:1px solid #444;border-radius:6px;padding:8px 16px;cursor:pointer;font-size:0.85rem;">💾 Save all</button>' +
          '<button id="plus-export-chat" style="background:#2a2a4a;color:#fbbf24;border:1px solid #444;border-radius:6px;padding:8px 16px;cursor:pointer;font-size:0.85rem;">📥 Export chat</button>';
        plusBtn.parentElement.style.position = 'relative';
        plusBtn.parentElement.appendChild(popup);
        document.getElementById('plus-import').addEventListener('click', function () {
          popup.remove();
          if (fileInput) fileInput.click();
        });
        document.getElementById('plus-export').addEventListener('click', function () {
          popup.remove();
          // Export chat as JSON
          const blob = new Blob([JSON.stringify(chatHistory, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'kelion-export-' + new Date().toISOString().slice(0, 10) + '.json';
          a.click();
          setTimeout(function () { URL.revokeObjectURL(url); }, 100);
        });
        document.getElementById('plus-export-chat').addEventListener('click', function () {
          popup.remove();
          const blob = new Blob([JSON.stringify(chatHistory, null, 2)], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'kelion-chat-' + new Date().toISOString().slice(0, 10) + '.json';
          a.click();
          setTimeout(function () {
            URL.revokeObjectURL(url);
          }, 100);
        });
        // Close popup on click outside
        setTimeout(function () {
          document.addEventListener('click', function closePopup(e) {
            if (!popup.contains(e.target) && e.target !== plusBtn) {
              popup.remove();
              document.removeEventListener('click', closePopup);
            }
          });
        }, 50);
      });
    }
    if (fileInput) {
      fileInput.addEventListener('change', function () {
        if (fileInput.files.length > 0) handleFiles(fileInput.files);
        fileInput.value = '';
      });
    }

    window.addEventListener('wake-message', function (e) {
      const detail = e.detail;
      hideWelcome();
      addMessage('user', detail.text);
      showThinking(true);
      if (isVisionRequest(detail.text)) triggerVision();
      else sendToAI(detail.text, detail.language);
    });

    // ── SPEAKER IDENTIFICATION: Greet known voices, ask unknown ones ──
    let _askingForName = false;
    window.addEventListener('speaker-identified', function (e) {
      const name = e.detail.name;
      if (name && !_askingForName) {
        console.log('[App] Welcome back:', name);
        // Prepend greeting context to next AI message
        window._speakerContext =
          '[SPEAKER_IDENTITY: Known user "' + name + '" is speaking. Greet them briefly by name.]';
      }
    });

    window.addEventListener('speaker-unknown', function (e) {
      if (_askingForName) return; // Already asking
      _askingForName = true;
      // Ask the AI to ask who this person is
      const askMsg =
        '[SYSTEM: An unknown voice activated the wake word. Ask them politely who they are (just their first name). Keep it short and friendly.]';
      sendToAI(askMsg, window.i18n ? i18n.getLanguage() : 'en').then(function () {
        // After AI asks, listen for the name response
        // The next voice input will be the name — capture it
        window._waitingForNameResponse = true;
        window._pendingVoicePrintForName = e.detail.print;
        _askingForName = false;
      });
    });

    // Intercept wake-message when waiting for name
    window.addEventListener(
      'wake-message',
      function (e) {
        if (!window._waitingForNameResponse) return;
        window._waitingForNameResponse = false;
        const name = e.detail.text.trim();
        if (name && name.length > 0 && name.length < 30 && window._pendingVoicePrintForName) {
          // Save voice profile with the given name
          if (window.KVoice && KVoice.saveVoiceProfile) {
            KVoice.saveVoiceProfile(name, window._pendingVoicePrintForName);
            console.log('[App] Voice profile saved for:', name);
          }
          window._pendingVoicePrintForName = null;
        }
      },
      true
    ); // Use capture phase so it runs before the main handler

    setupDragDrop();
    // Wake word NOT auto-started — user controls via 🎙️ button
    // Request geolocation so AI can see user's location
    if (window.KGeo)
      KGeo.getLocation().then(function (pos) {
        if (pos) console.log('[Geo] Location:', pos.lat.toFixed(2), pos.lng.toFixed(2));
      });
    checkHealth();


    // ─── Session exit: cleanup on tab/window close ────────────────
    window.addEventListener('beforeunload', function () {
      const token = localStorage.getItem('kelion_token');
      if (token) {
        try {
          navigator.sendBeacon('/api/auth/logout', JSON.stringify({ token: token }));
        } catch (_e) {
          /* ignored */
        }
      }

      // ── FREE TIER: Clear memory on exit (paid users keep everything) ──
      let userPlan = 'free';
      try {
        const u = window.KAuth && KAuth.getUser ? KAuth.getUser() : null;
        if (u && u.user_metadata && u.user_metadata.plan) userPlan = u.user_metadata.plan;
        // Also check localStorage for plan
        const storedPlan = localStorage.getItem('kelion_plan');
        if (storedPlan && storedPlan !== 'free') userPlan = storedPlan;
      } catch (_e) {
        /* ignored */
      }

      if (userPlan === 'free' || userPlan === 'guest') {
        // Clear chat history in memory
        chatHistory.length = 0;
        // Clear conversation ID so next session starts fresh
        currentConversationId = null;
        // Clear localStorage conversation data
        try {
          localStorage.removeItem('kelion_conv_id');
        } catch (_e) {
          /* ignored */
        }
        try {
          localStorage.removeItem('kelion_chat_history');
        } catch (_e) {
          /* ignored */
        }
        // Clear server-side user preferences for free users (beacon)
        if (token) {
          try {
            navigator.sendBeacon('/api/memory/clear-session', JSON.stringify({ token: token, plan: 'free' }));
          } catch (_e) {
            /* ignored */
          }
        }
        console.log('[App] Free tier: memory cleared on exit');
      }

      sessionStorage.clear();
      if (window.KVoice) {
        try {
          KVoice.stopSpeaking();
        } catch (_e) {
          /* ignored */
        }
        try {
          KVoice.stopListening();
        } catch (_e) {
          /* ignored */
        }
        try {
          KVoice.mute();
        } catch (_e) {
          /* ignored */
        }
      }
      if (window.i18n) {
        try {
          i18n.setLanguage('en');
        } catch (_e) {
          /* ignored */
        }
      }
    });

    // ─── Idle detection: logout after 30 min of inactivity ───────
    let idleTimer = null;
    function resetIdleTimer() {
      clearTimeout(idleTimer);
      if (localStorage.getItem('kelion_token')) {
        idleTimer = setTimeout(
          function () {
            if (window.KAuth && KAuth.isLoggedIn()) {
              KAuth.logout().then(function () {
                sessionStorage.clear();
                if (window.KVoice)
                  try {
                    KVoice.stopSpeaking();
                  } catch (_e) {
                    /* ignored */
                  }
                const authScr = document.getElementById('auth-screen');
                const appLayout = document.getElementById('app-layout');
                if (authScr) authScr.classList.remove('hidden');
                if (appLayout) appLayout.classList.add('hidden');
              });
            }
          },
          30 * 60 * 1000
        );
      }
    }
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        idleTimer = setTimeout(
          function () {
            if (window.KAuth && KAuth.isLoggedIn()) {
              KAuth.logout().then(function () {
                sessionStorage.clear();
                const authScr = document.getElementById('auth-screen');
                const appLayout = document.getElementById('app-layout');
                if (authScr) authScr.classList.remove('hidden');
                if (appLayout) appLayout.classList.add('hidden');
              });
            }
          },
          30 * 60 * 1000
        );
      } else {
        clearTimeout(idleTimer);
      }
    });
    ['click', 'keydown', 'touchstart', 'mousemove'].forEach(function (ev) {
      document.addEventListener(ev, resetIdleTimer, { passive: true });
    });
    resetIdleTimer();

    // Restore last conversation from localStorage
    const savedConvId = restoreConvId();
    if (savedConvId) {
      currentConversationId = savedConvId;
      fetch(API_BASE + '/api/conversations/' + savedConvId + '/messages', { headers: authHeaders() })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (data) {
          if (!data) return;
          const msgs = data.messages || data || [];
          if (msgs.length === 0) return;
          hideWelcome();
          const overlay = document.getElementById('chat-overlay');
          if (overlay) overlay.innerHTML = '';
          chatHistory = [];
          for (let i = 0; i < msgs.length; i++) {
            const role = msgs[i].role === 'assistant' ? 'assistant' : 'user';
            addMessage(role, msgs[i].content);
            chatHistory.push({ role: role, content: msgs[i].content });
          }
          saveChatHistoryLocal();
        })
        .catch(function (e) {
          console.warn('[App] restore conversation from server:', e.message);
          // Fallback: restore from localStorage (works for guests too)
          const localHistory = restoreChatHistoryLocal();
          if (localHistory && localHistory.length > 0) {
            hideWelcome();
            const overlay = document.getElementById('chat-overlay');
            if (overlay) overlay.innerHTML = '';
            chatHistory = [];
            for (let i = 0; i < localHistory.length; i++) {
              addMessage(localHistory[i].role, localHistory[i].content);
              chatHistory.push(localHistory[i]);
            }
            console.log('[App] Restored', localHistory.length, 'messages from local storage');
          } else {
            persistConvId(null);
          }
        });
    } else {
      // No server conversation — try local history restore
      const localHistory = restoreChatHistoryLocal();
      if (localHistory && localHistory.length > 0) {
        hideWelcome();
        const overlay = document.getElementById('chat-overlay');
        if (overlay) overlay.innerHTML = '';
        chatHistory = [];
        for (let i = 0; i < localHistory.length; i++) {
          addMessage(localHistory[i].role, localHistory[i].content);
          chatHistory.push(localHistory[i]);
        }
        console.log('[App] Restored', localHistory.length, 'messages from local storage');
      }
    }

    // ─── Mic button — voice-loop-message pipeline (ButtonBind handles click) ────────────
    // ButtonBind in index.html owns the click handler (uses cloneNode to avoid duplicates).
    // app.js only handles the voice pipeline events that need access to sendToAI/chatHistory.
    // Communication between ButtonBind and app.js happens via CustomEvents on window.
    (function () {
      let _usingRealtime = false;

      // ButtonBind dispatches 'mic-realtime-started' when KVoiceFirst connects
      window.addEventListener('mic-realtime-started', function () {
        _usingRealtime = true;
      });
      // ButtonBind dispatches 'mic-stopped' when mic is turned off
      window.addEventListener('mic-stopped', function () {
        _usingRealtime = false;
      });

      // Voice loop message → sendToAI (fallback pipeline when Realtime unavailable)
      window.addEventListener('voice-loop-message', async function (e) {
        if (_usingRealtime) return; // Realtime handles its own pipeline
        if (!e.detail || !e.detail.text) return;
        const text = e.detail.text.trim();
        if (!text) return;
        _voiceInitiated = true;
        if (window.KAvatar && KAvatar.setAttentive) KAvatar.setAttentive(true);
        addMessage('user', text);
        chatHistory.push({ role: 'user', content: text });
        showThinking(true);
        await sendToAI(text, window.KVoice ? KVoice.getLanguage() : 'en');
        if (window.KVoice && KVoice.resumeVoiceLoop) KVoice.resumeVoiceLoop();
      });

      // Loop stopped externally → notify ButtonBind via event
      window.addEventListener('voice-loop-stopped', function () {
        _usingRealtime = false;
        window.dispatchEvent(new CustomEvent('mic-state-changed', { detail: { active: false, realtime: false } }));
      });

      console.log('[App] Mic pipeline ready — ButtonBind handles click, app.js handles voice events');
    })();

    // ─── Dismiss splash loading overlay ─────────────────────
    clearTimeout(splashTimer);
    dismissSplash();

    // ─── Admin button — auto-detect via JWT ─────────
    (async function () {
      const un = document.getElementById('user-name');
      if (!un) return;

      // Try to auto-fetch admin secret via JWT (matches ADMIN_EMAIL on server)
      const savedSecret = sessionStorage.getItem('kelion_admin_secret');

      if (savedSecret) {
        // Admin detected — btn-admin-nav in navbar handles dashboard access
        console.log('[Admin] Auto-detected admin via JWT — use Admin button in navbar');
      }
      // user-name stays as simple display, no admin styling
    })();

    // ─── Admin credit alerts → avatar speaks them ─────────
    (function () {
      const secret = sessionStorage.getItem('kelion_admin_secret');
      if (!secret) return; // Not admin → skip

      // Check credit alerts after 5 seconds
      setTimeout(function () {
        fetch(API_BASE + '/api/admin/ai-status', {
          headers: { 'Content-Type': 'application/json', 'x-admin-secret': secret },
        })
          .then(function (r) {
            return r.ok ? r.json() : null;
          })
          .then(function (data) {
            if (!data || !data.providers) return;
            const alerts = data.providers.filter(function (p) {
              return p.alertLevel === 'red' || p.alertLevel === 'yellow';
            });
            if (alerts.length === 0) return;

            // Build alert message for avatar
            let msg = '⚠️ Admin Alert: ';
            alerts.forEach(function (a, i) {
              msg += a.name + ' — ' + a.alertMessage;
              if (i < alerts.length - 1) msg += '. ';
            });

            // Show via subtitle (like avatar speaking)
            const sub = document.getElementById('subtitle-text');
            if (sub) {
              sub.textContent = msg;
              sub.parentElement.style.display = 'block';
              // Auto-hide after 15 seconds
              setTimeout(function () {
                if (sub.textContent === msg) {
                  sub.parentElement.style.display = 'none';
                }
              }, 15000);
            }
            console.log('[Admin] Credit alerts:', alerts.length, 'issues found');
          })
          .catch(function () {
            /* silent */
          });
      }, 5000);
    })();

    console.log('[App] ✅ ' + ((window.APP_CONFIG && window.APP_CONFIG.appName) || 'KelionAI') + ' v2.5 — STREAMING + HISTORY');

    // ── Fetch deployed version and show in navbar ──
    fetch('/api/health')
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        const el = document.getElementById('app-version');
        if (el && d.version) el.textContent = 'v' + d.version;
      })
      .catch(function () {});

    // ── Show guest counter on load (hidden for logged-in / admin) ──
    const sess = { access_token: localStorage.getItem('kelion_token') };
    if (!sess.access_token && !(window.KAuth && KAuth.isAdmin && KAuth.isAdmin())) {
      const gc = document.getElementById('guest-counter');
      if (gc) {
        gc.style.display = 'inline';
        gc.textContent = 'Free';
        gc.style.color = '#8888aa';
      }
    }

    // ── E2E alias: btn-subscriptions → btn-pricing ──
    (function () {
      var bp = document.getElementById('btn-pricing');
      if (bp && !document.getElementById('btn-subscriptions')) {
        var alias = document.createElement('button');
        alias.id = 'btn-subscriptions';
        alias.textContent = 'Plans';
        alias.className = bp.className;
        alias.style.cssText = 'position:fixed;left:0;top:0;width:1px;height:1px;opacity:0.01;z-index:99999;pointer-events:auto;';
        alias.addEventListener('click', function () { bp.click(); });
        document.body.appendChild(alias);
      }
    })();
  }

  window.KApp = {};
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
