import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, classify, buildOverpassQuery } from '../../src/js/categories.js';

test('classifies traveller essentials', () => {
  assert.equal(classify({ shop: 'tobacco' }), 'pan');
  assert.equal(classify({ shop: 'pan' }), 'pan');
  assert.equal(classify({ shop: 'kiosk' }), 'pan');
  assert.equal(classify({ shop: 'convenience' }), 'grocery');
  assert.equal(classify({ amenity: 'pharmacy' }), 'pharmacy');
  assert.equal(classify({ shop: 'chemist' }), 'pharmacy');
  assert.equal(classify({ amenity: 'atm' }), 'atm');
  assert.equal(classify({ railway: 'station' }), 'transport');
  assert.equal(classify({ tourism: 'hotel' }), 'stay');
  assert.equal(classify({ amenity: 'bench' }), null);
  assert.equal(classify({}), null);
  assert.equal(classify(undefined), null);
});

test('every category has the fields the UI needs', () => {
  const ids = new Set();
  for (const c of CATEGORIES) {
    assert.ok(c.id && c.label && c.icon && /^#[0-9a-f]{6}$/i.test(c.color), c.id);
    assert.ok(!ids.has(c.id), `duplicate ${c.id}`);
    ids.add(c.id);
  }
});

test('overpass query covers all categories', () => {
  const q = buildOverpassQuery(25.3, 82.97, 5000);
  assert.match(q, /^\[out:json\]/);
  assert.match(q, /around:5000,25\.300000,82\.970000/);
  assert.match(q, /nwr\["shop"~"\^\(.*tobacco.*\)\$"\]/);
  assert.match(q, /nwr\["amenity"~/);
  assert.match(q, /nwr\["railway"~/);
  assert.match(q, /out center tags;$/);
});

test('schools and colleges are a category', () => {
  assert.equal(classify({ amenity: 'school' }), 'education');
  assert.equal(classify({ amenity: 'university' }), 'education');
});

test('recognises kinds of places typed as search text', async () => {
  const { categoryForQuery } = await import('../../src/js/categories.js');
  assert.equal(categoryForQuery('School'), 'education');
  assert.equal(categoryForQuery('schools'), 'education');
  assert.equal(categoryForQuery(' Chemist '), 'pharmacy');
  assert.equal(categoryForQuery('paan shop'), 'pan');
  assert.equal(categoryForQuery('ATM'), 'atm');
  assert.equal(categoryForQuery('petrol pump'), 'fuel');
  assert.equal(categoryForQuery('Varanasi'), null);
  assert.equal(categoryForQuery(''), null);
});
