// Offline-Cache: App-Dateien und Datenbank kommen aus dem Cache, Updates werden im Hintergrund geholt.
const CACHE = 'kt-v3';
const SHELL = ['./', 'index.html', 'app.css', 'app.js', 'vorlagen.js', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'data/bls.json'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  const sameOrigin = url.origin === location.origin;
  const cdn = url.hostname === 'cdn.jsdelivr.net';
  if (!sameOrigin && !cdn) return; // Open Food Facts und Claude immer live
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(e.request, { ignoreSearch: sameOrigin });
      const network = fetch(e.request).then((res) => {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      }).catch(() => cached);
      // CDN-Dateien sind versioniert und ändern sich nie: Cache zuerst.
      if (cdn) return cached || network;
      return cached ? (e.waitUntil(network), cached) : network;
    })
  );
});
