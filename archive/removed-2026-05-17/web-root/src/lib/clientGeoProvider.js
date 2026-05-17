// Module-level registry for the client geolocation provider.
//
// KelionStage owns the `useClientGeo` hook (React state + watchPosition
// subscription) and registers a provider here on mount. The `get_my_location`
// voice tool handler in kelionTools.js reads through this registry instead
// of the hook directly because the tool runs outside React (it's invoked
// from the voice transport's toolCall dispatcher).
//
// The registered provider exposes:
//   - getCoords() -> { lat, lon, accuracy } | null
//   - getPermission() -> 'prompt' | 'granted' | 'denied' | 'unknown'
//   - requestNow() -> void (triggers the OS permission prompt; must be
//     called on a user gesture on iOS)
//
// Rationale: on mobile iOS Safari silently refuses `getCurrentPosition`
// outside a user gesture. KelionStage already calls `requestNow` from its
// first stage-click handler (see KelionStage.jsx:2110). If the user has
// already granted permission we can serve coords immediately; if not, we
// return a speakable hint telling Kelion to ask the user to tap to allow
// location. Either way we never block the voice turn.

let provider = null

export function setClientGeoProvider(impl) {
  provider = impl || null
}

export function getClientGeoProvider() {
  return provider
}

export function readClientCoords() {
  if (!provider || typeof provider.getCoords !== 'function') return null
  try { return provider.getCoords() } catch { return null }
}

export function readClientGeoPermission() {
  if (!provider || typeof provider.getPermission !== 'function') return 'unknown'
  try { return provider.getPermission() } catch { return 'unknown' }
}

export function tryRequestClientGeo() {
  if (!provider || typeof provider.requestNow !== 'function') return false
  try { provider.requestNow(); return true } catch { return false }
}
