// City packs: ready-made bundles of extra places for popular destinations, built from the
// Overture Maps Places dataset (open data, allowed offline). The app combines a pack with the
// usual OpenStreetMap download, removing places that appear in both.
// This file is shared by the app and the pack builder (scripts/packs/build-packs.mjs).

/** Destinations with a pack. Radius above the free limit (5 km) needs Pro. */
export const PACKS = [
  { id: 'rishikesh', name: 'Rishikesh', state: 'Uttarakhand', lat: 30.1150, lon: 78.3050, radius: 5000, blurb: 'ghats, Laxman Jhula, Tapovan' },
  { id: 'haridwar', name: 'Haridwar', state: 'Uttarakhand', lat: 29.9500, lon: 78.1650, radius: 5000, blurb: 'Har Ki Pauri, ghats, station' },
  { id: 'mussoorie', name: 'Mussoorie', state: 'Uttarakhand', lat: 30.4598, lon: 78.0700, radius: 4000, blurb: 'Mall Road, Landour' },
  { id: 'nainital', name: 'Nainital', state: 'Uttarakhand', lat: 29.3860, lon: 79.4560, radius: 4000, blurb: 'Naini Lake, Mall Road' },
  { id: 'almora', name: 'Almora', state: 'Uttarakhand', lat: 29.5971, lon: 79.6591, radius: 4000, blurb: 'Mall Road, Kasar Devi' },
  { id: 'joshimath', name: 'Joshimath & Auli', state: 'Uttarakhand', lat: 30.5480, lon: 79.5670, radius: 4000, blurb: 'gateway to Badrinath, Auli' },
  { id: 'badrinath', name: 'Badrinath', state: 'Uttarakhand', lat: 30.7433, lon: 79.4938, radius: 3000, blurb: 'temple, Mana village' },
  { id: 'kedarnath', name: 'Kedarnath trek', state: 'Uttarakhand', lat: 30.6930, lon: 79.0460, radius: 7000, blurb: 'Gaurikund to the temple' },
  { id: 'dehradun', name: 'Dehradun', state: 'Uttarakhand', lat: 30.3200, lon: 78.0400, radius: 10000, blurb: 'city, ISBT, railway station' },
];

export const PACK_BY_ID = Object.fromEntries(PACKS.map((p) => [p.id, p]));

// ---- Overture category -> app category ----

// Strong hints in the name win over the (sometimes wrong) category.
const NAME_RULES = [
  ['transport', /railway station|rly station|bus stand|bus station|\bisbt\b|taxi stand|रेलवे स्टेशन|बस स्टैंड|बस अड्डा/i],
  ['atm', /\batm\b|एटीएम/i],
  ['pharmacy', /chemist|pharmacy|medical store|medicos|dawakhana|दवा/i],
  ['stay', /\bhotel\b|guest ?house|homestay|home stay|hostel|dharam?s?h?ala|dharmshala|ashram|lodge|resort|धर्मशाला/i],
  ['medical', /hospital|clinic|nursing home|dispensary|अस्पताल/i],
  ['police', /police|thana|चौकी|पुलिस/i],
  ['fuel', /petrol pump|filling station|fuel station|पेट्रोल/i],
  ['pan', /\bpaa?n\b|पान/i],
  ['tea', /\bchai\b|tea stall|tea point|चाय/i],
  ['toilets', /toilet|sulabh|शौचालय/i],
  ['education', /\bschool\b|vidyalaya|college|university|विद्यालय/i],
];

// Checked in order against the category words (taxonomy hierarchy + primary + basic category).
const CATEGORY_RULES = [
  ['pharmacy', /pharmacy|drug_?store|chemist/],
  ['medical', /hospital|clinic|doctors?_office|medical_cent|emergency|urgent_care|health_care|dental|diagnostic/],
  ['atm', /(^|_)atm($|_)|bank_or_credit_union|(^|_)bank($|_)|currency_exchange/],
  ['toilets', /toilet|restroom/],
  ['water', /drinking_water/],
  ['police', /police/],
  ['fuel', /gas_station|fuel_station|petrol/],
  ['transport', /bus_station|train_station|railway_station|metro_station|taxi|bus_stop|airport/],
  ['stay', /hotel|hostel|guest_house|bed_and_breakfast|resort|lodging|motel|homestay|campground/],
  ['education', /(^|_)school|college|university|kindergarten|place_of_learning/],
  ['tea', /cafe|coffee|tea_room|tea_house|(^|_)tea($|_)/],
  ['food', /restaurant|eatery|fast_food|food_court|food_stand|food_truck|dhaba|sweet|dessert|bakery|juice|ice_cream|snack/],
  ['pan', /tobacco|paan|kiosk|news_?stand/],
  ['grocery', /grocery|convenience|supermarket|department_store|food_and_beverage_store|general_store|discount_store|shopping_cent|(^|_)mall($|_)|dairy/],
];

// Category-based matches that also need a fitting name (these categories are noisy).
const NEEDS_NAME = {
  atm: /bank|\batm\b|\bcdm\b|cash/i, // "bank_or_credit_union" also covers loan companies
  transport: /station|stand|\bisbt\b|taxi|\bbus\b|railway|junction|\brly\b|airport|metro|depot|stop/i,
  education: /school|vidyalaya|college|university|academy|institute|vidya|shiksha|विद्यालय/i,
};
// Names that are never what a traveller means by "school", etc.
const NOT_EDUCATION = /yoga|reiki|meditation|music|dance|driving|tantra|ayurveda|massage|sound healing/i;

// Things that look like a match but aren't useful to travellers.
const SKIP = /driving_school|dance_school|music_school|yoga_studio|specialty_school|e_?cigarette|vape|bank_equipment|blood_bank|food_bank/;

const clip = (s, n) => (typeof s === 'string' ? s.trim().slice(0, n) : '');

/** Pick the app category for an Overture place, or null if it's not one we show. */
export function overtureCategory(row) {
  // Only the place's own name counts: "Tattoo Studio near Laxman Jhula Police" is not a police station.
  const name = (row.names?.primary || '').replace(/[,(-]?\s*\b(near|nr\.?|opp\.?|opposite|behind|beside|next to|in front of)\b.*$/i, '').trim();
  for (const [cat, re] of NAME_RULES) {
    if (re.test(name) && !(cat === 'education' && NOT_EDUCATION.test(name))) return cat;
  }
  const words = [row.basic_category, row.taxonomy?.primary, ...(row.taxonomy?.hierarchy || []), row.categories?.primary]
    .filter(Boolean).join(' ').toLowerCase();
  if (!words || SKIP.test(words)) return null;
  for (const [cat, re] of CATEGORY_RULES) {
    if (!re.test(words)) continue;
    if (NEEDS_NAME[cat] && !NEEDS_NAME[cat].test(name)) return null;
    if (cat === 'education' && NOT_EDUCATION.test(name)) return null;
    return cat;
  }
  // "shopping" alone is too vague; keep only general stores.
  if (/shopping/.test(words) && /kirana|general store|provision|mart\b|super ?market|departmental|store/i.test(name)) return 'grocery';
  return null;
}

/** Convert one Overture places row (as read from Overture's Parquet files) to an app place. */
export function overtureToPlace(row, { minConfidence = 0.45 } = {}) {
  if (!row?.id || (row.confidence ?? 1) < minConfidence) return null;
  if (row.operating_status && row.operating_status !== 'open') return null;
  const b = row.bbox;
  const lat = b ? (b.ymin + b.ymax) / 2 : row.lat;
  const lon = b ? (b.xmin + b.xmax) / 2 : row.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const cat = overtureCategory(row);
  if (!cat) return null;
  const primary = row.names?.primary || '';
  const common = row.names?.common;
  const en = (common && (Array.isArray(common) ? Object.fromEntries(common) : common).en) || '';
  const name = en || primary || row.brand?.names?.primary || '';
  if (!name) return null; // nameless Overture entries aren't worth showing
  const a = row.addresses?.[0];
  return {
    id: `ovt:${row.id}`,
    source: 'ovt',
    lat: Math.round(lat * 1e6) / 1e6,
    lon: Math.round(lon * 1e6) / 1e6,
    cat,
    name: clip(name, 120),
    localName: en && primary && primary !== en ? clip(primary, 120) : '',
    address: clip(a ? [a.freeform, a.locality].filter(Boolean).filter((v, i, arr) => arr.indexOf(v) === i).join(', ') : '', 200),
    phone: clip(row.phones?.[0], 60),
    kind: clip((row.basic_category || '').replace(/_/g, ' '), 40),
  };
}

// ---- Combining with OpenStreetMap ----

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9\p{Script=Devanagari}]+/gu, ' ').trim();

function sameName(a, b) {
  const x = norm(a); const y = norm(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * Add pack places to OpenStreetMap places, dropping ones that are probably already there:
 * same category nearby with a similar name, or same category very close.
 */
export function mergePlaces(osm, extra) {
  const cell = (lat, lon) => `${Math.floor(lat * 1000)}:${Math.floor(lon * 1000)}`; // ~110 m cells
  const grid = new Map();
  for (const p of osm) {
    const k = cell(p.lat, p.lon);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  const near = (p) => {
    const out = [];
    const la = Math.floor(p.lat * 1000); const lo = Math.floor(p.lon * 1000);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) out.push(...(grid.get(`${la + i}:${lo + j}`) || []));
    return out;
  };
  const metres = (a, b) => {
    const dy = (a.lat - b.lat) * 111320;
    const dx = (a.lon - b.lon) * 111320 * Math.cos((a.lat * Math.PI) / 180);
    return Math.hypot(dx, dy);
  };
  const added = [];
  for (const p of extra) {
    const dup = near(p).some((o) => o.cat === p.cat && (metres(o, p) < 15 || (metres(o, p) < 80 && sameName(o.name, p.name))));
    if (!dup) added.push(p);
  }
  return { places: [...osm, ...added], added: added.length };
}
