// ═══════════════════════════════════════════════════════════════
// KelionAI — Service Worker (PWA Offline Support)
// ═══════════════════════════════════════════════════════════════

const CACHE_NAME = 'kelionai-v2.5';
const OFFLINE_URLS = [
  '/',
  '/css/app.css',
  '/css/theme.css',
  '/js/app.js',
  '/js/avatar.js',
  '/js/voice.js',
  '/js/fft-lipsync.js',
  '/js/alignment-lipsync.js',
  '/manifest.json',
];

// Install — cache core assets (fault-tolerant)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        OFFLINE_URLS.map((url) =>
          cache.add(url).catch((err) => {
            console.warn('[SW] Failed to cache:', url, err.message);
          })
        )
      );
    })
  );
  self.skipWaiting();
});

// Activate — clean old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

// Fetch — network-first with cache fallback
self.addEventListener('fetch', (event) => {
  // Skip non-GET and API requests
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('/api/')) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Cache successful responses
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, clone);
          });
        }
        return response;
      })
      .catch(() => {
        // Fallback to cache when offline
        return caches.match(event.request).then((cached) => {
          return cached || caches.match('/');
        });
      })
  );
});
