/* global L */
// A Leaflet tile layer that keeps every tile you look at in the Cache API, so the map
// still shows those streets offline. Done in the page (not the service worker) so it
// works the same in the browser and inside the Android app.
import { MAX_CACHED_TILES } from './config.js';

const CACHE = 'nearby-tiles';
let trimTimer;

function scheduleTrim() {
  clearTimeout(trimTimer);
  trimTimer = setTimeout(async () => {
    try {
      const cache = await caches.open(CACHE);
      const keys = await cache.keys();
      const extra = keys.length - MAX_CACHED_TILES;
      for (let i = 0; i < extra; i++) await cache.delete(keys[i]); // oldest first
    } catch { /* storage unavailable */ }
  }, 5000);
}

async function loadTile(url) {
  if (!('caches' in window)) return null;
  const cache = await caches.open(CACHE);
  const hit = await cache.match(url);
  if (hit) return hit.blob();
  if (!navigator.onLine) throw new Error('offline');
  const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
  if (!res.ok) throw new Error(`tile ${res.status}`);
  await cache.put(url, res.clone());
  scheduleTrim();
  return res.blob();
}

export function cachedTileLayer(url, options) {
  const Layer = L.TileLayer.extend({
    createTile(coords, done) {
      const img = document.createElement('img');
      img.alt = '';
      img.setAttribute('role', 'presentation');
      const src = this.getTileUrl(coords);
      img.onload = () => done(null, img);
      img.onerror = () => done(new Error('tile failed'), img);
      loadTile(src)
        .then((blob) => {
          if (blob) img.src = URL.createObjectURL(blob);
          else img.src = src; // no Cache API: plain loading
        })
        .catch((err) => {
          if (navigator.onLine && err.message !== 'offline') img.src = src; // e.g. CORS issue: show without caching
          else done(err, img);
        });
      return img;
    },
  });
  const layer = new Layer(url, options);
  layer.on('tileunload', (e) => {
    if (e.tile.src.startsWith('blob:')) URL.revokeObjectURL(e.tile.src);
  });
  return layer;
}

export async function cachedTileCount() {
  try { return (await (await caches.open(CACHE)).keys()).length; } catch { return 0; }
}

export async function clearTiles() {
  try { await caches.delete(CACHE); } catch { /* ignore */ }
}
