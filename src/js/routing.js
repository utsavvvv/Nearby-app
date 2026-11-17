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

/**
 * A simple first instruction for a route line: which way to head, and the first real turn.
 * @param {number[][]} coords [[lon, lat], ...]
 * @returns {{ head: string, turn: 'left'|'right'|null, in: number, total: number }}
 */
export function firstInstruction(coords) {
  const segs = [];
  for (let i = 1; i < coords.length; i++) {
    const [lo1, la1] = coords[i - 1]; const [lo2, la2] = coords[i];
    const len = distance(la1, lo1, la2, lo2);
    if (len < 3) continue; // ignore tiny jitters
    segs.push({ len, b: bearingDeg(la1, lo1, la2, lo2) });
  }
  const total = segs.reduce((s, x) => s + x.len, 0);
  if (!segs.length) return { head: 'N', turn: null, in: 0, total };
  let walked = 0;
  for (let i = 1; i < segs.length; i++) {
    walked += segs[i - 1].len;
    const diff = ((segs[i].b - segs[i - 1].b + 540) % 360) - 180;
    if (Math.abs(diff) > 35 && walked >= 10) return { head: point(segs[0].b), turn: diff > 0 ? 'right' : 'left', in: walked, total };
  }
  return { head: point(segs[0].b), turn: null, in: total, total };
}

function bearingDeg(la1, lo1, la2, lo2) {
  const r = Math.PI / 180;
  const y = Math.sin((lo2 - lo1) * r) * Math.cos(la2 * r);
  const x = Math.cos(la1 * r) * Math.sin(la2 * r) - Math.sin(la1 * r) * Math.cos(la2 * r) * Math.cos((lo2 - lo1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
const point = (b) => POINTS[Math.round(b / 45) % 8];
