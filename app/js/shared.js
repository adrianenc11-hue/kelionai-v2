// ═══════════════════════════════════════════════════════════════
// KelionAI — Shared frontend utilities (window.KShared)
// Loaded before page-specific scripts on pricing, settings,
// billing and main app pages.
// ═══════════════════════════════════════════════════════════════
(function () {
    'use strict';
    var API = window.location.origin;

    window.KShared = {

        getToken: function () {
            try { return localStorage.getItem('kelion_token'); } catch (e) { return null; }
        },

        authHeaders: function () {
            if (window.KAuth) {
                return { 'Content-Type': 'application/json', ...window.KAuth.getAuthHeaders() };
            }
            var h = { 'Content-Type': 'application/json' };
            var t = window.KShared.getToken();
            if (t) h['Authorization'] = 'Bearer ' + t;
            return h;
        },

        loadPlans: async function () {
            try {
                var r = await fetch(API + '/api/payments/plans');
                if (!r.ok) return [];
                var d = await r.json();
                return d.plans || [];
            } catch (e) { return []; }
        },

        loadStatus: async function () {
            try {
                var r = await fetch(API + '/api/payments/status', { headers: window.KShared.authHeaders() });
                if (!r.ok) return null;
                return await r.json();
            } catch (e) { return null; }
        },

        checkout: async function (plan) {
            if (!window.KShared.getToken() && !(window.KAuth && window.KAuth.isLoggedIn())) {
                alert('You need to be signed in to upgrade.');
                return;
            }
            try {
                var body = { plan: plan };
                var referralCode = null;
                try { referralCode = localStorage.getItem('kelion_referral_code'); } catch (_e) {}
                if (referralCode) body.referral_code = referralCode;
                var r = await fetch(API + '/api/payments/checkout', {
                    method: 'POST', headers: window.KShared.authHeaders(),
                    body: JSON.stringify(body)
                });
                var d = await r.json();
                if (d.url) window.location.href = d.url;
                else alert(d.error || 'Checkout error');
            } catch (e) { alert('Error processing payment.'); }
        },

        openPortal: async function () {
            try {
                var r = await fetch(API + '/api/payments/portal', {
                    method: 'POST', headers: window.KShared.authHeaders()
                });
                var d = await r.json();
                if (d.url) window.location.href = d.url;
                else alert(d.error || 'Portal error');
            } catch (e) { alert('Error opening portal.'); }
        },

        esc: function (str) {
            return String(str)
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#39;');
        }

    };
})();
