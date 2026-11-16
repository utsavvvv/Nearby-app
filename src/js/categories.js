// Place categories useful to travellers, and how they map to OpenStreetMap tags.
// `match` lists OSM key -> allowed values. The first category whose rule matches wins,
// so more specific categories (pan shops) come before general ones.

export const CATEGORIES = [
  {
    id: 'pan', label: 'Pan & Tobacco', icon: '🌿', color: '#2e7d32',
    match: { shop: ['tobacco', 'pan', 'paan', 'betel', 'e-cigarette', 'kiosk', 'newsagent'] },
  },
  {
    id: 'grocery', label: 'Stores & Grocery', icon: '🛒', color: '#ef6c00',
    match: { shop: ['convenience', 'supermarket', 'general', 'grocery', 'greengrocer',
      'department_store', 'variety_store', 'dairy', 'bakery', 'mall', 'beverages'] },
  },
  {
    id: 'tea', label: 'Tea & Cafe', icon: '☕', color: '#6d4c41',
    match: { amenity: ['cafe'], shop: ['tea', 'coffee'] },
  },
  {
    id: 'food', label: 'Food', icon: '🍛', color: '#c62828',
    match: { amenity: ['restaurant', 'fast_food', 'food_court'] },
  },
  {
    id: 'pharmacy', label: 'Pharmacy', icon: '💊', color: '#00897b',
    match: { amenity: ['pharmacy'], shop: ['chemist'], healthcare: ['pharmacy'] },
  },
  {
    id: 'atm', label: 'ATM & Bank', icon: '🏧', color: '#1565c0',
    match: { amenity: ['atm', 'bank', 'bureau_de_change'] },
  },
  {
    id: 'medical', label: 'Hospital & Clinic', icon: '🏥', color: '#d81b60',
    match: { amenity: ['hospital', 'clinic', 'doctors'] },
  },
  {
    id: 'toilets', label: 'Toilets', icon: '🚻', color: '#5e35b1',
    match: { amenity: ['toilets'] },
  },
  {
    id: 'water', label: 'Drinking Water', icon: '🚰', color: '#0288d1',
    match: { amenity: ['drinking_water'] },
  },
  {
    id: 'stay', label: 'Hotels & Stay', icon: '🛏️', color: '#8e24aa',
    match: { tourism: ['hotel', 'guest_house', 'hostel', 'motel'] },
  },
  {
    id: 'transport', label: 'Bus, Train & Taxi', icon: '🚉', color: '#455a64',
    match: { amenity: ['bus_station', 'taxi'], railway: ['station', 'halt'] },
  },
  {
    id: 'fuel', label: 'Fuel', icon: '⛽', color: '#f9a825',
    match: { amenity: ['fuel'] },
  },
  {
    id: 'police', label: 'Police', icon: '👮', color: '#283593',
    match: { amenity: ['police'] },
  },
  {
    id: 'other', label: 'Other', icon: '📍', color: '#757575',
    match: {},
  },
];

export const CATEGORY_BY_ID = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));

/** Pick a category for a set of OSM tags (or null if it isn't one we care about). */
export function classify(tags = {}) {
  for (const cat of CATEGORIES) {
    for (const [key, values] of Object.entries(cat.match)) {
      if (tags[key] && values.includes(tags[key])) return cat.id;
    }
  }
  return null;
}

/** Build a single Overpass QL query that fetches every category around a point. */
export function buildOverpassQuery(lat, lon, radiusMeters) {
  // Collect allowed values per key across all categories.
  const byKey = {};
  for (const cat of CATEGORIES) {
    for (const [key, values] of Object.entries(cat.match)) {
      (byKey[key] ||= new Set());
      values.forEach((v) => byKey[key].add(v));
    }
  }
  const around = `(around:${Math.round(radiusMeters)},${lat.toFixed(6)},${lon.toFixed(6)})`;
  const parts = Object.entries(byKey).map(
    ([key, values]) => `  nwr["${key}"~"^(${[...values].join('|')})$"]${around};`,
  );
  return `[out:json][timeout:90];\n(\n${parts.join('\n')}\n);\nout center tags;`;
}
