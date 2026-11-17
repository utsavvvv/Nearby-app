// Downloads places from OpenStreetMap through the public Overpass API.
// Only needed once per area while online; afterwards everything is read from IndexedDB.

import { buildOverpassQuery, classify } from './categories.js';
import { OVERPASS_ENDPOINTS, OVERPASS_TIMEOUT_MS } from './config.js';
import { ROAD_TYPES } from './graph.js';

export class DownloadError extends Error {}

async function fetchWithTimeout(url, options, ms, signal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new DownloadError('The server took too long to answer')), ms);
  const onAbort = () => ctrl.abort(signal.reason);
  signal?.addEventListener('abort', onAbort);
  try {
    return await fetch(url, { ...options, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * Fetch all supported places within radiusMeters of (lat, lon).
 * Tries each Overpass server in turn. Pass an AbortSignal to cancel.
 */
export async function fetchPlaces(lat, lon, radiusMeters, regionId, { signal, endpoints = OVERPASS_ENDPOINTS, timeoutMs = OVERPASS_TIMEOUT_MS } = {}) {
  const json = await overpass(buildOverpassQuery(lat, lon, radiusMeters), { signal, endpoints, timeoutMs });
  return toPlaces(json.elements || [], regionId);
}

/** Roads around a point (ways + their nodes), for offline routing. */
export async function fetchRoads(lat, lon, radiusMeters, { signal, endpoints = OVERPASS_ENDPOINTS, timeoutMs = OVERPASS_TIMEOUT_MS } = {}) {
  const around = `(around:${Math.round(radiusMeters)},${lat.toFixed(6)},${lon.toFixed(6)})`;
  const query = `[out:json][timeout:120];
way["highway"~"^(${ROAD_TYPES.join('|')})$"]["service"!~"^(parking_aisle|driveway|drive-through)$"]["area"!="yes"]${around}->.w;
.w out body qt;
node(w.w);
out skel qt;`;
  const json = await overpass(query, { signal, endpoints, timeoutMs });
  return json.elements || [];
}

async function overpass(query, { signal, endpoints, timeoutMs }) {
  let lastError;
  for (const url of endpoints) {
    if (signal?.aborted) throw signal.reason ?? new DownloadError('Cancelled');
    try {
      const res = await fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      }, timeoutMs, signal);
      if (res.status === 429) throw new DownloadError('The map data server is busy (too many requests)');
      if (!res.ok) throw new DownloadError(`The map data server answered with error ${res.status}`);
      const json = await res.json();
      // Overpass reports timeouts / memory errors inside a 200 response.
      if (json.remark && /error|timed out/i.test(json.remark) && !(json.elements || []).length) {
        throw new DownloadError('The map data server could not finish — try a smaller radius');
      }
      return json;
    } catch (err) {
      if (signal?.aborted) throw err;
      lastError = err;
    }
  }
  if (lastError instanceof DownloadError) throw lastError;
  throw new DownloadError('Could not reach the map data servers. Check your internet connection.');
}

const clip = (s, n = 200) => (typeof s === 'string' ? s.slice(0, n) : '');

/**
 * Many places in OpenStreetMap have no name but do say who runs them, e.g. an ATM with
 * operator=State Bank of India or a chemist with brand=Apollo Pharmacy. Use that as the name.
 */
export function brandName(tags, cat) {
  const who = tags['brand:en'] || tags.brand || tags['operator:en'] || tags.operator || tags['network:en'] || tags.network || '';
  if (!who) return '';
  if (tags.amenity === 'atm' && !/\batm\b/i.test(who)) return `${who} ATM`;
  if (tags.amenity === 'bank' && !/bank/i.test(who)) return `${who} Bank`;
  if (cat === 'fuel' && !/petrol|pump|fuel/i.test(who)) return `${who} petrol pump`;
  return who;
}

export function toPlaces(elements, regionId) {
  const places = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const tags = el.tags || {};
    const cat = classify(tags);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !cat) continue;
    const enName = tags['name:en'];
    places.push({
      id: `osm:${el.type}/${el.id}`,
      source: 'osm',
      regionId,
      lat,
      lon,
      cat,
      name: clip(enName || tags.name || brandName(tags, cat), 120),
      localName: enName && tags.name && tags.name !== enName ? clip(tags.name, 120) : '',
      hours: clip(tags.opening_hours),
      phone: clip(tags.phone || tags['contact:phone'], 60),
      address: clip([tags['addr:housenumber'], tags['addr:street'], tags['addr:suburb'] || tags['addr:city']]
        .filter(Boolean).join(', ')),
      kind: clip((tags.shop || tags.amenity || tags.tourism || tags.railway || '').replace(/_/g, ' '), 40),
    });
  }
  return places;
}
