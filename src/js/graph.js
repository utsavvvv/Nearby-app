// Offline road routing.
// A saved area's roads (from OpenStreetMap) are turned into a compact graph stored on the phone;
// shortest paths are then found on the phone with A* search — no internet needed.

const R = 6371000;
const DEG = Math.PI / 180;

const NOT_WALKABLE = new Set(['motorway', 'motorway_link']);
const NOT_DRIVABLE = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'bridleway', 'corridor']);
export const ROAD_TYPES = [
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
  'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'road', 'track',
  'pedestrian', 'footway', 'path', 'steps', 'cycleway',
];

// Typical driving speeds (km/h) by road type in Indian towns and cities. Used to prefer main
// roads like an online router does, and for time estimates. Links (ramps) are a bit slower.
export const DRIVE_SPEED = {
  motorway: 70, trunk: 55, primary: 40, secondary: 32, tertiary: 26, unclassified: 20,
  residential: 16, living_street: 10, service: 10, road: 15, track: 10,
};
const WALK_SPEED = 4.8; // km/h
export const GRAPH_VERSION = 2;

function driveSpeed(t) {
  const base = DRIVE_SPEED[t.highway.replace(/_link$/, '')] ?? 15;
  let v = t.highway.endsWith('_link') ? base * 0.8 : base;
  const limit = parseInt(t.maxspeed, 10);
  if (limit > 0) v = Math.min(v, limit);
  return Math.max(5, Math.round(v));
}

const WALK = 1;
const DRIVE = 2;
const NO = new Set(['no', 'private']);

function walkable(t) {
  if (NOT_WALKABLE.has(t.highway)) return false;
  if (t.foot === 'no') return false;
  if (NO.has(t.access) && t.foot !== 'yes' && t.foot !== 'designated') return false;
  return true;
}

function drivable(t) {
  if (NOT_DRIVABLE.has(t.highway)) return false;
  if (NO.has(t.access) || NO.has(t.motor_vehicle) || NO.has(t.motorcar)) return false;
  return true;
}

/** 1 = one-way along the way, -1 = against it, 0 = both directions (for cars). */
function oneway(t) {
  const o = t.oneway;
  if (o === 'yes' || o === '1' || o === 'true') return 1;
  if (o === '-1' || o === 'reverse') return -1;
  if (o === 'no') return 0;
  if (t.junction === 'roundabout' || t.highway === 'motorway') return 1;
  return 0;
}

/**
 * Build a graph from an Overpass response (ways with node ids + nodes with coordinates).
 * Returns plain typed arrays so it can be stored in IndexedDB as-is.
 */
export function buildGraph(elements) {
  const coords = new Map();
  for (const el of elements) if (el.type === 'node') coords.set(el.id, el);

  const index = new Map(); // OSM node id -> graph index
  const lat = []; const lon = [];
  const from = []; const to = []; const flags = []; const speeds = [];
  const idx = (id) => {
    let i = index.get(id);
    if (i === undefined) {
      const n = coords.get(id);
      if (!n) return -1;
      i = lat.length;
      index.set(id, i);
      lat.push(n.lat); lon.push(n.lon);
    }
    return i;
  };

  for (const el of elements) {
    if (el.type !== 'way' || !el.tags?.highway || !Array.isArray(el.nodes)) continue;
    const t = el.tags;
    const w = walkable(t); const d = drivable(t);
    if (!w && !d) continue;
    const ow = d ? oneway(t) : 0;
    const fwd = (w ? WALK : 0) | (d && ow !== -1 ? DRIVE : 0);
    const back = (w ? WALK : 0) | (d && ow !== 1 ? DRIVE : 0);
    const kmh = d ? driveSpeed(t) : 0;
    for (let k = 1; k < el.nodes.length; k++) {
      const a = idx(el.nodes[k - 1]); const b = idx(el.nodes[k]);
      if (a < 0 || b < 0 || a === b) continue;
      if (fwd) { from.push(a); to.push(b); flags.push(fwd); speeds.push(kmh); }
      if (back) { from.push(b); to.push(a); flags.push(back); speeds.push(kmh); }
    }
  }

  // Compressed adjacency lists (CSR): edges of node i are offsets[i] .. offsets[i+1].
  const n = lat.length;
  const offsets = new Uint32Array(n + 1);
  for (const a of from) offsets[a + 1]++;
  for (let i = 0; i < n; i++) offsets[i + 1] += offsets[i];
  const fill = offsets.slice(0, n);
  const targets = new Uint32Array(from.length);
  const edgeFlags = new Uint8Array(from.length);
  const edgeSpeeds = new Uint8Array(from.length);
  for (let e = 0; e < from.length; e++) {
    const p = fill[from[e]]++;
    targets[p] = to[e];
    edgeFlags[p] = flags[e];
    edgeSpeeds[p] = speeds[e];
  }
  return {
    version: GRAPH_VERSION, count: n, lat: Float64Array.from(lat), lon: Float64Array.from(lon),
    offsets, targets, flags: edgeFlags, speeds: edgeSpeeds,
  };
}

// Flat-earth distance around the graph's latitude: accurate to well under 1% across a city,
// and consistent between edges and the A* estimate, so the search finds the true shortest path.
function metric(g) {
  if (!g._kx) {
    let sum = 0;
    for (let i = 0; i < g.count; i++) sum += g.lat[i];
    g._kx = Math.cos((sum / Math.max(1, g.count)) * DEG) * R * DEG;
    g._ky = R * DEG;
  }
  return [g._kx, g._ky];
}

function dist(g, i, j) {
  const [kx, ky] = metric(g);
  const dx = (g.lon[i] - g.lon[j]) * kx; const dy = (g.lat[i] - g.lat[j]) * ky;
  return Math.sqrt(dx * dx + dy * dy);
}

const MODE = { walk: WALK, drive: DRIVE };

/** Nearest graph node usable in this mode, and how far it is (metres). */
export function nearestNode(g, la, lo, mode = 'walk') {
  const [kx, ky] = metric(g);
  const m = MODE[mode];
  let best = -1; let bestD = Infinity;
  for (let i = 0; i < g.count; i++) {
    const dx = (g.lon[i] - lo) * kx; const dy = (g.lat[i] - la) * ky;
    const d = dx * dx + dy * dy;
    if (d >= bestD) continue;
    let usable = false;
    for (let e = g.offsets[i]; e < g.offsets[i + 1]; e++) if (g.flags[e] & m) { usable = true; break; }
    if (usable) { best = i; bestD = d; }
  }
  return best < 0 ? null : { node: best, distance: Math.sqrt(bestD) };
}

/** Minimal binary heap of (priority, node). */
class Heap {
  constructor() { this.p = []; this.v = []; }
  get size() { return this.p.length; }
  push(pr, val) {
    const { p, v } = this;
    let i = p.length; p.push(pr); v.push(val);
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (p[up] <= pr) break;
      p[i] = p[up]; v[i] = v[up]; i = up;
    }
    p[i] = pr; v[i] = val;
  }
  pop() {
    const { p, v } = this;
    const top = v[0];
    const lp = p.pop(); const lv = v.pop();
    if (p.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= p.length) break;
        if (c + 1 < p.length && p[c + 1] < p[c]) c++;
        if (p[c] >= lp) break;
        p[i] = p[c]; v[i] = v[c]; i = c;
      }
      p[i] = lp; v[i] = lv;
    }
    return top;
  }
}

/**
 * Best path between two points along the roads, or null if there is none.
 * Walking: the shortest path. Driving: the fastest, using each road type's typical speed,
 * so main roads are preferred over lanes (like an online router).
 * Includes the short off-road bits from each point to the nearest road.
 * @returns {{coords:number[][], distance:number, duration:number} | null}
 */
export function shortestPath(g, start, end, mode = 'walk') {
  if (!g?.count) return null;
  const s = nearestNode(g, start.lat, start.lon, mode);
  const t = nearestNode(g, end.lat, end.lon, mode);
  if (!s || !t) return null;
  const m = MODE[mode];
  const drive = mode === 'drive';
  const n = g.count;
  // Cost is seconds. Older saved graphs (v1) have no speeds: assume 20 km/h everywhere.
  const speedOf = (e) => (drive ? (g.speeds?.[e] || 20) : WALK_SPEED) / 3.6;
  let maxSpeed = WALK_SPEED / 3.6;
  if (drive) { maxSpeed = 20 / 3.6; if (g.speeds) for (const v of g.speeds) maxSpeed = Math.max(maxSpeed, v / 3.6); }
  const cost = new Float64Array(n).fill(Infinity);
  const len = new Float64Array(n);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap = new Heap();
  cost[s.node] = 0;
  heap.push(dist(g, s.node, t.node) / maxSpeed, s.node);
  while (heap.size) {
    const u = heap.pop();
    if (done[u]) continue;
    if (u === t.node) break;
    done[u] = 1;
    for (let e = g.offsets[u]; e < g.offsets[u + 1]; e++) {
      if (!(g.flags[e] & m)) continue;
      const v = g.targets[e];
      if (done[v]) continue;
      const d = dist(g, u, v);
      const cand = cost[u] + d / speedOf(e);
      if (cand < cost[v]) {
        cost[v] = cand;
        len[v] = len[u] + d;
        prev[v] = u;
        heap.push(cand + dist(g, v, t.node) / maxSpeed, v);
      }
    }
  }
  if (cost[t.node] === Infinity) return null;
  const path = [];
  for (let v = t.node; v !== -1; v = prev[v]) path.push([g.lon[v], g.lat[v]]);
  path.reverse();
  // The bits between the points and the road are on foot / slow.
  const offRoad = s.distance + t.distance;
  return {
    coords: [[start.lon, start.lat], ...path, [end.lon, end.lat]],
    distance: offRoad + len[t.node],
    duration: cost[t.node] + offRoad / (WALK_SPEED / 3.6),
  };
}
