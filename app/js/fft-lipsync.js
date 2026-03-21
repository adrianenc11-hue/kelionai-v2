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

    // Smoothing — CINEMATIC mode: dynamic attack/release for natural feel
    var prevValues = {};
    var SMOOTH_ATTACK = 0.15;   // cinematic: slower attack for natural movement
    var SMOOTH_RELEASE = 0.08;  // cinematic: very gentle release

    // ── Mouth opening clamp — REALISTIC values for visible movement ──
    var MAX_MOUTH_OPEN = 0.04;  // 17% further reduced
    var MAX_VISEME_AA = 0.075;  // 17% further reduced
    var MAX_VISEME = 0.083;     // 17% further reduced

    // ── TEMP SLIDER: global mouth amplitude multiplier ──
    var _mouthMultiplier = parseFloat(localStorage.getItem('kelion_mouth_mult') || '0.75');
    (function _createSlider() {
        if (typeof document === 'undefined') return;
        var wrap = document.createElement('div');
        wrap.id = 'mouth-slider-wrap';
        wrap.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:99999;background:rgba(0,0,0,0.75);padding:8px 14px;border-radius:10px;font-family:sans-serif;font-size:12px;color:#fff;display:flex;align-items:center;gap:8px;';
        var label = document.createElement('span');
        label.textContent = '👄 ';
        var slider = document.createElement('input');
        slider.type = 'range'; slider.min = '0'; slider.max = '3'; slider.step = '0.05';
        slider.value = String(_mouthMultiplier);
        slider.style.cssText = 'width:120px;cursor:pointer;';
        var val = document.createElement('span');
        val.textContent = _mouthMultiplier.toFixed(2);
        val.style.minWidth = '32px';
        slider.addEventListener('input', function() {
            _mouthMultiplier = parseFloat(this.value);
            val.textContent = _mouthMultiplier.toFixed(2);
            localStorage.setItem('kelion_mouth_mult', String(_mouthMultiplier));
        });
        wrap.appendChild(label); wrap.appendChild(slider); wrap.appendChild(val);
        if (document.body) document.body.appendChild(wrap);
        else document.addEventListener('DOMContentLoaded', function() { document.body.appendChild(wrap); });
    })();

    // ── Coarticulation — blend previous viseme into current ──
    var _prevVisemes = {};
    var COARTIC_BLEND = 0.10;  // 10% — less blend = more distinct shapes

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
            analyser.fftSize = 512;  // CINEMATIC: doubled for better frequency resolution
            analyser.smoothingTimeConstant = 0.35;  // slightly less smoothing for snappier response
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
                analyser.fftSize = 512;  // CINEMATIC: doubled
                analyser.smoothingTimeConstant = 0.35;
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
        // ── Clamp helper — enforces max mouth opening ──
        function clamp(v, max) { return Math.min(v * _mouthMultiplier, (max || MAX_VISEME) * _mouthMultiplier); }

        var visemes = {
            // Jaw open — driven by low freq (vowels)
            'jawOpen': clamp(low * 0.7, MAX_MOUTH_OPEN),
            'mouthOpen': clamp(low * 0.5, MAX_MOUTH_OPEN),

            // Vowels — driven by low + mid (both naming conventions)
            'viseme_aa': clamp(low * 1.2, MAX_VISEME_AA), 'aa': clamp(low * 1.2, MAX_VISEME_AA),
            'viseme_O': clamp(low * 0.9 * (1 - mid * 0.3)), 'oh': clamp(low * 0.9 * (1 - mid * 0.3)),
            'viseme_E': clamp(mid * 1.0 * (1 - low * 0.2)), 'E': clamp(mid * 1.0 * (1 - low * 0.2)),
            'viseme_I': clamp(mid * 0.8 * (1 - low * 0.4)), 'ih': clamp(mid * 0.8 * (1 - low * 0.4)),
            'viseme_U': clamp(low * 0.6 + mid * 0.3), 'ou': clamp(low * 0.6 + mid * 0.3),

            // Consonants — driven by mid + hi (both naming conventions)
            'viseme_PP': mid > 0.3 ? clamp((1 - low) * 0.5) : 0, 'PP': mid > 0.3 ? clamp((1 - low) * 0.5) : 0,
            'viseme_FF': clamp(hi * 0.8), 'FF': clamp(hi * 0.8),
            'viseme_TH': clamp(hi * 0.5 + mid * 0.3), 'TH': clamp(hi * 0.5 + mid * 0.3),
            'viseme_DD': clamp(mid * 0.6 + low * 0.2), 'DD': clamp(mid * 0.6 + low * 0.2),
            'viseme_kk': clamp(mid * 0.5 * (1 - hi * 0.3)), 'kk': clamp(mid * 0.5 * (1 - hi * 0.3)),
            'viseme_CH': clamp(hi * 0.9), 'CH': clamp(hi * 0.9),
            'viseme_SS': clamp(hi * 1.0), 'SS': clamp(hi * 1.0),
            'viseme_nn': clamp(mid * 0.5), 'nn': clamp(mid * 0.5),
            'viseme_RR': clamp(mid * 0.7 + low * 0.3), 'RR': clamp(mid * 0.7 + low * 0.3),
            'viseme_sil': 0, 'sil': 0,

            // Supplementary ARKit — visible mouth movement
            'mouthSmile': clamp(mid * 0.25),
            'mouthFunnel': clamp(low * 0.5 * (1 - mid)),
            'mouthPucker': clamp(low * 0.35 + mid * 0.15),
            'mouthClose': (low < 0.05 && mid < 0.05) ? 0.15 : 0,
            'mouthRollLower': clamp(mid * 0.15),
            'mouthRollUpper': clamp(mid * 0.10),
            'mouthShrugLower': clamp(low * 0.20 * (1 - mid)),
            'mouthShrugUpper': clamp(mid * 0.12),
            'jawLeft': clamp(Math.sin(Date.now() * 0.003) * mid * 0.06),
            'jawRight': clamp(Math.cos(Date.now() * 0.003) * mid * 0.06),
            'mouthStretchLeft': clamp(low * 0.15),
            'mouthStretchRight': clamp(low * 0.15),
            'mouthLowerDownLeft': clamp(low * 0.22),
            'mouthLowerDownRight': clamp(low * 0.22),
            'mouthUpperUpLeft': clamp(mid * 0.12),
            'mouthUpperUpRight': clamp(mid * 0.12),
            'mouthDimpleLeft': clamp(mid * 0.08),
            'mouthDimpleRight': clamp(mid * 0.08)
        };

        // Apply with CINEMATIC smoothing (dynamic attack/release + coarticulation)
        for (var m = 0; m < morphMeshes.length; m++) {
            var mesh = morphMeshes[m];
            if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
            for (var name in visemes) {
                var idx = mesh.morphTargetDictionary[name];
                if (idx === undefined) continue;
                var target = visemes[name];

                // Coarticulation: blend 15% of previous viseme shape
                var prevShape = _prevVisemes[name] || 0;
                target = target * (1 - COARTIC_BLEND) + prevShape * COARTIC_BLEND;

                var prev = prevValues[name] || 0;
                // Dynamic smoothing: attack faster than release
                var factor = (target > prev) ? SMOOTH_ATTACK : SMOOTH_RELEASE;
                var smoothed = prev + (target - prev) * factor;

                // CINEMATIC: add subtle asymmetry for realism (left side slightly ahead)
                var asymOffset = (name.indexOf('Left') !== -1 || name.indexOf('left') !== -1) ? 0.02 : 0;
                smoothed = Math.min(smoothed + asymOffset, 1);

                mesh.morphTargetInfluences[idx] = smoothed;
                prevValues[name] = smoothed;
            }
        }
        // Store current visemes for next frame's coarticulation
        for (var k in visemes) _prevVisemes[k] = visemes[k];
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

            // Hard reset ALL viseme + mouth morphs to zero
            var allMorphs = VISEME_MORPHS.concat(ARKIT_MOUTH).concat(LEGACY_MOUTH);
            for (var i = 0; i < allMorphs.length; i++) {
                var idx = mesh.morphTargetDictionary[allMorphs[i]];
                if (idx !== undefined) {
                    mesh.morphTargetInfluences[idx] = 0;
                }
            }
        }
        // Clear prevValues
        prevValues = {};
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
        'a': { viseme_aa: 0.20, jawOpen: 0.15 },
        'ă': { viseme_aa: 0.12, jawOpen: 0.10 },
        'â': { viseme_aa: 0.10, jawOpen: 0.08 },
        'î': { viseme_I: 0.12, jawOpen: 0.05 },
        'e': { viseme_E: 0.18, jawOpen: 0.08 },
        'i': { viseme_I: 0.12, jawOpen: 0.04 },
        'o': { viseme_O: 0.18, mouthFunnel: 0.10, jawOpen: 0.10 },
        'u': { viseme_U: 0.15, mouthPucker: 0.10, jawOpen: 0.05 },
        'b': { viseme_PP: 0.15 }, 'p': { viseme_PP: 0.15 }, 'm': { viseme_PP: 0.12 },
        'f': { viseme_FF: 0.15 }, 'v': { viseme_FF: 0.12 },
        's': { viseme_SS: 0.12 }, 'z': { viseme_SS: 0.10 },
        'ș': { viseme_CH: 0.12 }, 'ț': { viseme_SS: 0.08, viseme_DD: 0.08 },
        't': { viseme_DD: 0.10 }, 'd': { viseme_DD: 0.10 },
        'n': { viseme_nn: 0.12 }, 'l': { viseme_nn: 0.08, jawOpen: 0.05 },
        'r': { viseme_RR: 0.12, jawOpen: 0.05 },
        'c': { viseme_kk: 0.10 }, 'g': { viseme_kk: 0.10 },
        'h': { jawOpen: 0.08 }, 'j': { viseme_CH: 0.08 },
        'k': { viseme_kk: 0.10 },
        ' ': { viseme_sil: 0.05 },
        '.': {}, ',': { viseme_sil: 0.02 }, '!': {}, '?': {}
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
