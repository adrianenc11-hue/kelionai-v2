// Module-level registry for the active camera controller.
//
// Both voice transports (openaiRealtime.js, geminiLive.js) expose a
// `startCamera({ facingMode })` / `stopCamera()` pair. They register their
// controller here on mount and unregister on unmount. The `switch_camera`
// tool handler in kelionTools.js calls `requestCameraSwitch('front' | 'back')`
// which resolves to `facingMode: 'user' | 'environment'` and asks the
// currently-mounted transport to restart its camera with the new mode.
//
// Rationale: the camera is hardcoded to `facingMode: 'user'` in both
// transports today (see openaiRealtime.js:797 and geminiLive.js:835) so
// on phones Kelion always sees the selfie camera. Mobile users want to
// flip to the rear camera for "what's that building over there?" — this
// tool is how the model invokes the switch.
//
// No React state, no renders — just a module-level ref. The controller
// function is replaced (not stacked) when a transport mounts, so only
// the most recent transport is active. That matches the app's behaviour:
// exactly one voice transport is live at any time.

let controller = null
let currentFacingMode = 'user'

export function setCameraController(impl) {
  // `impl` is `{ restart({ facingMode }), getFacingMode() }` or null to unregister.
  controller = impl || null
}

export function getCameraController() {
  return controller
}

export function getCurrentFacingMode() {
  try {
    if (controller && typeof controller.getFacingMode === 'function') {
      return controller.getFacingMode() || currentFacingMode
    }
  } catch { /* fall through */ }
  return currentFacingMode
}

export function setCurrentFacingMode(mode) {
  if (mode === 'user' || mode === 'environment') currentFacingMode = mode
}

// Normalise a voice-model argument like 'front' / 'back' / 'rear' /
// 'selfie' / 'environment' to the underlying `facingMode` string.
export function normaliseSide(side) {
  const s = String(side || '').trim().toLowerCase()
  if (s === 'front' || s === 'user' || s === 'selfie' || s === 'face') return 'user'
  if (s === 'back' || s === 'rear' || s === 'environment' || s === 'world') return 'environment'
  return null
}

export async function requestCameraSwitch(side) {
  const facingMode = normaliseSide(side)
  if (!facingMode) {
    return { ok: false, error: `Unknown camera side '${side}'. Use 'front' or 'back'.` }
  }
  if (!controller || typeof controller.restart !== 'function') {
    return { ok: false, error: 'Camera is not active. Tell the user to tap the camera button first.' }
  }
  try {
    await controller.restart({ facingMode })
    setCurrentFacingMode(facingMode)
    return { ok: true, facingMode, side: facingMode === 'user' ? 'front' : 'back' }
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'Failed to switch camera.' }
  }
}
