(function() {
    'use strict';

    // Layer 1: Disable DevTools keyboard shortcuts
    document.addEventListener('keydown', function(e) {
        // Block F12
        if (e.key === 'F12') { e.preventDefault(); return false; }
        // Block Ctrl+U (view source)
        if (e.ctrlKey && e.key === 'u') { e.preventDefault(); return false; }
        // Block Ctrl+Shift+I (DevTools)
        if (e.ctrlKey && e.shiftKey && e.key === 'I') { e.preventDefault(); return false; }
        // Block Ctrl+Shift+J (Console)
        if (e.ctrlKey && e.shiftKey && e.key === 'J') { e.preventDefault(); return false; }
        // Block Ctrl+Shift+C (Inspector)
        if (e.ctrlKey && e.shiftKey && e.key === 'C') { e.preventDefault(); return false; }
        // Block Ctrl+S (save page)
        if (e.ctrlKey && e.key === 's') { e.preventDefault(); return false; }
        // Block Ctrl+A (select all — allow only in input fields)
        if (e.ctrlKey && e.key === 'a' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
            e.preventDefault(); return false;
        }
    });

    // Layer 2: Disable right-click context menu
    document.addEventListener('contextmenu', function(e) {
        e.preventDefault(); return false;
    });

    // Layer 3: Disable text selection (except input fields)
    document.addEventListener('selectstart', function(e) {
        if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return true;
        e.preventDefault(); return false;
    });

    // Layer 4: Disable drag (prevent dragging images/elements)
    document.addEventListener('dragstart', function(e) {
        if (e.target.tagName !== 'INPUT') { e.preventDefault(); return false; }
    });

    // Layer 5: DevTools detection (size-based)
    // Threshold accounts for typical browser chrome/scrollbar width on most platforms
    (function detectDevTools() {
        var threshold = 160;
        var devtoolsOpen = false;
        setInterval(function() {
            var widthThreshold = window.outerWidth - window.innerWidth > threshold;
            var heightThreshold = window.outerHeight - window.innerHeight > threshold;
            if (widthThreshold || heightThreshold) {
                if (!devtoolsOpen) {
                    devtoolsOpen = true;
                    // Log fingerprint silently — DO NOT block the app
                    fetch('/api/security/devtools-open', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            fingerprint: window._KFingerprint || 'unknown',
                            url: window.location.href,
                            ts: Date.now()
                        })
                    }).catch(function() {});
                }
            } else {
                devtoolsOpen = false;
            }
        }, 2000);
    })();

    // Layer 6: Console warning
    if (window.console) {
        var style = 'color: #FF4444; font-size: 20px; font-weight: bold;';
        console.log('%c\u26D4 STOP!', style);
        console.log('%cThis browser console is for authorized developers only.', 'color: #ccc; font-size: 14px;');
        console.log('%cCopyright \u00A9 AE Design. All rights reserved.', 'color: #888; font-size: 12px;');
    }

    // Layer 7: Invisible fingerprint watermark
    (function() {
        var fp = [
            navigator.userAgent.substring(0, 20),
            screen.width + 'x' + screen.height,
            navigator.language,
            new Date().getTimezoneOffset(),
            navigator.platform ? navigator.platform.substring(0, 10) : 'unknown'
        ].join('|');

        // Simple hash
        var hash = 0;
        for (var i = 0; i < fp.length; i++) {
            hash = ((hash << 5) - hash) + fp.charCodeAt(i);
            hash |= 0;
        }
        var fingerprint = 'KFP-' + Math.abs(hash).toString(36).toUpperCase();
        window._KFingerprint = fingerprint;

        // Invisible watermark in DOM
        var el = document.createElement('span');
        el.setAttribute('data-kfp', fingerprint);
        el.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;opacity:0;pointer-events:none;';
        el.setAttribute('aria-hidden', 'true');
        document.body.appendChild(el);

        // Also set on html element
        document.documentElement.setAttribute('data-kelion-fp', fingerprint);
    })();

})();
