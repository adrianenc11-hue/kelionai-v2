(function () {
  'use strict';

  var AD_MESSAGES = [
    '🚀 Upgrade to Pro — 100 messages/day + voice + memory → /upgrade',
    '🎤 Kira is waiting for you — upgrade and unlock the second avatar',
    "💾 Your conversations aren't saved — upgrade to Pro to keep your memory",
    '🌍 KelionAI speaks 6 languages — Pro unlocks all native voices',
    '📁 Export your data in PDF, ZIP, JSON — available in Pro',
    '🔍 Unlimited web search — upgrade to Premium',
    '🖼️ Generate AI images with FLUX — Premium feature',
    '📧 Email assistant (Gmail/Outlook) — coming in Premium',
    '👨‍👩‍👧 Family Hub with GPS — Premium plan',
    "⭐ Refer a friend → 7 days Premium FREE for both — say 'give me referral code'",
  ];

  var PRO_MESSAGES = [
    "💡 Tip: Say 'Kelion, show history' to see past conversations on the monitor",
    "💡 Tip: Start with 'Kira,' to switch avatar mid-conversation",
    '💡 Tip: Drag and drop files directly onto the monitor',
    "💡 Tip: Say 'what's in front of me?' to activate camera vision",
    "💡 Tip: Say 'Kelion, forget everything' to reset your memory",
    "💡 Tip: Export your data anytime — say 'export my data'",
    '💡 Tip: Kelion auto-detects your language — just speak naturally',
    "💡 Tip: Say 'generate image of...' to create AI art with FLUX",
    '💡 Tip: Ask for weather — Kelion uses your GPS location automatically',
    '💡 Tip: Referral code gives 7 days Premium to you and a friend',
  ];

  var bar = null;
  var textEl = null;
  var disableBtn = null;
  var currentIndex = 0;
  var rotateInterval = null;
  var messages = [];

  /**
   * getBar
   * @returns {*}
   */
  function getBar() {
    return document.getElementById('ticker-bar');
  }
  /**
   * getTextEl
   * @returns {*}
   */
  function getTextEl() {
    return document.getElementById('ticker-text');
  }
  /**
   * getDisableBtn
   * @returns {*}
   */
  function getDisableBtn() {
    return document.getElementById('ticker-disable');
  }

  /**
   * showBar
   * @returns {*}
   */
  function showBar() {
    var b = getBar();
    if (b) {
      b.classList.remove('hidden');
      document.body.style.paddingBottom = '32px';
    }
  }

  /**
   * hideBar
   * @returns {*}
   */
  function hideBar() {
    var b = getBar();
    if (b) {
      b.classList.add('hidden');
      document.body.style.paddingBottom = '';
    }
  }

  /**
   * rotateMessage
   * @returns {*}
   */
  function rotateMessage() {
    var el = getTextEl();
    if (!el || !messages.length) return;
    el.classList.add('fade');
    setTimeout(function () {
      currentIndex = (currentIndex + 1) % messages.length;
      el.textContent = messages[currentIndex];
      el.classList.remove('fade');
    }, 400);
  }

  /**
   * startRotation
   * @returns {*}
   */
  function startRotation() {
    if (rotateInterval) clearInterval(rotateInterval);
    rotateInterval = setInterval(rotateMessage, 8000);
  }

  /**
   * disable
   * @returns {*}
   */
  function disable() {
    localStorage.setItem('kelion_ticker_disabled', '1');
    hideBar();
    if (rotateInterval) {
      clearInterval(rotateInterval);
      rotateInterval = null;
    }
    var user = window.KAuth && window.KAuth.getUser ? window.KAuth.getUser() : null;
    if (user) {
      fetch('/api/ticker/disable', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, window.KAuth.getAuthHeaders()),
        body: JSON.stringify({ disabled: true }),
      }).catch(function () {});
    }
  }

  /**
   * enable
   * @returns {*}
   */
  function enable() {
    localStorage.removeItem('kelion_ticker_disabled');
    init();
  }

  /**
   * initWithPlan
   * @param {*} plan
   * @returns {*}
   */
  function initWithPlan(plan) {
    if (plan === 'premium') {
      if (localStorage.getItem('kelion_ticker_disabled') === '1') {
        hideBar();
        return;
      }
      messages = PRO_MESSAGES;
    } else if (plan === 'pro') {
      messages = PRO_MESSAGES;
    } else {
      messages = AD_MESSAGES;
    }

    currentIndex = Math.floor(Math.random() * messages.length);
    var el = getTextEl();
    if (el) el.textContent = messages[currentIndex];

    var btn = getDisableBtn();
    if (btn) {
      if (plan === 'premium') {
        btn.classList.remove('hidden');
        btn.onclick = function () {
          disable();
        };
      } else {
        btn.classList.add('hidden');
        btn.onclick = null;
      }
    }

    showBar();
    startRotation();
  }

  /**
   * init
   * @returns {*}
   */
  function init() {
    // TEMPORARILY DISABLED — will be re-enabled later
    hideBar();
    return;

    bar = getBar();
    textEl = getTextEl();
    disableBtn = getDisableBtn();
    if (!bar) return;

    // If premium and disabled, bail out early
    var user = window.KAuth && window.KAuth.getUser ? window.KAuth.getUser() : null;
    if (!user) {
      initWithPlan('guest');
      return;
    }

    fetch('/api/payments/status', {
      headers: window.KAuth.getAuthHeaders(),
    })
      .then(function (r) {
        return r.ok ? r.json() : { plan: 'free' };
      })
      .then(function (d) {
        initWithPlan(d.plan || 'free');
      })
      .catch(function () {
        initWithPlan('free');
      });
  }

  window.KTicker = { init: init, disable: disable, enable: enable };
})();
