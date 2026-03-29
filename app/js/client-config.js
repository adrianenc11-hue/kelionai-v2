// ═══════════════════════════════════════════════════════════════
// App — Client-Side URL Config
// All external URLs loaded from server — zero hardcoding
// Auto-injects fonts and CDN scripts when loaded
// ═══════════════════════════════════════════════════════════════
(function () {
  'use strict';

  // ── Load URLs from server endpoint ──
  const U = (window.KELION_URLS = {});

  function _link(rel, href, extra) {
    if (!href) return;
    const l = document.createElement('link');
    l.rel = rel;
    l.href = href;
    if (extra) {
      for (const k in extra) l[k] = extra[k];
    }
    document.head.appendChild(l);
  }
  function _script(src, attrs) {
    if (!src) return null;
    const s = document.createElement('script');
    s.src = src;
    if (attrs) {
      for (const k in attrs) s[k] = attrs[k];
    }
    document.head.appendChild(s);
    return s;
  }

  // Read data attributes from our own script tag
  const me = document.currentScript;
  const fontSet = me ? me.getAttribute('data-fonts') : 'inter-light';
  const cdnList = me ? me.getAttribute('data-cdn') || '' : '';

  // Fetch URLs from server, then inject resources
  fetch('/api/config/urls')
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      // Merge server URLs into KELION_URLS
      for (const key in data) U[key] = data[key];

      // Fonts preconnect
      _link('preconnect', U.GOOGLE_FONTS_CSS);
      _link('preconnect', U.GOOGLE_FONTS_STATIC, { crossOrigin: '' });

      // Font stylesheet
      const fontMap = {
        'inter-full': U.GOOGLE_FONTS_INTER,
        'inter-light': U.GOOGLE_FONTS_INTER_LIGHT,
        'inter-basic': U.GOOGLE_FONTS_INTER_BASIC,
        'inter-jetbrains': U.GOOGLE_FONTS_INTER_JETBRAINS,
      };
      _link('stylesheet', fontMap[fontSet] || fontMap['inter-light']);

      // CDN scripts (if requested via data-cdn)
      if (cdnList) {
        const cdns = cdnList.split(',');
        const cdnMap = {
          tensorflow: U.CDN_TENSORFLOW,
          cocossd: U.CDN_COCOSSD,
          sentry: U.CDN_SENTRY_JS,
          logrocket: U.CDN_LOGROCKET,
          'leaflet-css': U.CDN_LEAFLET_CSS,
          'leaflet-js': U.CDN_LEAFLET_JS,
        };
        for (let i = 0; i < cdns.length; i++) {
          const name = cdns[i].trim();
          const url = cdnMap[name];
          if (!url) continue;
          if (name.indexOf('-css') > -1) {
            _link('stylesheet', url);
          } else {
            const s = _script(url, name === 'sentry' ? { crossOrigin: 'anonymous' } : {});
            if (name === 'sentry' && s) {
              s.onload = function () {
                const dsn = (document.querySelector('meta[name="sentry-dsn"]') || {}).content;
                if (window.Sentry && dsn)
                  Sentry.init({
                    dsn: dsn,
                    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
                    tracesSampleRate: 1.0,
                    replaysOnErrorSampleRate: 1.0,
                  });
              };
            }
          }
        }
      }

      // Build APP_CONFIG for easy access by other scripts (copy-shield, etc.)
      window.APP_CONFIG = {
        appName:     U.APP_NAME     || 'KelionAI',
        appVersion:  U.APP_VERSION  || '',
        appUrl:      U.APP_URL      || '',
        studioName:  U.STUDIO_NAME  || 'EA Studio',
        founderName: U.FOUNDER_NAME || 'Adrian',
      };

      // Dispatch event so other scripts know URLs are ready
      window.dispatchEvent(new CustomEvent('kelion-urls-ready', { detail: U }));
      // Dispatch app-config-loaded so meta tags and page title update dynamically
      window.dispatchEvent(new CustomEvent('app-config-loaded', { detail: window.APP_CONFIG }));
    })
    .catch(function (err) {
      console.warn('[client-config] Failed to load URLs from server:', err.message);
    });
})();
