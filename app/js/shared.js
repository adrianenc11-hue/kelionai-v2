// ═══════════════════════════════════════════════════════════════
// App — Shared frontend utilities (window.KShared)
// Loaded before page-specific scripts on pricing, settings,
// billing and main app pages.
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';
  const API = window.location.origin;

  window.KShared = {
    getToken: function () {
      try {
        return localStorage.getItem('kelion_token');
      } catch (_e) {
        return null;
      }
    },

    authHeaders: function () {
      if (window.KAuth) {
        return { 'Content-Type': 'application/json', ...window.KAuth.getAuthHeaders() };
      }
      const h = { 'Content-Type': 'application/json' };
      const t = window.KShared.getToken();
      if (t) h['Authorization'] = 'Bearer ' + t;
      return h;
    },

    loadPlans: async function () {
      try {
        const r = await fetch(API + '/api/payments/plans');
        if (!r.ok) return [];
        const d = await r.json();
        return d.plans || [];
      } catch (_e) {
        return [];
      }
    },

    loadStatus: async function () {
      try {
        const r = await fetch(API + '/api/payments/status', { headers: window.KShared.authHeaders() });
        if (!r.ok) return null;
        return await r.json();
      } catch (_e) {
        return null;
      }
    },

    checkout: async function (plan) {
      if (!window.KShared.getToken() && !(window.KAuth && window.KAuth.isLoggedIn())) {
        alert(i18n.t('shared.signInRequired'));
        return;
      }
      try {
        const body = { plan: plan };
        let referralCode = null;
        try {
          referralCode = localStorage.getItem('kelion_referral_code');
        } catch (_e) {
          /* ignored */
        }
        if (referralCode) body.referral_code = referralCode;
        const r = await fetch(API + '/api/payments/checkout', {
          method: 'POST',
          headers: window.KShared.authHeaders(),
          body: JSON.stringify(body),
        });
        const d = await r.json();
        if (d.url) window.location.href = d.url;
        else alert(d.error || 'Checkout error');
      } catch (_e) {
        alert('Error processing payment.');
      }
    },

    openPortal: async function () {
      try {
        const r = await fetch(API + '/api/payments/portal', {
          method: 'POST',
          headers: window.KShared.authHeaders(),
        });
        const d = await r.json();
        if (d.url) window.location.href = d.url;
        else alert(d.error || 'Portal error');
      } catch (_e) {
        alert('Error opening portal.');
      }
    },

    esc: function (str) {
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    },

    currencySymbol: function (code) {
      const map = { GBP: '£', EUR: '€', USD: '$', RON: 'lei ', PLN: 'zł', SEK: 'kr ', CHF: 'CHF ' };
      return map[(code || '').toUpperCase()] || code + ' ';
    },

    formatPrice: function (price, currency) {
      if (price === 0) return i18n.t('payments.free');
      return window.KShared.currencySymbol(currency) + price;
    },
  };
})();
