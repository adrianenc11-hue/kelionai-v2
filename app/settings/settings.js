// ═══════════════════════════════════════════════════════════════
// KelionAI — Settings Page JS
// Preferences + Billing
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';
  var API = window.location.origin;
  var PREFS_KEY = 'kelion_settings';

  // ─────────────────────────────────────────────────────────────
  // PREFERENCES
  // ─────────────────────────────────────────────────────────────
  function loadPrefs() {
    try {
      var raw = localStorage.getItem(PREFS_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
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
    el.style.opacity = '1';
    clearTimeout(el._t);
    el._t = setTimeout(function () {
      el.style.opacity = '0';
    }, 2000);
  }

  function applyPrefs(prefs) {
    var lang = document.getElementById('pref-language');
    var currentLang = (window.i18n ? i18n.getLanguage() : null) || prefs.language;
    if (lang && currentLang) lang.value = currentLang;

    var browser = document.getElementById('notif-browser');
    if (browser) browser.checked = !!prefs.notifBrowser;

    var sounds = document.getElementById('notif-sounds');
    if (sounds) sounds.checked = prefs.notifSounds !== false;
  }

  // ─────────────────────────────────────────────────────────────
  // BILLING
  // ─────────────────────────────────────────────────────────────
  async function loadBillingStatus() {
    try {
      var r = await fetch(API + '/api/payments/status', { headers: KShared.authHeaders() });
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
        if (plan === 'free') desc.textContent = 'Free plan — limited features';
        else if (plan === 'pro') desc.textContent = 'Pro plan — enhanced features';
        else if (plan === 'premium') desc.textContent = 'Premium plan — unlimited access';
      }
      if (plan !== 'free' && plan !== 'guest') {
        if (upgradeBtn) upgradeBtn.style.display = 'none';
        if (billingRow) billingRow.style.display = 'flex';
      }
    } catch (e) {}
  }

  // ─────────────────────────────────────────────────────────────
  // EVENT BINDINGS
  // ─────────────────────────────────────────────────────────────
  function bindEvents() {
    var prefs = loadPrefs();

    // Language
    var lang = document.getElementById('pref-language');
    if (lang) {
      lang.addEventListener('change', function () {
        prefs.language = this.value;
        savePrefs(prefs);
        if (window.i18n) i18n.setLanguage(this.value);
      });
    }

    // Notifications
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

    // Billing portal
    var portal = document.getElementById('btn-portal');
    if (portal) {
      portal.addEventListener('click', async function () {
        try {
          var r = await fetch(API + '/api/payments/portal', {
            method: 'POST',
            headers: Object.assign({ 'Content-Type': 'application/json' }, KShared.authHeaders()),
          });
          var d = await r.json();
          if (d.url) window.location.href = d.url;
        } catch (e) {}
      });
    }

  }

  // ─────────────────────────────────────────────────────────────
  // INIT
  // ─────────────────────────────────────────────────────────────
  function init() {
    var prefs = loadPrefs();
    applyPrefs(prefs);
    bindEvents();
    loadBillingStatus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();