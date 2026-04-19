import { useEffect, useRef, useState } from 'react'

// Client-side geolocation. Calls navigator.geolocation.getCurrentPosition on
// mount and returns { lat, lon, accuracy } once the browser resolves.
//
// Design notes:
// - Uses `enableHighAccuracy: true` so on mobile the OS will prefer GPS /
//   fused location instead of coarse cell-tower fallback. On desktop this
//   still routes through the OS location service (WiFi BSSID lookup),
//   which is typically ~20–80 m — far better than IP-geo's 25–50 km.
// - Caches the last known position in localStorage so a refresh or a
//   re-mount of the stage doesn't ping the OS again for every render.
//   The cache window is short (10 min) because users move.
// - If permission was denied before, or the browser refuses, we return
//   null and the server quietly falls back to IP geolocation. No prompt
//   spam; the browser itself decides whether to ask.

const STORAGE_KEY = 'kelion.geo.v1'
const CACHE_MAX_AGE_MS = 10 * 60 * 1000       // 10 min
const LOOKUP_TIMEOUT_MS = 8_000               // allow a full GPS cold-lock

function readCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const obj = JSON.parse(raw)
    if (!obj || typeof obj.ts !== 'number') return null
    if (Date.now() - obj.ts > CACHE_MAX_AGE_MS) return null
    return { lat: obj.lat, lon: obj.lon, accuracy: obj.accuracy }
  } catch {
    return null
  }
}

function writeCache(coords) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ts: Date.now(), ...coords }),
    )
  } catch {
    /* quota exceeded / private mode → ignore */
  }
}

export function useClientGeo() {
  // Seed synchronously from localStorage so the very first chat request
  // after a refresh already carries precise coordinates (no IP-geo detour
  // while the Geolocation API is still acquiring a fix).
  const [coords, setCoords] = useState(() => readCache())
  const firedRef = useRef(false)

  useEffect(() => {
    if (firedRef.current) return
    firedRef.current = true

    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      return
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }
        setCoords(c)
        writeCache(c)
      },
      (err) => {
        // Permission denied / timeout / position unavailable. Keep whatever
        // we have from the cache (possibly null) and let server-side IP-geo
        // cover the fallback case. Log quietly — this is not user-facing.
        // eslint-disable-next-line no-console
        console.warn('[geo] getCurrentPosition failed:', err.code, err.message)
      },
      {
        enableHighAccuracy: true,
        timeout: LOOKUP_TIMEOUT_MS,
        maximumAge: CACHE_MAX_AGE_MS,
      },
    )
  }, [])

  return coords
}
