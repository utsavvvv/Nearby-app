// Service worker: keeps the app itself and viewed map tiles available offline.
const VERSION = 'v1';
const SHELL = `nearby-shell-${VERSION}`;
const TILES = 'nearby-tiles';
const MAX_TILES = 3000;

const SHELL_FILES = [
  './',
  'index.html',
  'css/style.css',
  'js/app.js',
  'js/categories.js',
  'js/db.js',
  'js/geo.js',
  'js/overpass.js',
  'vendor/leaflet/leaflet.js',
  'vendor/leaflet/leaflet.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('nearby-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

async function trimTiles() {
  const cache = await caches.open(TILES);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Map tiles: serve from cache first, otherwise fetch and remember for offline use.
  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(caches.open(TILES).then(async (cache) => {
      const hit = await cache.match(req);
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok || res.type === 'opaque') {
          await cache.put(req, res.clone());
          trimTiles();
        }
        return res;
      } catch {
        return new Response('', { status: 504 });
      }
    }));
    return;
  }

  // App files: network first (to get updates), fall back to cache when offline.
  if (url.origin === self.location.origin) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) caches.open(SHELL).then((c) => c.put(req, res.clone()));
          return res;
        })
        .catch(async () => (await caches.match(req, { ignoreSearch: true }))
          || (req.mode === 'navigate' ? caches.match('index.html') : Response.error())),
    );
  }
});
