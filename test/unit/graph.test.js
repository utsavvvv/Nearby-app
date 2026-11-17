import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, shortestPath, nearestNode } from '../../src/js/graph.js';
import { distance } from '../../src/js/geo.js';

// A small street grid: 4x4 junctions ~111 m apart (0.001° lat), with a few special roads.
function grid({ oneWayTop = false, footpathShortcut = false, missingMiddle = false } = {}) {
  const els = [];
  const id = (r, c) => 1000 + r * 10 + c;
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) els.push({ type: 'node', id: id(r, c), lat: 25 + r * 0.001, lon: 82 + c * 0.0011 });
  let w = 1;
  for (let r = 0; r < 4; r++) {
    els.push({ type: 'way', id: w++, nodes: [0, 1, 2, 3].map((c) => id(r, c)),
      tags: { highway: 'residential', ...(oneWayTop && r === 3 ? { oneway: 'yes' } : {}) } });
  }
  for (let c = 0; c < 4; c++) {
    if (missingMiddle && (c === 1 || c === 2)) continue;
    els.push({ type: 'way', id: w++, nodes: [0, 1, 2, 3].map((r) => id(r, c)), tags: { highway: 'residential' } });
  }
  if (footpathShortcut) {
    // A diagonal footpath from bottom-left to top-right: shorter, but only for walking.
    els.push({ type: 'way', id: w++, nodes: [id(0, 0), id(3, 3)], tags: { highway: 'footway' } });
  }
  els.push({ type: 'way', id: w++, nodes: [id(0, 0), id(0, 1)], tags: { building: 'yes' } }); // not a road: ignored
  return els;
}

const pt = (r, c) => ({ lat: 25 + r * 0.001, lon: 82 + c * 0.0011 });
const len = (coords) => coords.slice(1).reduce((s, [lo, la], i) => s + distance(coords[i][1], coords[i][0], la, lo), 0);

test('builds a compact graph', () => {
  const g = buildGraph(grid());
  assert.equal(g.count, 16);
  assert.equal(g.offsets.length, 17);
  // 4 rows + 4 columns, 3 segments each, both directions = 48 edges
  assert.equal(g.targets.length, 48);
  assert.ok(g.lat instanceof Float64Array && g.targets instanceof Uint32Array);
});

test('finds the shortest path along streets', () => {
  const g = buildGraph(grid());
  const r = shortestPath(g, pt(0, 0), pt(3, 3), 'walk');
  assert.ok(r);
  // Manhattan distance: 3 * 111 m + 3 * ~110.6 m
  const manhattan = 3 * distance(25, 82, 25.001, 82) + 3 * distance(25, 82, 25, 82.0011);
  assert.ok(Math.abs(r.distance - manhattan) < 2, `${r.distance} vs ${manhattan}`);
  assert.ok(Math.abs(len(r.coords) - r.distance) < 2);
  assert.deepEqual(r.coords[0], [82, 25]);
  assert.deepEqual(r.coords.at(-1), [82 + 3 * 0.0011, 25.003]);
});

test('walkers use footpaths, drivers do not', () => {
  const g = buildGraph(grid({ footpathShortcut: true }));
  const walk = shortestPath(g, pt(0, 0), pt(3, 3), 'walk');
  const drive = shortestPath(g, pt(0, 0), pt(3, 3), 'drive');
  assert.ok(walk.distance < 500, `walk ${walk.distance}`); // diagonal ~470 m
  assert.ok(drive.distance > 650, `drive ${drive.distance}`); // around the grid ~665 m
});

test('drivers respect one-way streets, walkers ignore them', () => {
  const g = buildGraph(grid({ oneWayTop: true }));
  // Top row is one-way left->right. Going right->left by car must detour.
  const walk = shortestPath(g, pt(3, 3), pt(3, 0), 'walk');
  const drive = shortestPath(g, pt(3, 3), pt(3, 0), 'drive');
  assert.ok(walk.distance < 340, `walk ${walk.distance}`);
  assert.ok(drive.distance > walk.distance + 200, `drive ${drive.distance}`);
});

test('snaps points that are off the road', () => {
  const g = buildGraph(grid());
  const near = nearestNode(g, 25.0001, 82.0001, 'walk');
  assert.equal(near.node, 0);
  assert.ok(near.distance < 20);
  const r = shortestPath(g, { lat: 24.9998, lon: 81.9998 }, pt(0, 1), 'walk');
  assert.ok(r.distance > 110 && r.distance < 160);
});

test('returns null when there is no connection', () => {
  const els = grid();
  // An island road far away, not connected to the grid.
  els.push({ type: 'node', id: 1, lat: 25.01, lon: 82.01 }, { type: 'node', id: 2, lat: 25.011, lon: 82.01 });
  els.push({ type: 'way', id: 99, nodes: [1, 2], tags: { highway: 'residential' } });
  const g = buildGraph(els);
  assert.equal(shortestPath(g, pt(0, 0), { lat: 25.0105, lon: 82.01 }, 'walk'), null);
  assert.equal(shortestPath({ count: 0 }, pt(0, 0), pt(1, 1)), null);
});

test('handles a city-sized graph quickly', () => {
  // 300 x 300 grid = 90,000 junctions, about 33 km x 33 km of streets.
  const els = [];
  const N = 300;
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) els.push({ type: 'node', id: r * N + c + 1, lat: 25 + r * 0.001, lon: 82 + c * 0.0011 });
  for (let r = 0; r < N; r++) els.push({ type: 'way', id: 1e6 + r, nodes: Array.from({ length: N }, (_, c) => r * N + c + 1), tags: { highway: 'residential' } });
  for (let c = 0; c < N; c++) els.push({ type: 'way', id: 2e6 + c, nodes: Array.from({ length: N }, (_, r) => r * N + c + 1), tags: { highway: 'residential' } });
  const t0 = performance.now();
  const g = buildGraph(els);
  const t1 = performance.now();
  const r = shortestPath(g, pt(0, 0), { lat: 25 + 250 * 0.001, lon: 82 + 250 * 0.0011 }, 'walk');
  const t2 = performance.now();
  assert.ok(r);
  assert.ok(t1 - t0 < 3000, `build ${t1 - t0} ms`);
  assert.ok(t2 - t1 < 1500, `route ${t2 - t1} ms`);
});
