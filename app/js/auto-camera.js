// ═══════════════════════════════════════════════════════════════
// App — Auto-Camera Vision
// Captures camera frame automatically with each chat message
// So Kelion can always "see" the user (especially for blind users!)
// Also provides face tracking for avatar eye contact
// Button is in index.html — this module handles the camera logic
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  let _stream = null;
  let _video = null;
  let _canvas = null;
  let _enabled = false;
  let _permissionGranted = false;

  // Face tracking
  let _faceDetector = null;
  let _faceTrackInterval = null;
  let _trackCanvas = null;
  let _trackCtx = null;
  let _prevFrame = null;
  let _starting = false;

  const CAPTURE_WIDTH = 1280;
  const CAPTURE_HEIGHT = 720;
  const JPEG_QUALITY = 0.8;
  const FACE_TRACK_MS = 150; // face tracking interval (ms)

  // Live vision presets
  const FAST_CAPTURE_W = 640;
  const FAST_CAPTURE_H = 360;
  const FAST_CAPTURE_Q = 0.62;
  const DEEP_CAPTURE_W = 1280;
  const DEEP_CAPTURE_H = 720;
  const DEEP_CAPTURE_Q = 0.82;

  function emitState(error) {
    window.dispatchEvent(
      new CustomEvent('auto-camera-state', {
        detail: {
          active: _enabled && !!_stream,
          permissionGranted: _permissionGranted,
          starting: _starting,
          error: error || null,
        },
      })
    );
  }

  /**
   * Initialize hidden video + canvas elements
   */
  function init() {
    if (_video) return;

    _video = document.createElement('video');
    _video.setAttribute('autoplay', '');
    _video.setAttribute('playsinline', '');
    _video.setAttribute('muted', '');
    _video.muted = true; // prevent feedback
    // Append to DOM as a PiP preview so user sees it's active
    _video.id = 'auto-camera-preview';
    _video.style.position = 'absolute';
    _video.style.bottom = '80px';
    _video.style.left = '20px';
    _video.style.width = '120px';
    _video.style.height = '160px';
    _video.style.objectFit = 'cover';
    _video.style.borderRadius = '12px';
    _video.style.border = '2px solid rgba(255,255,255,0.2)';
    _video.style.boxShadow = '0 4px 12px rgba(0,0,0,0.5)';
    _video.style.zIndex = '9999';
    _video.style.transform = 'scaleX(-1)'; // mirror
    _video.style.display = 'none'; // strictly hidden
    _video.style.visibility = 'hidden';
    _video.style.opacity = '0';
    _video.style.pointerEvents = 'none'; // don't block clicks

    // Add to body unless there's a specific wrapper
    const wrapper = document.querySelector('.main-wrapper') || document.body;
    wrapper.appendChild(_video);

    _canvas = document.createElement('canvas');
    _canvas.width = CAPTURE_WIDTH;
    _canvas.height = CAPTURE_HEIGHT;
    _canvas.style.display = 'none';
    document.body.appendChild(_canvas);

    // Tracking canvas (smaller for performance)
    _trackCanvas = document.createElement('canvas');
    _trackCanvas.width = 160;
    _trackCanvas.height = 120;
    _trackCtx = _trackCanvas.getContext('2d', { willReadFrequently: true });

    // Try browser FaceDetector API (Chrome)
    try {
      if (typeof FaceDetector !== 'undefined') {
        _faceDetector = new FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
        console.log('[AutoCamera] ✅ Browser FaceDetector available');
      }
    } catch (_e) {
      /* not available */
    }

    console.log('[AutoCamera] Initialized');
  }

  /**
   * Request camera permission and start stream
   */
  async function requestPermission() {
    if (_permissionGranted && _stream) return true;

    try {
      _starting = true;
      emitState();
      init();
      _stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: CAPTURE_WIDTH },
          height: { ideal: CAPTURE_HEIGHT },
          facingMode: 'user',
        },
        audio: false,
      });
      _video.srcObject = _stream;
      await _video.play();
      _permissionGranted = true;
      _enabled = true;
      _starting = false;
      // ALWAYS HIDDEN FOR ZERO-TEXT UI (Pip removed)
      console.log('[AutoCamera] ✅ Camera active');

      // Start face tracking loop
      startFaceTracking();

      // Start live vision analysis
      startLiveVision();

      emitState();

      return true;
    } catch (e) {
      console.warn('[AutoCamera] ❌ Permission denied:', e.message);
      _starting = false;
      _permissionGranted = false;
      _enabled = false;
      emitState(e.message);
      return false;
    }
  }

  /**
   * Face tracking loop — detects face position and dispatches events
   */
  function startFaceTracking() {
    if (_faceTrackInterval) return;
    _faceTrackInterval = setInterval(trackFace, FACE_TRACK_MS);
    console.log('[AutoCamera] 👁️ Face tracking started');
  }

  function stopFaceTracking() {
    if (_faceTrackInterval) {
      clearInterval(_faceTrackInterval);
      _faceTrackInterval = null;
    }
    _prevFrame = null;
  }

  /**
   * Detect face position — tries FaceDetector API, falls back to motion tracking
   */
  async function trackFace() {
    if (!_enabled || !_video || _video.readyState < 2) return;

    // Method 1: Browser FaceDetector API (Chrome, Android)
    if (_faceDetector) {
      try {
        const faces = await _faceDetector.detect(_video);
        if (faces.length > 0) {
          const box = faces[0].boundingBox;
          const vw = _video.videoWidth || CAPTURE_WIDTH;
          const vh = _video.videoHeight || CAPTURE_HEIGHT;
          const centerX = box.x + box.width / 2;
          const centerY = box.y + box.height / 2;
          // Normalize to -1..1, mirror X (front camera)
          const nx = -((centerX / vw) * 2 - 1);
          const ny = -((centerY / vh) * 2 - 1);
          dispatchFacePosition(nx, ny);
          return;
        }
      } catch (_e) {
        // FaceDetector failed, fall through to motion tracking
        _faceDetector = null;
        console.log('[AutoCamera] FaceDetector unavailable, using motion fallback');
      }
    }

    // Method 2: Motion-based center tracking (no ML needed)
    // Draws small frame, compares with previous, finds center of motion
    try {
      const tw = _trackCanvas.width;
      const th = _trackCanvas.height;
      _trackCtx.drawImage(_video, 0, 0, tw, th);
      const currentFrame = _trackCtx.getImageData(0, 0, tw, th);

      if (_prevFrame) {
        let sumX = 0,
          sumY = 0,
          sumW = 0;
        const curr = currentFrame.data;
        const prev = _prevFrame.data;
        // Sample every 4th pixel for speed
        for (let y = 0; y < th; y += 2) {
          for (let x = 0; x < tw; x += 2) {
            const i = (y * tw + x) * 4;
            const diff =
              Math.abs(curr[i] - prev[i]) + Math.abs(curr[i + 1] - prev[i + 1]) + Math.abs(curr[i + 2] - prev[i + 2]);
            if (diff > 60) {
              // motion threshold
              // Weight by luminance (faces are usually brighter)
              const lum = curr[i] * 0.3 + curr[i + 1] * 0.6 + curr[i + 2] * 0.1;
              const w = diff * (lum / 255);
              sumX += x * w;
              sumY += y * w;
              sumW += w;
            }
          }
        }
        if (sumW > 500) {
          // enough motion detected
          const cx = sumX / sumW;
          const cy = sumY / sumW;
          // Normalize to -1..1, mirror X
          const nx = -((cx / tw) * 2 - 1);
          const ny = -((cy / th) * 2 - 1);
          dispatchFacePosition(nx, ny);
        }
      }
      _prevFrame = currentFrame;
    } catch (_e) {
      /* ignored */
    }
  }

  /**
   * Dispatch face position event for avatar eye tracking
   */
  function dispatchFacePosition(x, y) {
    window.dispatchEvent(
      new CustomEvent('face-position', {
        detail: { x: x, y: y },
      })
    );
  }

  /**
   * Capture a single frame (photo)
   */
  function captureFrame() {
    if (!_enabled || !_stream || !_video || !_canvas) return null;
    if (_video.readyState < 2) return null;

    try {
      const ctx = _canvas.getContext('2d');
      ctx.drawImage(_video, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
      const dataUrl = _canvas.toDataURL('image/jpeg', JPEG_QUALITY);
      const base64 = dataUrl.split(',')[1];
      return { base64, mimeType: 'image/jpeg' };
    } catch (e) {
      console.warn('[AutoCamera] Capture failed:', e.message);
      return null;
    }
  }

  /**
   * Stop the camera stream
   */
  function stop() {
    stopFaceTracking();
    stopLiveVision();
    if (_stream) {
      _stream.getTracks().forEach((t) => {
        t.stop();
        t.enabled = false;
      });
      _stream = null;
    }
    if (_video) {
      _video.srcObject = null;
    }
    _enabled = false;
    console.log('[AutoCamera] Camera stopped');
    emitState();
  }

  /**
   * Toggle auto-camera on/off
   */
  async function toggle() {
    if (_enabled) {
      stop();
      return false;
    } else {
      return await requestPermission();
    }
  }

  /**
   * Check if auto-camera is active
   */
  function isActive() {
    return _enabled && _permissionGranted && !!_stream;
  }

  function isStarting() {
    return _starting;
  }

  // Camera is OFF by default — user must click btn-camera to start.
  // Just init hidden elements, no auto-start.
  function initOnly() {
    init();
    console.log('[AutoCamera] Initialized — camera OFF by default, click button to start');
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initOnly);
  } else {
    initOnly();
  }

  let _facingMode = 'user'; // 'user' = front, 'environment' = back

  /**
   * Switch between front and back camera
   */
  async function switchCamera() {
    const wasFaceTracking = !!_faceTrackInterval;
    stop();
    _facingMode = _facingMode === 'user' ? 'environment' : 'user';
    try {
      init();
      _stream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: CAPTURE_WIDTH },
          height: { ideal: CAPTURE_HEIGHT },
          facingMode: _facingMode,
        },
        audio: false,
      });
      _video.srcObject = _stream;
      await _video.play();
      _permissionGranted = true;
      _enabled = true;
      console.log('[AutoCamera] Switched to', _facingMode === 'user' ? 'front' : 'back', 'camera');
      if (wasFaceTracking && _facingMode === 'user') startFaceTracking();
      return _facingMode;
    } catch (e) {
      console.warn('[AutoCamera] Switch failed:', e.message);
      _facingMode = 'user'; // revert
      return null;
    }
  }

  // ═══════════════════════════════════════════════════════════
  // DUAL-TIER LIVE VISION — professional safety system
  // FAST (1s): GPT-5.4 Vision danger scan → instant TTS alert
  // DEEP (5s): GPT-5.4 Vision full analysis → brain context
  // ═══════════════════════════════════════════════════════════
  let _fastInterval = null;
  let _deepInterval = null;
  let _lastVision = null;      // { description, timestamp }
  let _fastBusy = false;
  let _deepBusy = false;
  const FAST_INTERVAL_MS = 1000;  // danger scan every 1 second
  const DEEP_INTERVAL_MS = 2500;  // full analysis every 2.5 seconds

  function _captureForVision(width, height, quality) {
    if (!_enabled || !_stream || !_video) return null;
    if (_video.readyState < 2) return null;
    try {
      var c = document.createElement('canvas');
      c.width = width;
      c.height = height;
      var ctx = c.getContext('2d');
      ctx.drawImage(_video, 0, 0, width, height);
      var url = c.toDataURL('image/jpeg', quality);
      return url.split(',')[1];
    } catch (_e) { return null; }
  }

  function _visionHeaders() {
    var headers = { 'Content-Type': 'application/json' };
    try {
      if (window.KAuth && KAuth.getAuthHeaders) {
        var auth = KAuth.getAuthHeaders();
        if (auth && auth.Authorization) headers.Authorization = auth.Authorization;
      }
    } catch (_e) {
      /* fallback below */
    }
    if (!headers.Authorization) {
      var token = localStorage.getItem('kelion_token') || localStorage.getItem('sb-token') || '';
      if (token) headers.Authorization = 'Bearer ' + token;
    }
    return headers;
  }

  // ── Danger detection keywords ──
  var DANGER_IMMEDIATE = /⚠️PERICOL/i;
  var DANGER_WARNING   = /⚠️ATENȚIE|🚫BLOCAT/i;
  var _lastDangerSpoken = 0;
  var DANGER_COOLDOWN_MS = 5000; // don't repeat same danger alert within 5s

  function _checkDanger(desc) {
    if (!desc) return null;
    if (DANGER_IMMEDIATE.test(desc)) return 'immediate';
    if (DANGER_WARNING.test(desc)) return 'warning';
    return null;
  }

  function _getUserFirstName() {
    try {
      var raw = localStorage.getItem('kelion_user');
      if (raw) {
        var u = JSON.parse(raw);
        if (u && u.name) return u.name.split(' ')[0];
      }
    } catch (_e) { /* ignore */ }
    return '';
  }

  function _speakDanger(desc, level) {
    var now = Date.now();
    if (now - _lastDangerSpoken < DANGER_COOLDOWN_MS) return;
    _lastDangerSpoken = now;
    // Extract just the danger line
    var lines = desc.split(/[.!\n]/);
    var dangerLine = '';
    for (var i = 0; i < lines.length; i++) {
      if (/⚠️/.test(lines[i])) { dangerLine = lines[i].trim(); break; }
    }
    if (!dangerLine) dangerLine = desc.substring(0, 80);
    // Build short safety-first phrase: "Atenție, scaun stânga" / "Scări în față"
    var clean = dangerLine
      .replace(/⚠️PERICOL:\s*/i, '')
      .replace(/⚠️ATENȚIE:\s*/i, '')
      .replace(/🚫BLOCAT:\s*/i, '')
      .trim();

    // Try to extract hazard + direction + short distance from free text
    var cleanLow = clean.toLowerCase();
    var dir = '';
    if (/\b(st[âa]nga|stinga)\b/.test(cleanLow)) dir = 'stânga';
    else if (/\b(dreapta)\b/.test(cleanLow)) dir = 'dreapta';
    else if (/\b([îi]n\s+fa[țt]a|in\s+fata|fa[țt][ăa])\b/.test(cleanLow)) dir = 'în față';
    else if (/\b([îi]n\s+spate|in\s+spate)\b/.test(cleanLow)) dir = 'în spate';

    var hazardMatch = cleanLow.match(/\b(sc[ăa]ri|treapt[ăa]|bordur[ăa]|ma[șs]in[ăa]|autobuz|camion|biciclet[ăa]|trotinet[ăa]|persoan[ăa]|om|c[âa]ine|u[șs][ăa]|obstacol|st[âa]lp|groap[ăa]|gaur[ăa]|cablu|foc|sticl[ăa]|scaun|mas[ăa]|zid|perete)\b/);
    var hazard = hazardMatch ? hazardMatch[1] : 'obstacol';

    var distMatch = cleanLow.match(/\b(la\s*~?\s*\d+\s*(m|metri?)|la\s+un\s+pas|chiar\s+l[âa]ng[ăa]\s+tine)\b/);
    var dist = distMatch ? distMatch[1].replace(/\s+/g, ' ').trim() : '';

    var phrase = '';
    if (level === 'immediate') {
      phrase = 'Atenție, ' + hazard;
    } else {
      phrase = hazard.charAt(0).toUpperCase() + hazard.slice(1);
    }
    if (dir) phrase += ' ' + dir;
    if (dist) phrase += ', ' + dist;

    var firstName = _getUserFirstName();
    var spokenText = (firstName ? firstName + ', ' : '') + phrase;
    // Dispatch danger event for brain/UI
    window.dispatchEvent(new CustomEvent('live-vision-danger', {
      detail: { level: level, message: dangerLine, spokenText: spokenText, timestamp: now }
    }));
    // Immediate TTS — calm voice, not rushed
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel(); // interrupt anything playing
      var utter = new SpeechSynthesisUtterance(spokenText);
      utter.rate = 1.0; // calm speed, not rushed
      utter.pitch = 1.0; // normal pitch, reassuring
      utter.volume = 1;
      utter.lang = (window.i18n && i18n.getLanguage) ? i18n.getLanguage() : 'ro';
      window.speechSynthesis.speak(utter);
    }
    console.warn('[AutoCamera] ⚠️ DANGER (' + level + '):', spokenText);
  }

  // ── FAST: Danger-only scan (GPT-5.4, 1s interval) ──
  async function _fastScan() {
    if (_fastBusy || !_enabled) return;
    var base64 = _captureForVision(FAST_CAPTURE_W, FAST_CAPTURE_H, FAST_CAPTURE_Q);
    if (!base64) return;
    _fastBusy = true;
    try {
      var res = await fetch('/api/vision/fast', {
        method: 'POST',
        headers: _visionHeaders(),
        body: JSON.stringify({
          image: base64,
          language: window.i18n ? i18n.getLanguage() : 'ro',
        }),
      });
      if (res.ok) {
        var data = await res.json();
        var result = (data.result || '').trim();
        // Only act on danger results (not ✅)
        if (result && result !== '✅') {
          var dangerLevel = _checkDanger(result) || 'warning';
          _speakDanger(result, dangerLevel);
          console.warn('[AutoCamera] ⚡ FAST danger:', result);
        }
      }
    } catch (e) {
      // Silent fail — don't interrupt user
    } finally {
      _fastBusy = false;
    }
  }

  // ── DEEP: Full analysis (GPT-5.4, 5s interval) ──
  async function _deepAnalysis() {
    if (_deepBusy || !_enabled) return;
    var base64 = _captureForVision(DEEP_CAPTURE_W, DEEP_CAPTURE_H, DEEP_CAPTURE_Q);
    if (!base64) return;
    _deepBusy = true;
    try {
      var res = await fetch('/api/vision', {
        method: 'POST',
        headers: _visionHeaders(),
        body: JSON.stringify({
          image: base64,
          avatar: window.KAvatar && KAvatar.getCurrentAvatar ? KAvatar.getCurrentAvatar() : 'kelion',
          language: window.i18n ? i18n.getLanguage() : 'ro',
          fingerprint: window._visitorFP || null,
        }),
      });
      if (res.ok) {
        var data = await res.json();
        if (data.description) {
          _lastVision = { description: data.description, timestamp: Date.now() };
          window.dispatchEvent(new CustomEvent('live-vision-update', { detail: _lastVision }));
          // Deep analysis also checks danger (backup for fast scan)
          var dangerLevel = _checkDanger(data.description);
          if (dangerLevel) {
            _speakDanger(data.description, dangerLevel);
          }
          console.log('[AutoCamera] 🔍 Deep vision:', data.description.substring(0, 80) + '...');
        }
      }
    } catch (e) {
      console.warn('[AutoCamera] Deep vision error:', e.message);
    } finally {
      _deepBusy = false;
    }
  }

  function startLiveVision() {
    if (_fastInterval) return;
    // FAST tier: danger scan every 1s
    _fastInterval = setInterval(_fastScan, FAST_INTERVAL_MS);
    // DEEP tier: full analysis every 5s
    _deepInterval = setInterval(_deepAnalysis, DEEP_INTERVAL_MS);
    // Immediate first scans
    setTimeout(_fastScan, 300);
    setTimeout(_deepAnalysis, 800);
    console.log('[AutoCamera] 🛡️ Dual-tier vision started: FAST=' + (FAST_INTERVAL_MS/1000) + 's, DEEP=' + (DEEP_INTERVAL_MS/1000) + 's');
  }

  function stopLiveVision() {
    if (_fastInterval) {
      clearInterval(_fastInterval);
      _fastInterval = null;
    }
    if (_deepInterval) {
      clearInterval(_deepInterval);
      _deepInterval = null;
    }
    _lastVision = null;
    _fastBusy = false;
    _deepBusy = false;
    console.log('[AutoCamera] Vision stopped');
  }

  function getLastVision() {
    return _lastVision;
  }

  // Expose globally
  window.KAutoCamera = {
    requestPermission,
    start: requestPermission,
    captureFrame,
    stop,
    toggle,
    isActive,
    isStarting,
    switchCamera,
    getLastVision,
    getFacingMode: function () {
      return _facingMode;
    },
  };
})();
