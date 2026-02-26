// ═══════════════════════════════════════════════════════════════
// KelionAI — Emergency SOS
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var API = window.location.origin;
    var active = false;
    var countdownInterval = null;
    var locationData = null;

    // Same trigger words as brain.js
    var EMERGENCY_WORDS = ['kelion help', 'emergency', 'urgenta', 'urgență', 'help me', '112', '911'];

    function containsEmergencyWord(text) {
        if (!text) return false;
        var lower = text.toLowerCase();
        for (var i = 0; i < EMERGENCY_WORDS.length; i++) {
            if (lower.indexOf(EMERGENCY_WORDS[i]) !== -1) return true;
        }
        return false;
    }

    function authHeaders() {
        return { 'Content-Type': 'application/json', ...(window.KAuth ? KAuth.getAuthHeaders() : {}) };
    }

    function trigger() {
        if (active) return;
        active = true;

        var overlay = document.getElementById('sos-overlay');
        if (!overlay) return;
        overlay.classList.remove('hidden');

        // Get GPS location
        var locEl = document.getElementById('sos-location');
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(
                function (pos) {
                    locationData = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    if (locEl) locEl.textContent = '📍 ' + locationData.lat.toFixed(5) + ', ' + locationData.lng.toFixed(5);
                },
                function () {
                    if (locEl) locEl.textContent = '📍 Localizare indisponibilă';
                }
            );
        } else {
            if (locEl) locEl.textContent = '📍 Geolocation nesuportată';
        }

        // Countdown
        var seconds = 60;
        var timerEl = document.getElementById('sos-timer');
        if (timerEl) timerEl.textContent = String(seconds);

        countdownInterval = setInterval(function () {
            seconds--;
            if (timerEl) timerEl.textContent = String(seconds);
            if (seconds <= 0) {
                clearInterval(countdownInterval);
                countdownInterval = null;
                sendAlert();
            }
        }, 1000);

        // Bind "I'm safe" button
        var safeBtn = document.getElementById('sos-safe-btn');
        if (safeBtn) {
            safeBtn.onclick = cancel;
        }
    }

    function sendAlert() {
        fetch(API + '/api/sos/alert', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                location: locationData,
                fingerprint: (function () { try { return localStorage.getItem('kelion_fp') || 'guest'; } catch (e) { return 'guest'; } }()),
                timestamp: new Date().toISOString()
            })
        }).then(function (r) {
            if (!r.ok) {
                var locEl = document.getElementById('sos-location');
                if (locEl) locEl.textContent = '⚠️ Alert send failed — call 112 directly!';
            }
        }).catch(function (err) {
            console.error('[SOS] Alert send failed:', err);
            var locEl = document.getElementById('sos-location');
            if (locEl) locEl.textContent = '⚠️ Alert send failed — call 112 directly!';
        });
    }

    function cancel() {
        if (!active) return;
        active = false;

        if (countdownInterval) {
            clearInterval(countdownInterval);
            countdownInterval = null;
        }

        var overlay = document.getElementById('sos-overlay');
        if (overlay) overlay.classList.add('hidden');

        fetch(API + '/api/sos/cancel', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ reason: 'user_confirmed_safe' })
        }).catch(function () {});

        locationData = null;
    }

    window.KSOS = { trigger: trigger, cancel: cancel, isActive: function () { return active; }, containsEmergencyWord: containsEmergencyWord };
}());
