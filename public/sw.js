// Stage 5 — M23/M25: Kelion service worker.
// Handles: push delivery (shows a notification) and notification click (opens
// the app URL, focusing an existing tab if possible).

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = {};
  try { payload = event.data ? event.data.json() : {}; }
  catch { payload = { title: 'Kelion', body: (event.data && event.data.text()) || 'Kelion is thinking about you.' }; }

  const title = payload.title || 'Kelion';
  const options = {
    body: payload.body || '',
    icon: '/icons.svg',
    badge: '/icons.svg',
    tag: 'kelion-proactive',
    renotify: true,
    data: { url: payload.url || '/' },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of all) {
      try {
        const url = new URL(client.url);
        if (url.origin === self.location.origin) {
          client.focus();
          if ('navigate' in client) { try { await client.navigate(targetUrl); } catch { /* ignore */ } }
          return;
        }
      } catch { /* ignore */ }
    }
    await self.clients.openWindow(targetUrl);
  })());
});
