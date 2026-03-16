// ═══════════════════════════════════════════════════════════════
// KelionAI — Auto-Camera Vision
// Captures camera frame automatically with each chat message
// So Kelion can always "see" the user (especially for blind users!)
// Also provides face tracking for avatar eye contact
// Button is in index.html — this module handles the camera logic
// ═══════════════════════════════════════════════════════════════
(function () {
  ('use strict');

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

  const CAPTURE_WIDTH = 640;
  const CAPTURE_HEIGHT = 480;
  const JPEG_QUALITY = 0.6;
  const FACE_TRACK_MS = 150; // face tracking interval (ms)

  /**
   * Initialize hidden video + canvas elements
   */
  function init() {
    if (_video) return;

    _video = document.createElement('video');
    _video.setAttribute('autoplay', '');
    _video.setAttribute('playsinline', '');
    _video.setAttribute('muted', '');
    _video.style.display = 'none';
    document.body.appendChild(_video);

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
      console.log('[AutoCamera] ✅ Camera active');

      // Start face tracking loop
      startFaceTracking();

      return true;
    } catch (e) {
      console.warn('[AutoCamera] ❌ Permission denied:', e.message);
      _permissionGranted = false;
      _enabled = false;
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
    if (_stream) {
      _stream.getTracks().forEach((t) => t.stop());
      _stream = null;
    }
    _enabled = false;
    console.log('[AutoCamera] Camera stopped');
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

  // Auto-init on load (just hidden elements, button is in HTML)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
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

  // Expose globally
  window.KAutoCamera = {
    requestPermission,
    captureFrame,
    stop,
    toggle,
    isActive,
    switchCamera,
    getFacingMode: function () {
      return _facingMode;
    },
  };
})();
