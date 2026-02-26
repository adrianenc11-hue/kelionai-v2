// KelionAI v2 — Multi-Device Sync Module
(function () {
    'use strict';
    const API_BASE = window.location.origin;
    let pollInterval = null;
    let lastSync = null;
    let lastUpdated = null;

    function authHeaders() {
        return { 'Content-Type': 'application/json', ...(window.KAuth ? KAuth.getAuthHeaders() : {}) };
    }

    function isLoggedIn() {
        return !!(window.KAuth && KAuth.isLoggedIn && KAuth.isLoggedIn());
    }

    function showSyncIndicator() {
        var el = document.getElementById('sync-indicator');
        if (!el) {
            el = document.createElement('div');
            el.id = 'sync-indicator';
            el.style.cssText = [
                'position:fixed', 'bottom:16px', 'left:50%', 'transform:translateX(-50%)',
                'background:rgba(0,204,255,0.15)', 'border:1px solid rgba(0,204,255,0.3)',
                'color:#00ccff', 'font-size:0.75rem', 'padding:4px 14px', 'border-radius:50px',
                'z-index:8000', 'opacity:0', 'transition:opacity 0.3s ease', 'pointer-events:none',
                'font-family:Inter,sans-serif'
            ].join(';');
            el.textContent = '↻ Synced';
            document.body.appendChild(el);
        }
        el.style.opacity = '1';
        setTimeout(function () { el.style.opacity = '0'; }, 1000);
    }

    async function poll() {
        if (!isLoggedIn()) return;
        try {
            var r = await fetch(API_BASE + '/api/sync/status', { headers: authHeaders() });
            if (!r.ok) return;
            var data = await r.json();
            if (data.lastUpdated && data.lastUpdated !== lastUpdated) {
                if (lastUpdated !== null) {
                    // New data available — reload conversations list
                    if (window.KApp && KApp.loadConversations) KApp.loadConversations();
                    showSyncIndicator();
                }
                lastUpdated = data.lastUpdated;
                lastSync = new Date();
            }
        } catch (e) { /* silent fail */ }
    }

    function start() {
        if (pollInterval) return;
        poll();
        pollInterval = setInterval(poll, 10000);
    }

    function stop() {
        if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    }

    function getLastSync() { return lastSync; }

    function init() {
        // Start polling once user is authenticated
        window.addEventListener('kelion-auth-change', function (e) {
            if (e.detail && e.detail.loggedIn) start();
            else stop();
        });
        // Also start if already logged in
        if (isLoggedIn()) start();
    }

    window.KSync = { init: init, stop: stop, getLastSync: getLastSync };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
