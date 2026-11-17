import { test } from 'node:test';
import assert from 'node:assert/strict';
import { firstInstruction, straightLine, formatDuration } from '../../src/js/routing.js';

test('first instruction: head direction and first turn', () => {
  // North 200 m, then east (a right turn), then north again.
  const c = [[82, 25], [82, 25.0018], [82.002, 25.0018], [82.002, 25.003]];
  const i = firstInstruction(c);
  assert.equal(i.head, 'N');
  assert.equal(i.turn, 'right');
  assert.ok(Math.abs(i.in - 200) < 5, `${i.in}`);
  assert.ok(i.total > 500);
});

test('first instruction: left turn, and straight routes', () => {
  assert.equal(firstInstruction([[82, 25], [82.002, 25], [82.002, 25.002]]).turn, 'left'); // east then north
  const straight = firstInstruction([[82, 25], [82.001, 25.001], [82.002, 25.002]]);
  assert.equal(straight.head, 'NE');
  assert.equal(straight.turn, null);
  assert.equal(firstInstruction([[82, 25]]).turn, null);
});

test('straight-line fallback and durations', () => {
  const s = straightLine({ lat: 25, lon: 82 }, { lat: 25.009, lon: 82 }, 'walk');
  assert.equal(s.straight, true);
  assert.ok(Math.abs(s.duration - s.distance / (4.8 / 3.6)) < 1);
  assert.equal(formatDuration(30), '1 min');
  assert.equal(formatDuration(3 * 3600 + 120), '3 h 2 min');
});
