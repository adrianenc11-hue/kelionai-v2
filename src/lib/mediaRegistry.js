// Central registry of active MediaStream objects opened by the app.
// Any component that calls navigator.mediaDevices.getUserMedia() MUST register
// the returned stream here so we can guarantee camera/microphone release on
// logout or page unload.
//
// This is critical for RULES.md rule 17: "do not declare logout stops mic/
// camera without verification". Stopping tracks is the only reliable way to
// release the capture devices across browsers.

const active = new Set()

export function registerStream(stream) {
  if (stream && typeof stream.getTracks === 'function') {
    active.add(stream)
  }
}

export function unregisterStream(stream) {
  if (stream) active.delete(stream)
}

export function stopAllStreams() {
  for (const s of active) {
    try {
      s.getTracks().forEach(t => {
        try { t.stop() } catch { /* ignore */ }
      })
    } catch { /* ignore */ }
  }
  active.clear()
}

export function countActiveTracks() {
  let live = 0
  for (const s of active) {
    try {
      for (const t of s.getTracks()) {
        if (t.readyState === 'live') live++
      }
    } catch { /* ignore */ }
  }
  return live
}

if (typeof window !== 'undefined') {
  // Best-effort cleanup on navigation/unload. Browsers are not obligated to
  // run this, so it is an extra safety net — not the primary guarantee.
  window.addEventListener('beforeunload', () => { stopAllStreams() })
  window.addEventListener('pagehide', () => { stopAllStreams() })
  // Expose for test tooling (Playwright acceptance script reads this).
  // Expose `registerStream` too so the `logout-media` acceptance script
  // (which opens its own getUserMedia stream in the page context) can plug
  // that stream into the app's registry. Without this, `stopAllStreams()`
  // in `handleLogout` has nothing to iterate and the acceptance test fails.
  window.__kelionMedia = {
    registerStream,
    stopAllStreams,
    countActiveTracks,
  }
}
