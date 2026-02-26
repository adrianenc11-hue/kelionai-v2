// KelionAI v2 — Emergency SOS Module
(function () {
    'use strict';
    const API_BASE = window.location.origin;
    let overlay = null, countdownInterval = null, countdownVal = 60;

    function authHeaders() {
        return { 'Content-Type': 'application/json', ...(window.KAuth ? KAuth.getAuthHeaders() : {}) };
    }

    function createOverlay() {
        if (document.getElementById('sos-overlay')) return;
        overlay = document.createElement('div');
        overlay.id = 'sos-overlay';
        overlay.style.cssText = [
            'position:fixed', 'top:0', 'left:0', 'width:100%', 'height:100%',
            'background:rgba(180,0,0,0.92)', 'z-index:99999', 'display:flex',
            'flex-direction:column', 'align-items:center', 'justify-content:center',
            'font-family:Inter,sans-serif', 'color:#fff', 'text-align:center', 'padding:20px'
        ].join(';');
        overlay.innerHTML = [
            '<div style="font-size:3rem;margin-bottom:12px">🆘</div>',
            '<h1 style="font-size:1.8rem;font-weight:700;margin-bottom:8px">EMERGENCY DETECTED</h1>',
            '<p style="font-size:1rem;opacity:0.85;margin-bottom:20px">Call emergency services immediately if you are in danger.</p>',
            '<div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin-bottom:20px">',
            '  <a href="tel:112" style="background:#fff;color:#c00;font-weight:700;padding:14px 28px;border-radius:50px;text-decoration:none;font-size:1.1rem">📞 112</a>',
            '  <a href="tel:999" style="background:#fff;color:#c00;font-weight:700;padding:14px 28px;border-radius:50px;text-decoration:none;font-size:1.1rem">📞 999</a>',
            '  <a href="tel:911" style="background:#fff;color:#c00;font-weight:700;padding:14px 28px;border-radius:50px;text-decoration:none;font-size:1.1rem">📞 911</a>',
            '</div>',
            '<p id="sos-location" style="font-size:0.9rem;opacity:0.8;margin-bottom:16px">📍 Sharing your location...</p>',
            '<div style="font-size:2.5rem;font-weight:700;margin-bottom:20px" id="sos-countdown">60</div>',
            '<p id="sos-status" style="font-size:0.85rem;opacity:0.75;margin-bottom:20px"></p>',
            '<button id="sos-dismiss" style="background:#fff;color:#c00;border:none;padding:14px 36px;border-radius:50px;font-size:1rem;font-weight:700;cursor:pointer">✅ I\'m OK</button>'
        ].join('');
        document.body.appendChild(overlay);
        document.getElementById('sos-dismiss').addEventListener('click', dismiss);
    }

    function startCountdown() {
        countdownVal = 60;
        countdownInterval = setInterval(function () {
            countdownVal--;
            var el = document.getElementById('sos-countdown');
            if (el) el.textContent = countdownVal;
            if (countdownVal <= 0) {
                clearInterval(countdownInterval);
                var st = document.getElementById('sos-status');
                if (st) st.textContent = 'Alerting emergency contact (if set)';
            }
        }, 1000);
    }

    function getLocation(callback) {
        if (!navigator.geolocation) { callback(null, null, null); return; }
        navigator.geolocation.getCurrentPosition(
            function (pos) { callback(pos.coords.latitude, pos.coords.longitude, null); },
            function () { callback(null, null, 'Location unavailable'); },
            { timeout: 8000 }
        );
    }

    function postAlert(lat, lng, message) {
        fetch(API_BASE + '/api/sos/alert', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ lat: lat, lng: lng, message: message || 'Emergency triggered' })
        }).catch(function (e) { console.warn('[SOS] alert post failed:', e.message); });
    }

    function trigger(detail) {
        var message = (detail && detail.message) ? detail.message : '';
        createOverlay();
        startCountdown();

        getLocation(function (lat, lng, err) {
            var locEl = document.getElementById('sos-location');
            if (err || (!lat && !lng)) {
                if (locEl) locEl.textContent = '📍 Location unavailable';
            } else {
                if (locEl) locEl.textContent = '📍 Location shared: ' + lat.toFixed(4) + ', ' + lng.toFixed(4);
            }
            postAlert(lat, lng, message);
        });
    }

    function dismiss() {
        if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
        var el = document.getElementById('sos-overlay');
        if (el) el.remove();
        overlay = null;
    }

    function init() {
        window.addEventListener('kelion-emergency', function (e) {
            trigger(e.detail || {});
        });
    }

    window.KSOS = { init: init, trigger: trigger, dismiss: dismiss };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
