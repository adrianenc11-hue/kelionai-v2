// ═══════════════════════════════════════════════════════════════
// App — Professional Alignment Lip Sync Engine
// Uses ElevenLabs character-level timestamps for precise viseme animation
// Supports 15 Oculus visemes + ARKit blend shapes
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  let morphMeshes = [];
  let _active = false;
  let _alignment = null; // { characters, character_start_times_seconds, character_end_times_seconds }
  let _audioStartTime = 0; // AudioContext.currentTime when playback started
  let _audioCtx = null;
  let _prevValues = {};

  // ── Smoothing constants ──
  const SMOOTH_ATTACK = 0.22; // controlled attack — natural opening
  const SMOOTH_RELEASE = 0.12; // gentle release — no snapping
  const COARTIC_BLEND = 0.12; // 12% blend from previous shape
  const ASYMMETRY_OFFSET = 0.015; // left side leads slightly

  // ── Clamp constants — CONTROLLED mouth movement (not exaggerated) ──
  const MAX_JAW = 0.2;
  const MAX_VOWEL = 0.28;
  const MAX_VISEME = 0.25;

  // ── Character → Phoneme class mapping ──
  // Groups: V_OPEN, V_MID, V_CLOSE, V_ROUND, V_TIGHT, C_BILABIAL, C_LABIO,
  //         C_DENTAL, C_ALVEOLAR, C_PALATAL, C_VELAR, C_SIBILANT, C_NASAL, SILENCE
  const CHAR_PHONEME = {
    // Romanian vowels
    a: 'V_OPEN',
    ă: 'V_MID',
    â: 'V_MID',
    î: 'V_CLOSE',
    e: 'V_MID',
    i: 'V_CLOSE',
    o: 'V_ROUND',
    u: 'V_TIGHT',
    // English vowels (additional)
    y: 'V_CLOSE',
    // Bilabial: lips together
    b: 'C_BILABIAL',
    p: 'C_BILABIAL',
    m: 'C_NASAL',
    // Labiodental: lip + teeth
    f: 'C_LABIO',
    v: 'C_LABIO',
    // Dental/Alveolar
    t: 'C_DENTAL',
    d: 'C_DENTAL',
    n: 'C_NASAL',
    l: 'C_ALVEOLAR',
    r: 'C_ALVEOLAR',
    // Sibilants
    s: 'C_SIBILANT',
    z: 'C_SIBILANT',
    ș: 'C_PALATAL',
    ț: 'C_SIBILANT',
    // Palatal/Postalveolar
    c: 'C_VELAR',
    g: 'C_VELAR',
    k: 'C_VELAR',
    h: 'C_VELAR',
    j: 'C_PALATAL',
    ş: 'C_PALATAL',
    ţ: 'C_SIBILANT',
    q: 'C_VELAR',
    w: 'V_TIGHT',
    x: 'C_SIBILANT',
    // Silence
    ' ': 'SILENCE',
    '.': 'SILENCE',
    ',': 'SILENCE',
    '!': 'SILENCE',
    '?': 'SILENCE',
    '-': 'SILENCE',
    ':': 'SILENCE',
    ';': 'SILENCE',
    '"': 'SILENCE',
    "'": 'SILENCE',
    '\n': 'SILENCE',
    '\r': 'SILENCE',
    '(': 'SILENCE',
    ')': 'SILENCE',
  };

  // ── Phoneme class → Viseme weight map ──
  // Each maps to multiple morph targets with calibrated weights
  const PHONEME_VISEMES = {
    V_OPEN: {
      viseme_aa: 0.1,
      aa: 0.1,
      jawOpen: 0.07,
      mouthOpen: 0.06,
      mouthLowerDownLeft: 0.03,
      mouthLowerDownRight: 0.03,
    },
    V_MID: {
      viseme_E: 0.09,
      E: 0.09,
      jawOpen: 0.05,
      mouthOpen: 0.04,
      mouthStretchLeft: 0.04,
      mouthStretchRight: 0.04,
    },
    V_CLOSE: {
      viseme_I: 0.09,
      ih: 0.09,
      jawOpen: 0.04,
      mouthStretchLeft: 0.05,
      mouthStretchRight: 0.05,
      mouthSmileLeft: 0.02,
      mouthSmileRight: 0.02,
    },
    V_ROUND: {
      viseme_O: 0.09,
      oh: 0.09,
      jawOpen: 0.05,
      mouthFunnel: 0.06,
      mouthPucker: 0.04,
    },
    V_TIGHT: {
      viseme_U: 0.1,
      ou: 0.1,
      mouthPucker: 0.08,
      mouthFunnel: 0.05,
      jawOpen: 0.03,
    },
    C_BILABIAL: {
      viseme_PP: 0.12,
      PP: 0.12,
      mouthClose: 0.07,
      mouthPressLeft: 0.04,
      mouthPressRight: 0.04,
    },
    C_LABIO: {
      viseme_FF: 0.1,
      FF: 0.1,
      mouthUpperUpLeft: 0.04,
      mouthUpperUpRight: 0.04,
      mouthRollLower: 0.04,
    },
    C_DENTAL: {
      viseme_DD: 0.09,
      DD: 0.09,
      jawOpen: 0.04,
      mouthUpperUpLeft: 0.02,
      mouthUpperUpRight: 0.02,
    },
    C_ALVEOLAR: {
      viseme_RR: 0.09,
      RR: 0.09,
      jawOpen: 0.05,
      mouthStretchLeft: 0.02,
      mouthStretchRight: 0.02,
    },
    C_SIBILANT: {
      viseme_SS: 0.1,
      SS: 0.1,
      mouthStretchLeft: 0.04,
      mouthStretchRight: 0.04,
      jawOpen: 0.02,
    },
    C_PALATAL: {
      viseme_CH: 0.09,
      CH: 0.09,
      mouthFunnel: 0.04,
      jawOpen: 0.04,
    },
    C_VELAR: {
      viseme_kk: 0.09,
      kk: 0.09,
      jawOpen: 0.05,
    },
    C_NASAL: {
      viseme_nn: 0.09,
      nn: 0.09,
      mouthClose: 0.04,
      mouthPressLeft: 0.02,
      mouthPressRight: 0.02,
    },
    SILENCE: {
      viseme_sil: 0.01,
      sil: 0.01,
    },
  };

  // ── Pre-computed timeline: array of { startTime, endTime, visemes: {} } ──
  let _timeline = [];

  // ── Build timeline from alignment data ──
  function _buildTimeline(alignment) {
    _timeline = [];
    if (!alignment || !alignment.characters) return;

    const chars = alignment.characters;
    const starts = alignment.character_start_times_seconds;
    const ends = alignment.character_end_times_seconds;

    for (let i = 0; i < chars.length; i++) {
      const ch = (chars[i] || '').toLowerCase();
      const phonemeClass = CHAR_PHONEME[ch] || 'SILENCE';
      const visemes = PHONEME_VISEMES[phonemeClass] || PHONEME_VISEMES['SILENCE'];

      _timeline.push({
        startTime: starts[i] || 0,
        endTime: ends[i] || 0,
        visemes: visemes,
        phonemeClass: phonemeClass,
        char: ch,
      });
    }
    console.log(
      '[AlignmentLipSync] Timeline built:',
      _timeline.length,
      'entries,',
      'duration:',
      _timeline.length > 0 ? _timeline[_timeline.length - 1].endTime.toFixed(2) + 's' : '0s'
    );
  }

  // ── Cubic ease-in-out for natural transitions ──
  function _cubicEase(t) {
    if (t < 0) return 0;
    if (t > 1) return 1;
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  // ── Get blended viseme weights at a specific time ──
  function _getVisemesAtTime(currentTime) {
    const result = {};

    if (_timeline.length === 0) return result;

    // Find active timeline entry
    let activeIdx = -1;
    for (let i = 0; i < _timeline.length; i++) {
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

    const entry = _timeline[activeIdx];
    const duration = entry.endTime - entry.startTime;
    const progress = duration > 0 ? (currentTime - entry.startTime) / duration : 0;

    // Apply cubic easing for natural in/out within each phoneme
    const eased = _cubicEase(progress);

    // Envelope: ramp up in first 30%, sustain 40%, ramp down last 30%
    let envelope = 1.0;
    if (eased < 0.3) {
      envelope = eased / 0.3; // ramp up
    } else if (eased > 0.7) {
      envelope = (1.0 - eased) / 0.3; // ramp down
    }

    // Apply current phoneme's visemes with envelope
    for (const key in entry.visemes) {
      result[key] = entry.visemes[key] * envelope;
    }

    // Coarticulation: blend with next phoneme (lookahead)
    if (activeIdx + 1 < _timeline.length && eased > 0.6) {
      const nextEntry = _timeline[activeIdx + 1];
      const blendFactor = ((eased - 0.6) / 0.4) * COARTIC_BLEND;
      for (const nk in nextEntry.visemes) {
        result[nk] = (result[nk] || 0) + nextEntry.visemes[nk] * blendFactor;
      }
    }

    // Coarticulation: blend with previous phoneme (lookbehind)
    if (activeIdx > 0 && eased < 0.3) {
      const prevEntry = _timeline[activeIdx - 1];
      const prevBlend = ((0.3 - eased) / 0.3) * COARTIC_BLEND;
      for (const pk in prevEntry.visemes) {
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
  const ALL_MOUTH_MORPHS = [
    'viseme_sil',
    'viseme_PP',
    'viseme_FF',
    'viseme_TH',
    'viseme_DD',
    'viseme_kk',
    'viseme_CH',
    'viseme_SS',
    'viseme_nn',
    'viseme_RR',
    'viseme_aa',
    'viseme_E',
    'viseme_I',
    'viseme_O',
    'viseme_U',
    'sil',
    'PP',
    'FF',
    'TH',
    'DD',
    'kk',
    'CH',
    'SS',
    'nn',
    'RR',
    'aa',
    'E',
    'ih',
    'oh',
    'ou',
    'jawOpen',
    'mouthOpen',
    'mouthSmile',
    'mouthFunnel',
    'mouthPucker',
    'mouthClose',
    'mouthSmileLeft',
    'mouthSmileRight',
    'mouthPressLeft',
    'mouthPressRight',
    'mouthRollLower',
    'mouthRollUpper',
    'mouthShrugLower',
    'mouthShrugUpper',
    'mouthStretchLeft',
    'mouthStretchRight',
    'mouthLowerDownLeft',
    'mouthLowerDownRight',
    'mouthUpperUpLeft',
    'mouthUpperUpRight',
    'mouthDimpleLeft',
    'mouthDimpleRight',
    'jawLeft',
    'jawRight',
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

    const currentTime = _audioCtx.currentTime - _audioStartTime;

    // Past the end? Stop
    if (currentTime > _timeline[_timeline.length - 1].endTime + 0.3) {
      stop();
      return;
    }

    const targetVisemes = _getVisemesAtTime(currentTime);

    // Apply to all morph meshes
    for (let m = 0; m < morphMeshes.length; m++) {
      const mesh = morphMeshes[m];
      if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;

      for (const name in targetVisemes) {
        const idx = mesh.morphTargetDictionary[name];
        if (idx === undefined) continue;

        let target = targetVisemes[name];

        // Live multiplier from localStorage (slider tuning)
        const _mm = parseFloat(localStorage.getItem('kelion_mouth_mult') || '0.6');

        // Apply clamps based on morph type
        let maxVal = MAX_VISEME * _mm;
        if (name === 'jawOpen' || name === 'mouthOpen') maxVal = MAX_JAW * _mm;
        if (name.indexOf('viseme_aa') >= 0 || name === 'aa') maxVal = MAX_VOWEL * _mm;
        target = _clamp(target * _mm, maxVal);

        // Asymmetry: left side slightly ahead
        if (name.indexOf('Left') >= 0 || name.indexOf('left') >= 0) {
          target = _clamp(target + ASYMMETRY_OFFSET, maxVal);
        }

        // Dynamic smoothing: attack vs release
        const prev = _prevValues[name] || 0;
        const factor = target > prev ? SMOOTH_ATTACK : SMOOTH_RELEASE;
        const smoothed = prev + (target - prev) * factor;

        mesh.morphTargetInfluences[idx] = smoothed;
        _prevValues[name] = smoothed;
      }

      // Decay all non-targeted mouth morphs
      for (let ai = 0; ai < ALL_MOUTH_MORPHS.length; ai++) {
        const morphName = ALL_MOUTH_MORPHS[ai];
        if (targetVisemes[morphName] !== undefined) continue; // already handled
        const aidx = mesh.morphTargetDictionary[morphName];
        if (aidx === undefined) continue;
        const current = mesh.morphTargetInfluences[aidx];
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
    for (let m = 0; m < morphMeshes.length; m++) {
      const mesh = morphMeshes[m];
      if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
      for (let i = 0; i < ALL_MOUTH_MORPHS.length; i++) {
        const idx = mesh.morphTargetDictionary[ALL_MOUTH_MORPHS[i]];
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
    dispose: dispose,
  };

  console.log('[AlignmentLipSync] ✅ Professional lip sync engine loaded');
})();
