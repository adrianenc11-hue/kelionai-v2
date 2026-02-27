(function () {
    'use strict';
    var API = window.location.origin;
    var PREFS_KEY = 'kelion_settings';

    function getToken() {
        try { return localStorage.getItem('kelion_token'); } catch (e) { return null; }
    }

    function authHeaders() {
        var h = { 'Content-Type': 'application/json' };
        var t = getToken();
        if (t) h['Authorization'] = 'Bearer ' + t;
        return h;
    }

    /* ── Persist preferences in localStorage ── */
    function loadPrefs() {
        try {
            var raw = localStorage.getItem(PREFS_KEY);
            return raw ? JSON.parse(raw) : {};
        } catch (e) { return {}; }
    }

    function savePrefs(prefs) {
        try {
            localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
            showSaveFeedback();
        } catch (e) {}
    }

    function showSaveFeedback() {
        var el = document.getElementById('save-feedback');
        if (!el) return;
        el.classList.add('show');
        clearTimeout(el._t);
        el._t = setTimeout(function () { el.classList.remove('show'); }, 2000);
    }

    /* ── Apply saved preferences to UI ── */
    function applyPrefs(prefs) {
        var lang = document.getElementById('pref-language');
        if (lang && prefs.language) lang.value = prefs.language;

        var browser = document.getElementById('notif-browser');
        if (browser) browser.checked = !!prefs.notifBrowser;

        var sounds = document.getElementById('notif-sounds');
        if (sounds) sounds.checked = prefs.notifSounds !== false;

        var ticker = document.getElementById('notif-ticker');
        if (ticker) ticker.checked = prefs.notifTicker !== false;
    }

    /* ── Load billing status ── */
    async function loadBillingStatus() {
        try {
            var r = await fetch(API + '/api/payments/status', { headers: authHeaders() });
            if (!r.ok) return;
            var data = await r.json();
            var plan = data.plan || 'free';

            var badge = document.getElementById('plan-badge');
            var desc = document.getElementById('plan-desc');
            var upgradeBtn = document.getElementById('btn-upgrade');
            var billingRow = document.getElementById('billing-row');

            if (badge) {
                badge.textContent = plan.charAt(0).toUpperCase() + plan.slice(1);
                badge.className = 'plan-status-badge ' + plan;
            }

            if (desc) {
                if (plan === 'free') {
                    desc.textContent = '50 mesaje/zi · Funcții de bază';
                } else if (plan === 'pro') {
                    desc.textContent = 'Chat nelimitat · Toate funcțiile';
                } else if (plan === 'enterprise') {
                    desc.textContent = 'Acces complet · Suport prioritar';
                }
            }

            if (plan !== 'free' && plan !== 'guest') {
                if (upgradeBtn) upgradeBtn.style.display = 'none';
                if (billingRow) billingRow.style.display = 'flex';
            }
        } catch (e) {}
    }

    /* ── Open billing portal ── */
    async function openPortal() {
        try {
            var r = await fetch(API + '/api/payments/portal', {
                method: 'POST', headers: authHeaders()
            });
            var d = await r.json();
            if (d.url) window.location.href = d.url;
            else alert(d.error || 'Eroare portal billing.');
        } catch (e) { alert('Eroare la deschiderea portalului de billing.'); }
    }

    /* ── Event listeners ── */
    function bindEvents() {
        var prefs = loadPrefs();

        var lang = document.getElementById('pref-language');
        if (lang) {
            lang.addEventListener('change', function () {
                prefs.language = this.value;
                savePrefs(prefs);
            });
        }

        var browser = document.getElementById('notif-browser');
        if (browser) {
            browser.addEventListener('change', function () {
                prefs.notifBrowser = this.checked;
                if (this.checked && 'Notification' in window && Notification.permission === 'default') {
                    Notification.requestPermission();
                }
                savePrefs(prefs);
            });
        }

        var sounds = document.getElementById('notif-sounds');
        if (sounds) {
            sounds.addEventListener('change', function () {
                prefs.notifSounds = this.checked;
                savePrefs(prefs);
            });
        }

        var ticker = document.getElementById('notif-ticker');
        if (ticker) {
            ticker.addEventListener('change', function () {
                prefs.notifTicker = this.checked;
                savePrefs(prefs);
            });
        }

        var portal = document.getElementById('btn-portal');
        if (portal) portal.addEventListener('click', openPortal);
    }

    function init() {
        var prefs = loadPrefs();
        applyPrefs(prefs);
        bindEvents();
        loadBillingStatus();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
