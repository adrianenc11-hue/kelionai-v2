// ═══════════════════════════════════════════════════════════════
// App — Geolocation Module (Smart GPS)
//
// 3 levels of location:
//   1. IP geolocation (server-side, no popup, city-level) → for weather
//   2. Browser GPS (popup ONCE, then cached) → for exact location
//   3. Brain can trigger GPS request via KGeo.requestGPS()
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  let cachedPosition = null;
  let permissionGranted = false;
  let watchId = null;

  // ── Get location (returns cached if available, else requests) ──
  function getLocation() {
    return new Promise(function (resolve) {
      // Return cached if fresh (< 5 min)
      if (cachedPosition && Date.now() - cachedPosition.timestamp < 300000) {
        resolve(cachedPosition);
        return;
      }
      if (!navigator.geolocation) {
        resolve(null);
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          cachedPosition = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: Date.now(),
          };
          permissionGranted = true;
          resolve(cachedPosition);
        },
        function (err) {
          console.warn('[Geo] Location unavailable:', err.message);
          resolve(cachedPosition); // return stale cache or null
        },
        { timeout: 8000, maximumAge: 300000, enableHighAccuracy: false }
      );
    });
  }

  // ── Request GPS — brain can call this when it needs precise location ──
  // Shows the browser popup. After user accepts, GPS is cached and auto-sent.
  function requestGPS() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) {
        resolve({ granted: false, reason: 'Geolocation not supported' });
        return;
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          cachedPosition = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            timestamp: Date.now(),
          };
          permissionGranted = true;
          // Start watching position for continuous updates
          startWatching();
          resolve({ granted: true, position: cachedPosition });
        },
        function (err) {
          resolve({ granted: false, reason: err.message });
        },
        { timeout: 10000, maximumAge: 0, enableHighAccuracy: true }
      );
    });
  }

  // ── Start watching position (after permission granted) ──
  function startWatching() {
    if (watchId || !navigator.geolocation) return;
    watchId = navigator.geolocation.watchPosition(
      function (pos) {
        cachedPosition = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: Date.now(),
        };
      },
      function () {
        /* silent fail on watch errors */
      },
      { maximumAge: 60000, enableHighAccuracy: false }
    );
  }

  // ── Stop watching ──
  function stopWatching() {
    if (watchId && navigator.geolocation) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
  }

  // ── Get cached position (synchronous, no popup) ──
  function getCached() {
    return cachedPosition;
  }

  // ── Is GPS permission granted? ──
  function hasPermission() {
    return permissionGranted;
  }

  // ── Check permission status without triggering popup ──
  function checkPermission() {
    return new Promise(function (resolve) {
      if (!navigator.permissions) {
        resolve('unknown');
        return;
      }
      navigator.permissions
        .query({ name: 'geolocation' })
        .then(function (result) {
          permissionGranted = result.state === 'granted';
          if (permissionGranted && !cachedPosition) {
            // Permission was already granted → silently get position
            getLocation();
          }
          resolve(result.state); // 'granted', 'denied', 'prompt'
        })
        .catch(function () {
          resolve('unknown');
        });
    });
  }

  // ── Auto-check on load — if permission already granted, get position silently ──
  checkPermission();

  window.KGeo = {
    getLocation: getLocation,
    requestGPS: requestGPS,
    getCached: getCached,
    hasPermission: hasPermission,
    checkPermission: checkPermission,
    startWatching: startWatching,
    stopWatching: stopWatching,
  };
})();
