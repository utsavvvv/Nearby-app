// The map: OpenFreeMap vector street map drawn with MapLibre GL.
// Every map file the app loads (style, fonts, icons, map tiles) is kept in the Cache API,
// so areas you have looked at while online still show offline. Works the same in the
// browser and inside the Android app.
import * as maplibregl from '../vendor/maplibre/maplibre-gl.mjs';
import { MAP_STYLE_URL, MAP_STYLE_DARK_URL, MAP_HOST, MAX_CACHED_MAP_FILES } from './config.js';

export const MAP_CACHE = 'nearby-map';
const PROTOCOL = 'nearbycache';

// OpenFreeMap puts a weekly version in tile paths (/planet/20261110_001001_pt/14/1/2.pbf).
// Drop it from the cache key so tiles saved last week still work offline today.
export function cacheKey(url) {
  return url.replace(/\/planet\/[^/]+\/(\d+\/\d+\/\d+\.pbf)$/, '/planet/$1');
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
async function load(url, signal) {
  const cache = await caches.open(MAP_CACHE);
  const key = cacheKey(url);
  const isTile = /\.(pbf|mvt|png|jpg|webp)$/.test(new URL(url).pathname);
  const isMeta = !isTile && !/\/fonts\/|\/sprites\//.test(url);
  if (isMeta && navigator.onLine) {
    try { return await fetchAndStore(cache, url, key, signal); } catch { /* fall back to cache */ }
  }
  const hit = await cache.match(key);
  if (hit) return hit;
  return fetchAndStore(cache, url, key, signal);
}

let protocolAdded = false;
function addCachingProtocol() {
  if (protocolAdded) return;
  protocolAdded = true;
  maplibregl.addProtocol(PROTOCOL, async (params, abortController) => {
    const url = params.url.replace(`${PROTOCOL}://`, 'https://');
    try {
      const res = await load(url, abortController.signal);
      if (params.type === 'json') return { data: await res.json() };
      if (params.type === 'string') return { data: await res.text() };
      return { data: await res.arrayBuffer() };
    } catch (err) {
      // A missing tile offline should leave a blank square, not break the map.
      if (/\.(pbf|mvt)$/.test(new URL(url).pathname)) return { data: new ArrayBuffer(0) };
      throw err;
    }
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
  constructor(container, { center, zoom, dark = false }) {
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
    this.dark = false;
    // Changing style removes our own layers, so (re-)add them every time a style loads.
    this.map.on('style.load', () => {
      if (!this.map.getSource('accuracy')) {
        this.map.addSource('accuracy', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
        this.map.addLayer({ id: 'accuracy', type: 'fill', source: 'accuracy', paint: { 'fill-color': '#1a73e8', 'fill-opacity': 0.12 } });
      }
      if (this.accuracy) this.setAccuracy(...this.accuracy);
    });
    if (dark) this.setDark(true);
  }

  /** Switch between the light and dark street map. */
  async setDark(dark) {
    if (dark === this.dark) return;
    this.dark = dark;
    let url = MAP_STYLE_URL;
    // Fall back to the light map if the dark one can't load (e.g. offline and never saved).
    if (dark) {
      try { await load(MAP_STYLE_DARK_URL); url = MAP_STYLE_DARK_URL; } catch { /* keep the light map */ }
    }
    if (this.dark !== dark) return; // changed again meanwhile
    this.map.setStyle(url.replace('https://', `${PROTOCOL}://`));
  }

  on(event, fn) { this.map.on(event, fn); }
  resize() { this.map.resize(); }
  getCenter() { const c = this.map.getCenter(); return { lat: c.lat, lon: c.lng }; }
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

  setAccuracy(lat, lon, radius) {
    this.accuracy = [lat, lon, radius];
    const src = this.map.isStyleLoaded?.() !== false ? this.map.getSource?.('accuracy') : null;
    if (!src) return;
    src.setData(radius > 0 ? circle(lon, lat, radius) : { type: 'FeatureCollection', features: [] });
  }
}

export async function cachedMapFileCount() {
  try { return (await (await caches.open(MAP_CACHE)).keys()).length; } catch { return 0; }
}

export async function clearMapCache() {
  try { await caches.delete(MAP_CACHE); } catch { /* ignore */ }
}
