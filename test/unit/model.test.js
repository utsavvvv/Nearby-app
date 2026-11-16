import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizePlace, sanitizeRegion } from '../../src/js/model.js';

test('accepts a valid place and drops unknown fields', () => {
  const p = sanitizePlace({ id: 'user:abc123', lat: 25, lon: 82, cat: 'pan', name: 'X', evil: '<script>' });
  assert.equal(p.source, 'user');
  assert.equal(p.regionId, 'user');
  assert.equal(p.name, 'X');
  assert.equal('evil' in p, false);
});

test('rejects bad places', () => {
  assert.equal(sanitizePlace(null), null);
  assert.equal(sanitizePlace({ id: 'user:a', lat: 'x', lon: 82, cat: 'pan' }), null);
  assert.equal(sanitizePlace({ id: 'user:a', lat: 95, lon: 82, cat: 'pan' }), null);
  assert.equal(sanitizePlace({ id: 'user:a', lat: 25, lon: 82, cat: 'nope' }), null);
  assert.equal(sanitizePlace({ id: 'javascript:alert(1)', lat: 25, lon: 82, cat: 'pan' }), null);
});

test('clips long strings', () => {
  const p = sanitizePlace({ id: 'osm:node/1', regionId: 'r', lat: 1, lon: 1, cat: 'atm', name: 'a'.repeat(500) });
  assert.equal(p.name.length, 120);
  assert.equal(p.source, 'osm');
});

test('regions', () => {
  assert.deepEqual(sanitizeRegion({ id: 'r:1', lat: 1, lon: 2, radius: 5000, name: 'Town', count: 3, savedAt: 10 }),
    { id: 'r:1', lat: 1, lon: 2, radius: 5000, name: 'Town', count: 3, savedAt: 10 });
  assert.equal(sanitizeRegion({ id: 'r:1', lat: 1, lon: 2, radius: 1e9 }), null);
  assert.equal(sanitizeRegion({ lat: 1, lon: 2, radius: 5 }), null);
});
