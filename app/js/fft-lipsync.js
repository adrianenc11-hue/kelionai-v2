// ═══════════════════════════════════════════════════════════════
// App v2 — Viseme Lip Sync Engine
// Supports 15 Oculus visemes + ARKit blend shapes
// Replaces old FFT-only approach with proper multi-morph viseme mapping
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  let morphMeshes = [];
  let audioCtx = null;
  let analyser = null;
  let dataArray = null;
  let isRunning = false;
  let fftActive = false;
  const connectedElements = new WeakSet();

  // ── Viseme morph targets (Oculus standard) ──
  const VISEME_MORPHS = [
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
  ];

  // ── ARKit mouth morphs (supplementary) ──
  const ARKIT_MOUTH = [
    'jawOpen',
    'mouthOpen',
    'mouthSmile',
    'mouthFunnel',
    'mouthPucker',
    'mouthClose',
    'mouthSmileLeft',
    'mouthSmileRight',
  ];

  // ── Legacy morphs (backward compat with older models) ──
  const LEGACY_MOUTH = ['Smile', 'jawOpen', 'mouthOpen', 'JawOpen', 'mouth_open'];

  // ── Frequency band → viseme mapping ──
  // Low (100-500Hz) = jaw movement, vowels
  // Mid (500-2000Hz) = consonants, sibilants
  // High (2000-4000Hz) = fricatives
  const BAND_LOW = { start: 2, end: 8 };
  const BAND_MID = { start: 8, end: 25 };
  const BAND_HI = { start: 25, end: 45 };

  // Smoothing — dynamic attack/release for natural feel
  let prevValues = {};
  const SMOOTH_ATTACK = 0.2; // controlled attack
  const SMOOTH_RELEASE = 0.1; // gentle release

  // ── Mouth opening clamp — CONTROLLED movement (not exaggerated) ──
  const MAX_MOUTH_OPEN = 0.18;
  const MAX_VISEME_AA = 0.25;
  const MAX_VISEME = 0.22;

  // ── Mouth amplitude multiplier — read dynamically each frame for live tuning ──
  function _getMouthMult() {
    return parseFloat(localStorage.getItem('kelion_mouth_mult') || '0.6');
  }

  // ── Coarticulation — blend previous viseme into current ──
  const _prevVisemes = {};
  const COARTIC_BLEND = 0.1; // 10% — less blend = more distinct shapes

  function SimpleLipSync() {}

  SimpleLipSync.prototype.setMorphMeshes = function (meshes) {
    morphMeshes = meshes;
    prevValues = {};
  };

  SimpleLipSync.prototype.connectToContext = function (ctx) {
    try {
      audioCtx = ctx;
      if (audioCtx.state === 'suspended') audioCtx.resume();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512; // CINEMATIC: doubled for better frequency resolution
      analyser.smoothingTimeConstant = 0.35; // slightly less smoothing for snappier response
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      console.log('[LipSync] Viseme engine connected, fftSize=512');
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
        const sourceNode = audioCtx.createMediaElementSource(audioEl);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 512; // CINEMATIC: doubled
        analyser.smoothingTimeConstant = 0.35;
        sourceNode.connect(analyser);
        analyser.connect(audioCtx.destination);
        dataArray = new Uint8Array(analyser.frequencyBinCount);
        connectedElements.add(audioEl);
        return true;
      } catch (_e) {
        console.warn('[LipSync] MediaElementSource failed');
        return false;
      }
    } catch (_e) {
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
    let low = _bandAvg(BAND_LOW.start, BAND_LOW.end);
    let mid = _bandAvg(BAND_MID.start, BAND_MID.end);
    let hi = _bandAvg(BAND_HI.start, BAND_HI.end);

    // Normalize (0-1) with noise gate
    const NOISE_GATE = 8;
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
    const _mm = _getMouthMult();
    function clamp(v, max) {
      return Math.min(v * _mm, (max || MAX_VISEME) * _mm);
    }

    const visemes = {
      // Jaw open — driven by low freq (vowels)
      jawOpen: clamp(low * 0.3, MAX_MOUTH_OPEN),
      mouthOpen: clamp(low * 0.22, MAX_MOUTH_OPEN),

      // Vowels — driven by low + mid (both naming conventions)
      viseme_aa: clamp(low * 0.5, MAX_VISEME_AA),
      aa: clamp(low * 0.5, MAX_VISEME_AA),
      viseme_O: clamp(low * 0.4 * (1 - mid * 0.3)),
      oh: clamp(low * 0.4 * (1 - mid * 0.3)),
      viseme_E: clamp(mid * 0.45 * (1 - low * 0.2)),
      E: clamp(mid * 0.45 * (1 - low * 0.2)),
      viseme_I: clamp(mid * 0.35 * (1 - low * 0.4)),
      ih: clamp(mid * 0.35 * (1 - low * 0.4)),
      viseme_U: clamp(low * 0.25 + mid * 0.15),
      ou: clamp(low * 0.25 + mid * 0.15),

      // Consonants — driven by mid + hi (both naming conventions)
      viseme_PP: mid > 0.3 ? clamp((1 - low) * 0.22) : 0,
      PP: mid > 0.3 ? clamp((1 - low) * 0.22) : 0,
      viseme_FF: clamp(hi * 0.35),
      FF: clamp(hi * 0.35),
      viseme_TH: clamp(hi * 0.22 + mid * 0.13),
      TH: clamp(hi * 0.22 + mid * 0.13),
      viseme_DD: clamp(mid * 0.25 + low * 0.1),
      DD: clamp(mid * 0.25 + low * 0.1),
      viseme_kk: clamp(mid * 0.22 * (1 - hi * 0.3)),
      kk: clamp(mid * 0.22 * (1 - hi * 0.3)),
      viseme_CH: clamp(hi * 0.4),
      CH: clamp(hi * 0.4),
      viseme_SS: clamp(hi * 0.45),
      SS: clamp(hi * 0.45),
      viseme_nn: clamp(mid * 0.22),
      nn: clamp(mid * 0.22),
      viseme_RR: clamp(mid * 0.3 + low * 0.13),
      RR: clamp(mid * 0.3 + low * 0.13),
      viseme_sil: 0,
      sil: 0,

      // Supplementary ARKit — subtle mouth movement
      mouthSmile: clamp(mid * 0.1),
      mouthFunnel: clamp(low * 0.22 * (1 - mid)),
      mouthPucker: clamp(low * 0.15 + mid * 0.07),
      mouthClose: low < 0.05 && mid < 0.05 ? 0.07 : 0,
      mouthRollLower: clamp(mid * 0.07),
      mouthRollUpper: clamp(mid * 0.05),
      mouthShrugLower: clamp(low * 0.09 * (1 - mid)),
      mouthShrugUpper: clamp(mid * 0.06),
      jawLeft: clamp(Math.sin(Date.now() * 0.003) * mid * 0.03),
      jawRight: clamp(Math.cos(Date.now() * 0.003) * mid * 0.03),
      mouthStretchLeft: clamp(low * 0.07),
      mouthStretchRight: clamp(low * 0.07),
      mouthLowerDownLeft: clamp(low * 0.1),
      mouthLowerDownRight: clamp(low * 0.1),
      mouthUpperUpLeft: clamp(mid * 0.06),
      mouthUpperUpRight: clamp(mid * 0.06),
      mouthDimpleLeft: clamp(mid * 0.04),
      mouthDimpleRight: clamp(mid * 0.04),
    };

    // Apply with CINEMATIC smoothing (dynamic attack/release + coarticulation)
    for (let m = 0; m < morphMeshes.length; m++) {
      const mesh = morphMeshes[m];
      if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
      for (const name in visemes) {
        const idx = mesh.morphTargetDictionary[name];
        if (idx === undefined) continue;
        let target = visemes[name];

        // Coarticulation: blend 15% of previous viseme shape
        const prevShape = _prevVisemes[name] || 0;
        target = target * (1 - COARTIC_BLEND) + prevShape * COARTIC_BLEND;

        const prev = prevValues[name] || 0;
        // Dynamic smoothing: attack faster than release
        const factor = target > prev ? SMOOTH_ATTACK : SMOOTH_RELEASE;
        let smoothed = prev + (target - prev) * factor;

        // CINEMATIC: add subtle asymmetry for realism (left side slightly ahead)
        const asymOffset = name.indexOf('Left') !== -1 || name.indexOf('left') !== -1 ? 0.02 : 0;
        smoothed = Math.min(smoothed + asymOffset, 1);

        mesh.morphTargetInfluences[idx] = smoothed;
        prevValues[name] = smoothed;
      }
    }
    // Store current visemes for next frame's coarticulation
    for (const k in visemes) _prevVisemes[k] = visemes[k];
  };

  function _bandAvg(start, end) {
    if (!dataArray) return 0;
    let sum = 0;
    let count = 0;
    end = Math.min(end, dataArray.length);
    for (let i = start; i < end; i++) {
      sum += dataArray[i];
      count++;
    }
    return count > 0 ? sum / count : 0;
  }

  SimpleLipSync.prototype.stop = function () {
    fftActive = false;
    isRunning = false;
    if (analyser) {
      try {
        analyser.disconnect();
      } catch (_e) {
        /* ignored */
      }
      analyser = null;
      dataArray = null;
    }
    this._resetMouth();
    prevValues = {};
    console.log('[LipSync] STOPPED — mouth closed');
  };

  SimpleLipSync.prototype._resetMouth = function () {
    for (let m = 0; m < morphMeshes.length; m++) {
      const mesh = morphMeshes[m];
      if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;

      // Hard reset ALL viseme + mouth morphs to zero
      const allMorphs = VISEME_MORPHS.concat(ARKIT_MOUTH).concat(LEGACY_MOUTH);
      for (let i = 0; i < allMorphs.length; i++) {
        const idx = mesh.morphTargetDictionary[allMorphs[i]];
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
    for (let m = 0; m < morphMeshes.length; m++) {
      const mesh = morphMeshes[m];
      if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
      for (let i = 0; i < LEGACY_MOUTH.length; i++) {
        const idx = mesh.morphTargetDictionary[LEGACY_MOUTH[i]];
        if (idx !== undefined) {
          const current = mesh.morphTargetInfluences[idx];
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

  // Romanian phoneme → viseme mapping (controlled amplitude)
  const PHONEME_VISEME = {
    a: { viseme_aa: 0.09, jawOpen: 0.07 },
    ă: { viseme_aa: 0.06, jawOpen: 0.05 },
    â: { viseme_aa: 0.05, jawOpen: 0.04 },
    î: { viseme_I: 0.06, jawOpen: 0.02 },
    e: { viseme_E: 0.08, jawOpen: 0.04 },
    i: { viseme_I: 0.06, jawOpen: 0.02 },
    o: { viseme_O: 0.08, mouthFunnel: 0.05, jawOpen: 0.05 },
    u: { viseme_U: 0.07, mouthPucker: 0.05, jawOpen: 0.02 },
    b: { viseme_PP: 0.07 },
    p: { viseme_PP: 0.07 },
    m: { viseme_PP: 0.06 },
    f: { viseme_FF: 0.07 },
    v: { viseme_FF: 0.06 },
    s: { viseme_SS: 0.06 },
    z: { viseme_SS: 0.05 },
    ș: { viseme_CH: 0.06 },
    ț: { viseme_SS: 0.04, viseme_DD: 0.04 },
    t: { viseme_DD: 0.05 },
    d: { viseme_DD: 0.05 },
    n: { viseme_nn: 0.06 },
    l: { viseme_nn: 0.04, jawOpen: 0.02 },
    r: { viseme_RR: 0.06, jawOpen: 0.02 },
    c: { viseme_kk: 0.05 },
    g: { viseme_kk: 0.05 },
    h: { jawOpen: 0.04 },
    j: { viseme_CH: 0.04 },
    k: { viseme_kk: 0.05 },
    ' ': { viseme_sil: 0.05 },
    '.': {},
    ',': { viseme_sil: 0.02 },
    '!': {},
    '?': {},
  };

  TextLipSync.prototype.speak = function (text) {
    this.stop();
    this.text = text;
    this.charIndex = 0;
    const self = this;

    function tick() {
      if (self.charIndex >= self.text.length) {
        self.stop();
        return;
      }

      const ch = self.text[self.charIndex].toLowerCase();
      let visemes = PHONEME_VISEME[ch];
      if (!visemes) {
        visemes = ch >= 'a' && ch <= 'z' ? { jawOpen: 0.06, viseme_aa: 0.04 } : {};
      }

      const isPause = ch === '.' || ch === '!' || ch === '?' || ch === ',' || ch === ' ' || ch === '\n';

      for (let m = 0; m < morphMeshes.length; m++) {
        const mesh = morphMeshes[m];
        if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;

        // First, decay all visemes
        for (let vi = 0; vi < VISEME_MORPHS.length; vi++) {
          const vIdx = mesh.morphTargetDictionary[VISEME_MORPHS[vi]];
          if (vIdx !== undefined) {
            mesh.morphTargetInfluences[vIdx] *= isPause ? 0 : 0.7;
          }
        }
        // Decay ARKit mouth
        for (let ai = 0; ai < ARKIT_MOUTH.length; ai++) {
          const aIdx = mesh.morphTargetDictionary[ARKIT_MOUTH[ai]];
          if (aIdx !== undefined) {
            mesh.morphTargetInfluences[aIdx] *= isPause ? 0 : 0.7;
          }
        }

        // Then apply current phoneme's visemes
        if (!isPause) {
          for (const name in visemes) {
            const idx = mesh.morphTargetDictionary[name];
            if (idx !== undefined) {
              const current = mesh.morphTargetInfluences[idx];
              mesh.morphTargetInfluences[idx] = current + (visemes[name] - current) * 0.25;
            }
          }
        }
      }

      self.charIndex++;

      let delay = self.msPerChar;
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
    for (let m = 0; m < morphMeshes.length; m++) {
      const mesh = morphMeshes[m];
      if (!mesh.morphTargetDictionary || !mesh.morphTargetInfluences) continue;
      const allMorphs = VISEME_MORPHS.concat(ARKIT_MOUTH).concat(LEGACY_MOUTH);
      for (let i = 0; i < allMorphs.length; i++) {
        const idx = mesh.morphTargetDictionary[allMorphs[i]];
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
