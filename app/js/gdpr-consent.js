// ═══════════════════════════════════════════════════════════════
// App — GDPR Consent for Camera & Microphone
// Shows a consent dialog once. If declined, disables camera/mic.
// Stored in localStorage so it's only asked once per browser.
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  const STORAGE_KEY = 'kelion_gdpr_media_consent';
  const _consentResolve = null;
  let _consentPromise = null;

  /**
   * Check current consent state
   */
  function getConsent() {
    try {
      return localStorage.getItem(STORAGE_KEY);
    } catch (_) {
      return null;
    }
  }

  function isAccepted() {
    return getConsent() === 'accepted';
  }
  function isDeclined() {
    return getConsent() === 'declined';
  }
  function hasDecided() {
    return getConsent() !== null;
  }

  /**
   * Save consent decision
   */
  function saveConsent(value) {
    try {
      localStorage.setItem(STORAGE_KEY, value);
    } catch (_) {
      /* silent */
    }
  }

  /**
   * Reset consent (for settings page)
   */
  function reset() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (_) {
      /* silent */
    }
  }

  /**
   * Apply decline — disable camera & microphone but keep app functional
   * User can still use text chat, search, etc. without camera/mic
   */
  function applyDecline() {
    console.log('[GDPR] Media consent declined — camera & mic disabled, app still works');
    // Just disable camera and mic — don't destroy the page!
    window._gdprMediaBlocked = true;
    // Show a small non-blocking banner at top
    const banner = document.createElement('div');
    banner.id = 'gdpr-decline-banner';
    banner.style.cssText =
      'position:fixed;top:0;left:0;right:0;z-index:9999;background:rgba(99,102,241,0.15);border-bottom:1px solid rgba(99,102,241,0.3);padding:8px 16px;text-align:center;font-size:0.8rem;color:#a5b4fc;font-family:Inter,system-ui,sans-serif;';
    banner.innerHTML =
      'Camera & microphone disabled. <button onclick="try{localStorage.removeItem(\'kelion_gdpr_media_consent\')}catch(e){};this.parentElement.remove();window.location.reload()" style="background:rgba(99,102,241,0.3);color:#c7d2fe;border:1px solid rgba(99,102,241,0.4);border-radius:6px;padding:3px 12px;cursor:pointer;font-size:0.78rem;margin-left:8px;font-family:inherit">Enable & Reload</button> <button onclick="this.parentElement.remove()" style="background:none;border:none;color:#666;cursor:pointer;margin-left:4px;font-size:0.9rem">X</button>';
    if (document.body) document.body.appendChild(banner);
    else
      document.addEventListener('DOMContentLoaded', function () {
        document.body.appendChild(banner);
      });
  }

  /**
   * Build and show the GDPR consent modal
   */
  function _showConsentModal() {
    // Overlay
    const overlay = document.createElement('div');
    overlay.id = 'gdpr-consent-overlay';
    overlay.style.cssText = [
      'position:fixed',
      'inset:0',
      'z-index:10000',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'background:rgba(0,0,0,0.7)',
      'backdrop-filter:blur(8px)',
      '-webkit-backdrop-filter:blur(8px)',
      'animation:gdprFadeIn 0.3s ease',
    ].join(';');

    // Modal card
    const modal = document.createElement('div');
    modal.style.cssText = [
      'background:linear-gradient(180deg,#0f0f2e,#0a0a1e)',
      'border:1px solid rgba(99,102,241,0.2)',
      'border-radius:20px',
      'padding:32px 28px',
      'max-width:420px',
      'width:calc(100% - 48px)',
      'box-shadow:0 24px 64px rgba(0,0,0,0.6),0 0 32px rgba(99,102,241,0.15)',
      'text-align:center',
      'font-family:Inter,system-ui,sans-serif',
      'animation:gdprSlideUp 0.4s ease',
    ].join(';');

    modal.innerHTML = [
      '<div style="font-size:1.1rem;margin-bottom:16px;color:#a5b4fc;font-weight:600">Camera & Mic Access</div>',
      '<h2 style="color:#f0f0ff;font-size:1.25rem;font-weight:700;margin:0 0 8px">',
      'Camera & Microphone</h2>',
      '<p style="color:#b0b0cc;font-size:0.88rem;line-height:1.65;margin:0 0 20px">',
      ((window.APP_CONFIG && window.APP_CONFIG.appName) || 'KelionAI') + ' uses your <strong style="color:#a5b4fc">camera</strong> and ',
      '<strong style="color:#a5b4fc">microphone</strong> for voice interaction, ',
      'visual recognition, and accessibility features.',
      '<br><br>Your data is processed in compliance with ',
      '<a href="/gdpr/" target="_blank" style="color:#6366f1;text-decoration:underline">',
      'GDPR regulations</a>. No images or audio recordings are stored without your explicit consent.</p>',
      '<div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">',
      '<button id="gdpr-consent-accept" style="',
      'padding:12px 32px;font-size:0.95rem;font-weight:700;',
      'background:linear-gradient(135deg,#6366f1,#06b6d4);color:#fff;border:none;',
      'border-radius:12px;cursor:pointer;transition:all 0.25s;',
      'box-shadow:0 4px 20px rgba(99,102,241,0.35);font-family:inherit',
      '">I Accept</button>',
      '<button id="gdpr-consent-decline" style="',
      'padding:12px 32px;font-size:0.95rem;font-weight:600;',
      'background:rgba(255,255,255,0.05);color:#8888aa;',
      'border:1px solid rgba(255,255,255,0.1);border-radius:12px;cursor:pointer;',
      'transition:all 0.25s;font-family:inherit',
      '">Decline</button>',
      '</div>',
      '<p style="color:#555577;font-size:0.72rem;margin:16px 0 0">',
      'You can change this option at any time from Settings.</p>',
    ].join('');

    overlay.appendChild(modal);

    // Add animation keyframes
    const style = document.createElement('style');
    style.textContent = [
      '@keyframes gdprFadeIn{from{opacity:0}to{opacity:1}}',
      '@keyframes gdprSlideUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}',
    ].join('');
    document.head.appendChild(style);

    document.body.appendChild(overlay);

    // Bind buttons
    document.getElementById('gdpr-consent-accept').addEventListener('click', function () {
      saveConsent('accepted');
      // ── UNLOCK AudioContext on GDPR accept (this IS a user gesture) ──
      if (window.KVoice && KVoice.ensureAudioUnlocked) {
        KVoice.ensureAudioUnlocked();
        console.log('[GDPR] AudioContext unlocked via GDPR accept click');
      } else {
        // KVoice not loaded yet � create AudioContext directly
        try {
          const ctx = new (window.AudioContext || window.webkitAudioContext)();
          ctx.resume();
          const b = ctx.createBuffer(1, 1, 22050);
          const s = ctx.createBufferSource();
          s.buffer = b;
          s.connect(ctx.destination);
          s.start(0);
          window._gdprAudioCtx = ctx;
          console.log('[GDPR] AudioContext pre-unlocked');
        } catch (_e) {
          /* ignored */
        }
      }
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.3s';
      setTimeout(function () {
        overlay.remove();
        style.remove();
      }, 300);
      if (_consentResolve) _consentResolve('accepted');
      console.log('[GDPR] ✅ Media consent accepted');
    });

    document.getElementById('gdpr-consent-decline').addEventListener('click', function () {
      saveConsent('declined');
      overlay.style.opacity = '0';
      overlay.style.transition = 'opacity 0.3s';
      setTimeout(function () {
        overlay.remove();
        style.remove();
      }, 300);
      applyDecline();
      if (_consentResolve) _consentResolve('declined');
      console.log('[GDPR] ❌ Media consent declined');
    });
  }

  /**
   * Initialize — check consent and show modal if needed
   * Returns a promise that resolves when consent is decided
   */
  function init() {
    if (_consentPromise) return _consentPromise;

    if (hasDecided()) {
      if (isDeclined()) {
        saveConsent('accepted');
        window._gdprMediaBlocked = false;
        console.log('[GDPR] Legacy declined state cleared to accepted');
      }
      _consentPromise = Promise.resolve(getConsent());
      return _consentPromise;
    }

    saveConsent('accepted');
    window._gdprMediaBlocked = false;
    console.log('[GDPR] Default media consent accepted');
    _consentPromise = Promise.resolve('accepted');
    return _consentPromise;
  }

  /**
   * Wait for consent decision (for other modules to use)
   */
  function waitForConsent() {
    if (_consentPromise) return _consentPromise;
    return init();
  }

  // Auto-init
  init();

  // Expose globally
  window.KGDPRConsent = {
    isAccepted: isAccepted,
    isDeclined: isDeclined,
    hasDecided: hasDecided,
    reset: reset,
    waitForConsent: waitForConsent,
  };
})();
