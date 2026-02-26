(function () {
    'use strict';

    const SOS_TRIGGERS = ['kelion help', 'ajutor kelion', 'help me please', 'emergency', 'urgenta', 'sun la 112'];

    let _active = false;
    let _countdown = 60;
    let _timerId = null;
    let _overlay = null;

    function _getOverlay() {
        if (!_overlay) _overlay = document.getElementById('sos-overlay');
        return _overlay;
    }

    function _updateTimer(n) {
        const el = document.getElementById('sos-timer');
        if (el) el.textContent = n;
    }

    function _updateLocation(text) {
        const el = document.getElementById('sos-location');
        if (el) el.textContent = text;
    }

    function _sendAlert(location) {
        const userId = window.KAuth ? KAuth.getUserId() : null;
        fetch('/api/sos/alert', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, window.KAuth ? KAuth.getAuthHeaders() : {}),
            body: JSON.stringify({ userId: userId, location: location, message: 'Auto-alert after 60s countdown' })
        }).catch(function (e) { console.warn('[SOS] alert send failed:', e.message); });
    }

    function dismiss() {
        if (!_active) return;
        _active = false;
        if (_timerId) { clearInterval(_timerId); _timerId = null; }
        var ov = _getOverlay();
        if (ov) ov.classList.add('hidden');
    }

    function trigger() {
        if (_active) return;
        _active = true;
        _countdown = 60;

        var ov = _getOverlay();
        if (!ov) return;
        ov.classList.remove('hidden');
        _updateTimer(60);
        _updateLocation('Se obține locația...');

        var gpsLocation = null;
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(function (pos) {
                gpsLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                _updateLocation('Lat: ' + gpsLocation.lat.toFixed(4) + ', Lng: ' + gpsLocation.lng.toFixed(4));
            }, function () {
                _updateLocation('Locație indisponibilă');
            });
        } else {
            _updateLocation('Locație indisponibilă');
        }

        _timerId = setInterval(function () {
            _countdown--;
            _updateTimer(_countdown);
            if (_countdown <= 0) {
                clearInterval(_timerId);
                _timerId = null;
                _sendAlert(gpsLocation);
                dismiss();
            }
        }, 1000);
    }

    function init() {
        var okBtn = document.getElementById('sos-ok');
        if (okBtn) {
            okBtn.addEventListener('click', function () { dismiss(); });
        }
    }

    window.KSOS = { init: init, trigger: trigger, dismiss: dismiss, triggers: SOS_TRIGGERS };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
}());
