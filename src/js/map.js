// The map: OpenFreeMap vector street map drawn with MapLibre GL.
// Map files (style, fonts, icons, tiles) are kept in the Cache API so the map works offline:
//  - MAP_AREA_CACHE: everything needed for each saved area, downloaded when the area is saved
//    (all zoom levels), never trimmed; removed when the area is deleted.
//  - MAP_CACHE: anything else you looked at while online, trimmed oldest-first.
// Works the same in the browser and inside the Android app.
import * as maplibregl from '../vendor/maplibre/maplibre-gl.mjs';
import { MAP_STYLE_URL, MAP_HOST, MAX_CACHED_MAP_FILES } from './config.js';

export const MAP_CACHE = 'nearby-map';
export const MAP_AREA_CACHE = 'nearby-map-areas';
const PROTOCOL = 'nearbycache';

// OpenFreeMap puts a weekly version in tile paths (/planet/20261110_001001_pt/14/1/2.pbf).
// Drop it from the cache key so tiles saved last week still work offline today.
export function cacheKey(url) {
  return new URL(url).href.replace(/\/planet\/[^/]+\/(\d+\/\d+\/\d+\.pbf)$/, '/planet/$1');
}

let trimTimer;
function scheduleTrim() {
  clearTimeout(trimTimer);
  trimTimer = setTimeout(async () => {
    try {
      const cache = await caches.open(MAP_CACHE);
      const keys = await cache.keys();
      for (let i = 0; i < keys.length - MAX_CACHED_MAP_FILES; i++) await cache.delete(keys[i]); // oldest first
    } catch { /* storage unavailable */ }
  }, 5000);
}

async function fetchAndStore(cache, url, key, signal) {
  const res = await fetch(url, { signal, credentials: 'omit' });
  if (!res.ok) throw new Error(`map file ${res.status}`);
  await cache.put(key, res.clone()).catch(() => {}); // full storage: still show the map
  scheduleTrim();
  return res;
}

// Style and TileJSON change when the map is updated, so prefer the network for those;
// tiles, fonts and icons never change at a given URL, so prefer the cache.
async function load(url, signal, { area = false } = {}) {
  const [areaCache, viewCache] = await Promise.all([caches.open(MAP_AREA_CACHE), caches.open(MAP_CACHE)]);
  const cache = area ? areaCache : viewCache;
  const key = cacheKey(url);
  const isTile = /\.(pbf|mvt|png|jpg|webp)$/.test(new URL(url).pathname);
  const isMeta = !isTile && !/\/fonts\/|\/sprites\//.test(url);
  if (isMeta && navigator.onLine) {
    try { return await fetchAndStore(cache, url, key, signal); } catch { /* fall back to cache */ }
  }
  const hit = (await areaCache.match(key)) || (await viewCache.match(key));
  if (hit) {
    if (area) await areaCache.put(key, hit.clone()).catch(() => {}); // now part of a saved area
    return hit;
  }
  return fetchAndStore(cache, url, key, signal);
}

// ---- Downloading the map for a whole saved area ----

const lon2x = (lon, z) => Math.floor(((lon + 180) / 360) * 2 ** z);
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/** Tile URLs covering a circle, zoom by zoom, stopping before `maxTiles` would be exceeded. */
export function tileUrls(template, lat, lon, radius, minZoom, maxZoom, maxTiles) {
  const dLat = radius / 111320;
  const dLon = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  const urls = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const x0 = lon2x(lon - dLon, z); const x1 = lon2x(lon + dLon, z);
    const y0 = lat2y(lat + dLat, z); const y1 = lat2y(lat - dLat, z);
    const count = (x1 - x0 + 1) * (y1 - y0 + 1);
    if (urls.length + count > maxTiles) break;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      urls.push(template.replace('{z}', z).replace('{x}', x).replace('{y}', y));
    }
  }
  return urls;
}

// Character ranges for labels: Latin, Latin Extended, punctuation and the main Indian scripts.
const GLYPH_RANGES = ['0-255', '256-511', '2304-2559', '2560-2815', '2816-3071', '3072-3327', '3328-3583', '8192-8447'];

function fontStacks(style) {
  const stacks = new Set();
  const walk = (v) => {
    if (!Array.isArray(v)) { if (v && typeof v === 'object') Object.values(v).forEach(walk); return; }
    if (v.length && v.every((x) => typeof x === 'string') && v.some((x) => /\b(Regular|Bold|Italic|Medium)\b/.test(x))) {
      stacks.add(v.join(','));
    } else v.forEach(walk);
  };
  (style.layers || []).forEach((l) => walk(l.layout?.['text-font']));
  return [...stacks];
}

/**
 * Download everything needed to show the map of a saved area offline at every zoom level.
 * @returns {Promise<string[]>} the cache keys stored (to remove them when the area is deleted)
 */
export async function downloadAreaMap(lat, lon, radius, { signal, onProgress, maxTiles = 800 } = {}) {
  const style = await (await load(MAP_STYLE_URL, signal, { area: true })).json();
  const urls = [MAP_STYLE_URL];
  for (const src of Object.values(style.sources || {})) {
    if (src.type !== 'vector' || !src.url) continue;
    urls.push(src.url);
    const tj = await (await load(src.url, signal, { area: true })).json();
    const maxZ = Math.min(tj.maxzoom ?? 14, 14);
    for (const t of tj.tiles || []) urls.push(...tileUrls(t, lat, lon, radius, tj.minzoom ?? 0, maxZ, maxTiles));
  }
  const sprites = typeof style.sprite === 'string' ? [style.sprite] : (style.sprite || []).map((s) => s.url);
  for (const s of sprites) urls.push(`${s}.json`, `${s}.png`, `${s}@2x.json`, `${s}@2x.png`);
  if (style.glyphs) {
    for (const stack of fontStacks(style)) {
      for (const range of GLYPH_RANGES) urls.push(style.glyphs.replace('{fontstack}', stack).replace('{range}', range));
    }
  }
  let done = 0;
  const keys = [];
  const queue = [...new Set(urls)];
  const total = queue.length;
  const worker = async () => {
    while (queue.length) {
      if (signal?.aborted) throw signal.reason || new Error('cancelled');
      const url = queue.shift();
      try { await load(url, signal, { area: true }); keys.push(cacheKey(url)); } catch { /* a missing glyph range etc. is fine */ }
      done++;
      onProgress?.(done / total);
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return keys;
}

/** Remove a deleted area's map files, except those another saved area still uses. */
export async function removeAreaMap(keys, keepKeys = new Set()) {
  try {
    const cache = await caches.open(MAP_AREA_CACHE);
    await Promise.all(keys.filter((k) => !keepKeys.has(k)).map((k) => cache.delete(k)));
  } catch { /* ignore */ }
}

let protocolAdded = false;
function addCachingProtocol() {
  if (protocolAdded) return;
  protocolAdded = true;
  maplibregl.addProtocol(PROTOCOL, async (params, abortController) => {
    const url = params.url.replace(`${PROTOCOL}://`, 'https://');
    // A missing tile (offline, outside saved areas) fails rather than coming back empty,
    // so the map keeps showing the less detailed tile it already has instead of white.
    const res = await load(url, abortController.signal);
    if (params.type === 'json') return { data: await res.json() };
    if (params.type === 'string') return { data: await res.text() };
    return { data: await res.arrayBuffer() };
  });
}

export function webglSupported() {
  try {
    const c = document.createElement('canvas');
    return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
  } catch { return false; }
}

/** Approximate circle polygon (metres) for the GPS accuracy ring. */
function circle(lon, lat, radius, steps = 48) {
  const coords = [];
  const dLat = radius / 111320;
  const dLon = radius / (111320 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * 2 * Math.PI;
    coords.push([lon + dLon * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  return { type: 'Feature', geometry: { type: 'Polygon', coordinates: [coords] }, properties: {} };
}

export class PlaceMap {
  constructor(container, { center, zoom }) {
    addCachingProtocol();
    this.markers = [];
    this.me = null;
    this.accuracy = null;
    this.map = new maplibregl.Map({
      container,
      style: MAP_STYLE_URL.replace('https://', `${PROTOCOL}://`),
      center: [center[1], center[0]],
      zoom,
      maxZoom: 19,
      attributionControl: { compact: true },
      dragRotate: false,
      pitchWithRotate: false,
      // Send every request for map files through the caching protocol.
      transformRequest: (url) => (url.startsWith(`https://${MAP_HOST}/`) ? { url: url.replace('https://', `${PROTOCOL}://`) } : undefined),
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    this.userMoved = false;
    // Remember when the person pans/zooms themselves, so GPS updates don't yank the map away.
    const mark = (e) => { if (e.originalEvent) this.userMoved = true; };
    this.map.on('dragstart', mark);
    this.map.on('zoomstart', mark);
    // Changing style removes our own layers, so (re-)add them every time a style loads.
    this.route = null;
    this.map.on('style.load', () => {
      if (!this.map.getSource('accuracy')) {
        this.map.addSource('accuracy', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        this.map.addLayer({ id: 'accuracy', type: 'fill', source: 'accuracy', paint: { 'fill-color': '#1a73e8', 'fill-opacity': 0.12 } });
      }
      if (!this.map.getSource('route')) {
        const empty = { type: 'FeatureCollection', features: [] };
        this.map.addSource('route', { type: 'geojson', data: empty });
        // Google-Maps-like route: dark blue casing under a bright blue line; dashed when it's only a straight line.
        this.map.addLayer({ id: 'route-casing', type: 'line', source: 'route', filter: ['!=', ['get', 'straight'], true],
          layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1558b0', 'line-width': 9 } });
        this.map.addLayer({ id: 'route-line', type: 'line', source: 'route', filter: ['!=', ['get', 'straight'], true],
          layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#4285f4', 'line-width': 6 } });
        this.map.addLayer({ id: 'route-straight', type: 'line', source: 'route', filter: ['==', ['get', 'straight'], true],
          layout: { 'line-cap': 'round' }, paint: { 'line-color': '#4285f4', 'line-width': 4, 'line-dasharray': [1, 2] } });
      }
      if (this.accuracy) this.setAccuracy(...this.accuracy);
      if (this.route) this.setRoute(this.route);
    });
  }

  on(event, fn) { this.map.on(event, fn); }
  resize() { this.map.resize(); }
  getCenter() { const c = this.map.getCenter(); return { lat: c.lat, lon: c.lng }; }
  getZoom() { return this.map.getZoom(); }
  setView([lat, lon], zoom) { this.map.jumpTo({ center: [lon, lat], zoom: zoom ?? this.map.getZoom() }); }
  contains(lat, lon) {
    const b = this.map.getBounds();
    const padLat = (b.getNorth() - b.getSouth()) * 0.2;
    const padLon = (b.getEast() - b.getWest()) * 0.2;
    return lat >= b.getSouth() - padLat && lat <= b.getNorth() + padLat && lon >= b.getWest() - padLon && lon <= b.getEast() + padLon;
  }

  /** items: [{ lat, lon, color, icon, title, popupHtml }] */
  setMarkers(items) {
    this.markers.forEach((m) => m.remove());
    this.markers = items.map((it) => {
      const el = document.createElement('button');
      el.className = 'pin-btn';
      el.setAttribute('aria-label', it.title);
      el.innerHTML = `<span class="pin" style="background:${it.color}"><span>${it.icon}</span></span>`;
      return new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([it.lon, it.lat])
        .setPopup(new maplibregl.Popup({ offset: 28, closeButton: true, maxWidth: '260px' }).setHTML(it.popupHtml))
        .addTo(this.map);
    });
  }

  setMe(lat, lon, accuracyMeters) {
    if (!this.me) {
      const el = document.createElement('div');
      el.className = 'me-dot';
      el.title = 'You are here';
      this.me = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(this.map);
    } else {
      this.me.setLngLat([lon, lat]);
    }
    this.setAccuracy(lat, lon, accuracyMeters);
  }

  /** Draw a route: { coords: [[lon, lat], ...], straight: boolean }, or null to clear. */
  setRoute(route) {
    this.route = route;
    const src = this.map.getSource('route'); // undefined until the style loads; style.load re-applies it
    if (!src) return;
    src.setData(route
      ? { type: 'Feature', properties: { straight: Boolean(route.straight) }, geometry: { type: 'LineString', coordinates: route.coords } }
      : { type: 'FeatureCollection', features: [] });
  }

  /** Zoom so all the given [lon, lat] points are visible. */
  fitPoints(coords, bottomPadding = 40) {
    if (!coords.length) return;
    let [w, s] = coords[0]; let [e, n] = coords[0];
    for (const [x, y] of coords) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
    this.map.fitBounds([[w, s], [e, n]], { padding: { top: 70, left: 40, right: 40, bottom: bottomPadding }, maxZoom: 17, duration: 0 });
  }

  setAccuracy(lat, lon, radius) {
    this.accuracy = [lat, lon, radius];
    const src = this.map.getSource('accuracy'); // undefined until the style loads; style.load re-applies it
    if (!src) return;
    src.setData(radius > 0 ? circle(lon, lat, radius) : { type: 'FeatureCollection', features: [] });
  }
}

export async function cachedMapFileCount() {
  try {
    const [a, b] = await Promise.all([caches.open(MAP_AREA_CACHE), caches.open(MAP_CACHE)]);
    return (await a.keys()).length + (await b.keys()).length;
  } catch { return 0; }
}

/** Clear map data you only browsed; saved areas keep their maps. */
export async function clearMapCache() {
  try { await caches.delete(MAP_CACHE); } catch { /* ignore */ }
}
