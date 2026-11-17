// Road routes between two points, from an OSRM-compatible routing server (needs internet).
// Offline, the app falls back to a straight line (see straightLine()).
import { ROUTING_URL, ROUTING_TIMEOUT_MS } from './config.js';
import { distance } from './geo.js';

const PROFILES = { walk: 'routed-foot', drive: 'routed-car' };

/**
 * @param {{lat:number, lon:number}} from
 * @param {{lat:number, lon:number}} to
 * @param {'walk'|'drive'} mode
 * @returns {Promise<{coords:number[][], distance:number, duration:number, straight:false}>}
 */
export async function fetchRoute(from, to, mode = 'walk', { signal, baseUrl = ROUTING_URL, timeoutMs = ROUTING_TIMEOUT_MS } = {}) {
  const pts = `${from.lon.toFixed(6)},${from.lat.toFixed(6)};${to.lon.toFixed(6)},${to.lat.toFixed(6)}`;
  const url = `${baseUrl}/${PROFILES[mode] || PROFILES.walk}/route/v1/driving/${pts}?overview=full&geometries=geojson&alternatives=false&steps=false`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, { signal: ctrl.signal, credentials: 'omit' });
    if (!res.ok) throw new Error(`routing server answered ${res.status}`);
    const json = await res.json();
    const route = json.routes?.[0];
    if (json.code !== 'Ok' || !route?.geometry?.coordinates?.length) throw new Error(json.message || 'no route found');
    return { coords: route.geometry.coordinates, distance: route.distance, duration: route.duration, straight: false };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Offline fallback: a straight line with an estimated walking/driving time. */
// Typical speeds in m/s: walking, and city driving in India.
export const SPEED = { walk: 4.8 / 3.6, drive: 22 / 3.6 };

export function straightLine(from, to, mode = 'walk') {
  const d = distance(from.lat, from.lon, to.lat, to.lon);
  return { coords: [[from.lon, from.lat], [to.lon, to.lat]], distance: d, duration: d / SPEED[mode], straight: true };
}

export function formatDuration(s) {
  const min = Math.max(1, Math.round(s / 60));
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${min % 60} min`;
}
