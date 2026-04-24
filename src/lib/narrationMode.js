// Continuous narration mode — accessibility feature for visually-impaired
// users. When enabled, the OpenAI Realtime transport periodically pulls
// a frame from the camera buffer, asks Gemini Vision to describe it, and
// injects that description back into the voice session so Kelion speaks
// a short natural narration. Adrian's requirement (2026-04-20):
//   "aplicatia se va vinde si pentru cei cu deficiente de vedere"
//   (app will also be sold to people with visual impairments)
//
// Lifecycle is decoupled from the voice transport on purpose so the
// `set_narration_mode` tool handler in src/lib/kelionTools.js can flip
// state without importing the transport hook (no React dep). The
// transport (src/lib/openaiRealtime.js) subscribes on mount and drives
// the narration loop.

const state = {
  enabled: false,
  intervalMs: 8000, // default cadence — fast enough to feel live, slow
                    // enough to never step on the user's turn.
  focus: '',        // optional anchor phrase from the user
                    // ("keep an eye on the stove", "tell me if the
                    //  dog moves"). Passed through as `focus` on
                    // /api/realtime/vision.
}
const listeners = new Set()

function notify() {
  const snap = { ...state }
  for (const fn of listeners) {
    try { fn(snap) } catch (_) { /* ignore listener errors */ }
  }
}

export function setNarrationMode({ enabled, interval_s, focus } = {}) {
  if (typeof enabled === 'boolean') state.enabled = enabled
  if (Number.isFinite(interval_s) && interval_s >= 4 && interval_s <= 30) {
    state.intervalMs = Math.round(interval_s * 1000)
  }
  if (typeof focus === 'string') state.focus = focus.slice(0, 200)
  // Disabling wipes focus so the next enable starts clean.
  if (state.enabled === false) state.focus = ''
  notify()
  return { ...state }
}

export function getNarrationMode() {
  return { ...state }
}

export function subscribeNarrationMode(fn) {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}
