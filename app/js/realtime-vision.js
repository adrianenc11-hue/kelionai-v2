// ═══════════════════════════════════════════════════════════════
// KelionAI — Real-Time Vision (TensorFlow.js COCO-SSD)
// Real-time object detection from camera — 100% client-side
// Zero server cost, works offline
// ═══════════════════════════════════════════════════════════════

const RealtimeVision = (() => {
    let model = null;
    let video = null;
    let isRunning = false;
    let intervalId = null;
    let lastSpoken = '';
    let lastSpokeTime = 0;

    // Position description based on bounding box
    function getPosition(bbox, videoWidth) {
        const centerX = bbox[0] + bbox[2] / 2;
        const relX = centerX / videoWidth;
        if (relX < 0.33) return 'to the left';
        if (relX > 0.66) return 'to the right';
        return 'ahead';
    }

    // Distance estimate based on bounding box height
    function getDistance(bbox, videoHeight) {
        const relH = bbox[3] / videoHeight;
        if (relH > 0.6) return 'very close';
        if (relH > 0.3) return 'close';
        if (relH > 0.15) return 'at medium distance';
        return 'far away';
    }

    // Build natural language description
    function buildDescription(predictions, videoWidth, videoHeight) {
        if (!predictions || predictions.length === 0) return '';

        const items = predictions
            .filter(p => p.score > 0.5)
            .map(p => {
                const label = p.class;
                const pos = getPosition(p.bbox, videoWidth);
                const dist = getDistance(p.bbox, videoHeight);
                return `${label} ${pos}, ${dist}`;
            });

        if (items.length === 0) return '';
        if (items.length === 1) return items[0];
        return items.join('. ');
    }

    // Speak only if content changed (avoid repetition)
    function speakIfNew(text) {
        if (!text) return;
        const now = Date.now();
        // Don't repeat same thing within 5 seconds
        if (text === lastSpoken && now - lastSpokeTime < 5000) return;

        lastSpoken = text;
        lastSpokeTime = now;

        // Use Web Speech API for instant local TTS (no server cost)
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = 'en-US';
        utterance.rate = 1.2; // Slightly faster for real-time
        utterance.volume = 0.8;
        speechSynthesis.cancel(); // Cancel previous
        speechSynthesis.speak(utterance);
    }

    // Initialize camera
    async function initCamera() {
        video = document.createElement('video');
        video.setAttribute('autoplay', '');
        video.setAttribute('playsinline', '');
        video.style.position = 'fixed';
        video.style.bottom = '10px';
        video.style.right = '10px';
        video.style.width = '160px';
        video.style.height = '120px';
        video.style.borderRadius = '12px';
        video.style.border = '2px solid rgba(0,255,136,0.5)';
        video.style.zIndex = '9999';
        video.style.objectFit = 'cover';
        video.style.opacity = '0.8';

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: 640, height: 480 }
            });
            video.srcObject = stream;
            document.body.appendChild(video);
            await video.play();
            console.log('[VISION] ✅ Camera initialized');
            return true;
        } catch (e) {
            console.error('[VISION] ❌ Camera access denied:', e.message);
            return false;
        }
    }

    // Load TensorFlow.js model
    async function loadModel() {
        if (model) return model;
        console.log('[VISION] Loading COCO-SSD model...');
        try {
            model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
            console.log('[VISION] ✅ Model loaded (MobileNet v2)');
            return model;
        } catch (e) {
            console.error('[VISION] ❌ Model load failed:', e.message);
            return null;
        }
    }

    // Main detection loop
    async function detect() {
        if (!model || !video || video.readyState < 2) return;

        try {
            const predictions = await model.detect(video);
            const desc = buildDescription(predictions, video.videoWidth, video.videoHeight);

            // Dispatch event for UI
            window.dispatchEvent(new CustomEvent('vision-detection', {
                detail: { predictions, description: desc }
            }));

            if (desc) {
                speakIfNew(desc);
            }
        } catch (e) {
            console.warn('[VISION] Detection error:', e.message);
        }
    }

    // Public API
    return {
        // Start real-time vision
        async start(intervalMs = 1000) {
            if (isRunning) return;

            const cameraOk = await initCamera();
            if (!cameraOk) {
                speakIfNew('Camera access denied. Please allow camera access.');
                return false;
            }

            const modelOk = await loadModel();
            if (!modelOk) {
                speakIfNew('The detection model could not be loaded.');
                return false;
            }

            isRunning = true;
            intervalId = setInterval(detect, intervalMs);
            console.log(`[VISION] ✅ Real-time detection started (${intervalMs}ms interval)`);
            speakIfNew('Real-time vision is active.');
            return true;
        },

        // Stop detection
        stop() {
            if (intervalId) clearInterval(intervalId);
            intervalId = null;
            isRunning = false;

            if (video && video.srcObject) {
                video.srcObject.getTracks().forEach(t => t.stop());
                video.remove();
                video = null;
            }

            speechSynthesis.cancel();
            console.log('[VISION] ⏹ Detection stopped');
        },

        // Check if running
        get active() { return isRunning; },

        // Toggle
        toggle(intervalMs = 1000) {
            if (isRunning) {
                this.stop();
                return false;
            } else {
                return this.start(intervalMs);
            }
        }
    };
})();
