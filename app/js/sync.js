(function () {
    'use strict';

    var _pollInterval = null;
    var _lastKnownConvId = null;
    var _lastTypedAt = 0;
    var _TYPING_DEBOUNCE = 30 * 1000; // 30 seconds

    function _authHeaders() {
        return Object.assign({ 'Content-Type': 'application/json' }, window.KAuth ? KAuth.getAuthHeaders() : {});
    }

    function _poll() {
        fetch('/api/sync/status', { headers: _authHeaders() })
            .then(function (r) { return r.ok ? r.json() : null; })
            .then(function (data) {
                if (!data || !data.active_conversation_id) return;
                var remoteId = data.active_conversation_id;
                if (!_lastKnownConvId) { _lastKnownConvId = remoteId; return; }
                if (remoteId === _lastKnownConvId) return;
                var now = Date.now();
                if (now - _lastTypedAt < _TYPING_DEBOUNCE) return; // user is actively typing
                _lastKnownConvId = remoteId;
                _notifySwitched(remoteId);
            })
            .catch(function () { /* ignore network errors */ });
    }

    function _notifySwitched(convId) {
        console.info('[Sync] Conversation continued from another device:', convId);
        var notif = document.createElement('div');
        notif.id = 'sync-notification';
        notif.textContent = '🔄 Conversation continued from another device';
        notif.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,200,255,0.15);border:1px solid rgba(0,200,255,0.4);color:#e0f7ff;padding:10px 20px;border-radius:8px;font-size:0.85rem;z-index:9000;';
        document.body.appendChild(notif);
        setTimeout(function () { if (notif.parentNode) notif.parentNode.removeChild(notif); }, 4000);
        // Dispatch a custom event so app.js can load the conversation if desired
        document.dispatchEvent(new CustomEvent('kelion:sync-switch', { detail: { conversationId: convId } }));
    }

    function _recordTyping() {
        _lastTypedAt = Date.now();
    }

    function init(currentConvId) {
        _lastKnownConvId = currentConvId || null;
        // Listen for typing to debounce auto-switch
        var input = document.getElementById('text-input');
        if (input) input.addEventListener('input', _recordTyping);
        _pollInterval = setInterval(_poll, 10 * 1000);
    }

    function setActive(convId) {
        _lastKnownConvId = convId;
        fetch('/api/sync/active', {
            method: 'POST',
            headers: _authHeaders(),
            body: JSON.stringify({ conversationId: convId })
        }).catch(function () {});
    }

    function stop() {
        if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
    }

    window.KSync = { init: init, setActive: setActive, stop: stop };
}());
