/* ============================================================
   AKM-POS Service Worker — app-shell caching for PWA / offline
   Bump CACHE_VERSION on every deploy to invalidate old caches.
   ============================================================ */

const CACHE_VERSION = 'akm-pos-v4.1.0';
const CACHE_NAME    = `${CACHE_VERSION}-static`;

// Core app shell — precached on install so the app launches offline.
const APP_SHELL = [
  '/',
  '/index.html',
  '/dashboard.html',
  '/styles.css?v=4.0',
  '/manifest.webmanifest',
  '/icon-192.png',
  '/icon-512.png',
  '/apple-touch-icon.png',
  '/Favicon.png',
];

// Hosts whose responses must ALWAYS hit the network (auth-sensitive / dynamic).
// The service worker never touches these — Firestore has its own offline cache.
const NETWORK_ONLY_HOSTS = [
  'firestore.googleapis.com',
  'firebase.googleapis.com',
  'firebaseinstallations.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'www.googleapis.com',
  'apis.google.com',
  'accounts.google.com',
];

// Cross-origin hosts we ARE allowed to cache (static CDN assets / fonts).
const CACHEABLE_CROSS_ORIGIN = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'cdn.jsdelivr.net',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
      .catch((err) => console.warn('[sw] precache failed:', err))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Allow the page to trigger an immediate activation after an update.
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // Only handle GET; everything else (POST writes, etc.) goes straight to network.
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // Never intercept auth/database traffic.
  if (NETWORK_ONLY_HOSTS.includes(url.hostname)) return;

  const sameOrigin = url.origin === self.location.origin;
  const cacheableCDN = CACHEABLE_CROSS_ORIGIN.includes(url.hostname);

  if (!sameOrigin && !cacheableCDN) return; // leave other cross-origin alone

  // Navigation requests: network-first, fall back to cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('/index.html')))
    );
    return;
  }

  // Static assets: stale-while-revalidate.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
