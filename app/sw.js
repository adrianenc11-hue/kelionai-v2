// ═══════════════════════════════════════════════════════════════
// KelionAI Service Worker — PWA + Offline Support
// ═══════════════════════════════════════════════════════════════

const CACHE_NAME = 'kelionai-v3';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/images/Icon.jpg',
  '/images/Productivity.jpg',
  '/css/main.css',
  '/js/app.js',
];

// ── Install: cache static assets ────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('[SW] Some assets failed to cache:', err);
      });
    })
  );
  self.skipWaiting();
});

// ── Activate: clean old caches ──────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first for API, cache-first for assets ────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // API calls → network only (never cache)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request).catch(() =>
        new Response(
          JSON.stringify({ error: 'Offline — no network connection' }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );
    return;
  }

  // Static assets → cache-first, fallback to network
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const cloned = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, cloned));
        return response;
      });
    }).catch(() => {
      // Offline fallback for navigation
      if (request.mode === 'navigate') {
        return caches.match('/index.html');
      }
    })
  );
});

// ── Push Notifications ──────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = { title: 'KelionAI', body: 'You have a new message.' };
  try {
    data = event.data ? event.data.json() : data;
  } catch (e) {
    data.body = event.data ? event.data.text() : data.body;
  }

  event.waitUntil(
    self.registration.showNotification(data.title || 'KelionAI', {
      body: data.body || '',
      icon: '/images/Icon.jpg',
      badge: '/images/Icon.jpg',
      vibrate: [200, 100, 200],
      data: { url: data.url || '/' },
    })
  );
});

// ── Notification Click ──────────────────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// ── Background Sync ─────────────────────────────────────────────
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-messages') {
    event.waitUntil(syncPendingMessages());
  }
});

async function syncPendingMessages() {
  try {
    const db = await openDB();
    const pending = await db.getAll('pending-messages');
    for (const msg of pending) {
      await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(msg),
      });
      await db.delete('pending-messages', msg.id);
    }
  } catch (e) {
    console.warn('[SW] Background sync failed:', e);
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('kelionai-offline', 1);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore('pending-messages', { keyPath: 'id' });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = reject;
  });
}