// ═══════════════════════════════════════════════════════════════
// KelionAI — Auto-Camera Vision
// Captures camera frame automatically with each chat message
// So Kelion can always "see" the user (especially for blind users!)
// Button is in index.html — this module handles the camera logic
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    let _stream = null;
    let _video = null;
    let _canvas = null;
    let _enabled = false;
    let _permissionGranted = false;

    const CAPTURE_WIDTH = 640;
    const CAPTURE_HEIGHT = 480;
    const JPEG_QUALITY = 0.6;

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
                    facingMode: 'user'
                },
                audio: false
            });
            _video.srcObject = _stream;
            await _video.play();
            _permissionGranted = true;
            _enabled = true;
            console.log('[AutoCamera] ✅ Camera active');
            return true;
        } catch (e) {
            console.warn('[AutoCamera] ❌ Permission denied:', e.message);
            _permissionGranted = false;
            _enabled = false;
            return false;
        }
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

    // Expose globally
    window.KAutoCamera = {
        requestPermission,
        captureFrame,
        stop,
        toggle,
        isActive
    };
})();
