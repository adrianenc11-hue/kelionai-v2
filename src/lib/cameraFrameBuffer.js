// Module-level latest camera frame buffer.
//
// Rationale: OpenAI Realtime GA does not yet accept live video. To still
// let Kelion answer "what do you see?" while voice is served by OpenAI,
// we keep the camera on client-side in silent mode — grab one JPEG every
// ~1 second into a module-level ref — and only upload the most-recent
// frame when the model calls the `what_do_you_see` tool. That tool handler
// (src/lib/kelionTools.js) POSTs the frame to our server, which asks
// Gemini Vision to describe it and returns the text back to OpenAI as a
// function_call_output. Gemini Vision handles the image, OpenAI handles
// the voice and reasoning.
//
// This module owns the single source of truth for "the latest frame we
// saw". openaiRealtime.js writes here when its passive grabber fires;
// kelionTools.js reads here when OpenAI calls the tool. No React state,
// no renders — just a plain ref to stay cheap at 1 Hz.

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
