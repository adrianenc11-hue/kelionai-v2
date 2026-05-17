import { useCallback, useEffect, useRef, useState } from 'react'

// Client-side geolocation with user-gesture fallback.
//
// Design notes:
// - Uses `enableHighAccuracy: true` so on mobile the OS will prefer GPS /
//   fused location instead of coarse cell-tower fallback. On desktop this
//   still routes through the OS location service (WiFi BSSID lookup),
//   which is typically ~20–80 m — far better than IP-geo's 25–50 km.
// - Caches the last known position in localStorage so a refresh or a
//   re-mount of the stage doesn't ping the OS again for every render.
//   The cache window is short (10 min) because users move.
// - iOS Safari silently refuses `getCurrentPosition` that isn't tied to
//   a user gesture — so the on-mount passive request often never shows
//   a prompt on iPhone / iPad. Adrian reported: "am verificat pe telefon,
//   nu culege datele de la gps telefon, tableta, iOS sau Android". The
//   hook now ALSO exposes `requestNow()` which the page calls on the
//   first user tap (Tap-to-talk / stage click). Running it under a real
//   gesture guarantees iOS shows the permission dialog.
// - After the first successful fix we switch to `watchPosition` so the
//   server sees fresh coordinates as the user moves, not just the
//   snapshot at app load.
// - Exposes `permission` ('prompt' | 'granted' | 'denied' | 'unknown')
//   and `lastError` so the UI can render a "Enable location" banner
//   when the browser reports denial.

const STORAGE_KEY = 'kelion.geo.v1'
const CACHE_MAX_AGE_MS = 10 * 60 * 1000       // 10 min
const LOOKUP_TIMEOUT_MS = 12_000              // allow a full GPS cold-lock on mobile

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
  const [permission, setPermission] = useState('unknown')
  const [lastError, setLastError] = useState(null)
  const watchIdRef = useRef(null)
  const passiveTriedRef = useRef(false)

  // Start a `watchPosition` subscription after the first successful fix.
  // Keeps coordinates fresh while the user walks/drives around without
  // requiring them to reload the tab. Only one subscription at a time.
  const startWatch = useCallback(() => {
    if (watchIdRef.current !== null) return
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return
    try {
      watchIdRef.current = navigator.geolocation.watchPosition(
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
          // Non-fatal; we still have the cache from the initial fix.
          // eslint-disable-next-line no-console
          console.warn('[geo] watchPosition error:', err.code, err.message)
        },
        {
          enableHighAccuracy: true,
          timeout: LOOKUP_TIMEOUT_MS,
          // Fresh positions only — watchPosition respects this cap.
          maximumAge: 30_000,
        },
      )
      // eslint-disable-next-line no-console
      console.info('[geo] watchPosition started, id=', watchIdRef.current)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[geo] watchPosition threw:', err && err.message)
    }
  }, [])

  // Fire a one-shot getCurrentPosition and (on success) kick off the
  // watchPosition subscription. Callable both passively on mount AND
  // from a user-gesture handler — iOS requires the latter to show the
  // permission prompt.
  const requestNow = useCallback(() => {
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setPermission('denied')
      setLastError('Geolocation API not available in this browser.')
      return
    }
    // eslint-disable-next-line no-console
    console.info('[geo] requestNow — current permission:', permission)
    setPermission((p) => (p === 'granted' ? p : 'prompt'))
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }
        setCoords(c)
        writeCache(c)
        setPermission('granted')
        setLastError(null)
        // eslint-disable-next-line no-console
        console.info('[geo] fix acquired', c)
        startWatch()
      },
      (err) => {
        // code 1 = PERMISSION_DENIED, 2 = POSITION_UNAVAILABLE, 3 = TIMEOUT
        if (err.code === 1) setPermission('denied')
        setLastError(`${err.code}: ${err.message}`)
        // eslint-disable-next-line no-console
        console.warn('[geo] getCurrentPosition failed:', err.code, err.message)
      },
      {
        enableHighAccuracy: true,
        timeout: LOOKUP_TIMEOUT_MS,
        maximumAge: CACHE_MAX_AGE_MS,
      },
    )
  }, [permission, startWatch])

  // Probe the Permissions API if available; it tells us whether we need
  // a gesture-triggered prompt or whether the user already granted or
  // denied access. Safari on iOS < 16 doesn't ship this API — we treat
  // its absence as 'unknown' and still attempt a passive request.
  useEffect(() => {
    let cancelled = false
    async function probe() {
      try {
        if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
          const st = await navigator.permissions.query({ name: 'geolocation' })
          if (cancelled) return
          setPermission(st.state)
          // eslint-disable-next-line no-console
          console.info('[geo] permission state:', st.state)
          st.onchange = () => { if (!cancelled) setPermission(st.state) }
        }
      } catch {
        /* no-op — fallback to unknown */
      }
    }
    probe()
    return () => { cancelled = true }
  }, [])

  // Passive attempt on mount. On desktop Chrome/Firefox this works
  // without a gesture; on iOS it often silently no-ops but is still
  // worth trying (older iOS versions, PWA mode). If it fails, the page
  // should call `requestNow()` from its first real user tap.
  useEffect(() => {
    if (passiveTriedRef.current) return
    passiveTriedRef.current = true
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) return
    if (permission === 'denied') return

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
        }
        setCoords(c)
        writeCache(c)
        setPermission('granted')
        // eslint-disable-next-line no-console
        console.info('[geo] passive fix acquired', c)
        startWatch()
      },
      (err) => {
        // eslint-disable-next-line no-console
        console.warn('[geo] passive getCurrentPosition failed:', err.code, err.message)
        // Don't flip permission to denied here — the browser may just
        // have declined to show a prompt outside of a user gesture.
      },
      {
        enableHighAccuracy: true,
        timeout: LOOKUP_TIMEOUT_MS,
        maximumAge: CACHE_MAX_AGE_MS,
      },
    )
  }, [permission, startWatch])

  // Clean up watch subscription on unmount so background nav doesn't
  // leak OS-level location pings after the user leaves the page.
  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null && navigator.geolocation?.clearWatch) {
        try { navigator.geolocation.clearWatch(watchIdRef.current) } catch { /* ignore */ }
        watchIdRef.current = null
      }
    }
  }, [])

  return { coords, permission, lastError, requestNow }
}
