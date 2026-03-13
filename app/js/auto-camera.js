// ═══════════════════════════════════════════════════════════════
// KelionAI — Auto-Camera Vision
// Captures camera frame automatically with each chat message
// So Kelion can always "see" the user
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    let _stream = null;
    let _video = null;
    let _canvas = null;
    let _enabled = false;
    let _permissionGranted = false;

    const CAPTURE_WIDTH = 640;   // Resolution - enough for Gemini, not too heavy
    const CAPTURE_HEIGHT = 480;
    const JPEG_QUALITY = 0.6;     // Lower quality = smaller payload = faster

    /**
     * Initialize the auto-camera system
     * Creates hidden video + canvas elements
     */
    function init() {
        if (_video) return; // Already initialized

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

        console.log('[AutoCamera] Initialized (hidden video + canvas)');
    }

    /**
     * Request camera permission and start stream
     * Returns true if permission granted
     */
    async function requestPermission() {
        if (_permissionGranted && _stream) return true;

        try {
            init();
            _stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    width: { ideal: CAPTURE_WIDTH },
                    height: { ideal: CAPTURE_HEIGHT },
                    facingMode: 'user'
                },
                audio: false
            });
            _video.srcObject = _stream;
            await _video.play();
            _permissionGranted = true;
            _enabled = true;
            console.log('[AutoCamera] ✅ Permission granted — auto-vision active');
            return true;
        } catch (e) {
            console.warn('[AutoCamera] ❌ Permission denied:', e.message);
            _permissionGranted = false;
            _enabled = false;
            return false;
        }
    }

    /**
     * Capture a single frame from the camera
     * Returns { base64, mimeType } or null if not available
     */
    function captureFrame() {
        if (!_enabled || !_stream || !_video || !_canvas) return null;
        if (_video.readyState < 2) return null; // Not ready

        try {
            const ctx = _canvas.getContext('2d');
            ctx.drawImage(_video, 0, 0, CAPTURE_WIDTH, CAPTURE_HEIGHT);
            const dataUrl = _canvas.toDataURL('image/jpeg', JPEG_QUALITY);
            // Extract pure base64 (remove "data:image/jpeg;base64," prefix)
            const base64 = dataUrl.split(',')[1];
            return {
                base64: base64,
                mimeType: 'image/jpeg'
            };
        } catch (e) {
            console.warn('[AutoCamera] Capture failed:', e.message);
            return null;
        }
    }

    /**
     * Stop the camera stream
     */
    function stop() {
        if (_stream) {
            _stream.getTracks().forEach(t => t.stop());
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
            const ok = await requestPermission();
            return ok;
        }
    }

    /**
     * Check if auto-camera is active
     */
    function isActive() {
        return _enabled && _permissionGranted && !!_stream;
    }

    // Auto-init on load (but don't request permission yet — user must opt-in)
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Expose globally
    window.KAutoCamera = {
        requestPermission,
        captureFrame,
        stop,
        toggle,
        isActive
    };
})();
