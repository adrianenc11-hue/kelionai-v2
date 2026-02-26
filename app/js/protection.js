(function () {
    'use strict';

    // ── Layer 2: Source Protection ──

    // Disable right-click context menu
    document.addEventListener('contextmenu', e => e.preventDefault());

    // Disable F12, Ctrl+U, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+Shift+C
    document.addEventListener('keydown', e => {
        if (e.key === 'F12') { e.preventDefault(); return false; }
        if (e.ctrlKey && e.key === 'u') { e.preventDefault(); return false; }
        if (e.ctrlKey && e.shiftKey && ['i', 'I', 'j', 'J', 'c', 'C'].includes(e.key)) { e.preventDefault(); return false; }
    });

    // DevTools detection (check window size difference trick)
    let devToolsOpen = false;
    const threshold = 160;
    const devToolsInterval = setInterval(() => {
        const widthDiff = window.outerWidth - window.innerWidth > threshold;
        const heightDiff = window.outerHeight - window.innerHeight > threshold;
        if ((widthDiff || heightDiff) && !devToolsOpen) {
            devToolsOpen = true;
            clearInterval(devToolsInterval);
            // Clear screen content when devtools detected
            document.body.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100vh;background:#0a0e1a;color:#00D4FF;font-family:sans-serif;font-size:24px">\uD83D\uDD12 Access Denied</div>';
        }
    }, 1000);

    // Disable text selection on sensitive elements
    document.addEventListener('selectstart', e => {
        if (e.target.closest('#avatar-canvas, #left-panel')) e.preventDefault();
    });

    // ── Layer 7: Fingerprinting ──
    // Generate unique session fingerprint and embed in all API calls
    const sessionId = localStorage.getItem('kelion_session_id') ||
        ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c =>
            (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));
    localStorage.setItem('kelion_session_id', sessionId);

    // Add session ID to all fetch calls via monkey-patch
    const originalFetch = window.fetch;
    window.fetch = function (url, options) {
        options = options || {};
        if (typeof url === 'string' && (url.startsWith(window.location.origin) || url.startsWith('/'))) {
            options.headers = options.headers || {};
            if (options.headers instanceof Headers) {
                options.headers.set('x-session-id', sessionId);
            } else {
                options.headers['x-session-id'] = sessionId;
            }
        }
        return originalFetch.call(this, url, options);
    };

    // Copyright watermark in console
    console.log('%c\u00A9 AE Design 2026 \u2014 KelionAI. All rights reserved. Unauthorized copying is prohibited.',
        'color: #00D4FF; font-size: 14px; font-weight: bold;');
    console.log('%cIf you are inspecting this code, please note that all access is logged and fingerprinted.',
        'color: #ff6b6b; font-size: 11px;');

    window.KProtection = { sessionId, getSessionId: () => sessionId };
})();
