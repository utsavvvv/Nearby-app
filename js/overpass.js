// Downloads places from OpenStreetMap through the public Overpass API.
// Only needed once per area while online; afterwards everything is read from IndexedDB.

import { buildOverpassQuery, classify } from './categories.js';

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];

export async function fetchPlaces(lat, lon, radiusMeters, regionId) {
  const query = buildOverpassQuery(lat, lon, radiusMeters);
  let lastError;
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
      const json = await res.json();
      return toPlaces(json.elements || [], regionId);
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Could not reach the map data servers');
}

function toPlaces(elements, regionId) {
  const places = [];
  for (const el of elements) {
    const lat = el.lat ?? el.center?.lat;
    const lon = el.lon ?? el.center?.lon;
    const tags = el.tags || {};
    const cat = classify(tags);
    if (lat == null || lon == null || !cat) continue;
    places.push({
      id: `osm:${el.type}/${el.id}`,
      source: 'osm',
      regionId,
      lat,
      lon,
      cat,
      name: tags['name:en'] || tags.name || '',
      localName: tags['name:en'] && tags.name !== tags['name:en'] ? tags.name : '',
      hours: tags.opening_hours || '',
      phone: tags.phone || tags['contact:phone'] || '',
      address: [tags['addr:housenumber'], tags['addr:street'], tags['addr:suburb'] || tags['addr:city']]
        .filter(Boolean).join(', '),
      kind: (tags.shop || tags.amenity || tags.tourism || tags.railway || '').replace(/_/g, ' '),
    });
  }
  return places;
}
