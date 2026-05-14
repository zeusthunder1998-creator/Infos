// Service Worker for Infos
// Strategy:
// - App shell (HTML, CSS, JS): network-first with cache fallback — ensures fresh code when online,
//   but lets the app open when offline.
// - Static assets (icons, logo, QR): cache-first — these rarely change.
// - Supabase API calls and realtime: NEVER cached — always hit the network for fresh data.

// IMPORTANT: bump this version on EVERY release so old caches get cleaned up
// and users get the new code. Without this, the SW serves the old JS chunks
// from cache and users miss the update.
const VERSION = 'v25.9';
const STATIC_CACHE = `infos-static-${VERSION}`;
const RUNTIME_CACHE = `infos-runtime-${VERSION}`;

// Assets that ship with the app and rarely change
const PRECACHE_ASSETS = [
  '/',
  '/manifest.json',
  '/logo.png',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-icon.png',
  '/favicon.ico',
  '/favicon-16.png',
  '/favicon-32.png',
  '/donate-qr.png',
];

// ---------- Install: precache the shell ----------
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_ASSETS).catch(() => {
        // If any asset fails (e.g. user-data/uploads can 404), don't block install
      }))
      .then(() => self.skipWaiting())
  );
});

// ---------- Activate: clean up old caches ----------
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(
        names
          .filter((name) => name.startsWith('infos-') && name !== STATIC_CACHE && name !== RUNTIME_CACHE)
          .map((name) => caches.delete(name))
      )
    ).then(() => self.clients.claim())
  );
});

// ---------- Fetch: route requests ----------
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Never touch non-GET
  if (request.method !== 'GET') return;

  // Never cache Supabase API or realtime traffic — always fresh
  if (url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in')) {
    return; // let browser handle normally
  }

  // Never cache cross-origin (except same-origin and our known fonts CDN)
  if (url.origin !== self.location.origin && url.hostname !== 'fonts.googleapis.com' && url.hostname !== 'fonts.gstatic.com') {
    return;
  }

  // Navigation requests (HTML): network-first, fallback to cached root
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Cache a copy of the fresh HTML
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          return response;
        })
        .catch(() =>
          caches.match(request).then((cached) => cached || caches.match('/'))
        )
    );
    return;
  }

  // Same-origin static assets (logo, icons, JS chunks, CSS): stale-while-revalidate.
  // Serve from cache instantly if available; fetch in background to update the cache.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        // Always kick off a fresh fetch in the background to keep cache up to date
        const fetchAndUpdate = fetch(request)
          .then((response) => {
            // Only cache 2xx success responses
            if (response && response.status === 200 && response.type === 'basic') {
              const copy = response.clone();
              caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
            }
            return response;
          })
          .catch(() => cached); // offline fallback

        // If cached, serve it immediately; background fetch will update for next load
        return cached || fetchAndUpdate;
      })
    );
    return;
  }

  // Google Fonts: cache-first (they almost never change)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(RUNTIME_CACHE).then((cache) => cache.put(request, copy)).catch(() => {});
          }
          return response;
        });
      })
    );
  }
});

// ---------- Messages from the page (e.g. "skip waiting") ----------
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ---------- v24.0: Web Push handlers ----------
// Triggered when the push service delivers a payload to this device.
// Payload format (JSON):
//   { title: string, body: string, url?: string, tag?: string }
// We show a notification with click-to-open behavior.
self.addEventListener('push', (event) => {
  let data = { title: 'Infos', body: 'You have a new notification.', url: '/' };
  try {
    if (event.data) {
      const parsed = event.data.json();
      data = { ...data, ...parsed };
    }
  } catch (e) {
    // Fall back to plain text body
    try { data.body = event.data.text(); } catch {}
  }

  const options = {
    body: data.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'infos-notification',
    // Don't auto-stack — replace previous notification with same tag
    renotify: !!data.tag,
    data: { url: data.url || '/' },
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Click on notification → focus existing tab or open new one
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Try to focus an existing tab on the same origin
      for (const client of clientList) {
        try {
          const clientUrl = new URL(client.url);
          if (clientUrl.origin === self.location.origin) {
            client.focus();
            // Try to navigate to the target URL within the existing tab
            if ('navigate' in client) {
              try { client.navigate(targetUrl); } catch {}
            }
            return;
          }
        } catch {}
      }
      // No existing tab — open a new one
      return self.clients.openWindow(targetUrl);
    })
  );
});
