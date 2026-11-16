import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOpenAt, parseHours } from '../../src/js/hours.js';

// 2026-11-16 is a Monday.
const at = (day, hh, mm = 0) => new Date(2026, 10, 16 + day, hh, mm);
const MON = 0; const SAT = 5; const SUN = 6;

test('24/7', () => {
  assert.equal(isOpenAt('24/7', at(MON, 3)), true);
});

test('simple daily hours', () => {
  assert.equal(isOpenAt('08:00-23:00', at(MON, 7, 59)), false);
  assert.equal(isOpenAt('08:00-23:00', at(MON, 8)), true);
  assert.equal(isOpenAt('08:00-23:00', at(SUN, 22, 59)), true);
  assert.equal(isOpenAt('08:00-23:00', at(SUN, 23)), false);
});

test('weekdays with a day off', () => {
  const h = 'Mo-Sa 09:00-21:00; Su off';
  assert.equal(isOpenAt(h, at(SAT, 10)), true);
  assert.equal(isOpenAt(h, at(SUN, 10)), false);
});

test('later rules override earlier ones', () => {
  const h = 'Mo-Su 09:00-21:00; Su 12:00-15:00';
  assert.equal(isOpenAt(h, at(SUN, 10)), false);
  assert.equal(isOpenAt(h, at(SUN, 13)), true);
  assert.equal(isOpenAt(h, at(MON, 10)), true);
});

test('split shifts and past midnight', () => {
  const h = 'Mo-Fr 10:00-14:00,17:00-02:00';
  assert.equal(isOpenAt(h, at(MON, 15)), false);
  assert.equal(isOpenAt(h, at(MON, 23)), true);
  assert.equal(isOpenAt(h, at(1, 1, 30)), true); // Tuesday 01:30, from Monday's shift
  assert.equal(isOpenAt(h, at(SUN, 1)), false); // Saturday has no shift
});

test('day lists and wrap-around ranges', () => {
  assert.equal(isOpenAt('Fr-Mo 10:00-12:00', at(SUN, 11)), true);
  assert.equal(isOpenAt('Fr-Mo 10:00-12:00', at(2, 11)), false); // Wednesday
  assert.equal(isOpenAt('Mo,We 10:00-12:00', at(2, 11)), true);
});

test('holiday rules are ignored, other days still work', () => {
  assert.equal(isOpenAt('Mo-Su 08:00-20:00; PH off', at(MON, 9)), true);
  assert.equal(isOpenAt('Su,PH 08:00-12:00', at(SUN, 9)), true);
});

test('unknown formats return null', () => {
  assert.equal(isOpenAt('sunrise-sunset', at(MON, 9)), null);
  assert.equal(isOpenAt('Jan-Mar 09:00-17:00', at(MON, 9)), null);
  assert.equal(isOpenAt('09:00+', at(MON, 9)), null);
  assert.equal(isOpenAt('', at(MON, 9)), null);
  assert.equal(parseHours(null), null);
});
