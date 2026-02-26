// ═══════════════════════════════════════════════════════════════
// KelionAI — Anti-Copy Protection (client-side)
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // ── Layer 1: Disable right-click context menu ──────────────
    document.addEventListener('contextmenu', function (e) {
        e.preventDefault();
    });

    // ── Layer 2: Disable DevTools keyboard shortcuts ───────────
    document.addEventListener('keydown', function (e) {
        var blocked = (
            e.key === 'F12' ||
            (e.ctrlKey && e.key === 'u') ||
            (e.ctrlKey && e.shiftKey && e.key === 'I') ||
            (e.ctrlKey && e.shiftKey && e.key === 'J') ||
            (e.ctrlKey && e.shiftKey && e.key === 'C') ||
            (e.ctrlKey && e.key === 's')
        );
        if (blocked) {
            e.preventDefault();
            e.stopPropagation();
            return false;
        }
    });

    // ── Layer 3: Disable drag on images and canvas ─────────────
    document.addEventListener('dragstart', function (e) {
        if (e.target.tagName === 'IMG' || e.target.tagName === 'CANVAS') {
            e.preventDefault();
        }
    });

    // ── Layer 4: DevTools detection (soft warning only) ────────
    var _devtoolsOpen = false;
    var _devtoolsOverlay = null;

    function _showDevtoolsWarning() {
        if (_devtoolsOverlay) return;
        _devtoolsOverlay = document.createElement('div');
        _devtoolsOverlay.id = '__kp_warn';
        _devtoolsOverlay.style.cssText = [
            'position:fixed', 'top:0', 'left:0', 'width:100%', 'z-index:999999',
            'background:rgba(10,10,26,0.95)', 'color:#ff4444',
            'font-family:system-ui,sans-serif', 'font-size:14px',
            'padding:10px 16px', 'text-align:center',
            'border-bottom:1px solid rgba(255,68,68,0.4)',
            'pointer-events:none'
        ].join(';');
        _devtoolsOverlay.textContent = '\u26D4 KelionAI \u2014 Unauthorized inspection detected. \u00A9 AE Design. All rights reserved.';
        document.body.appendChild(_devtoolsOverlay);
    }

    function _hideDevtoolsWarning() {
        if (_devtoolsOverlay) {
            _devtoolsOverlay.remove();
            _devtoolsOverlay = null;
        }
    }

    setInterval(function () {
        var threshold = 160;
        var open = (window.outerWidth - window.innerWidth > threshold) ||
                   (window.outerHeight - window.innerHeight > threshold);
        if (open && !_devtoolsOpen) {
            _devtoolsOpen = true;
            _showDevtoolsWarning();
        } else if (!open && _devtoolsOpen) {
            _devtoolsOpen = false;
            _hideDevtoolsWarning();
        }
    }, 1000);

    // ── Layer 5: Console warning ───────────────────────────────
    /* eslint-disable no-console */
    console.log('%c\u26D4 STOP!', 'color:red;font-size:48px;font-weight:bold;');
    console.log(
        '%cThis browser console is for developers only. If someone told you to paste something here, it is a scam.',
        'color:red;font-size:16px;'
    );
    console.log(
        '%c\u00A9 KelionAI \u2014 AE Design. All rights reserved. Unauthorized access or copying is strictly prohibited.',
        'color:#00D4FF;font-size:12px;'
    );
    /* eslint-enable no-console */

    // ── Layer 6: Invisible fingerprint per session ─────────────
    function _generateId() {
        var arr = new Uint8Array(16);
        if (window.crypto && window.crypto.getRandomValues) {
            window.crypto.getRandomValues(arr);
        } else {
            for (var i = 0; i < arr.length; i++) arr[i] = Math.floor(Math.random() * 256);
        }
        return Array.from(arr).map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
    }

    var _sessionId = (function () {
        try {
            var stored = sessionStorage.getItem('__kp_sid');
            if (stored) return stored;
            var id = _generateId();
            sessionStorage.setItem('__kp_sid', id);
            return id;
        } catch (_) {
            return _generateId();
        }
    }());

    // Embed invisible fingerprint node in DOM
    var _fp = document.createElement('span');
    _fp.id = '__fp';
    _fp.style.cssText = 'display:none;position:absolute;opacity:0;pointer-events:none;';
    _fp.textContent = _sessionId;
    document.body.appendChild(_fp);

    // Send fingerprint to server (fire-and-forget)
    function _sendFingerprint() {
        try {
            var payload = JSON.stringify({
                sessionId: _sessionId,
                userAgent: navigator.userAgent,
                screen: window.screen.width + 'x' + window.screen.height,
                timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                lang: navigator.language
            });
            if (navigator.sendBeacon) {
                var blob = new Blob([payload], { type: 'application/json' });
                navigator.sendBeacon('/api/protection/fingerprint', blob);
            } else {
                fetch('/api/protection/fingerprint', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: payload,
                    keepalive: true
                }).catch(function () {});
            }
        } catch (_) {}
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _sendFingerprint);
    } else {
        _sendFingerprint();
    }

    // ── Public API ─────────────────────────────────────────────
    window.KProtection = {
        getFingerprint: function () { return _sessionId; },
        init: function () {} // already runs on load; exposed for compatibility
    };

}());
