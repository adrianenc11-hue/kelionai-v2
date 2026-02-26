// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — Emergency SOS Module
// Triggered when brain returns isEmergency:true or SOS keywords detected
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // ─── State ───────────────────────────────────────────────────
    var sosActive = false;
    var sosCountdown = 60;
    var sosTimer = null;
    var sosLocation = null;
    var sosContact = null;

    var GEO_TIMEOUT = 10000;
    var GEO_MAX_AGE = 30000;

    // ─── CSS ─────────────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('sos-styles')) return;
        var style = document.createElement('style');
        style.id = 'sos-styles';
        style.textContent = [
            '#sos-overlay{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.92);display:flex;align-items:center;justify-content:center;}',
            '#sos-modal{max-width:420px;width:90%;background:#1a0505;border:2px solid #ff3333;border-radius:16px;padding:32px;}',
            '#sos-icon{font-size:48px;text-align:center;margin-bottom:8px;}',
            '#sos-modal h2{color:#ff4444;text-align:center;margin:0 0 16px;}',
            '#sos-location{color:#ccc;font-size:14px;text-align:center;margin-bottom:8px;}',
            '#sos-countdown{color:#ff8800;font-size:18px;text-align:center;margin:16px 0;}',
            '#sos-numbers{background:rgba(255,255,255,0.05);border-radius:8px;padding:12px;margin-bottom:16px;}',
            '#sos-numbers p{color:#fff;margin:4px 0;font-size:14px;}',
            '#sos-contact-section{color:#aaa;font-size:13px;text-align:center;margin-bottom:12px;min-height:20px;}',
            '#sos-share-btn{display:block;width:100%;background:#ff3333;color:#fff;border:none;border-radius:8px;padding:12px;font-size:15px;cursor:pointer;font-weight:bold;}',
            '#sos-share-btn:hover{background:#cc2222;}',
            '#sos-cancel-btn{display:block;width:100%;background:rgba(255,255,255,0.1);color:#fff;border:none;border-radius:8px;padding:12px;font-size:15px;cursor:pointer;margin-top:8px;}',
            '#sos-cancel-btn:hover{background:rgba(255,255,255,0.2);}'
        ].join('');
        document.head.appendChild(style);
    }

    // ─── Overlay HTML ─────────────────────────────────────────────
    function createOverlay() {
        var overlay = document.createElement('div');
        overlay.id = 'sos-overlay';
        overlay.innerHTML = [
            '<div id="sos-modal">',
            '  <div id="sos-icon">🆘</div>',
            '  <h2>EMERGENCY SOS</h2>',
            '  <div id="sos-location">📍 Getting location...</div>',
            '  <div id="sos-countdown">Auto-alert in: <span id="sos-seconds">60</span>s</div>',
            '  <div id="sos-numbers">',
            '    <p>🇷🇴 Romania Emergency: <strong>112</strong></p>',
            '    <p>🇬🇧 UK Emergency: <strong>999</strong></p>',
            '    <p>🇺🇸 US Emergency: <strong>911</strong></p>',
            '    <p>EU Emergency: <strong>112</strong></p>',
            '  </div>',
            '  <div id="sos-contact-section"></div>',
            '  <div id="sos-buttons">',
            '    <button id="sos-share-btn">📤 Share location with contact</button>',
            '    <button id="sos-cancel-btn">✅ I\'m OK — Cancel</button>',
            '  </div>',
            '</div>'
        ].join('');
        return overlay;
    }

    // ─── TRIGGER ─────────────────────────────────────────────────
    function triggerSOS(location) {
        if (sosActive) return;
        sosActive = true;
        sosCountdown = 60;

        injectStyles();

        var existing = document.getElementById('sos-overlay');
        if (existing) existing.parentNode.removeChild(existing);

        var overlay = createOverlay();
        document.body.appendChild(overlay);

        document.getElementById('sos-cancel-btn').addEventListener('click', cancelSOS);
        document.getElementById('sos-share-btn').addEventListener('click', shareLocation);

        if (location) {
            sosLocation = location;
            updateLocationDisplay(location);
        } else {
            getLocation().then(function (loc) {
                sosLocation = loc;
                updateLocationDisplay(loc);
            }).catch(function () {
                updateLocationDisplay(null);
            });
        }

        loadContact().then(function (contact) {
            sosContact = contact;
            updateContactDisplay(contact);
        });

        startCountdown();
    }

    function updateLocationDisplay(loc) {
        var el = document.getElementById('sos-location');
        if (!el) return;
        if (loc && loc.lat && loc.lng) {
            el.textContent = '📍 ' + loc.lat.toFixed(5) + ', ' + loc.lng.toFixed(5);
        } else {
            el.textContent = '📍 Location unavailable';
        }
    }

    function updateContactDisplay(contact) {
        var el = document.getElementById('sos-contact-section');
        if (!el) return;
        if (contact && contact.name) {
            el.textContent = '👤 Contact: ' + contact.name + (contact.phone ? ' · ' + contact.phone : '');
        } else {
            el.textContent = 'No emergency contact set (go to Settings to add one)';
        }
    }

    // ─── COUNTDOWN ───────────────────────────────────────────────
    function startCountdown() {
        clearInterval(sosTimer);
        sosTimer = setInterval(function () {
            sosCountdown--;
            var el = document.getElementById('sos-seconds');
            if (el) el.textContent = sosCountdown;
            if (sosCountdown <= 0) {
                clearInterval(sosTimer);
                shareLocation();
            }
        }, 1000);
    }

    // ─── CANCEL ──────────────────────────────────────────────────
    function cancelSOS() {
        clearInterval(sosTimer);
        sosActive = false;
        sosCountdown = 60;
        sosTimer = null;
        var overlay = document.getElementById('sos-overlay');
        if (overlay) overlay.parentNode.removeChild(overlay);
    }

    // ─── GET LOCATION ────────────────────────────────────────────
    function getLocation() {
        return new Promise(function (resolve, reject) {
            if (!navigator.geolocation) { reject(new Error('Geolocation unavailable')); return; }
            navigator.geolocation.getCurrentPosition(
                function (pos) { resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }); },
                function (err) { reject(err); },
                { timeout: GEO_TIMEOUT, maximumAge: GEO_MAX_AGE }
            );
        });
    }

    // ─── SHARE LOCATION ──────────────────────────────────────────
    function shareLocation() {
        var btn = document.getElementById('sos-share-btn');
        if (btn) { btn.disabled = true; btn.textContent = '📤 Sending...'; }

        var payload = {
            location: sosLocation ? (sosLocation.lat + ',' + sosLocation.lng) : null,
            contact: sosContact,
            message: 'SOS triggered via KelionAI'
        };

        fetch('/api/sos/alert', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, window.KAuth ? KAuth.getAuthHeaders() : {}),
            body: JSON.stringify(payload)
        }).then(function (r) { return r.json(); }).then(function () {
            if (btn) { btn.textContent = '✅ Alert logged!'; }
            var el = document.getElementById('sos-contact-section');
            if (el) el.textContent = '✅ Emergency alert has been recorded. Call 112/999/911 directly for immediate help.';
        }).catch(function () {
            if (btn) { btn.disabled = false; btn.textContent = '📤 Share location with contact'; }
        });
    }

    // ─── LOAD CONTACT ────────────────────────────────────────────
    function loadContact() {
        var headers = window.KAuth ? KAuth.getAuthHeaders() : {};
        return fetch('/api/sos/contact', { headers: headers })
            .then(function (r) { return r.json(); })
            .then(function (d) { return d.contact || null; })
            .catch(function () { return null; });
    }

    // ─── SAVE CONTACT ────────────────────────────────────────────
    function saveContact(name, phone, email) {
        var headers = Object.assign({ 'Content-Type': 'application/json' }, window.KAuth ? KAuth.getAuthHeaders() : {});
        return fetch('/api/memory', {
            method: 'POST',
            headers: headers,
            body: JSON.stringify({ action: 'save', key: 'emergency_contact', value: { name: name, phone: phone, email: email } })
        }).then(function (r) { return r.json(); });
    }

    // ─── EXPOSE ──────────────────────────────────────────────────
    window.KSOS = { triggerSOS: triggerSOS, cancelSOS: cancelSOS, saveContact: saveContact };

    console.log('[SOS] ✅ Emergency SOS module loaded');
})();
