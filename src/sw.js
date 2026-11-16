// Service worker: makes the app itself load with no internet.
// The build script fills in VERSION (a content hash) and the list of files.
// Map tiles are cached by the page itself (see js/tiles.js) so that also works in the Android app.

const VERSION = '__VERSION__';
const FILES = [/* __FILES__ */];
const CACHE = `nearby-shell-${VERSION}`;

self.addEventListener('install', (event) => {
  // Fetch fresh copies (bypass the HTTP cache) so the precache matches this version exactly.
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('nearby-shell-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The page asks the waiting worker to take over when the user taps "Update".
self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // map data, tiles, etc. go straight to the network

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      return await fetch(req);
    } catch (err) {
      if (req.mode === 'navigate') {
        const shell = await cache.match('index.html');
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
