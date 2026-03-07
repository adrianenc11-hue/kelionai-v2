// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — Viseme Lip Sync Engine
// Supports 15 Oculus visemes + ARKit blend shapes
// Replaces old FFT-only approach with proper multi-morph viseme mapping
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var morphMeshes = [];
    var audioCtx = null;
    var analyser = null;
    var dataArray = null;
    var isRunning = false;
    var fftActive = false;
    var connectedElements = new WeakSet();

    // ── Viseme morph targets (Oculus standard) ──
    var VISEME_MORPHS = [
        'viseme_sil', 'viseme_PP', 'viseme_FF', 'viseme_TH',
        'viseme_DD', 'viseme_kk', 'viseme_CH', 'viseme_SS',
        'viseme_nn', 'viseme_RR', 'viseme_aa', 'viseme_E',
        'viseme_I', 'viseme_O', 'viseme_U'
    ];

    // ── ARKit mouth morphs (supplementary) ──
    var ARKIT_MOUTH = [
        'jawOpen', 'mouthOpen', 'mouthSmile', 'mouthFunnel',
        'mouthPucker', 'mouthClose', 'mouthSmileLeft', 'mouthSmileRight'
    ];

    // ── Legacy morphs (backward compat with older models) ──
    var LEGACY_MOUTH = ['Smile', 'jawOpen', 'mouthOpen', 'JawOpen', 'mouth_open'];

    // ── Frequency band → viseme mapping ──
    // Low (100-500Hz) = jaw movement, vowels
    // Mid (500-2000Hz) = consonants, sibilants
    // High (2000-4000Hz) = fricatives
    var BAND_LOW = { start: 2, end: 8 };
    var BAND_MID = { start: 8, end: 25 };
    var BAND_HI = { start: 25, end: 45 };

    // Smoothing
    var prevValues = {};
    var SMOOTH_FACTOR = 0.15; // much smoother than old 0.5

    function SimpleLipSync() { }

    SimpleLipSync.prototype.setMorphMeshes = function (meshes) {
        morphMeshes = meshes;
        prevValues = {};
    };

    SimpleLipSync.prototype.connectToContext = function (ctx) {
        try {
            audioCtx = ctx;
            if (audioCtx.state === 'suspended') audioCtx.resume();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 256;
            analyser.smoothingTimeConstant = 0.4;
            dataArray = new Uint8Array(analyser.frequencyBinCount);
            console.log('[LipSync] Viseme engine connected, fftSize=256');
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
            if (connectedElements.has(audioEl)) return true;
            try {
                var sourceNode = audioCtx.createMediaElementSource(audioEl);
                analyser = audioCtx.createAnalyser();
                analyser.fftSize = 256;
                analyser.smoothingTimeConstant = 0.4;
                sourceNode.connect(analyser);
                analyser.connect(audioCtx.destination);
                dataArray = new Uint8Array(analyser.frequencyBinCount);
                connectedElements.add(audioEl);
                return true;
            } catch (e) {
                console.warn('[LipSync] MediaElementSource failed');
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
        prevValues = {};
    };

    SimpleLipSync.prototype.isActive = function () {
        return fftActive && isRunning;
    };

    // ── Main update — called each frame ──
    SimpleLipSync.prototype.update = function () {
        if (!fftActive || !isRunning || !analyser || !dataArray) {
            this._resetMouth();
            return;
        }
        analyser.getByteFrequencyData(dataArray);

        // Extract frequency bands
        var low = _bandAvg(BAND_LOW.start, BAND_LOW.end);
        var mid = _bandAvg(BAND_MID.start, BAND_MID.end);
        var hi = _bandAvg(BAND_HI.start, BAND_HI.end);

        // Normalize (0-1) with noise gate
        var NOISE_GATE = 8;
        low = Math.max(0, Math.min(1, (low - NOISE_GATE) / 60));
        mid = Math.max(0, Math.min(1, (mid - NOISE_GATE) / 50));
        hi = Math.max(0, Math.min(1, (hi - NOISE_GATE) / 40));

        // If all below threshold → mouth closed
        if (low < 0.02 && mid < 0.02 && hi < 0.02) {
            this._resetMouth();
            return;
        }

        // Map frequency bands to visemes
        // Support BOTH Oculus (viseme_XX) AND MetaPerson (XX) naming
        var visemes = {
            // Jaw open — driven by low freq (vowels)
            'jawOpen': low * 0.7,
            'mouthOpen': low * 0.5,

            // Vowels — driven by low + mid (both naming conventions)
            'viseme_aa': low * 0.8, 'aa': low * 0.8,              // "A" — wide open
            'viseme_O': low * 0.6 * (1 - mid * 0.5), 'oh': low * 0.6 * (1 - mid * 0.5),  // "O"
            'viseme_E': mid * 0.7 * (1 - low * 0.3), 'E': mid * 0.7 * (1 - low * 0.3),  // "E"
            'viseme_I': mid * 0.5 * (1 - low * 0.5), 'ih': mid * 0.5 * (1 - low * 0.5),  // "I"
            'viseme_U': low * 0.4 * mid * 0.3, 'ou': low * 0.4 * mid * 0.3,              // "U"

            // Consonants — driven by mid + hi (both naming conventions)
            'viseme_PP': mid > 0.4 ? (1 - low) * 0.3 : 0, 'PP': mid > 0.4 ? (1 - low) * 0.3 : 0,
            'viseme_FF': hi * 0.5, 'FF': hi * 0.5,
            'viseme_TH': hi * 0.3 * mid * 0.3, 'TH': hi * 0.3 * mid * 0.3,
            'viseme_DD': mid * 0.4 * low * 0.3, 'DD': mid * 0.4 * low * 0.3,
            'viseme_kk': mid * 0.3 * (1 - hi * 0.5), 'kk': mid * 0.3 * (1 - hi * 0.5),
            'viseme_CH': hi * 0.6, 'CH': hi * 0.6,
            'viseme_SS': hi * 0.7, 'SS': hi * 0.7,
            'viseme_nn': mid * 0.3, 'nn': mid * 0.3,
            'viseme_RR': mid * 0.5 * low * 0.4, 'RR': mid * 0.5 * low * 0.4,
            'viseme_sil': 0, 'sil': 0,

            // Supplementary ARKit
            'mouthSmile': mid * 0.15,
            'mouthFunnel': low * 0.3 * (1 - mid),
            'mouthPucker': low * 0.2 * mid * 0.2
        };

        // Apply with exponential smoothing
        for (var m = 0; m < morphMeshes.length; m++) {
            var mesh = morphMeshes[m];
            if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
            for (var name in visemes) {
                var idx = mesh.morphTargetDictionary[name];
                if (idx === undefined) continue;
                var target = visemes[name];
                var prev = prevValues[name] || 0;
                var smoothed = prev + (target - prev) * SMOOTH_FACTOR;
                mesh.morphTargetInfluences[idx] = smoothed;
                prevValues[name] = smoothed;
            }
        }
    };

    function _bandAvg(start, end) {
        if (!dataArray) return 0;
        var sum = 0;
        var count = 0;
        end = Math.min(end, dataArray.length);
        for (var i = start; i < end; i++) {
            sum += dataArray[i];
            count++;
        }
        return count > 0 ? sum / count : 0;
    }

    SimpleLipSync.prototype.stop = function () {
        fftActive = false;
        isRunning = false;
        if (analyser) {
            try { analyser.disconnect(); } catch (e) { }
            analyser = null;
            dataArray = null;
        }
        this._resetMouth();
        prevValues = {};
        console.log('[LipSync] STOPPED — mouth closed');
    };

    SimpleLipSync.prototype._resetMouth = function () {
        for (var m = 0; m < morphMeshes.length; m++) {
            var mesh = morphMeshes[m];
            if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;

            // Reset ALL viseme + mouth morphs smoothly
            var allMorphs = VISEME_MORPHS.concat(ARKIT_MOUTH).concat(LEGACY_MOUTH);
            for (var i = 0; i < allMorphs.length; i++) {
                var idx = mesh.morphTargetDictionary[allMorphs[i]];
                if (idx !== undefined) {
                    var current = mesh.morphTargetInfluences[idx];
                    mesh.morphTargetInfluences[idx] = current * 0.85; // smooth close
                }
            }
        }
        // Decay prevValues
        for (var key in prevValues) {
            prevValues[key] *= 0.85;
            if (prevValues[key] < 0.01) prevValues[key] = 0;
        }
    };

    SimpleLipSync.prototype.dispose = function () {
        this.stop();
    };

    // ── Legacy compat ──
    SimpleLipSync.prototype._setMouth = function (value) {
        // Single-value fallback for old models without visemes
        for (var m = 0; m < morphMeshes.length; m++) {
            var mesh = morphMeshes[m];
            if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
            for (var i = 0; i < LEGACY_MOUTH.length; i++) {
                var idx = mesh.morphTargetDictionary[LEGACY_MOUTH[i]];
                if (idx !== undefined) {
                    var current = mesh.morphTargetInfluences[idx];
                    mesh.morphTargetInfluences[idx] = current + (value - current) * SMOOTH_FACTOR;
                }
            }
        }
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

    // Romanian phoneme → viseme mapping (which visemes to activate)
    var PHONEME_VISEME = {
        'a': { viseme_aa: 0.8, jawOpen: 0.6 },
        'ă': { viseme_aa: 0.5, jawOpen: 0.4 },
        'â': { viseme_aa: 0.4, jawOpen: 0.3 },
        'î': { viseme_I: 0.5, jawOpen: 0.2 },
        'e': { viseme_E: 0.7, jawOpen: 0.3 },
        'i': { viseme_I: 0.5, jawOpen: 0.15 },
        'o': { viseme_O: 0.7, mouthFunnel: 0.4, jawOpen: 0.4 },
        'u': { viseme_U: 0.6, mouthPucker: 0.4, jawOpen: 0.2 },
        'b': { viseme_PP: 0.6 }, 'p': { viseme_PP: 0.6 }, 'm': { viseme_PP: 0.5 },
        'f': { viseme_FF: 0.6 }, 'v': { viseme_FF: 0.5 },
        's': { viseme_SS: 0.5 }, 'z': { viseme_SS: 0.4 },
        'ș': { viseme_CH: 0.5 }, 'ț': { viseme_SS: 0.3, viseme_DD: 0.3 },
        't': { viseme_DD: 0.4 }, 'd': { viseme_DD: 0.4 },
        'n': { viseme_nn: 0.5 }, 'l': { viseme_nn: 0.3, jawOpen: 0.2 },
        'r': { viseme_RR: 0.5, jawOpen: 0.2 },
        'c': { viseme_kk: 0.4 }, 'g': { viseme_kk: 0.4 },
        'h': { jawOpen: 0.3 }, 'j': { viseme_CH: 0.3 },
        'k': { viseme_kk: 0.4 },
        ' ': { viseme_sil: 0.1 },
        '.': {}, ',': { viseme_sil: 0.05 }, '!': {}, '?': {}
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
            var visemes = PHONEME_VISEME[ch];
            if (!visemes) {
                visemes = (ch >= 'a' && ch <= 'z') ? { jawOpen: 0.15, viseme_aa: 0.1 } : {};
            }

            var isPause = (ch === '.' || ch === '!' || ch === '?' || ch === ',' || ch === ' ' || ch === '\n');

            for (var m = 0; m < morphMeshes.length; m++) {
                var mesh = morphMeshes[m];
                if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;

                // First, decay all visemes
                for (var vi = 0; vi < VISEME_MORPHS.length; vi++) {
                    var vIdx = mesh.morphTargetDictionary[VISEME_MORPHS[vi]];
                    if (vIdx !== undefined) {
                        mesh.morphTargetInfluences[vIdx] *= isPause ? 0 : 0.7;
                    }
                }
                // Decay ARKit mouth
                for (var ai = 0; ai < ARKIT_MOUTH.length; ai++) {
                    var aIdx = mesh.morphTargetDictionary[ARKIT_MOUTH[ai]];
                    if (aIdx !== undefined) {
                        mesh.morphTargetInfluences[aIdx] *= isPause ? 0 : 0.7;
                    }
                }

                // Then apply current phoneme's visemes
                if (!isPause) {
                    for (var name in visemes) {
                        var idx = mesh.morphTargetDictionary[name];
                        if (idx !== undefined) {
                            var current = mesh.morphTargetInfluences[idx];
                            mesh.morphTargetInfluences[idx] = current + (visemes[name] - current) * 0.4;
                        }
                    }
                }
            }

            self.charIndex++;

            var delay = self.msPerChar;
            if (ch === '.' || ch === '!' || ch === '?') delay = 300;
            else if (ch === ',') delay = 150;
            else if (ch === ' ') delay = 20;

            self.timer = setTimeout(tick, delay);
        }
        tick();
    };

    TextLipSync.prototype.stop = function () {
        if (this.timer) clearTimeout(this.timer);
        this.timer = null;
        // Close all visemes
        for (var m = 0; m < morphMeshes.length; m++) {
            var mesh = morphMeshes[m];
            if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
            var allMorphs = VISEME_MORPHS.concat(ARKIT_MOUTH).concat(LEGACY_MOUTH);
            for (var i = 0; i < allMorphs.length; i++) {
                var idx = mesh.morphTargetDictionary[allMorphs[i]];
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
