import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PACKS, overtureCategory, overtureToPlace, mergePlaces } from '../../src/js/packs.js';

const row = (name, basic, extra = {}) => ({
  id: `id-${name}`, names: { primary: name }, basic_category: basic, taxonomy: { primary: basic, hierarchy: [basic] },
  confidence: 0.8, bbox: { xmin: 78.3, xmax: 78.3, ymin: 30.1, ymax: 30.1 }, ...extra,
});

test('pack list is sane', () => {
  const ids = new Set();
  for (const p of PACKS) {
    assert.ok(/^[a-z-]+$/.test(p.id) && !ids.has(p.id));
    ids.add(p.id);
    assert.ok(p.radius >= 1000 && p.radius <= 20000);
    assert.ok(p.lat > 28 && p.lat < 32 && p.lon > 77 && p.lon < 81, p.id); // Uttarakhand
  }
});

test('maps Overture categories to app categories', () => {
  assert.equal(overtureCategory(row('Sai Medical store', 'pharmacy_and_drug_store')), 'pharmacy');
  assert.equal(overtureCategory(row('HDFC Bank ATM', 'atm')), 'atm');
  assert.equal(overtureCategory(row('Indian Oil', 'gas_station')), 'fuel');
  assert.equal(overtureCategory(row('Ganga View', 'hotel')), 'stay');
  assert.equal(overtureCategory(row('Chotiwala', 'indian_restaurant')), 'food');
  assert.equal(overtureCategory(row('Little Buddha', 'cafe')), 'tea');
  assert.equal(overtureCategory(row('Govt Inter College', 'place_of_learning')), 'education');
});

test('name hints fix wrong categories', () => {
  assert.equal(overtureCategory(row('Rishikesh Railway Station', 'music_venue')), 'transport');
  assert.equal(overtureCategory(row('योग नगरी ऋषिकेश रेलवे स्टेशन', 'music_venue')), 'transport');
  assert.equal(overtureCategory(row('Bishnoi Dharamsala', 'taxi_or_ride_share_service')), 'stay');
  assert.equal(overtureCategory(row('Pappu Chai Wala', 'shopping')), 'tea');
});

test('drops noisy matches', () => {
  assert.equal(overtureCategory(row('Manappuram Finance', 'bank_or_credit_union')), null); // loan company, not an ATM
  assert.equal(overtureCategory(row('Troubleshooterz', 'train_station')), null);
  assert.equal(overtureCategory(row('Hari Om Yoga Vidya School', 'specialty_school')), null);
  assert.equal(overtureCategory(row('Reiki School India', 'place_of_learning')), null);
  assert.equal(overtureCategory(row('Some Lawyer', 'lawyer')), null);
});

test('converts rows to places', () => {
  const p = overtureToPlace(row('Sai Medical store', 'pharmacy_and_drug_store', {
    addresses: [{ freeform: 'Laxman Jhula Rd', locality: 'Rishikesh' }], phones: ['+91 99999'],
    names: { primary: 'साई मेडिकल', common: [['en', 'Sai Medical store'], ['hi', 'साई मेडिकल']] },
  }));
  assert.deepEqual(p, {
    id: 'ovt:id-Sai Medical store', source: 'ovt', lat: 30.1, lon: 78.3, cat: 'pharmacy', name: 'Sai Medical store',
    localName: 'साई मेडिकल', address: 'Laxman Jhula Rd, Rishikesh', phone: '+91 99999', kind: 'pharmacy and drug store',
  });
  assert.equal(overtureToPlace(row('X', 'hotel', { confidence: 0.2 })), null);
  assert.equal(overtureToPlace(row('X', 'hotel', { operating_status: 'permanently_closed' })), null);
  assert.equal(overtureToPlace(row('', 'hotel')), null);
});

test('merging skips places OpenStreetMap already has', () => {
  const osm = [
    { id: 'osm:node/1', lat: 30.1, lon: 78.3, cat: 'atm', name: 'SBI ATM' },
    { id: 'osm:node/2', lat: 30.11, lon: 78.31, cat: 'food', name: 'Chotiwala Restaurant' },
  ];
  const extra = [
    { id: 'ovt:a', lat: 30.10005, lon: 78.30005, cat: 'atm', name: 'State Bank ATM' }, // 7 m away, same type
    { id: 'ovt:b', lat: 30.1103, lon: 78.3103, cat: 'food', name: 'Chotiwala' }, // ~45 m, similar name
    { id: 'ovt:c', lat: 30.1103, lon: 78.3103, cat: 'food', name: 'Little Italy' }, // nearby, different place
    { id: 'ovt:d', lat: 30.12, lon: 78.32, cat: 'stay', name: 'New Hotel' },
  ];
  const { places, added } = mergePlaces(osm, extra);
  assert.equal(added, 2);
  assert.deepEqual(places.map((p) => p.id), ['osm:node/1', 'osm:node/2', 'ovt:c', 'ovt:d']);
});

test('"near X" in a name does not decide the category', () => {
  assert.equal(overtureCategory(row('Mazel Tov Tattoo Studio near Laxman jhula police', 'tattoo_and_piercing')), null);
  assert.equal(overtureCategory(row('Sharma Sweets opp. Railway Station', 'sweet_shop')), 'food');
  assert.equal(overtureCategory(row('Laxman Jhula Police Station', 'government_office')), 'police');
});
