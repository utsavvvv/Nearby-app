import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hotelUrl, areaHotelsUrl } from '../../src/js/hotels.js';

test('hotel link searches by name and area, with affiliate id', () => {
  const url = new URL(hotelUrl({ name: 'Hotel Ganges View', address: '' }, 'Godowlia', '12345'));
  assert.equal(url.origin, 'https://www.booking.com');
  assert.equal(url.searchParams.get('ss'), 'Hotel Ganges View, Godowlia');
  assert.equal(url.searchParams.get('aid'), '12345');
});

test('hotel link without affiliate id still works', () => {
  const url = new URL(hotelUrl({ name: 'X & Y <Inn>', address: 'Dashashwamedh Rd' }, 'Godowlia', ''));
  assert.equal(url.searchParams.get('ss'), 'X & Y <Inn>, Dashashwamedh Rd');
  assert.equal(url.searchParams.has('aid'), false);
});

test('area link', () => {
  const url = new URL(areaHotelsUrl('Rishikesh', 'a1'));
  assert.equal(url.searchParams.get('ss'), 'Rishikesh');
  assert.equal(url.searchParams.get('aid'), 'a1');
});
