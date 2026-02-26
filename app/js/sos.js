// ═══════════════════════════════════════════════════════════════
// KelionAI — Emergency SOS Module
// Handles emergency detection, countdown overlay, and alert dispatch
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var _timer = null;
    var _seconds = 60;
    var _active = false;
    var _locationData = null;

    // ── Geolocation ──────────────────────────────────────────
    function getLocation(cb) {
        if (!navigator.geolocation) { cb(null); return; }
        navigator.geolocation.getCurrentPosition(
            function (pos) {
                cb({ lat: pos.coords.latitude, lng: pos.coords.longitude });
            },
            function () { cb(null); },
            { timeout: 5000 }
        );
    }

    // ── Show / hide overlay ──────────────────────────────────
    function showOverlay(data) {
        var overlay = document.getElementById('sos-overlay');
        if (!overlay) return;

        // Emergency contact
        var contactEl = document.getElementById('sos-contact');
        if (contactEl) {
            var contact = data && data.emergencyContact;
            if (contact && (contact.name || contact.phone)) {
                contactEl.innerHTML = '👤 <strong>' + (contact.name || '') + '</strong>' +
                    (contact.phone ? ' · <a href="tel:' + contact.phone + '">' + contact.phone + '</a>' : '');
            } else {
                contactEl.textContent = '';
            }
        }

        // Reset countdown
        _seconds = 60;
        var timerEl = document.getElementById('sos-timer');
        if (timerEl) timerEl.textContent = _seconds;

        overlay.classList.remove('hidden');
        _active = true;

        // Request location
        getLocation(function (loc) {
            _locationData = loc;
        });

        // Start countdown
        _timer = setInterval(function () {
            _seconds -= 1;
            if (timerEl) timerEl.textContent = _seconds;
            if (_seconds <= 0) {
                clearInterval(_timer);
                _timer = null;
                sendAlert(data);
            }
        }, 1000);
    }

    function hideOverlay() {
        if (_timer) { clearInterval(_timer); _timer = null; }
        _active = false;
        _locationData = null;
        var overlay = document.getElementById('sos-overlay');
        if (overlay) overlay.classList.add('hidden');
    }

    // ── Send alert to server ─────────────────────────────────
    function sendAlert(data) {
        hideOverlay();
        var contact = (data && data.emergencyContact) || null;
        var userId = (window.KAuth && KAuth.getUserId) ? KAuth.getUserId() : null;
        var payload = {
            userId: userId,
            location: _locationData || (data && data.location) || null,
            emergencyContact: contact,
            timestamp: new Date().toISOString()
        };
        var headers = { 'Content-Type': 'application/json' };
        if (window.KAuth && KAuth.getAuthHeaders) Object.assign(headers, KAuth.getAuthHeaders());

        fetch(window.location.origin + '/api/sos/alert', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(payload)
        }).catch(function (e) {
            console.warn('[SOS] Alert send failed:', e.message);
            // Alert failed — show a visible fallback message in chat if app is available
            if (window.KApp && typeof KApp.addMessage === 'function') {
                KApp.addMessage('assistant', '⚠️ SOS alert could not be sent. Please call emergency services directly: 112 / 999 / 911');
            }
        });
    }

    // ── Public API ───────────────────────────────────────────
    function trigger(data) {
        if (_active) return;
        showOverlay(data || {});
    }

    function cancelSOS() {
        hideOverlay();
    }

    function startCountdown(data) {
        trigger(data);
    }

    function init() {
        var cancelBtn = document.getElementById('sos-cancel');
        if (cancelBtn) {
            cancelBtn.addEventListener('click', function () {
                cancelSOS();
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    window.KSOS = { init: init, trigger: trigger, startCountdown: startCountdown, cancelSOS: cancelSOS };
})();
