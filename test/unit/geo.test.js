import { test } from 'node:test';
import assert from 'node:assert/strict';
import { distance, bearing, compassPoint, formatDistance, walkTime } from '../../src/js/geo.js';

test('distance between two known points', () => {
  // Kolkata Howrah Bridge -> Victoria Memorial is about 4.5 km
  const d = distance(22.5851, 88.3468, 22.5448, 88.3426);
  assert.ok(d > 4400 && d < 4600, `got ${d}`);
  assert.equal(distance(10, 10, 10, 10), 0);
});

test('bearing points the right way', () => {
  assert.ok(Math.abs(bearing(0, 0, 1, 0) - 0) < 0.01); // north
  assert.ok(Math.abs(bearing(0, 0, 0, 1) - 90) < 0.01); // east
  assert.ok(Math.abs(bearing(0, 0, -1, 0) - 180) < 0.01); // south
  assert.ok(Math.abs(bearing(0, 0, 0, -1) - 270) < 0.01); // west
});

test('compass points', () => {
  assert.equal(compassPoint(0), 'N');
  assert.equal(compassPoint(44), 'NE');
  assert.equal(compassPoint(359), 'N');
  assert.equal(compassPoint(200), 'S');
});

test('formatting', () => {
  assert.equal(formatDistance(42), '40 m');
  assert.equal(formatDistance(1234), '1.2 km');
  assert.equal(formatDistance(23456), '23 km');
  assert.equal(walkTime(10), '1 min walk');
  assert.equal(walkTime(8000), '1 h 40 min walk');
});
