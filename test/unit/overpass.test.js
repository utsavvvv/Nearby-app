import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPlaces, toPlaces, DownloadError } from '../../src/js/overpass.js';

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const ELEMENTS = [
  { type: 'node', id: 1, lat: 25.1, lon: 82.1, tags: { shop: 'tobacco', name: 'Raju Pan', opening_hours: '08:00-23:00' } },
  { type: 'way', id: 2, center: { lat: 25.2, lon: 82.2 }, tags: { amenity: 'pharmacy', name: 'दवा घर', 'name:en': 'Dawa Ghar', phone: '+91 1' } },
  { type: 'node', id: 3, lat: 25.3, lon: 82.3, tags: { amenity: 'bench' } },
  { type: 'way', id: 4, tags: { shop: 'convenience' } }, // no coordinates
];

test('toPlaces converts and filters elements', () => {
  const places = toPlaces(ELEMENTS, 'r1');
  assert.equal(places.length, 2);
  assert.deepEqual(places[0], {
    id: 'osm:node/1', source: 'osm', regionId: 'r1', lat: 25.1, lon: 82.1, cat: 'pan', name: 'Raju Pan',
    localName: '', hours: '08:00-23:00', phone: '', address: '', kind: 'tobacco',
  });
  assert.equal(places[1].name, 'Dawa Ghar');
  assert.equal(places[1].localName, 'दवा घर');
  assert.equal(places[1].lat, 25.2);
});

test('falls back to the next server when one fails', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (calls.length === 1) return new Response('busy', { status: 504 });
    return Response.json({ elements: ELEMENTS });
  };
  const places = await fetchPlaces(25, 82, 2000, 'r', { endpoints: ['https://a/x', 'https://b/x'] });
  assert.equal(places.length, 2);
  assert.deepEqual(calls, ['https://a/x', 'https://b/x']);
});

test('reports a clear error when every server fails', async () => {
  globalThis.fetch = async () => new Response('', { status: 429 });
  await assert.rejects(fetchPlaces(25, 82, 2000, 'r', { endpoints: ['https://a/x'] }), (err) => err instanceof DownloadError && /busy/.test(err.message));
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(fetchPlaces(25, 82, 2000, 'r', { endpoints: ['https://a/x'] }), /Check your internet/);
});

test('treats an Overpass runtime error as a failure', async () => {
  globalThis.fetch = async () => Response.json({ elements: [], remark: 'runtime error: Query timed out' });
  await assert.rejects(fetchPlaces(25, 82, 2000, 'r', { endpoints: ['https://a/x'] }), /smaller radius/);
});

test('times out slow servers', async () => {
  globalThis.fetch = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  await assert.rejects(fetchPlaces(25, 82, 2000, 'r', { endpoints: ['https://a/x'], timeoutMs: 20 }), /too long/);
});

test('can be cancelled', async () => {
  const ctrl = new AbortController();
  globalThis.fetch = (url, { signal }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
  const p = fetchPlaces(25, 82, 2000, 'r', { endpoints: ['https://a/x', 'https://b/x'], signal: ctrl.signal });
  ctrl.abort(new Error('user cancelled'));
  await assert.rejects(p, /user cancelled/);
});

test('unnamed places get a name from their brand or operator', async () => {
  const { brandName } = await import('../../src/js/overpass.js');
  const places = toPlaces([
    { type: 'node', id: 10, lat: 1, lon: 1, tags: { amenity: 'atm', operator: 'State Bank of India' } },
    { type: 'node', id: 11, lat: 1, lon: 1, tags: { amenity: 'atm', brand: 'HDFC Bank ATM' } },
    { type: 'node', id: 12, lat: 1, lon: 1, tags: { amenity: 'pharmacy', brand: 'Apollo Pharmacy' } },
    { type: 'node', id: 13, lat: 1, lon: 1, tags: { amenity: 'fuel', brand: 'Indian Oil' } },
    { type: 'node', id: 14, lat: 1, lon: 1, tags: { amenity: 'atm', name: 'Named ATM', operator: 'X' } },
    { type: 'node', id: 15, lat: 1, lon: 1, tags: { shop: 'kiosk' } },
  ], 'r');
  assert.deepEqual(places.map((p) => p.name), ['State Bank of India ATM', 'HDFC Bank ATM', 'Apollo Pharmacy', 'Indian Oil petrol pump', 'Named ATM', '']);
  assert.equal(brandName({ amenity: 'bank', operator: 'Canara' }, 'atm'), 'Canara Bank');
});
