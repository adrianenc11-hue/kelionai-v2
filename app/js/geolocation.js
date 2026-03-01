// ═══════════════════════════════════════════════════════════════
// KelionAI — Geolocation Module
// Provides browser GPS coordinates for weather/map requests
// ═══════════════════════════════════════════════════════════════
(function() {
    'use strict';
    var cachedPosition = null;

    function getLocation() {
        return new Promise(function(resolve) {
            if (!navigator.geolocation) { resolve(null); return; }
            navigator.geolocation.getCurrentPosition(
                function(pos) {
                    cachedPosition = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    resolve(cachedPosition);
                },
                function(err) {
                    console.warn('[Geo] Location unavailable:', err.message);
                    resolve(cachedPosition);
                },
                { timeout: 5000, maximumAge: 300000 }
            );
        });
    }

    function getCached() { return cachedPosition; }

    window.KGeo = { getLocation: getLocation, getCached: getCached };
})();
