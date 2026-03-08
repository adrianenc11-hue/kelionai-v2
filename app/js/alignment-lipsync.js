// ═══════════════════════════════════════════════════════════════
// KelionAI — Professional Alignment Lip Sync Engine
// Uses ElevenLabs character-level timestamps for precise viseme animation
// Supports 15 Oculus visemes + ARKit blend shapes
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var morphMeshes = [];
    var _active = false;
    var _alignment = null;  // { characters, character_start_times_seconds, character_end_times_seconds }
    var _audioStartTime = 0; // AudioContext.currentTime when playback started
    var _audioCtx = null;
    var _prevValues = {};

    // ── Smoothing constants ──
    var SMOOTH_ATTACK = 0.18;    // how fast visemes open
    var SMOOTH_RELEASE = 0.12;   // how fast visemes close
    var COARTIC_BLEND = 0.20;    // 20% blend from previous shape
    var ASYMMETRY_OFFSET = 0.015; // left side leads slightly

    // ── Clamp constants — prevents face distortion ──
    var MAX_JAW = 0.12;
    var MAX_VOWEL = 0.18;
    var MAX_VISEME = 0.22;

    // ── Character → Phoneme class mapping ──
    // Groups: V_OPEN, V_MID, V_CLOSE, V_ROUND, V_TIGHT, C_BILABIAL, C_LABIO,
    //         C_DENTAL, C_ALVEOLAR, C_PALATAL, C_VELAR, C_SIBILANT, C_NASAL, SILENCE
    var CHAR_PHONEME = {
        // Romanian vowels
        'a': 'V_OPEN', 'ă': 'V_MID', 'â': 'V_MID', 'î': 'V_CLOSE',
        'e': 'V_MID', 'i': 'V_CLOSE', 'o': 'V_ROUND', 'u': 'V_TIGHT',
        // English vowels (additional)
        'y': 'V_CLOSE',
        // Bilabial: lips together
        'b': 'C_BILABIAL', 'p': 'C_BILABIAL', 'm': 'C_NASAL',
        // Labiodental: lip + teeth
        'f': 'C_LABIO', 'v': 'C_LABIO',
        // Dental/Alveolar
        't': 'C_DENTAL', 'd': 'C_DENTAL', 'n': 'C_NASAL',
        'l': 'C_ALVEOLAR', 'r': 'C_ALVEOLAR',
        // Sibilants
        's': 'C_SIBILANT', 'z': 'C_SIBILANT',
        'ș': 'C_PALATAL', 'ț': 'C_SIBILANT',
        // Palatal/Postalveolar
        'c': 'C_VELAR', 'g': 'C_VELAR', 'k': 'C_VELAR',
        'h': 'C_VELAR', 'j': 'C_PALATAL',
        'ş': 'C_PALATAL', 'ţ': 'C_SIBILANT',
        'q': 'C_VELAR', 'w': 'V_TIGHT', 'x': 'C_SIBILANT',
        // Silence
        ' ': 'SILENCE', '.': 'SILENCE', ',': 'SILENCE',
        '!': 'SILENCE', '?': 'SILENCE', '-': 'SILENCE',
        ':': 'SILENCE', ';': 'SILENCE', '"': 'SILENCE',
        "'": 'SILENCE', '\n': 'SILENCE', '\r': 'SILENCE',
        '(': 'SILENCE', ')': 'SILENCE'
    };

    // ── Phoneme class → Viseme weight map ──
    // Each maps to multiple morph targets with calibrated weights
    var PHONEME_VISEMES = {
        'V_OPEN': {
            viseme_aa: 0.18, aa: 0.18,
            jawOpen: 0.10, mouthOpen: 0.08,
            mouthLowerDownLeft: 0.05, mouthLowerDownRight: 0.05
        },
        'V_MID': {
            viseme_E: 0.15, E: 0.15,
            jawOpen: 0.07, mouthOpen: 0.05,
            mouthStretchLeft: 0.06, mouthStretchRight: 0.06
        },
        'V_CLOSE': {
            viseme_I: 0.18, ih: 0.18,
            jawOpen: 0.06,
            mouthStretchLeft: 0.10, mouthStretchRight: 0.10,
            mouthSmileLeft: 0.04, mouthSmileRight: 0.04
        },
        'V_ROUND': {
            viseme_O: 0.16, oh: 0.16,
            jawOpen: 0.08, mouthFunnel: 0.10,
            mouthPucker: 0.06
        },
        'V_TIGHT': {
            viseme_U: 0.20, ou: 0.20,
            mouthPucker: 0.18, mouthFunnel: 0.10,
            jawOpen: 0.06
        },
        'C_BILABIAL': {
            viseme_PP: 0.25, PP: 0.25,
            mouthClose: 0.15, mouthPressLeft: 0.08, mouthPressRight: 0.08
        },
        'C_LABIO': {
            viseme_FF: 0.22, FF: 0.22,
            mouthUpperUpLeft: 0.06, mouthUpperUpRight: 0.06,
            mouthRollLower: 0.08
        },
        'C_DENTAL': {
            viseme_DD: 0.18, DD: 0.18,
            jawOpen: 0.06,
            mouthUpperUpLeft: 0.04, mouthUpperUpRight: 0.04
        },
        'C_ALVEOLAR': {
            viseme_RR: 0.16, RR: 0.16,
            jawOpen: 0.08,
            mouthStretchLeft: 0.04, mouthStretchRight: 0.04
        },
        'C_SIBILANT': {
            viseme_SS: 0.20, SS: 0.20,
            mouthStretchLeft: 0.08, mouthStretchRight: 0.08,
            jawOpen: 0.04
        },
        'C_PALATAL': {
            viseme_CH: 0.18, CH: 0.18,
            mouthFunnel: 0.06, jawOpen: 0.06
        },
        'C_VELAR': {
            viseme_kk: 0.16, kk: 0.16,
            jawOpen: 0.08
        },
        'C_NASAL': {
            viseme_nn: 0.18, nn: 0.18,
            mouthClose: 0.08,
            mouthPressLeft: 0.04, mouthPressRight: 0.04
        },
        'SILENCE': {
            viseme_sil: 0.03, sil: 0.03
        }
    };

    // ── Pre-computed timeline: array of { startTime, endTime, visemes: {} } ──
    var _timeline = [];

    // ── Build timeline from alignment data ──
    function _buildTimeline(alignment) {
        _timeline = [];
        if (!alignment || !alignment.characters) return;

        var chars = alignment.characters;
        var starts = alignment.character_start_times_seconds;
        var ends = alignment.character_end_times_seconds;

        for (var i = 0; i < chars.length; i++) {
            var ch = (chars[i] || '').toLowerCase();
            var phonemeClass = CHAR_PHONEME[ch] || 'SILENCE';
            var visemes = PHONEME_VISEMES[phonemeClass] || PHONEME_VISEMES['SILENCE'];

            _timeline.push({
                startTime: starts[i] || 0,
                endTime: ends[i] || 0,
                visemes: visemes,
                phonemeClass: phonemeClass,
                char: ch
            });
        }
        console.log('[AlignmentLipSync] Timeline built:', _timeline.length, 'entries,',
            'duration:', _timeline.length > 0 ? _timeline[_timeline.length - 1].endTime.toFixed(2) + 's' : '0s');
    }

    // ── Cubic ease-in-out for natural transitions ──
    function _cubicEase(t) {
        if (t < 0) return 0;
        if (t > 1) return 1;
        return t < 0.5
            ? 4 * t * t * t
            : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    // ── Get blended viseme weights at a specific time ──
    function _getVisemesAtTime(currentTime) {
        var result = {};

        if (_timeline.length === 0) return result;

        // Find active timeline entry
        var activeIdx = -1;
        for (var i = 0; i < _timeline.length; i++) {
            if (currentTime >= _timeline[i].startTime && currentTime < _timeline[i].endTime) {
                activeIdx = i;
                break;
            }
        }

        // If past all entries, return silence
        if (activeIdx === -1) {
            if (currentTime >= _timeline[_timeline.length - 1].endTime) {
                return PHONEME_VISEMES['SILENCE'];
            }
            // Before first entry
            return PHONEME_VISEMES['SILENCE'];
        }

        var entry = _timeline[activeIdx];
        var duration = entry.endTime - entry.startTime;
        var progress = duration > 0 ? (currentTime - entry.startTime) / duration : 0;

        // Apply cubic easing for natural in/out within each phoneme
        var eased = _cubicEase(progress);

        // Envelope: ramp up in first 30%, sustain 40%, ramp down last 30%
        var envelope = 1.0;
        if (eased < 0.3) {
            envelope = eased / 0.3; // ramp up
        } else if (eased > 0.7) {
            envelope = (1.0 - eased) / 0.3; // ramp down
        }

        // Apply current phoneme's visemes with envelope
        for (var key in entry.visemes) {
            result[key] = entry.visemes[key] * envelope;
        }

        // Coarticulation: blend with next phoneme (lookahead)
        if (activeIdx + 1 < _timeline.length && eased > 0.6) {
            var nextEntry = _timeline[activeIdx + 1];
            var blendFactor = (eased - 0.6) / 0.4 * COARTIC_BLEND;
            for (var nk in nextEntry.visemes) {
                result[nk] = (result[nk] || 0) + nextEntry.visemes[nk] * blendFactor;
            }
        }

        // Coarticulation: blend with previous phoneme (lookbehind)
        if (activeIdx > 0 && eased < 0.3) {
            var prevEntry = _timeline[activeIdx - 1];
            var prevBlend = (0.3 - eased) / 0.3 * COARTIC_BLEND;
            for (var pk in prevEntry.visemes) {
                result[pk] = (result[pk] || 0) + prevEntry.visemes[pk] * prevBlend;
            }
        }

        return result;
    }

    // ── Clamp helper ──
    function _clamp(v, max) {
        return Math.min(Math.max(v, 0), max || MAX_VISEME);
    }

    // ── All mouth morph names for reset ──
    var ALL_MOUTH_MORPHS = [
        'viseme_sil', 'viseme_PP', 'viseme_FF', 'viseme_TH',
        'viseme_DD', 'viseme_kk', 'viseme_CH', 'viseme_SS',
        'viseme_nn', 'viseme_RR', 'viseme_aa', 'viseme_E',
        'viseme_I', 'viseme_O', 'viseme_U',
        'sil', 'PP', 'FF', 'TH', 'DD', 'kk', 'CH', 'SS',
        'nn', 'RR', 'aa', 'E', 'ih', 'oh', 'ou',
        'jawOpen', 'mouthOpen', 'mouthSmile', 'mouthFunnel',
        'mouthPucker', 'mouthClose', 'mouthSmileLeft', 'mouthSmileRight',
        'mouthPressLeft', 'mouthPressRight', 'mouthRollLower', 'mouthRollUpper',
        'mouthShrugLower', 'mouthShrugUpper', 'mouthStretchLeft', 'mouthStretchRight',
        'mouthLowerDownLeft', 'mouthLowerDownRight', 'mouthUpperUpLeft', 'mouthUpperUpRight',
        'mouthDimpleLeft', 'mouthDimpleRight', 'jawLeft', 'jawRight'
    ];

    // ══════════════════════════════════════════════════════
    // PUBLIC API
    // ══════════════════════════════════════════════════════

    function setMorphMeshes(meshes) {
        morphMeshes = meshes || [];
        _prevValues = {};
    }

    function setAudioContext(ctx) {
        _audioCtx = ctx;
    }

    function load(alignment) {
        _alignment = alignment;
        _buildTimeline(alignment);
        _prevValues = {};
    }

    function start(audioStartTime) {
        _audioStartTime = audioStartTime || 0;
        _active = true;
        _prevValues = {};
        console.log('[AlignmentLipSync] ▶ Started at audioCtx.currentTime =', audioStartTime.toFixed(3));
    }

    function update() {
        if (!_active || !_audioCtx || _timeline.length === 0) return;

        var currentTime = _audioCtx.currentTime - _audioStartTime;

        // Past the end? Stop
        if (currentTime > _timeline[_timeline.length - 1].endTime + 0.3) {
            stop();
            return;
        }

        var targetVisemes = _getVisemesAtTime(currentTime);

        // Apply to all morph meshes
        for (var m = 0; m < morphMeshes.length; m++) {
            var mesh = morphMeshes[m];
            if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;

            for (var name in targetVisemes) {
                var idx = mesh.morphTargetDictionary[name];
                if (idx === undefined) continue;

                var target = targetVisemes[name];

                // Apply clamps based on morph type
                var maxVal = MAX_VISEME;
                if (name === 'jawOpen' || name === 'mouthOpen') maxVal = MAX_JAW;
                if (name.indexOf('viseme_aa') >= 0 || name === 'aa') maxVal = MAX_VOWEL;
                target = _clamp(target, maxVal);

                // Asymmetry: left side slightly ahead
                if (name.indexOf('Left') >= 0 || name.indexOf('left') >= 0) {
                    target = _clamp(target + ASYMMETRY_OFFSET, maxVal);
                }

                // Dynamic smoothing: attack vs release
                var prev = _prevValues[name] || 0;
                var factor = (target > prev) ? SMOOTH_ATTACK : SMOOTH_RELEASE;
                var smoothed = prev + (target - prev) * factor;

                mesh.morphTargetInfluences[idx] = smoothed;
                _prevValues[name] = smoothed;
            }

            // Decay all non-targeted mouth morphs
            for (var ai = 0; ai < ALL_MOUTH_MORPHS.length; ai++) {
                var morphName = ALL_MOUTH_MORPHS[ai];
                if (targetVisemes[morphName] !== undefined) continue; // already handled
                var aidx = mesh.morphTargetDictionary[morphName];
                if (aidx === undefined) continue;
                var current = mesh.morphTargetInfluences[aidx];
                if (current > 0.001) {
                    mesh.morphTargetInfluences[aidx] = current * 0.88; // exponential decay
                    _prevValues[morphName] = mesh.morphTargetInfluences[aidx];
                }
            }
        }
    }

    function stop() {
        _active = false;
        // Smooth close — decay all mouth morphs
        for (var m = 0; m < morphMeshes.length; m++) {
            var mesh = morphMeshes[m];
            if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
            for (var i = 0; i < ALL_MOUTH_MORPHS.length; i++) {
                var idx = mesh.morphTargetDictionary[ALL_MOUTH_MORPHS[i]];
                if (idx !== undefined) {
                    mesh.morphTargetInfluences[idx] = 0;
                }
            }
        }
        _prevValues = {};
        _timeline = [];
        console.log('[AlignmentLipSync] ⏹ Stopped');
    }

    function isActive() {
        return _active;
    }

    function dispose() {
        stop();
        morphMeshes = [];
        _alignment = null;
        _audioCtx = null;
    }

    // ── Export ──
    window.AlignmentLipSync = {
        setMorphMeshes: setMorphMeshes,
        setAudioContext: setAudioContext,
        load: load,
        start: start,
        update: update,
        stop: stop,
        isActive: isActive,
        dispose: dispose
    };

    console.log('[AlignmentLipSync] ✅ Professional lip sync engine loaded');
})();
