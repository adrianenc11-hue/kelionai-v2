/**
 * KelionAI — Visitor Tracker
 * Tracks anonymous visitors as potential leads.
 * Generates browser fingerprint, captures device data, tracks page visits + time.
 * Auto-loaded on every page.
 */
(function () {
  'use strict';

  // ── Generate browser fingerprint (hash of stable device properties) ──
  function generateFingerprint() {
    var cached = localStorage.getItem('k_visitor_fp');
    if (cached) return cached;

    var components = [
      navigator.userAgent,
      navigator.language,
      screen.width + 'x' + screen.height,
      screen.colorDepth,
      new Date().getTimezoneOffset(),
      navigator.hardwareConcurrency || 0,
      navigator.platform,
      !!window.indexedDB,
      !!window.sessionStorage,
      navigator.maxTouchPoints || 0,
    ];

    // Simple hash
    var str = components.join('|');
    var hash = 0;
    for (var i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    var fp = 'v_' + Math.abs(hash).toString(36) + '_' + Date.now().toString(36);
    localStorage.setItem('k_visitor_fp', fp);
    return fp;
  }

  // ── Parse device info ──
  function getDeviceInfo() {
    var ua = navigator.userAgent;
    var browser = 'Other';
    if (ua.indexOf('Chrome') > -1 && ua.indexOf('Edge') === -1) browser = 'Chrome';
    else if (ua.indexOf('Firefox') > -1) browser = 'Firefox';
    else if (ua.indexOf('Safari') > -1 && ua.indexOf('Chrome') === -1) browser = 'Safari';
    else if (ua.indexOf('Edge') > -1) browser = 'Edge';
    else if (ua.indexOf('Opera') > -1 || ua.indexOf('OPR') > -1) browser = 'Opera';

    var device = 'Desktop';
    if (/Mobile|Android|iPhone/i.test(ua)) device = 'Mobile';
    else if (/Tablet|iPad/i.test(ua)) device = 'Tablet';

    var os = 'Other';
    if (ua.indexOf('Windows') > -1) os = 'Windows';
    else if (ua.indexOf('Mac OS') > -1) os = 'macOS';
    else if (ua.indexOf('Android') > -1) os = 'Android';
    else if (ua.indexOf('iPhone') > -1 || ua.indexOf('iPad') > -1) os = 'iOS';
    else if (ua.indexOf('Linux') > -1) os = 'Linux';

    return { browser: browser, device: device, os: os };
  }

  // ── Get UTM params ──
  function getUTM() {
    var params = new URLSearchParams(window.location.search);
    return {
      utm_source: params.get('utm_source') || null,
      utm_medium: params.get('utm_medium') || null,
      utm_campaign: params.get('utm_campaign') || null,
    };
  }

  // ── Track visit ──
  var fingerprint = generateFingerprint();
  var deviceInfo = getDeviceInfo();
  var utm = getUTM();
  var pageStart = Date.now();

  // Don't track admin pages or API
  if (window.location.pathname.indexOf('/admin') === 0) return;

  var visitData = {
    fingerprint: fingerprint,
    path: window.location.pathname,
    referrer: document.referrer || null,
    browser: deviceInfo.browser,
    device: deviceInfo.device,
    os: deviceInfo.os,
    screen_width: screen.width,
    screen_height: screen.height,
    language: navigator.language,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    utm_source: utm.utm_source,
    utm_medium: utm.utm_medium,
    utm_campaign: utm.utm_campaign,
  };

  // Send tracking data
  try {
    fetch('/api/track/visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(visitData),
      keepalive: true,
    }).catch(function () {
      /* silent */
    });
  } catch (e) {
    /* silent */
  }

  // ── Send beacon on page leave with duration ──
  function sendBeacon() {
    var duration = Math.round((Date.now() - pageStart) / 1000);
    if (duration < 1) return;
    var data = JSON.stringify({ fingerprint: fingerprint, path: window.location.pathname, duration: duration });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/track/beacon', new Blob([data], { type: 'application/json' }));
    } else {
      try {
        fetch('/api/track/beacon', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: data,
          keepalive: true,
        }).catch(function () {});
      } catch (e) {}
    }
  }

  window.addEventListener('beforeunload', sendBeacon);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') sendBeacon();
  });
})();
