(function () {
    'use strict';

    var pollInterval = null;
    var lastSyncAt = null;
    var initRetries = 0;
    var MAX_INIT_RETRIES = 10;

    async function poll() {
        if (!window.KAuth || !window.KAuth.isLoggedIn()) return;

        var headers = window.KAuth.getAuthHeaders ? window.KAuth.getAuthHeaders() : {};
        var url = '/api/sync/latest' + (lastSyncAt ? '?since=' + encodeURIComponent(lastSyncAt) : '');

        try {
            var r = await fetch(url, { headers: headers });
            if (!r.ok) return;
            var data = await r.json();

            if (data.server_time) lastSyncAt = data.server_time;

            if (data.conversations && data.conversations.length > 0) {
                var latest = data.conversations[0];
                var localConvId = null;
                try { localConvId = localStorage.getItem('kelion_conv_id'); } catch (e) {}
                if (latest.id !== localConvId) {
                    window.dispatchEvent(new CustomEvent('sync-update', {
                        detail: { conversation: latest }
                    }));
                }
            }
        } catch (e) { /* silent fail */ }
    }

    function init() {
        if (!window.KAuth || !window.KAuth.isLoggedIn()) {
            if (initRetries < MAX_INIT_RETRIES) {
                initRetries++;
                setTimeout(init, 2000);
            }
            return;
        }

        lastSyncAt = new Date().toISOString();
        poll();
        pollInterval = setInterval(poll, 10000);
        console.log('[Sync] \u2705 Multi-device sync active');
    }

    function stop() {
        if (pollInterval) clearInterval(pollInterval);
        pollInterval = null;
    }

    window.KSync = { init: init, stop: stop };
})();
