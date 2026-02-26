// ═══════════════════════════════════════════════════════════════
// KelionAI — Multi-Device Sync
// Polls conversation history every 10s and shows notification dot
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';

    var API = window.location.origin;
    var syncInterval = null;
    var lastSync = null;
    var knownConvIds = {};

    function authHeaders() {
        return { 'Content-Type': 'application/json', ...(window.KAuth ? KAuth.getAuthHeaders() : {}) };
    }

    function setNotificationDot(show) {
        var btn = document.getElementById('btn-history');
        if (!btn) return;
        var existing = document.getElementById('sync-dot');
        if (show && !existing) {
            var dot = document.createElement('span');
            dot.id = 'sync-dot';
            dot.className = 'sync-dot';
            btn.appendChild(dot);
        } else if (!show && existing) {
            existing.parentNode.removeChild(existing);
        }
    }

    function syncConversations() {
        if (!window.KAuth || !KAuth.isLoggedIn()) return;

        fetch(API + '/api/conversations', { headers: authHeaders() })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (!data) return;
                var convs = data.conversations || [];
                var hasNew = false;
                var initialized = Object.keys(knownConvIds).length > 0;

                for (var i = 0; i < convs.length; i++) {
                    var id = convs[i].id;
                    if (!knownConvIds[id]) {
                        if (initialized) hasNew = true;
                        knownConvIds[id] = true;
                    }
                }

                if (hasNew) setNotificationDot(true);
                lastSync = new Date();
            })
            .catch(function () {});
    }

    function start() {
        if (syncInterval) return;
        syncConversations();
        syncInterval = setInterval(syncConversations, 10000);
    }

    function stop() {
        if (syncInterval) {
            clearInterval(syncInterval);
            syncInterval = null;
        }
    }

    function getLastSync() { return lastSync; }

    // Clear notification dot when history sidebar is opened
    document.addEventListener('click', function (e) {
        if (e.target && (e.target.id === 'btn-history' || e.target.closest && e.target.closest('#btn-history'))) {
            setNotificationDot(false);
        }
    });

    window.KSync = { start: start, stop: stop, getLastSync: getLastSync };
}());
