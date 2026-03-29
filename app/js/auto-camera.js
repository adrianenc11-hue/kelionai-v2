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
  // LIVE VISION LOOP — continuous analysis while camera is ON
  // Brain can access latest context via window.KAutoCamera.getLastVision()
  // ═══════════════════════════════════════════════════════════
  let _visionInterval = null;
  let _lastVision = null;      // { description, timestamp }
  let _visionBusy = false;
  const VISION_INTERVAL_MS = 3000; // analyze every 3 seconds
  const VISION_LOW_RES_W = 640;
  const VISION_LOW_RES_H = 480;
  const VISION_JPEG_Q = 0.6;

  function _captureLowRes() {
    if (!_enabled || !_stream || !_video) return null;
    if (_video.readyState < 2) return null;
    try {
      var c = document.createElement('canvas');
      c.width = VISION_LOW_RES_W;
      c.height = VISION_LOW_RES_H;
      var ctx = c.getContext('2d');
      ctx.drawImage(_video, 0, 0, VISION_LOW_RES_W, VISION_LOW_RES_H);
      var url = c.toDataURL('image/jpeg', VISION_JPEG_Q);
      return url.split(',')[1];
    } catch (_e) { return null; }
  }

  // ── Danger detection keywords ──
  var DANGER_IMMEDIATE = /⚠️PERICOL/i;
  var DANGER_WARNING   = /⚠️ATENȚIE/i;
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
    // Clean up emoji markers for speech
    var spokenText = dangerLine.replace(/⚠️PERICOL:\s*/i, '').replace(/⚠️ATENȚIE:\s*/i, '').trim();
    var firstName = _getUserFirstName();
    // Build calm, personal alert: "Adrian, atenție, obstacol în stânga la 2 metri"
    if (level === 'immediate') {
      spokenText = (firstName ? firstName + ', ' : '') + 'atenție, ' + spokenText;
    } else {
      spokenText = (firstName ? firstName + ', ' : '') + 'am observat, ' + spokenText;
    }
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

  async function _analyzeFrame() {
    if (_visionBusy || !_enabled) return;
    var base64 = _captureLowRes();
    if (!base64) return;
    _visionBusy = true;
    try {
      var token = localStorage.getItem('sb-token') || '';
      var res = await fetch('/api/vision', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token,
        },
        body: JSON.stringify({
          image: base64,
          avatar: window.KAvatar && KAvatar.getCurrentAvatar ? KAvatar.getCurrentAvatar() : 'kira',
          language: window.i18n ? i18n.getLanguage() : 'ro',
        }),
      });
      if (res.ok) {
        var data = await res.json();
        if (data.description) {
          _lastVision = { description: data.description, timestamp: Date.now() };
          window.dispatchEvent(new CustomEvent('live-vision-update', { detail: _lastVision }));
          // ── Danger detection — instant TTS alert ──
          var dangerLevel = _checkDanger(data.description);
          if (dangerLevel) {
            _speakDanger(data.description, dangerLevel);
          }
          console.log('[AutoCamera] Live vision:', data.description.substring(0, 80) + '...');
        }
      }
    } catch (e) {
      console.warn('[AutoCamera] Live vision error:', e.message);
    } finally {
      _visionBusy = false;
    }
  }

  function startLiveVision() {
    if (_visionInterval) return;
    _visionInterval = setInterval(_analyzeFrame, VISION_INTERVAL_MS);
    // Immediate first analysis
    setTimeout(_analyzeFrame, 500);
    console.log('[AutoCamera] Live vision started (every ' + (VISION_INTERVAL_MS / 1000) + 's)');
  }

  function stopLiveVision() {
    if (_visionInterval) {
      clearInterval(_visionInterval);
      _visionInterval = null;
    }
    _lastVision = null;
    _visionBusy = false;
    console.log('[AutoCamera] Live vision stopped');
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
