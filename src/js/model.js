// Validation for data coming from import files, so a bad or hostile file can't break the app.
import { CATEGORY_BY_ID } from './categories.js';

const str = (v, n) => (typeof v === 'string' ? v.slice(0, n) : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function sanitizePlace(p) {
  if (!p || typeof p !== 'object') return null;
  const lat = num(p.lat); const lon = num(p.lon);
  if (lat == null || lon == null || Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  if (typeof p.id !== 'string' || !/^(osm|user):[\w/.-]{1,80}$/.test(p.id)) return null;
  if (!CATEGORY_BY_ID[p.cat]) return null;
  const source = p.id.startsWith('user:') ? 'user' : 'osm';
  return {
    id: p.id,
    source,
    regionId: source === 'user' ? 'user' : str(p.regionId, 100),
    lat, lon,
    cat: p.cat,
    name: str(p.name, 120),
    localName: str(p.localName, 120),
    note: str(p.note, 200),
    hours: str(p.hours, 200),
    phone: str(p.phone, 60),
    address: str(p.address, 200),
    kind: str(p.kind, 40),
    addedAt: num(p.addedAt) ?? undefined,
  };
}

export function sanitizeRegion(r) {
  if (!r || typeof r !== 'object' || typeof r.id !== 'string' || r.id.length > 100) return null;
  const lat = num(r.lat); const lon = num(r.lon); const radius = num(r.radius);
  if (lat == null || lon == null || radius == null || radius <= 0 || radius > 50000) return null;
  return {
    id: r.id, lat, lon, radius,
    name: str(r.name, 120) || 'Imported area',
    count: Math.max(0, Math.round(num(r.count) ?? 0)),
    savedAt: num(r.savedAt) ?? Date.now(),
  };
}
