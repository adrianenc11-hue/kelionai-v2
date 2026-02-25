// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — Robust Lip Sync
// Two modes: FFT (audio analysis) + Text fallback (phoneme-based)
// Fixed: createMediaElementSource called only once per element
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var morphMeshes = [];
    var audioCtx = null;
    var analyser = null;
    var dataArray = null;
    var animFrame = null;
    var isRunning = false;
    var fftActive = false; // Driven by main Three.js animate loop
    var connectedElements = new WeakSet(); // Track connected elements

    // Morph targets that control mouth
    var MOUTH_MORPHS = ['Smile', 'jawOpen', 'mouthOpen', 'viseme_aa', 'JawOpen', 'mouth_open'];

    function SimpleLipSync() { }

    SimpleLipSync.prototype.setMorphMeshes = function (meshes) {
        morphMeshes = meshes;
    };

    // Connect to an existing AudioContext (for AudioBufferSourceNode playback)
    // Returns the analyser node so the caller can wire: source → analyser → destination
    SimpleLipSync.prototype.connectToContext = function (ctx) {
        try {
            audioCtx = ctx;
            if (audioCtx.state === 'suspended') audioCtx.resume();

            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.6;
            dataArray = new Uint8Array(analyser.frequencyBinCount);
            console.log('[LipSync] Analyser connected to AudioContext, fftSize=256, bins=' + analyser.frequencyBinCount);
            return analyser;
        } catch (e) {
            console.error('[LipSync] connectToContext error:', e);
            return null;
        }
    };

    SimpleLipSync.prototype.connectToElement = function (audioEl) {
        try {
            if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            if (audioCtx.state === 'suspended') audioCtx.resume();

            // Only create source ONCE per element
            if (connectedElements.has(audioEl)) {
                // Already connected, just reuse analyser
                return true;
            }

            try {
                var sourceNode = audioCtx.createMediaElementSource(audioEl);
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 256;
                analyser.smoothingTimeConstant = 0.6;

                sourceNode.connect(analyser);
                analyser.connect(audioCtx.destination);

                dataArray = new Uint8Array(analyser.frequencyBinCount);
                connectedElements.add(audioEl);
                return true;
            } catch (e) {
                // If createMediaElementSource fails (already used), fall back
                console.warn('[LipSync] MediaElementSource failed, using amplitude fallback');
                return false;
            }
        } catch (e) {
            console.error('[LipSync] Connect error:', e);
            return false;
        }
    };

    SimpleLipSync.prototype.start = function () {
        fftActive = true;
        isRunning = true;
        console.log('[LipSync] FFT lip sync started');
    };

    // Called each frame from the main Three.js animate loop
    SimpleLipSync.prototype.update = function () {
        if (!fftActive || !analyser || !dataArray) return;
        analyser.getByteFrequencyData(dataArray);

        // Voice frequencies (100-3000Hz)
        var sum = 0;
        var count = 0;
        var startBin = 2;
        var endBin = Math.min(dataArray.length, 40);
        for (var i = startBin; i < endBin; i++) {
            sum += dataArray[i];
            count++;
        }
        var avg = count > 0 ? sum / count : 0;

        // Normalize to 0-1 with sensitivity
        var mouthOpen = Math.min(1, Math.max(0, (avg - 15) / 70));

        // Add slight variation for natural look
        if (mouthOpen > 0.05) {
            mouthOpen += (Math.random() - 0.5) * 0.05;
            mouthOpen = Math.max(0, Math.min(1, mouthOpen));
        }

        this._setMouth(mouthOpen);
    };

    SimpleLipSync.prototype.stop = function () {
        fftActive = false;
        isRunning = false;
        if (animFrame) cancelAnimationFrame(animFrame);
        animFrame = null;
        this._setMouth(0);
    };

    SimpleLipSync.prototype._setMouth = function (value) {
        for (var m = 0; m < morphMeshes.length; m++) {
            var mesh = morphMeshes[m];
            if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
            for (var i = 0; i < MOUTH_MORPHS.length; i++) {
                var idx = mesh.morphTargetDictionary[MOUTH_MORPHS[i]];
                if (idx !== undefined) {
                    // Smooth transition
                    var current = mesh.morphTargetInfluences[idx];
                    mesh.morphTargetInfluences[idx] = current + (value - current) * 0.3;
                }
            }
        }
    };

    SimpleLipSync.prototype.dispose = function () {
        this.stop();
        analyser = null;
    };

    // ─── Text-based lip sync (phoneme mapping for Romanian) ──
    function TextLipSync(opts) {
        this.msPerChar = (opts && opts.msPerChar) || 50;
        this.timer = null;
        this.charIndex = 0;
        this.text = '';
    }

    TextLipSync.prototype.setMorphMeshes = function (meshes) {
        morphMeshes = meshes;
    };

    // Romanian phoneme → mouth openness mapping
    var PHONEME_MAP = {
        'a': 0.8, 'ă': 0.6, 'â': 0.5, 'î': 0.4,
        'e': 0.6, 'i': 0.3, 'o': 0.7, 'u': 0.5,
        'b': 0.1, 'p': 0.1, 'm': 0.05,
        'f': 0.2, 'v': 0.2, 's': 0.15, 'z': 0.15,
        'ș': 0.25, 'ț': 0.2,
        't': 0.1, 'd': 0.15, 'n': 0.1, 'l': 0.2,
        'r': 0.25, 'c': 0.15, 'g': 0.2,
        'h': 0.3, 'j': 0.2, 'k': 0.15,
        ' ': 0.02, '.': 0, ',': 0.02, '!': 0, '?': 0
    };

    TextLipSync.prototype.speak = function (text) {
        this.stop();
        this.text = text;
        this.charIndex = 0;
        var self = this;

        function tick() {
            if (self.charIndex >= self.text.length) {
                self.stop();
                return;
            }

            var ch = self.text[self.charIndex].toLowerCase();
            var mouthVal = PHONEME_MAP[ch];
            if (mouthVal === undefined) {
                mouthVal = (ch >= 'a' && ch <= 'z') ? 0.15 : 0;
            }

            // Add natural variation only for speech sounds
            if (mouthVal > 0.05) {
                mouthVal += (Math.random() - 0.5) * 0.1;
                mouthVal = Math.max(0, Math.min(1, mouthVal));
            }

            // Set mouth directly on morphs
            var isPause = (ch === '.' || ch === '!' || ch === '?' || ch === ',' || ch === ' ' || ch === '\n');
            for (var m = 0; m < morphMeshes.length; m++) {
                var mesh = morphMeshes[m];
                if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
                for (var i = 0; i < MOUTH_MORPHS.length; i++) {
                    var idx = mesh.morphTargetDictionary[MOUTH_MORPHS[i]];
                    if (idx !== undefined) {
                        if (isPause) {
                            // IMMEDIATE close at pauses
                            mesh.morphTargetInfluences[idx] = 0;
                        } else {
                            // Smooth open for speech
                            var current = mesh.morphTargetInfluences[idx];
                            mesh.morphTargetInfluences[idx] = current + (mouthVal - current) * 0.5;
                        }
                    }
                }
            }

            self.charIndex++;

            // Vary speed for natural cadence
            var delay = self.msPerChar;
            if (ch === '.' || ch === '!' || ch === '?') delay = 300; // longer pause at sentence end
            else if (ch === ',') delay = 150; // pause at comma
            else if (ch === ' ') delay = 20; // quick space

            self.timer = setTimeout(tick, delay);
        }
        tick();
    };

    TextLipSync.prototype.stop = function () {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        // Close mouth smoothly
        for (var m = 0; m < morphMeshes.length; m++) {
            var mesh = morphMeshes[m];
            if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
            for (var i = 0; i < MOUTH_MORPHS.length; i++) {
                var idx = mesh.morphTargetDictionary[MOUTH_MORPHS[i]];
                if (idx !== undefined) {
                    mesh.morphTargetInfluences[idx] = 0;
                }
            }
        }
    };

    window.SimpleLipSync = SimpleLipSync;
    window.TextLipSync = TextLipSync;
    window.FFTLipSync = SimpleLipSync;
})();
