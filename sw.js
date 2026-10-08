// Service worker: keeps a copy of the app so it works with no network.
// Strategy: try the network first (so updates show right away), fall back to the saved copy when offline.
const CACHE = 'family-feud-v7';
const FILES = ['./', './index.html', './xlsx.mini.min.js', './manifest.webmanifest',
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
      if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || Response.error()))
  );
});
