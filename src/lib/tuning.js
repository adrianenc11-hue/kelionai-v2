// Runtime tuning store.
//
// Holds mutable parameters that let us tune avatar behaviour (lip-sync
// envelope, jaw amplitude, body yaw, expression weights, …) without a
// rebuild + redeploy cycle. The object is read on every animation frame
// by `KelionStage.jsx` and `lipSync.js`; the Leva debug panel in
// `TuningPanel.jsx` (visible only when the URL contains `?debug=1`)
// writes into it live.
//
// Design notes
// - We deliberately mutate a single exported object rather than using a
//   React store: the consumers here run inside a requestAnimationFrame
//   loop (60 Hz) and we don't want a re-render on every slider drag.
// - Defaults match the values Adrian approved in PR #60 (lip-sync
//   rewrite) and PR #62 (avatar yaw -3°) so the out-of-box behaviour
//   is identical when the panel is not mounted.
// - Listeners are opt-in; code that needs to react to a change (e.g. to
//   persist tuning into localStorage) subscribes via `onTuningChange`.

export const TUNING = {
  // Avatar body yaw
  //   Idle target = BASE_FACING_OFFSET (-3° so Kelion faces the camera)
  //   Presenting target = BASE_FACING_OFFSET + PRESENTING_YAW (-11° total)
  avatarBaseYaw: -0.0524,        // radians; -3°
  avatarPresentingYaw: -0.14,    // radians; -8° additional toward monitor

  // Lip-sync amplitudes applied in KelionStage AvatarModel
  jawAmplitude: 0.22,            // multiplier for bone rotation.x
  morphAmplitude: 0.85,          // multiplier for viseme_aa / mouthOpen morph (clamped ≤1)

  // Lip-sync envelope (lipSync.js)
  lipAttack: 0.45,               // 0..1 exponential smoothing on rising energy
  lipRelease: 0.08,              // 0..1 exponential smoothing on falling energy
  lipFormantWeight: 1.5,         // gain multiplier for the 200–2000 Hz band vs rest of speech band
  lipPeakDecay: 0.9995,          // auto-gain rolling peak decay per frame

  // Eye look (KelionStage AvatarModel, optional — consumed if non-null)
  eyeLookX: 0,                   // -0.5..+0.5 rad, left/right gaze offset
  eyeLookY: 0,                   // -0.5..+0.5 rad, up/down gaze offset

  // Expression baseline weights blended on top of automatic emotion morphs
  expressionSmile: 0,            // 0..1 added to mouthSmile
  expressionBrowInnerUp: 0,      // 0..1 added to browInnerUp
}

const listeners = new Set()

/** Patch the tuning object in one place so listeners fire once per change. */
export function updateTuning(patch) {
  Object.assign(TUNING, patch)
  for (const fn of listeners) {
    try { fn(TUNING) } catch { /* ignore listener errors */ }
  }
}

/** Subscribe to tuning changes. Returns an unsubscribe function. */
export function onTuningChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Truthy when the current URL opts into the tuning UI. Safe on SSR. */
export function isTuningEnabled() {
  if (typeof window === 'undefined') return false
  try {
    const params = new URLSearchParams(window.location.search)
    return params.has('debug') || params.has('tune')
  } catch {
    return false
  }
}
