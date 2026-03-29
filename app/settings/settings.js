// ═══════════════════════════════════════════════════════════════
// KelionAI — Settings Page JS
// Preferences + Billing + Voice Clone (full UI)
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';
  var API = window.location.origin;
  var PREFS_KEY = 'kelion_settings';

  // ─────────────────────────────────────────────────────────────
  // PREFERENCES
  // ─────────────────────────────────────────────────────────────
  function loadPrefs() {
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function savePrefs(prefs) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
      showSaveFeedback();
    } catch (e) {}
  }

  function showSaveFeedback() {
    var el = document.getElementById('save-feedback');
    if (!el) return;
    el.classList.add('show');
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(function () {
      el.style.opacity = '0';
    }, 2000);
  }

  function applyPrefs(prefs) {
    var lang = document.getElementById('pref-language');
    var currentLang = (window.i18n ? i18n.getLanguage() : null) || prefs.language;
    if (lang && currentLang) lang.value = currentLang;

    var browser = document.getElementById('notif-browser');
    if (browser) browser.checked = !!prefs.notifBrowser;

    var sounds = document.getElementById('notif-sounds');
    if (sounds) sounds.checked = prefs.notifSounds !== false;
  }

  // ─────────────────────────────────────────────────────────────
  // BILLING
  // ─────────────────────────────────────────────────────────────
  async function loadBillingStatus() {
    try {
      var r = await fetch(API + '/api/payments/status', { headers: KShared.authHeaders() });
      if (!r.ok) return;
      var data = await r.json();
      var plan = data.plan || 'free';

      var badge = document.getElementById('plan-badge');
      var desc = document.getElementById('plan-desc');
      var upgradeBtn = document.getElementById('btn-upgrade');
      var billingRow = document.getElementById('billing-row');

      if (badge) {
        badge.textContent = plan.charAt(0).toUpperCase() + plan.slice(1);
        badge.className = 'plan-status-badge ' + plan;
      }
      if (desc) {
        if (plan === 'free') desc.textContent = 'Free plan — limited features';
        else if (plan === 'pro') desc.textContent = 'Pro plan — enhanced features';
        else if (plan === 'premium') desc.textContent = 'Premium plan — unlimited access';
      }
      if (plan !== 'free' && plan !== 'guest') {
        if (upgradeBtn) upgradeBtn.style.display = 'none';
        if (billingRow) billingRow.style.display = 'flex';
      }
    } catch (e) {}
  }

  // ─────────────────────────────────────────────────────────────
  // CALIBRATION TEXT — ElevenLabs-optimized
  // ─────────────────────────────────────────────────────────────
  var CALIBRATION_TEXTS = {
    ro: [
      'Bună ziua! Mă numesc și acesta este glasul meu. Vorbesc clar și rar, astfel încât sistemul să poată capta toate nuanțele vocii mele. Astăzi este o zi frumoasă, cerul este senin și soarele strălucește. Îmi place să citesc cărți, să ascult muzică și să petrec timp cu familia. Tehnologia modernă ne ajută să comunicăm mai ușor și mai eficient. Sper că această înregistrare va fi de bună calitate.',
      'Salut! Înregistrez vocea mea pentru a crea un profil vocal personalizat. Voi citi acest text cu voce naturală, fără a exagera. Unu, doi, trei — testez microfonul. Vremea de afară este plăcută. Calculatoarele și telefoanele inteligente fac parte din viața noastră de zi cu zi. Mulțumesc pentru atenție și sper că rezultatul va fi excelent.',
    ],
    en: [
      'Hello! My name is and this is my voice. I am speaking clearly and at a natural pace so the system can capture all the nuances of my voice. Today is a beautiful day, the sky is clear and the sun is shining. I enjoy reading books, listening to music, and spending time with family. Modern technology helps us communicate more easily and efficiently. I hope this recording will be of good quality.',
      'Hi there! I am recording my voice to create a personalized voice profile. I will read this text naturally without exaggerating. One, two, three — testing the microphone. The weather outside is pleasant. Computers and smartphones are part of our daily lives. Thank you for your attention and I hope the result will be excellent.',
    ],
    fr: [
      'Bonjour! Je m\'appelle et voici ma voix. Je parle clairement et à un rythme naturel pour que le système puisse capturer toutes les nuances de ma voix. Aujourd\'hui est une belle journée, le ciel est dégagé et le soleil brille. J\'aime lire des livres, écouter de la musique et passer du temps en famille. La technologie moderne nous aide à communiquer plus facilement.',
    ],
    de: [
      'Hallo! Mein Name ist und das ist meine Stimme. Ich spreche klar und in einem natürlichen Tempo, damit das System alle Nuancen meiner Stimme erfassen kann. Heute ist ein schöner Tag, der Himmel ist klar und die Sonne scheint. Ich lese gerne Bücher, höre Musik und verbringe Zeit mit der Familie. Moderne Technologie hilft uns, einfacher und effizienter zu kommunizieren.',
    ],
    es: [
      'Hola! Mi nombre es y esta es mi voz. Hablo con claridad y a un ritmo natural para que el sistema pueda capturar todos los matices de mi voz. Hoy es un día hermoso, el cielo está despejado y el sol brilla. Me gusta leer libros, escuchar música y pasar tiempo con la familia. La tecnología moderna nos ayuda a comunicarnos de manera más fácil y eficiente.',
    ],
  };

  var _calibrationIndex = 0;

  function getCalibrationText() {
    var lang = (window.i18n && i18n.getLanguage ? i18n.getLanguage() : null) || 'en';
    var code = lang.toLowerCase().split('-')[0];
    var texts = CALIBRATION_TEXTS[code] || CALIBRATION_TEXTS['en'];
    return texts[_calibrationIndex % texts.length];
  }

  function renderCalibrationText() {
    var box = document.getElementById('calibration-text-box');
    if (box) box.textContent = getCalibrationText();
  }

  // ─────────────────────────────────────────────────────────────
  // RECORDER
  // ─────────────────────────────────────────────────────────────
  var _mediaRecorder = null;
  var _recordedChunks = [];
  var _recordedBlob = null;
  var _recordingStart = 0;
  var _timerInterval = null;
  var _analyser = null;
  var _recAudioCtx = null;
  var _animFrame = null;

  function formatTime(ms) {
    var s = Math.floor(ms / 1000);
    var m = Math.floor(s / 60);
    s = s % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function startRecording() {
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 44100 } })
      .then(function (stream) {
        _recordedChunks = [];
        _recordedBlob = null;

        // Setup analyser for waveform
        _recAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
        var source = _recAudioCtx.createMediaStreamSource(stream);
        _analyser = _recAudioCtx.createAnalyser();
        _analyser.fftSize = 256;
        source.connect(_analyser);
        drawWaveform();

        // MediaRecorder
        var mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
          ? 'audio/webm;codecs=opus'
          : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';

        _mediaRecorder = new MediaRecorder(stream, { mimeType: mimeType });
        _mediaRecorder.ondataavailable = function (e) {
          if (e.data && e.data.size > 0) _recordedChunks.push(e.data);
        };
        _mediaRecorder.onstop = function () {
          _recordedBlob = new Blob(_recordedChunks, { type: mimeType });
          stream.getTracks().forEach(function (t) { t.stop(); });
          if (_recAudioCtx) { _recAudioCtx.close(); _recAudioCtx = null; }
          if (_animFrame) { cancelAnimationFrame(_animFrame); _animFrame = null; }
          onRecordingComplete();
        };

        _mediaRecorder.start(100);
        _recordingStart = Date.now();

        // Timer
        var timerEl = document.getElementById('rec-timer');
        _timerInterval = setInterval(function () {
          if (timerEl) timerEl.textContent = formatTime(Date.now() - _recordingStart);
        }, 500);

        // UI state: recording
        setRecordingUI(true);
      })
      .catch(function (e) {
        alert('Microphone access denied: ' + e.message);
      });
  }

  function stopRecording() {
    if (_mediaRecorder && _mediaRecorder.state !== 'inactive') {
      _mediaRecorder.stop();
    }
    clearInterval(_timerInterval);
    setRecordingUI(false);
  }

  function setRecordingUI(recording) {
    var startBtn = document.getElementById('btn-record-start');
    var stopBtn = document.getElementById('btn-record-stop');
    var canvas = document.getElementById('rec-canvas');
    var idle = document.getElementById('rec-waveform-idle');

    if (recording) {
      if (startBtn) { startBtn.style.display = 'none'; startBtn.classList.add('recording'); }
      if (stopBtn) stopBtn.style.display = 'inline-flex';
      if (canvas) canvas.style.display = 'block';
      if (idle) idle.style.display = 'none';
    } else {
      if (startBtn) { startBtn.style.display = 'inline-flex'; startBtn.classList.remove('recording'); }
      if (stopBtn) stopBtn.style.display = 'none';
    }
  }

  function onRecordingComplete() {
    var durationMs = Date.now() - _recordingStart;
    var timerEl = document.getElementById('rec-timer');
    if (timerEl) timerEl.textContent = formatTime(durationMs);

    var canvas = document.getElementById('rec-canvas');
    var idle = document.getElementById('rec-waveform-idle');
    if (canvas) canvas.style.display = 'none';
    if (idle) { idle.style.display = 'block'; idle.textContent = '✅ Recording complete — ' + formatTime(durationMs); idle.style.color = '#10b981'; }

    var playBtn = document.getElementById('btn-record-play');
    var clearBtn = document.getElementById('btn-record-clear');
    if (playBtn) playBtn.style.display = 'inline-flex';
    if (clearBtn) clearBtn.style.display = 'inline-flex';

    // Show duration warning if too short
    var warn = document.getElementById('rec-duration-warn');
    if (warn) warn.style.display = durationMs < 25000 ? 'block' : 'none';

    // Show save form
    var saveRow = document.getElementById('voice-save-row');
    if (saveRow) saveRow.style.display = 'flex';
  }

  function drawWaveform() {
    if (!_analyser) return;
    var canvas = document.getElementById('rec-canvas');
    if (!canvas) return;
    var ctx = canvas.getContext('2d');
    var bufferLength = _analyser.frequencyBinCount;
    var dataArray = new Uint8Array(bufferLength);

    function draw() {
      _animFrame = requestAnimationFrame(draw);
      _analyser.getByteTimeDomainData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = 'rgba(99,102,241,0.06)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#6366f1';
      ctx.beginPath();
      var sliceWidth = canvas.width / bufferLength;
      var x = 0;
      for (var i = 0; i < bufferLength; i++) {
        var v = dataArray[i] / 128.0;
        var y = (v * canvas.height) / 2;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
        x += sliceWidth;
      }
      ctx.lineTo(canvas.width, canvas.height / 2);
      ctx.stroke();
    }
    draw();
  }

  function clearRecording() {
    _recordedBlob = null;
    _recordedChunks = [];
    _recordingStart = 0;

    var timerEl = document.getElementById('rec-timer');
    if (timerEl) timerEl.textContent = '0:00';

    var canvas = document.getElementById('rec-canvas');
    var idle = document.getElementById('rec-waveform-idle');
    if (canvas) canvas.style.display = 'none';
    if (idle) { idle.style.display = 'block'; idle.textContent = 'Press Record to start'; idle.style.color = '#555'; }

    var playBtn = document.getElementById('btn-record-play');
    var clearBtn = document.getElementById('btn-record-clear');
    if (playBtn) playBtn.style.display = 'none';
    if (clearBtn) clearBtn.style.display = 'none';

    var saveRow = document.getElementById('voice-save-row');
    if (saveRow) saveRow.style.display = 'none';

    var warn = document.getElementById('rec-duration-warn');
    if (warn) warn.style.display = 'none';

    var cloneErr = document.getElementById('clone-error');
    var cloneOk = document.getElementById('clone-success');
    if (cloneErr) { cloneErr.style.display = 'none'; cloneErr.textContent = ''; }
    if (cloneOk) { cloneOk.style.display = 'none'; cloneOk.textContent = ''; }
  }

  function previewRecording() {
    if (!_recordedBlob) return;
    var url = URL.createObjectURL(_recordedBlob);
    var audio = new Audio(url);
    audio.onended = function () { URL.revokeObjectURL(url); };
    audio.play().catch(function () { URL.revokeObjectURL(url); });
  }

  // ─────────────────────────────────────────────────────────────
  // UPLOAD & CLONE
  // ─────────────────────────────────────────────────────────────
  async function uploadAndClone() {
    if (!_recordedBlob) {
      showCloneError('No recording found. Please record your voice first.');
      return;
    }

    var nameInput = document.getElementById('voice-name-input');
    var name = nameInput ? nameInput.value.trim() : '';
    if (!name) {
      name = 'My Voice ' + new Date().toLocaleDateString();
    }

    var uploadBtn = document.getElementById('btn-clone-upload');
    var progress = document.getElementById('clone-progress');
    var errEl = document.getElementById('clone-error');
    var okEl = document.getElementById('clone-success');

    if (uploadBtn) uploadBtn.disabled = true;
    if (progress) progress.style.display = 'block';
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
    if (okEl) { okEl.style.display = 'none'; okEl.textContent = ''; }

    try {
      var formData = new FormData();
      var ext = _recordedBlob.type.includes('webm') ? 'webm' : _recordedBlob.type.includes('wav') ? 'wav' : 'mp3';
      formData.append('audio', _recordedBlob, 'voice_sample.' + ext);
      formData.append('name', name);
      formData.append('description', 'Voice cloned via KelionAI Settings');

      var headers = {};
      if (window.KAuth && KAuth.getAuthHeaders) {
        var ah = KAuth.getAuthHeaders();
        // Don't set Content-Type for FormData (browser sets it with boundary)
        if (ah.Authorization) headers.Authorization = ah.Authorization;
        if (ah['x-session-token']) headers['x-session-token'] = ah['x-session-token'];
      }

      var r = await fetch(API + '/api/voice/clone', {
        method: 'POST',
        headers: headers,
        body: formData,
      });

      var data = await r.json();

      if (progress) progress.style.display = 'none';

      if (!r.ok || data.error) {
        showCloneError(data.error || 'Cloning failed. Please try again.');
      } else {
        if (okEl) {
          okEl.textContent = '✅ ' + (data.message || 'Voice cloned successfully!');
          okEl.style.display = 'block';
        }
        clearRecording();
        if (nameInput) nameInput.value = '';
        // Reload voices list
        setTimeout(loadVoiceList, 1000);
      }
    } catch (e) {
      if (progress) progress.style.display = 'none';
      showCloneError('Network error: ' + e.message);
    } finally {
      if (uploadBtn) uploadBtn.disabled = false;
    }
  }

  function showCloneError(msg) {
    var errEl = document.getElementById('clone-error');
    if (errEl) { errEl.textContent = '❌ ' + msg; errEl.style.display = 'block'; }
  }

  // ─────────────────────────────────────────────────────────────
  // VOICE LIST
  // ─────────────────────────────────────────────────────────────
  async function loadVoiceList() {
    var listEl = document.getElementById('voice-list');
    var activeBadge = document.getElementById('active-voice-badge');
    var activeDesc = document.getElementById('active-voice-desc');
    if (!listEl) return;

    listEl.innerHTML = '<div style="color:#555;font-size:0.82rem;text-align:center;padding:12px;">Loading...</div>';

    try {
      var headers = window.KAuth && KAuth.getAuthHeaders ? KAuth.getAuthHeaders() : {};
      var r = await fetch(API + '/api/voice/clone', { headers: headers });
      if (!r.ok) {
        if (r.status === 401) {
          listEl.innerHTML = '<div style="color:#666;font-size:0.82rem;text-align:center;padding:12px;">Sign in to manage cloned voices</div>';
          return;
        }
        throw new Error('HTTP ' + r.status);
      }
      var data = await r.json();
      var voices = data.voices || [];

      if (voices.length === 0) {
        listEl.innerHTML = '<div style="color:#555;font-size:0.82rem;text-align:center;padding:12px;">No cloned voices yet — record your voice above to get started!</div>';
        if (activeBadge) { activeBadge.textContent = 'Default'; activeBadge.style.background = 'rgba(16,185,129,0.12)'; activeBadge.style.color = '#10b981'; }
        if (activeDesc) activeDesc.textContent = 'Using default avatar voice';
        return;
      }

      listEl.innerHTML = '';
      var activeVoice = voices.find(function (v) { return v.isActive; });

      if (activeVoice) {
        if (activeBadge) { activeBadge.textContent = activeVoice.name; activeBadge.style.background = 'rgba(99,102,241,0.15)'; activeBadge.style.color = '#a5b4fc'; }
        if (activeDesc) activeDesc.textContent = 'Using your cloned voice: ' + activeVoice.name;
      } else {
        if (activeBadge) { activeBadge.textContent = 'Default'; activeBadge.style.background = 'rgba(16,185,129,0.12)'; activeBadge.style.color = '#10b981'; }
        if (activeDesc) activeDesc.textContent = 'Using default avatar voice';
      }

      voices.forEach(function (voice) {
        var card = document.createElement('div');
        card.className = 'voice-card' + (voice.isActive ? ' active-voice' : '');
        var date = voice.createdAt ? new Date(voice.createdAt).toLocaleDateString() : '';
        var dur = voice.durationSec ? voice.durationSec + 's sample' : '';
        var meta = [date, dur].filter(Boolean).join(' · ');

        card.innerHTML =
          '<div style="font-size:1.4rem;flex-shrink:0;">' + (voice.isActive ? '🟢' : '🎤') + '</div>' +
          '<div class="voice-card-info">' +
            '<div class="voice-card-name">' + escapeHtml(voice.name) + '</div>' +
            '<div class="voice-card-meta">' + escapeHtml(meta) + (voice.isActive ? ' · <span style="color:#10b981;font-weight:600;">Active</span>' : '') + '</div>' +
          '</div>' +
          '<div class="voice-card-actions">' +
            (voice.isActive
              ? '<button class="voice-action-btn deactivate" data-id="' + voice.id + '" data-action="deactivate">Use Default</button>'
              : '<button class="voice-action-btn activate" data-id="' + voice.id + '" data-action="activate">Activate</button>'
            ) +
            '<button class="voice-action-btn delete" data-id="' + voice.id + '" data-action="delete">Delete</button>' +
          '</div>';

        listEl.appendChild(card);
      });

      // Bind action buttons
      listEl.querySelectorAll('[data-action]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = this.dataset.id;
          var action = this.dataset.action;
          handleVoiceAction(id, action);
        });
      });

    } catch (e) {
      listEl.innerHTML = '<div style="color:#f87171;font-size:0.82rem;text-align:center;padding:12px;">Failed to load voices: ' + escapeHtml(e.message) + '</div>';
    }
  }

  async function handleVoiceAction(id, action) {
    var headers = Object.assign({ 'Content-Type': 'application/json' }, window.KAuth && KAuth.getAuthHeaders ? KAuth.getAuthHeaders() : {});

    try {
      if (action === 'delete') {
        if (!confirm('Delete this cloned voice? This cannot be undone.')) return;
        var r = await fetch(API + '/api/voice/clone/' + id, { method: 'DELETE', headers: headers });
        if (!r.ok) throw new Error('Delete failed');
      } else if (action === 'activate') {
        var r2 = await fetch(API + '/api/voice/clone/' + id + '/activate', { method: 'PATCH', headers: headers });
        if (!r2.ok) throw new Error('Activate failed');
      } else if (action === 'deactivate') {
        var r3 = await fetch(API + '/api/voice/clone/' + id + '/deactivate', { method: 'PATCH', headers: headers });
        if (!r3.ok) throw new Error('Deactivate failed');
      }
      loadVoiceList();
    } catch (e) {
      alert('Error: ' + e.message);
    }
  }

  function escapeHtml(s) {
    var div = document.createElement('div');
    div.textContent = String(s || '');
    return div.innerHTML;
  }

  // ─────────────────────────────────────────────────────────────
  // EVENT BINDINGS
  // ─────────────────────────────────────────────────────────────
  function bindEvents() {
    var prefs = loadPrefs();

    // Language
    var lang = document.getElementById('pref-language');
    if (lang) {
      lang.addEventListener('change', function () {
        prefs.language = this.value;
        savePrefs(prefs);
        if (window.i18n) i18n.setLanguage(this.value);
        renderCalibrationText();
      });
    }

    // Notifications
    var browser = document.getElementById('notif-browser');
    if (browser) {
      browser.addEventListener('change', function () {
        prefs.notifBrowser = this.checked;
        if (this.checked && 'Notification' in window && Notification.permission === 'default') {
          Notification.requestPermission();
        }
        savePrefs(prefs);
      });
    }

    var sounds = document.getElementById('notif-sounds');
    if (sounds) {
      sounds.addEventListener('change', function () {
        prefs.notifSounds = this.checked;
        savePrefs(prefs);
      });
    }

    // Billing portal
    var portal = document.getElementById('btn-portal');
    if (portal) {
      portal.addEventListener('click', async function () {
        try {
          var r = await fetch(API + '/api/payments/portal', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, KShared.authHeaders()),
          });
          var d = await r.json();
          if (d.url) window.location.href = d.url;
        } catch (e) {}
      });
    }

    // ── Voice Clone events ──

    // Calibration copy
    var copyBtn = document.getElementById('btn-copy-calibration');
    if (copyBtn) {
      copyBtn.addEventListener('click', function () {
        var box = document.getElementById('calibration-text-box');
        if (box && navigator.clipboard) {
          navigator.clipboard.writeText(box.textContent).then(function () {
            copyBtn.textContent = '✅ Copied!';
            setTimeout(function () { copyBtn.textContent = '📋 Copy text'; }, 2000);
          });
        }
      });
    }

    // Calibration refresh
    var refreshCalBtn = document.getElementById('btn-refresh-calibration');
    if (refreshCalBtn) {
      refreshCalBtn.addEventListener('click', function () {
        _calibrationIndex++;
        renderCalibrationText();
      });
    }

    // Record start
    var recStartBtn = document.getElementById('btn-record-start');
    if (recStartBtn) {
      recStartBtn.addEventListener('click', function () {
        startRecording();
      });
    }

    // Record stop
    var recStopBtn = document.getElementById('btn-record-stop');
    if (recStopBtn) {
      recStopBtn.addEventListener('click', function () {
        stopRecording();
      });
    }

    // Preview
    var playBtn = document.getElementById('btn-record-play');
    if (playBtn) {
      playBtn.addEventListener('click', function () {
        previewRecording();
      });
    }

    // Clear
    var clearBtn = document.getElementById('btn-record-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', function () {
        clearRecording();
      });
    }

    // Clone upload
    var cloneBtn = document.getElementById('btn-clone-upload');
    if (cloneBtn) {
      cloneBtn.addEventListener('click', function () {
        uploadAndClone();
      });
    }

    // Refresh voice list
    var refreshVoicesBtn = document.getElementById('btn-refresh-voices');
    if (refreshVoicesBtn) {
      refreshVoicesBtn.addEventListener('click', function () {
        loadVoiceList();
      });
    }

    // Voice name input — Enter key
    var voiceNameInput = document.getElementById('voice-name-input');
    if (voiceNameInput) {
      voiceNameInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); uploadAndClone(); }
      });
    }
  }

  // ─────────────────────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────────────────────
  function init() {
    var prefs = loadPrefs();
    applyPrefs(prefs);
    bindEvents();
    loadBillingStatus();
    renderCalibrationText();
    loadVoiceList();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();