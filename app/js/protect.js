// ═══════════════════════════════════════════════════════════════
// KelionAI v2 — SOURCE PROTECTION (Layer 2 + Layer 7)
// Disable right-click, DevTools, copy, print, drag
// Fingerprint injection for session tracing
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    // ─── CONSTANTS ───────────────────────────────────────────────
    var COPYRIGHT_TEXT = '© KelionAI — AE Design. All rights reserved. Unauthorized copying prohibited.';
    var WARNING_SHOWN = false;

    // ─── RIGHT-CLICK ─────────────────────────────────────────────
    document.addEventListener('contextmenu', function (e) {
        e.preventDefault();
    });

    // ─── KEYBOARD SHORTCUTS ──────────────────────────────────────
    document.addEventListener('keydown', function (e) {
        var key = e.key ? e.key.toUpperCase() : '';
        var ctrl = e.ctrlKey || e.metaKey;

        // F12
        if (e.keyCode === 123) { e.preventDefault(); return; }
        // Ctrl+Shift+I, Ctrl+Shift+J
        if (ctrl && e.shiftKey && (key === 'I' || key === 'J')) { e.preventDefault(); return; }
        // Ctrl+U (view source)
        if (ctrl && key === 'U') { e.preventDefault(); return; }
        // Ctrl+S (save page)
        if (ctrl && key === 'S') { e.preventDefault(); return; }
        // Ctrl+A (select all)
        if (ctrl && key === 'A') { e.preventDefault(); return; }
    });

    // ─── TEXT SELECTION ON SENSITIVE ELEMENTS ────────────────────
    var style = document.createElement('style');
    style.textContent = [
        '.avatar-area, canvas, #legal-watermark {',
        '  -webkit-user-select: none;',
        '  -moz-user-select: none;',
        '  -ms-user-select: none;',
        '  user-select: none;',
        '}'
    ].join('\n');
    document.head.appendChild(style);

    // ─── DRAG ON IMAGES AND CANVAS ───────────────────────────────
    document.addEventListener('dragstart', function (e) {
        if (e.target.tagName === 'IMG' || e.target.tagName === 'CANVAS') {
            e.preventDefault();
        }
    });

    // ─── PRINT OVERRIDE ──────────────────────────────────────────
    var originalPrint = window.print;
    window.print = function () {
        showWarning('Printing is disabled. © KelionAI — AE Design.');
    };
    window.addEventListener('beforeprint', function (e) {
        showWarning('Printing is disabled. © KelionAI — AE Design.');
    });

    // ─── COPY — REPLACE CLIPBOARD CONTENT ────────────────────────
    document.addEventListener('copy', function (e) {
        if (e.clipboardData) {
            e.clipboardData.setData('text/plain', COPYRIGHT_TEXT);
            e.preventDefault();
        }
    });

    // ─── DEVTOOLS DETECTION ──────────────────────────────────────
    function checkDevTools() {
        var threshold = 160;
        var widthDiff = window.outerWidth - window.innerWidth;
        var heightDiff = window.outerHeight - window.innerHeight;
        if (widthDiff > threshold || heightDiff > threshold) {
            if (!WARNING_SHOWN) {
                WARNING_SHOWN = true;
                showWarning('Unauthorized access attempt detected.');
                logDevToolsAttempt();
            }
        }
    }
    setInterval(checkDevTools, 1000);

    // ─── WARNING OVERLAY ─────────────────────────────────────────
    function showWarning(message) {
        var existing = document.getElementById('protect-warning-overlay');
        if (existing) return;

        var overlay = document.createElement('div');
        overlay.id = 'protect-warning-overlay';
        overlay.setAttribute('role', 'alert');
        overlay.style.cssText = [
            'position:fixed',
            'top:0',
            'left:0',
            'width:100%',
            'z-index:2147483647',
            'background:rgba(10,10,20,0.97)',
            'color:#ff4444',
            'font-family:system-ui,sans-serif',
            'display:flex',
            'flex-direction:column',
            'align-items:center',
            'justify-content:center',
            'padding:32px',
            'text-align:center',
            'box-shadow:0 4px 32px rgba(0,0,0,0.8)'
        ].join(';');

        var icon = document.createElement('div');
        icon.textContent = '⚠️';
        icon.style.cssText = 'font-size:3rem;margin-bottom:16px';

        var title = document.createElement('div');
        title.textContent = message;
        title.style.cssText = 'font-size:1.25rem;font-weight:bold;margin-bottom:12px';

        var sub = document.createElement('div');
        sub.textContent = '© 2026 KelionAI — AE Design. All Rights Reserved.';
        sub.style.cssText = 'font-size:0.875rem;color:#aaa;margin-bottom:24px';

        var btn = document.createElement('button');
        btn.textContent = 'Dismiss';
        btn.style.cssText = [
            'background:#333',
            'color:#fff',
            'border:1px solid #555',
            'border-radius:8px',
            'padding:10px 24px',
            'cursor:pointer',
            'font-size:1rem'
        ].join(';');
        btn.addEventListener('click', function () {
            overlay.remove();
        });

        overlay.appendChild(icon);
        overlay.appendChild(title);
        overlay.appendChild(sub);
        overlay.appendChild(btn);
        document.body.appendChild(overlay);
    }

    // ─── LOG DEVTOOLS ATTEMPT ─────────────────────────────────────
    function logDevToolsAttempt() {
        try {
            fetch('/api/protect/devtools-attempt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ timestamp: new Date().toISOString() })
            }).catch(function () { /* silent */ });
        } catch (e) { /* silent */ }
    }

    // ─── FINGERPRINT INJECTION ────────────────────────────────────
    function injectFingerprint() {
        fetch('/api/protect/fingerprint')
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.token) return;
                var token = data.token;

                // Set as data attribute on body for traceability
                document.body.setAttribute('data-fp', token);

                // Inject as invisible watermark text node
                var wm = document.createElement('span');
                wm.setAttribute('aria-hidden', 'true');
                wm.style.cssText = [
                    'position:fixed',
                    'bottom:0',
                    'left:0',
                    'opacity:0.001',
                    'font-size:1px',
                    'color:transparent',
                    'pointer-events:none',
                    'user-select:none',
                    'z-index:-1'
                ].join(';');
                wm.textContent = token;
                document.body.appendChild(wm);
            })
            .catch(function () { /* fingerprint is best-effort */ });
    }

    // ─── INIT ────────────────────────────────────────────────────
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectFingerprint);
    } else {
        injectFingerprint();
    }
}());
