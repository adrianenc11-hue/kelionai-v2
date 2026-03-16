// ═══════════════════════════════════════════════════════════════
// KelionAI — GPS/Geolocation Module (KGeo)
// Auto-detects user location via navigator.geolocation
// Caches result and provides it to chat payload
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  let cached = null;
  let watching = false;
  let watchId = null;

  // ── Get current position (one-shot) ────────────────────────
  function getCurrentPosition() {
    return new Promise(function (resolve) {
      if (!navigator.geolocation) {
        console.warn('[Geo] Geolocation not supported');
        return resolve(null);
      }
      navigator.geolocation.getCurrentPosition(
        function (pos) {
          cached = {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy,
            altitude: pos.coords.altitude,
            speed: pos.coords.speed,
            timestamp: Date.now(),
          };
          console.log(
            '[Geo] Position acquired:',
            cached.lat.toFixed(4),
            cached.lng.toFixed(4),
            '±' + Math.round(cached.accuracy) + 'm'
          );
          resolve(cached);
        },
        function (err) {
          console.warn('[Geo] Position error:', err.message);
          resolve(null);
        },
        {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 60000, // Cache for 1 min
        }
      );
    });
  }

  // ── Start watching position (continuous updates) ───────────
  function startWatching() {
    if (watching || !navigator.geolocation) return;
    watching = true;
    watchId = navigator.geolocation.watchPosition(
      function (pos) {
        cached = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          altitude: pos.coords.altitude,
          speed: pos.coords.speed,
          timestamp: Date.now(),
        };
      },
      function (_err) {
        /* silent */
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 30000,
      }
    );
    console.log('[Geo] Watching position started');
  }

  // ── Stop watching ──────────────────────────────────────────
  function stopWatching() {
    if (watchId !== null) {
      navigator.geolocation.clearWatch(watchId);
      watchId = null;
    }
    watching = false;
  }

  // ── Get cached position (used by app.js L425) ─────────────
  function getCached() {
    return cached;
  }

  // ── Auto-init: request permission on first interaction ─────
  function init() {
    // Request GPS on first user interaction (required by browsers)
    var initOnce = function () {
      getCurrentPosition();
      startWatching();
      document.removeEventListener('click', initOnce);
      document.removeEventListener('touchstart', initOnce);
    };
    document.addEventListener('click', initOnce, { once: true });
    document.addEventListener('touchstart', initOnce, { once: true });

    // Also try immediately (works if permission already granted)
    if (navigator.permissions) {
      navigator.permissions
        .query({ name: 'geolocation' })
        .then(function (result) {
          if (result.state === 'granted') {
            getCurrentPosition();
            startWatching();
          }
        })
        .catch(function () {
          /* not supported */
        });
    }
  }

  // ── Public API ─────────────────────────────────────────────
  window.KGeo = {
    init: init,
    getCached: getCached,
    getCurrentPosition: getCurrentPosition,
    getLocation: getCurrentPosition, // alias — compatible with geolocation.js API
    startWatching: startWatching,
    stopWatching: stopWatching,
    hasPosition: function () {
      return cached !== null;
    },
  };

  // Auto-init on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
