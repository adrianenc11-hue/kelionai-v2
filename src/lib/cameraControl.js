// Module-level registry for the active camera controller.
//
// Both voice transports (openaiRealtime.js, geminiLive.js) expose a
// `startCamera({ facingMode, deviceId })` / `stopCamera()` pair. They
// register their controller here on mount and unregister on unmount.
//
// Voice tools in kelionTools.js call:
//   - requestCameraStart(side)  — "pornește camera [front|back]"
//   - requestCameraStop()       — "oprește camera"
//   - requestCameraSwitch(side) — "schimbă camera [front|back]"
//   - requestCameraZoom(level)  — "zoom pe număr", "focalizează"
//
// Additions (Apr-2026):
//   - `requestCameraZoom(level)` — applies a live MediaStreamTrack
//     constraint for the `zoom` capability (Android Chrome; iOS Safari
//     does not expose zoom yet but this degrades gracefully with a
//     software-zoom fallback).
//   - `captureHighResSnapshot({ maxWidth })` — pulls a native-resolution
//     JPEG for the `what_do_you_see` tool so Kelion can read distant
//     text (license plates, signs). The 1-Hz passive buffer is 480 px
//     wide which is useless past ~2 m.
//
// Resolution: we ask for `ideal: 3840×2160` (4K) and the browser
// negotiates down to the highest resolution the picked camera can
// produce. Vision frames are still downsampled before send, but a
// higher native capture means license plates stay legible after the
// downsample. See openaiRealtime.js for MAX_W tuning.
//
// No React state, no renders — just a module-level ref. The controller
// function is replaced (not stacked) when a transport mounts, so only
// the most recent transport is active. That matches the app's behaviour:
// exactly one voice transport is live at any time.

let controller = null
let currentFacingMode = 'user'

// Keyword lists are exported so tests can pin the heuristic down.
// The comparison is lowercase `includes`, which is how browsers expose
// device labels (vendor strings like "camera2 1, facing back" on Android
// or "FaceTime HD Camera (Built-in)" on macOS).
export const AVOID_BACK_LABEL_KEYWORDS = [
  'ultra', 'wide', 'tele', 'telephoto', 'depth', 'macro',
  'front', 'user', 'selfie', 'face',
]

export const PREFER_BACK_LABEL_KEYWORDS = [
  'back', 'rear', 'environment', 'world',
  // Android's Camera2 API labels the primary rear lens "0" on most
  // devices; the secondary (ultrawide / tele) get higher indices.
  // "facing back" is the Chromium label for the primary rear camera.
  'facing back', 'back camera',
]

export function setCameraController(impl) {
  // `impl` is an object shaped like:
  //   {
  //     start?({ facingMode, deviceId }) : Promise<void>,
  //     stop?()                          : Promise<void>|void,
  //     restart({ facingMode, deviceId }): Promise<void>,
  //     getFacingMode()                  : 'user'|'environment',
  //     getActiveTrack?()                : MediaStreamTrack|null,
  //     applyZoom?(level)                : Promise<{ ok, zoom? }>,
  //     captureHighResSnapshot?({ maxWidth }) : Promise<Blob|string>,
  //   }
  // Legacy callers registered only `restart` + `getFacingMode`; the
  // new optional fields unlock camera_on / camera_off / zoom_camera
  // and the what_do_you_see hi-res snapshot path.
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


// Score a back-camera candidate by label. Positive score = good rear lens,
// negative = avoid (ultrawide / tele / depth / front). Exported for tests.
export function scoreBackCameraLabel(label) {
  const s = String(label || '').toLowerCase()
  if (!s) return 0
  let score = 0
  for (const kw of AVOID_BACK_LABEL_KEYWORDS) {
    if (s.includes(kw)) score -= 10
  }
  for (const kw of PREFER_BACK_LABEL_KEYWORDS) {
    if (s.includes(kw)) score += 5
  }
  // Android Camera2 indexes the primary back lens as "0" ("camera2 0" /
  // "camera 0, facing back"). Secondary lenses get higher indices and
  // are almost always ultrawide or telephoto. Bump the "0" variant.
  if (/(^|\s|,)0(\s|,|$)/.test(s) || /camera2\s*0\b/.test(s)) score += 3
  return score
}

// Pick the best video input device id for the requested facing mode.
// Returns null if we can't decide — caller should fall back to a plain
// facingMode constraint. Safe to call repeatedly; cheap on its own.
export async function pickBestCameraDeviceId(facingMode) {
  try {
    if (!navigator.mediaDevices?.enumerateDevices) return null
    const devices = await navigator.mediaDevices.enumerateDevices()
    const videos = (devices || []).filter((d) => d.kind === 'videoinput')
    if (videos.length <= 1) return null
    // Labels are empty strings until the page has been granted camera
    // permission at least once. Before that we can't pick intelligently.
    const labelled = videos.filter((d) => d.label && d.label.trim())
    if (labelled.length === 0) return null

    if (facingMode === 'environment') {
      // Rank back-camera candidates by label heuristic. Only consider
      // devices that don't look like the front camera.
      const candidates = labelled
        .map((d) => ({ d, score: scoreBackCameraLabel(d.label) }))
        .filter((c) => c.score > 0)
        .sort((a, b) => b.score - a.score)
      if (candidates.length) return candidates[0].d.deviceId
      return null
    }
    if (facingMode === 'user') {
      // Front camera detection is simpler: most devices have exactly one
      // and label it "front" / "user" / "selfie" / "facetime".
      const hit = labelled.find((d) => /front|user|selfie|face/i.test(d.label))
      return hit ? hit.deviceId : null
    }
    return null
  } catch {
    return null
  }
}

export async function requestCameraStart(side) {
  const facingMode = normaliseSide(side) || 'environment'
  if (!controller) {
    return { ok: false, error: 'Camera controller not mounted. Open Kelion first.' }
  }
  const deviceId = await pickBestCameraDeviceId(facingMode)
  try {
    const fn = controller.start || controller.restart
    if (typeof fn !== 'function') {
      return { ok: false, error: 'Camera controller does not support start.' }
    }
    await fn.call(controller, { facingMode, deviceId })
    setCurrentFacingMode(facingMode)
    return { ok: true, facingMode, deviceId: deviceId || null, side: facingMode === 'user' ? 'front' : 'back' }
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'Failed to start camera.' }
  }
}

export async function requestCameraStop() {
  if (!controller || typeof controller.stop !== 'function') {
    return { ok: false, error: 'Camera is not active.' }
  }
  try {
    await controller.stop()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'Failed to stop camera.' }
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
    const deviceId = await pickBestCameraDeviceId(facingMode)
    await controller.restart({ facingMode, deviceId })
    setCurrentFacingMode(facingMode)
    return { ok: true, facingMode, deviceId: deviceId || null, side: facingMode === 'user' ? 'front' : 'back' }
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'Failed to switch camera.' }
  }
}

// Apply digital zoom to the active video track. Uses
// MediaStreamTrack.applyConstraints({ advanced: [{ zoom }] }) where the
// browser supports native zoom (Android Chrome, many iOS builds); on
// platforms without hardware zoom capability the function resolves as
// `softZoom: true` so the caller knows to fall back to canvas-side
// cropping if it needs a visible effect.
//
// `level` is either a numeric multiplier (1 = no zoom, 2 = 2×, 4 = 4×)
// OR one of the relative keywords 'in' / 'out' / 'reset'. We clamp to
// the track's advertised [min, max] so asking for 10× on a lens capped
// at 3× results in 3× instead of a rejected promise.
export async function requestCameraZoom(level) {
  if (!controller || typeof controller.getActiveTrack !== 'function') {
    return { ok: false, error: 'Camera is not active. Start the camera first.' }
  }
  const track = controller.getActiveTrack()
  if (!track) {
    return { ok: false, error: 'No active camera track. Start the camera first.' }
  }
  // Resolve relative keywords against the current zoom + caps.
  const caps = (track.getCapabilities && track.getCapabilities()) || {}
  let target
  if (typeof level === 'string') {
    const kw = level.trim().toLowerCase()
    const settings = (track.getSettings && track.getSettings()) || {}
    const current = Number(settings.zoom) || 1
    if (kw === 'in') target = current + (caps.zoom?.step || 1)
    else if (kw === 'out') target = Math.max(caps.zoom?.min || 1, current - (caps.zoom?.step || 1))
    else if (kw === 'reset') target = caps.zoom?.min || 1
    else target = Number(kw)
  } else {
    target = Number(level)
  }
  if (!Number.isFinite(target) || target <= 0) {
    return { ok: false, error: 'Zoom level must be a positive number (1 = no zoom) or one of in/out/reset.' }
  }
  try {
    if (caps.zoom && typeof caps.zoom.min === 'number' && typeof caps.zoom.max === 'number') {
      const clamped = Math.max(caps.zoom.min, Math.min(caps.zoom.max, target))
      await track.applyConstraints({ advanced: [{ zoom: clamped }] })
      return { ok: true, zoom: clamped, nativeZoom: true }
    }
    // No native zoom — signal soft-zoom fallback. Consumers can apply a
    // canvas crop when sampling frames; voice model will still hear a
    // success.
    return { ok: true, zoom: target, nativeZoom: false, softZoom: true }
  } catch (err) {
    return { ok: false, error: (err && err.message) || 'Zoom adjustment rejected by camera driver.' }
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
