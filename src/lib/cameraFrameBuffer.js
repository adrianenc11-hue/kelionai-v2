// Module-level latest camera frame buffer.
//
// Keeps the most recent camera frame as a data URL. Used by the
// narration mode (set_narration_mode) which periodically sends the
// latest frame to Gemini Vision for continuous scene description.
// Gemini Live now handles direct vision via realtimeInput.video,
// so the old what_do_you_see tool no longer uses this buffer.
//
// This module owns the single source of truth for "the latest frame we
// saw". No React state, no renders — just a plain ref to stay cheap.

let latestFrame = null // { dataUrl: string, capturedAt: number } | null

export function setLatestCameraFrame(dataUrl) {
  if (!dataUrl || typeof dataUrl !== 'string') return
  latestFrame = { dataUrl, capturedAt: Date.now() }
}

export function getLatestCameraFrame() {
  return latestFrame
}

export function clearLatestCameraFrame() {
  latestFrame = null
}
