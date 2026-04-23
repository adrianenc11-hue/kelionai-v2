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
// Additions (Apr-2026):
//   - `pickBestRearCameraDeviceId()` — walks enumerateDevices() to find
//     the most capable back-facing camera (the "Main" / "Wide" lens on
//     phones with multiple rear lenses). Falls back to plain
//     `facingMode: 'environment'` when device labels are empty (desktop
//     / permission not yet granted).
//   - `requestCameraZoom(level)` — applies a live MediaStreamTrack
//     constraint for the `zoom` capability (Android Chrome; iOS Safari
//     does not expose zoom yet but this degrades gracefully).
//   - `captureHighResSnapshot({ maxWidth })` — pulls a native-resolution
//     JPEG for the `what_do_you_see` tool so Kelion can read distant
//     text (license plates, signs). The 1-Hz passive buffer is 480 px
//     wide which is useless past ~2 m.
//
// No React state, no renders — just a module-level ref. The controller
// function is replaced (not stacked) when a transport mounts, so only
// the most recent transport is active. That matches the app's behaviour:
// exactly one voice transport is live at any time.

let controller = null
let currentFacingMode = 'user'

export function setCameraController(impl) {
  // `impl` is `{ restart({ facingMode, deviceId? }), getFacingMode(),
  // applyZoom?(level), captureHighResSnapshot?({ maxWidth }) }` or null
  // to unregister.
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

// Rank a video-input device label so we can pick the best rear camera
// on phones that expose 2-4 back lenses. Higher score = prefer.
//
// iOS Safari labels the combined multi-lens virtual device as
// "Back Triple Camera" / "Back Dual Camera" — picking that one lets
// Apple's ISP auto-switch between wide/ultra-wide/telephoto based on
// zoom level, which gives us the best real-world quality. On Android
// Chrome the "camera2 legacy" devices usually show up as "camera2 0
// (back)" / "camera2 2 (back)" — we prefer the lowest numeric id
// because that's conventionally the main sensor.
function scoreRearCamera(label) {
  const L = (label || '').toLowerCase()
  // Non-back cameras get -Infinity so they're always filtered out.
  const isBack = /back|rear|environment|trás|arrière|trasera|hátsó|задн|arrière/.test(L)
  const isSelfie = /front|user|selfie|face/.test(L) && !isBack
  if (isSelfie) return -Infinity
  let s = isBack ? 0 : -1000  // unlabeled devices score low but not -Inf
  if (/triple/.test(L)) s += 300
  if (/dual\s*wide/.test(L)) s += 260
  if (/dual/.test(L)) s += 250
  if (/wide(?!\s*angle)/.test(L)) s += 220  // "Wide" lens (main)
  if (/main/.test(L)) s += 210
  if (/telephoto|tele\b/.test(L)) s += 120   // good at distance but narrow FOV
  if (/ultra[\s-]?wide|ultrawide/.test(L)) s += 80  // widest FOV, low detail
  if (/depth|lidar|infrared|ir\b/.test(L)) s -= 500  // not a photo sensor
  // Android often suffixes with the hardware index "camera2 0 (back)";
  // lower index = main sensor on most devices.
  const idxMatch = L.match(/camera2\s+(\d+)/)
  if (idxMatch) s += Math.max(0, 50 - Number(idxMatch[1]) * 10)
  return s
}

// enumerateDevices + score → deviceId for the best rear camera, or null
// if we can't make an informed pick (labels empty before permission
// grant; single-camera desktop; etc.).
export async function pickBestRearCameraDeviceId() {
  try {
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.enumerateDevices !== 'function') {
      return null
    }
    const devices = await navigator.mediaDevices.enumerateDevices()
    const cams = (devices || []).filter((d) => d && d.kind === 'videoinput')
    if (cams.length <= 1) return null  // nothing to choose between
    // Browsers return empty `label` strings until the user has granted
    // camera permission at least once. Without labels we can't rank,
    // so fall back to pure `facingMode: 'environment'`.
    const anyLabeled = cams.some((d) => (d.label || '').trim().length > 0)
    if (!anyLabeled) return null
    let best = null
    let bestScore = -Infinity
    for (const d of cams) {
      const s = scoreRearCamera(d.label)
      if (s > bestScore) {
        bestScore = s
        best = d
      }
    }
    if (!best || bestScore <= 0) return null
    return best.deviceId || null
  } catch {
    return null
  }
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
    // For the back camera, try to pick the best lens if labels are
    // available. `restart` falls back to `facingMode` when deviceId is
    // null. On the front side we let the browser choose — phones only
    // have one selfie camera and ranking empty labels is noise.
    const deviceId = facingMode === 'environment' ? await pickBestRearCameraDeviceId() : null
    await controller.restart({ facingMode, deviceId })
    setCurrentFacingMode(facingMode)
    return { ok: true, facingMode, side: facingMode === 'user' ? 'front' : 'back', deviceId: deviceId || null }
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'Failed to switch camera.' }
  }
}

// Apply a live zoom level to the currently-active camera track.
// `level` is either:
//   - a number interpreted against the track's [min, max] capability
//     range (e.g. 2 → 2× optical/digital zoom where supported);
//   - the string 'in' / 'out' / 'reset' for relative steps;
// Returns { ok, zoom, min, max, step } on success or { ok:false, error }.
export async function requestCameraZoom(level) {
  if (!controller || typeof controller.applyZoom !== 'function') {
    return { ok: false, error: 'Zoom is not supported by the active camera.' }
  }
  try {
    return await controller.applyZoom(level)
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'Zoom failed.' }
  }
}

// Pull a high-resolution snapshot for on-demand vision (license plates,
// distant text, fine detail). Returns { ok, dataUrl } or { ok:false,
// error }. Falls back to whatever `getLatestCameraFrame` holds when the
// transport doesn't implement the snapshot path.
export async function captureHighResSnapshot(opts = {}) {
  if (!controller || typeof controller.captureHighResSnapshot !== 'function') {
    return { ok: false, error: 'High-res snapshot not supported on this transport.' }
  }
  try {
    return await controller.captureHighResSnapshot(opts)
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'Snapshot failed.' }
  }
}
