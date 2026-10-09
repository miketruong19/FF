// Service worker: keeps a copy of the app so it works with no network.
// Strategy: try the network first (so updates show right away), fall back to the saved copy when offline.
const CACHE = 'family-feud-v12';
// './' is the app on every host; Cloudflare redirects /index.html to /, so it isn't listed separately.
const FILES = ['./', './xlsx.mini.min.js', './manifest.webmanifest',
  './game-night.csv', './filipino-vietnamese-family.csv', './family-questions.csv', './two-families.csv'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  // The TV relay's room calls and socket are live data: never cached, never answered from the cache.
  const path = new URL(e.request.url).pathname;
  if (path.includes('/api/') || path.endsWith('/ws')) return;
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res && res.ok && !res.redirected) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })
      // Offline, any page of the app (a Home Screen launch, /index.html) opens the saved app.
      .then((hit) => hit || (e.request.mode === 'navigate' ? caches.match('./') : null))
      .then((hit) => hit || Response.error()))
  );
});
