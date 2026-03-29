// ===============================================================
// App -- Mobile Features v2
// Navigation, SOS Emergency (with accidental trigger protection),
// Receipt Scanner, Mood Detection
// Callable from chat commands + KMobile API, display on monitor
// ===============================================================
(function () {
  'use strict';

  const API_BASE = window.location.origin;

  function authHeaders() {
    const h = window.KAuth && KAuth.getAuthHeaders ? KAuth.getAuthHeaders() : {};
    h['Content-Type'] = 'application/json';
    return h;
  }

  function getGeo() {
    return window.KGeo ? KGeo.getCached() : null;
  }

  function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  // ===============================================================
  // N2: NAVIGATION
  // ===============================================================
  function navigate(destination) {
    const geo = getGeo();
    let url;
    if (geo) {
      url =
        (window.KELION_URLS && KELION_URLS.GOOGLE_MAPS) +
        '/dir/' +
        geo.lat +
        ',' +
        geo.lng +
        '/' +
        encodeURIComponent(destination);
    } else {
      url = (window.KELION_URLS && KELION_URLS.GOOGLE_MAPS) + '/dir//' + encodeURIComponent(destination);
    }

    const _t = window.i18n
      ? i18n.t.bind(i18n)
      : function (k, _p) {
          return k;
        };
    const html =
      '<div style="padding:20px;text-align:center">' +
      '<div style="font-size:2rem;margin-bottom:12px">&#x1F9ED;</div>' +
      '<div style="color:#a5b4fc;font-weight:700;font-size:1.1rem">' +
      _t('mobile.navigateTo') +
      '</div>' +
      '<div style="color:#fff;font-size:1.3rem;margin:8px 0;font-weight:600">' +
      esc(destination) +
      '</div>' +
      (geo
        ? '<div style="color:#888;font-size:0.8rem">' +
          _t('mobile.from') +
          ' ' +
          geo.lat.toFixed(4) +
          ', ' +
          geo.lng.toFixed(4) +
          '</div>'
        : '') +
      '<a href="' +
      url +
      '" target="_blank" style="display:inline-block;margin-top:16px;padding:12px 24px;background:#6366f1;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">' +
      _t('mobile.openGoogleMaps') +
      '</a>' +
      '<div style="color:#666;font-size:0.75rem;margin-top:8px">' +
      new Date().toLocaleString() +
      '</div>' +
      '</div>';

    if (typeof window.showOnMonitor === 'function') window.showOnMonitor(html, 'html');
    window.open(url, '_blank');
    return html;
  }

  // ===============================================================
  // N8: SOS EMERGENCY -- cu protectie anti-accidental
  //   Trimite coordonatele prin:
  //   1. Monitor (butoane 112 / Ambulanta / Politie)
  //   2. SMS (link sms:?body= cu coordonate)
  //   3. navigator.share() pe mobile
  //   4. Supabase (salvare in brain_memory)
  // ===============================================================
  function sosEmergency() {
    const _t = window.i18n
      ? i18n.t.bind(i18n)
      : function (k) {
          return k;
        };
    const confirmed = window.confirm(_t('mobile.sos.confirm'));
    if (!confirmed) return null;

    const geo = getGeo();
    const locText = geo
      ? 'Lat: ' + geo.lat.toFixed(6) + ', Lng: ' + geo.lng.toFixed(6) + ' (+-' + Math.round(geo.accuracy || 0) + 'm)'
      : _t('mobile.locationUnavailable');
    const mapsLink = geo ? (window.KELION_URLS && KELION_URLS.GOOGLE_MAPS) + '?q=' + geo.lat + ',' + geo.lng : '';
    const timestamp = new Date().toLocaleString();
    const shareText = _t('mobile.sos.shareText') + ' ' + locText + ' ' + mapsLink + ' ' + timestamp;

    const smsLink = 'sms:?body=' + encodeURIComponent(shareText);

    const html =
      '<div style="padding:20px;text-align:center;background:linear-gradient(135deg,rgba(239,68,68,0.15),rgba(0,0,0,0))">' +
      '<div style="font-size:3rem;margin-bottom:12px;animation:pulseSos 1s infinite">&#x1F6A8;</div>' +
      '<div style="color:#ef4444;font-weight:700;font-size:1.3rem;text-transform:uppercase">SOS EMERGENCY</div>' +
      '<div style="color:#fff;font-size:1rem;margin:12px 0">' +
      esc(locText) +
      '</div>' +
      '<div style="color:#888;font-size:0.8rem">' +
      timestamp +
      '</div>' +
      (mapsLink
        ? '<a href="' +
          mapsLink +
          '" target="_blank" style="display:inline-block;margin-top:12px;padding:10px 20px;background:#334155;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">' +
          _t('mobile.locationOnMap') +
          '</a>'
        : '') +
      '<div style="margin-top:16px;display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
      '<a href="tel:112" style="padding:10px 20px;background:#dc2626;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:1.1rem">' +
      _t('mobile.call112') +
      '</a>' +
      '<a href="tel:112" style="padding:10px 20px;background:#f97316;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">' +
      _t('mobile.ambulance') +
      '</a>' +
      '<a href="tel:112" style="padding:10px 20px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">' +
      _t('mobile.police') +
      '</a>' +
      '</div>' +
      '<div style="margin-top:16px;border-top:1px solid rgba(255,255,255,0.1);padding-top:16px">' +
      '<div style="color:#f59e0b;font-weight:600;font-size:0.85rem;margin-bottom:8px">' +
      _t('mobile.sendCoordinates') +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
      '<a href="' +
      smsLink +
      '" style="padding:8px 16px;background:#10b981;color:#fff;text-decoration:none;border-radius:8px;font-weight:600">SMS</a>' +
      '<button id="sos-share-btn" style="padding:8px 16px;background:#6366f1;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer">Share</button>' +
      '</div></div></div>' +
      '<style>@keyframes pulseSos{0%,100%{transform:scale(1)}50%{transform:scale(1.15)}}</style>';

    if (typeof window.showOnMonitor === 'function') window.showOnMonitor(html, 'html');

    setTimeout(function () {
      const shareBtn = document.getElementById('sos-share-btn');
      if (shareBtn) {
        shareBtn.addEventListener('click', function () {
          if (navigator.share) {
            navigator.share({ title: 'SOS', text: shareText, url: mapsLink || undefined }).catch(function () {});
          } else {
            navigator.clipboard.writeText(shareText).then(function () {
              shareBtn.textContent = 'Copied!';
            });
          }
        });
      }
    }, 100);

    fetch(API_BASE + '/api/chat', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ message: '[SOS EMERGENCY] ' + locText + ' | ' + timestamp + ' | ' + mapsLink, geo: geo }),
    }).catch(function () {});

    return html;
  }

  // ===============================================================
  // C5: RECEIPT SCANNER
  // ===============================================================
  function scanReceipt() {
    let frame = null;
    if (window.KAutoCamera && KAutoCamera.isActive()) {
      frame = KAutoCamera.captureFrame();
    }

    if (!frame) {
      navigator.mediaDevices
        .getUserMedia({
          video: { facingMode: 'environment', width: { ideal: 1280 } },
          audio: false,
        })
        .then(function (stream) {
          const video = document.createElement('video');
          video.autoplay = true;
          video.playsInline = true;
          video.srcObject = stream;
          video.play().then(function () {
            setTimeout(function () {
              const canvas = document.createElement('canvas');
              canvas.width = 1280;
              canvas.height = 960;
              canvas.getContext('2d').drawImage(video, 0, 0, 1280, 960);
              stream.getTracks().forEach(function (t) {
                t.stop();
              });
              const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
              sendReceiptToAI({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
            }, 1000);
          });
        })
        .catch(function () {
          const errHtml = '<div style="padding:20px;color:#ef4444;text-align:center">Camera unavailable</div>';
          if (typeof window.showOnMonitor === 'function') window.showOnMonitor(errHtml, 'html');
        });
      return;
    }

    sendReceiptToAI(frame);
  }

  function sendReceiptToAI(frame) {
    const loadHtml =
      '<div style="padding:20px;text-align:center"><div style="font-size:2rem">&#x1F9FE;</div><div style="color:#f59e0b;margin-top:8px">Scanning receipt...</div></div>';
    if (typeof window.showOnMonitor === 'function') window.showOnMonitor(loadHtml, 'html');

    fetch(API_BASE + '/api/chat', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        message:
          'Analyze this receipt. Extract: store, date, list of products with prices, total. Format as HTML table. At the end estimate total calories for food products.',
        imageBase64: frame.base64,
        imageMimeType: frame.mimeType,
        geo: getGeo(),
      }),
    })
      .then(function (r) {
        if (r.ok) return r.json();
        throw new Error('failed');
      })
      .then(function (data) {
        const reply = data.reply || data.text || 'No response';
        const html =
          '<div style="padding:16px">' +
          '<div style="color:#f59e0b;font-weight:700;font-size:1.1rem;margin-bottom:8px">Receipt Analysis</div>' +
          '<div style="color:#888;font-size:0.75rem;margin-bottom:12px">' +
          new Date().toLocaleString() +
          '</div>' +
          '<div style="color:#ddd;font-size:0.9rem">' +
          reply +
          '</div></div>';
        if (typeof window.showOnMonitor === 'function') window.showOnMonitor(html, 'html');
      })
      .catch(function (e) {
        console.warn('[MobileFeatures] Receipt error:', e);
      });
  }

  // ===============================================================
  // F3: MOOD DETECTION
  // ===============================================================
  function detectMood() {
    let frame = null;
    if (
      window.KAutoCamera &&
      KAutoCamera.isActive() &&
      KAutoCamera.getFacingMode &&
      KAutoCamera.getFacingMode() === 'user'
    ) {
      frame = KAutoCamera.captureFrame();
    }

    if (!frame) {
      navigator.mediaDevices
        .getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 } },
          audio: false,
        })
        .then(function (stream) {
          const video = document.createElement('video');
          video.autoplay = true;
          video.playsInline = true;
          video.srcObject = stream;
          video.play().then(function () {
            setTimeout(function () {
              const canvas = document.createElement('canvas');
              canvas.width = 640;
              canvas.height = 480;
              canvas.getContext('2d').drawImage(video, 0, 0, 640, 480);
              stream.getTracks().forEach(function (t) {
                t.stop();
              });
              const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
              sendMoodToAI({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
            }, 800);
          });
        })
        .catch(function () {});
      return;
    }

    sendMoodToAI(frame);
  }

  function sendMoodToAI(frame) {
    fetch(API_BASE + '/api/chat', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        message:
          'Analyze the facial expression. Detect the emotion (happy, sad, surprised, angry, neutral, tired). Respond with an emoji + emotion, then a short piece of advice.',
        imageBase64: frame.base64,
        imageMimeType: frame.mimeType,
      }),
    })
      .then(function (r) {
        if (r.ok) return r.json();
        throw new Error('failed');
      })
      .then(function (data) {
        const reply = data.reply || data.text || '';
        const html =
          '<div style="padding:20px;text-align:center">' +
          '<div style="color:#a5b4fc;font-weight:700;font-size:1rem">Mood Detection</div>' +
          '<div style="color:#fff;font-size:1.1rem;margin:12px 0">' +
          esc(reply) +
          '</div>' +
          '<div style="color:#666;font-size:0.75rem">' +
          new Date().toLocaleString() +
          '</div></div>';
        if (typeof window.showOnMonitor === 'function') window.showOnMonitor(html, 'html');
      })
      .catch(function () {});
  }

  // ===============================================================
  // Chat command interceptor for Phase 2
  // ===============================================================
  function setupChatInterceptor() {
    const input = document.getElementById('text-input') || document.getElementById('msg-input');
    if (!input) return;

    input.addEventListener(
      'keydown',
      function (e) {
        if (e.key !== 'Enter') return;
        const val = (input.value || '').trim();
        if (!val) return;
        const lower = val.toLowerCase();

        // N2: Navigare
        const navMatch = lower.match(/^(cum ajung|navigheaza?|du-ma|mergi)\s+(la|spre|catre)\s+(.+)$/);
        if (navMatch) {
          e.preventDefault();
          e.stopPropagation();
          input.value = '';
          navigate(navMatch[3]);
          return false;
        }

        // N8: SOS (cu confirmare anti-accidental)
        if (/^(sos|urgenta|ajutor|emergency|help me)$/.test(lower)) {
          e.preventDefault();
          e.stopPropagation();
          input.value = '';
          sosEmergency();
          return false;
        }

        // C5: Receipt
        if (/^(scaneaza|scan|analizeaza)\s*(bonul|bon|receipt|chitanta)$/.test(lower)) {
          e.preventDefault();
          e.stopPropagation();
          input.value = '';
          scanReceipt();
          return false;
        }

        // F3: Mood
        if (/^(cum ma vezi|mood|ce expresie|cum arat|ce fata|detect mood)$/.test(lower)) {
          e.preventDefault();
          e.stopPropagation();
          input.value = '';
          detectMood();
          return false;
        }
      },
      true
    );
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupChatInterceptor);
  } else {
    setupChatInterceptor();
  }

  window.KMobile = {
    navigate: navigate,
    sos: sosEmergency,
    scanReceipt: scanReceipt,
    detectMood: detectMood,
  };
})();
