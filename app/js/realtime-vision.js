// ═══════════════════════════════════════════════════════════════
// KelionAI — Real-Time Vision (TensorFlow.js COCO-SSD)
// Detecție obiecte în timp real din cameră — 100% client-side
// Zero cost server, funcționează offline
// ═══════════════════════════════════════════════════════════════

const RealtimeVision = (() => {
    let model = null;
    let video = null;
    let isRunning = false;
    let intervalId = null;
    let lastSpoken = '';
    let lastSpokeTime = 0;

    // Romanian labels for COCO-SSD detected objects
    const LABELS_RO = {
        'person': 'persoană',
        'bicycle': 'bicicletă',
        'car': 'mașină',
        'motorcycle': 'motocicletă',
        'airplane': 'avion',
        'bus': 'autobuz',
        'train': 'tren',
        'truck': 'camion',
        'boat': 'barcă',
        'traffic light': 'semafor',
        'fire hydrant': 'hidrant',
        'stop sign': 'semn stop',
        'parking meter': 'parcometre',
        'bench': 'bancă',
        'bird': 'pasăre',
        'cat': 'pisică',
        'dog': 'câine',
        'horse': 'cal',
        'sheep': 'oaie',
        'cow': 'vacă',
        'elephant': 'elefant',
        'bear': 'urs',
        'zebra': 'zebră',
        'giraffe': 'girafă',
        'backpack': 'rucsac',
        'umbrella': 'umbrelă',
        'handbag': 'geantă',
        'tie': 'cravată',
        'suitcase': 'valiză',
        'frisbee': 'frisbee',
        'skis': 'schiuri',
        'snowboard': 'snowboard',
        'sports ball': 'minge',
        'kite': 'zmeu',
        'baseball bat': 'bâtă',
        'baseball glove': 'mănușă',
        'skateboard': 'skateboard',
        'surfboard': 'surfboard',
        'tennis racket': 'rachetă de tenis',
        'bottle': 'sticlă',
        'wine glass': 'pahar de vin',
        'cup': 'ceașcă',
        'fork': 'furculiță',
        'knife': 'cuțit',
        'spoon': 'lingură',
        'bowl': 'castron',
        'banana': 'banană',
        'apple': 'măr',
        'sandwich': 'sandviș',
        'orange': 'portocală',
        'broccoli': 'broccoli',
        'carrot': 'morcov',
        'hot dog': 'hot dog',
        'pizza': 'pizza',
        'donut': 'gogoașă',
        'cake': 'tort',
        'chair': 'scaun',
        'couch': 'canapea',
        'potted plant': 'plantă',
        'bed': 'pat',
        'dining table': 'masă',
        'toilet': 'toaletă',
        'tv': 'televizor',
        'laptop': 'laptop',
        'mouse': 'mouse',
        'remote': 'telecomandă',
        'keyboard': 'tastatură',
        'cell phone': 'telefon',
        'microwave': 'cuptor cu microunde',
        'oven': 'cuptor',
        'toaster': 'prăjitor',
        'sink': 'chiuvetă',
        'refrigerator': 'frigider',
        'book': 'carte',
        'clock': 'ceas',
        'vase': 'vază',
        'scissors': 'foarfece',
        'teddy bear': 'ursuleț',
        'hair drier': 'uscător de păr',
        'toothbrush': 'periuță de dinți',
    };

    // Position description based on bounding box
    function getPosition(bbox, videoWidth) {
        const centerX = bbox[0] + bbox[2] / 2;
        const relX = centerX / videoWidth;
        if (relX < 0.33) return 'la stânga';
        if (relX > 0.66) return 'la dreapta';
        return 'în față';
    }

    // Distance estimate based on bounding box height
    function getDistance(bbox, videoHeight) {
        const relH = bbox[3] / videoHeight;
        if (relH > 0.6) return 'foarte aproape';
        if (relH > 0.3) return 'aproape';
        if (relH > 0.15) return 'la distanță medie';
        return 'departe';
    }

    // Build natural language description
    function buildDescription(predictions, videoWidth, videoHeight) {
        if (!predictions || predictions.length === 0) return '';

        const items = predictions
            .filter(p => p.score > 0.5)
            .map(p => {
                const label = LABELS_RO[p.class] || p.class;
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
        utterance.lang = 'ro-RO';
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
                speakIfNew('Nu am acces la cameră. Te rog să permiți accesul.');
                return false;
            }

            const modelOk = await loadModel();
            if (!modelOk) {
                speakIfNew('Modelul de detectare nu s-a putut încărca.');
                return false;
            }

            isRunning = true;
            intervalId = setInterval(detect, intervalMs);
            console.log(`[VISION] ✅ Real-time detection started (${intervalMs}ms interval)`);
            speakIfNew('Viziunea în timp real este activată.');
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
