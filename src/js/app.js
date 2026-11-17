import { CATEGORIES, CATEGORY_BY_ID, categoryForQuery } from './categories.js';
import { distance, bearing, compassPoint, formatDistance, walkTime } from './geo.js';
import * as db from './db.js';
import { fetchPlaces, fetchRoads } from './overpass.js';
import { buildGraph, shortestPath, GRAPH_VERSION } from './graph.js';
import { fetchRoute, straightLine, formatDuration } from './routing.js';
import { isOpenAt } from './hours.js';
import { sanitizePlace, sanitizeRegion } from './model.js';
import { PlaceMap, webglSupported, cachedMapFileCount, clearMapCache, downloadAreaMap, removeAreaMap } from './map.js';
import { isNative, openExternal, saveTextFile } from './platform.js';
import { hotelUrl, areaHotelsUrl } from './hotels.js';
import { ProStore } from './pro.js';
import { getTheme, setTheme, onThemeChange } from './theme.js';
import {
  DEFAULT_CENTER, DEFAULT_COUNTRY, MAX_ROAD_RADIUS, FREE_MAX_AREAS, FREE_MAX_RADIUS, PLAY_STORE_URL, NOMINATIM_TIMEOUT_MS, NOMINATIM_URL, STALE_AFTER_DAYS, SUPPORT_URL,
} from './config.js';

const $ = (sel) => document.querySelector(sel);
const MAX_LIST = 150;
const MAX_MARKERS = 400;
const MAX_IMPORT_BYTES = 30 * 1024 * 1024;

const state = {
  places: [],
  regions: [],
  pos: loadPref('lastPos', null), // {lat, lon, acc, ts, manual}
  heading: null, // degrees from north, from the compass
  cat: 'all',
  query: '',
  hideClosed: loadPref('hideClosed', false),
  view: 'list',
  openId: null,
  download: null, // AbortController of a running download
  route: null, // { place, mode: 'walk'|'drive', result, source, from }
};

const pro = new ProStore({
  plugin: isNative ? window.Capacitor?.Plugins?.NativePurchases || null : null,
  storage: (() => { try { return window.localStorage; } catch { return null; } })(),
});

// ---------- utilities ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}
function loadPref(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; }
}
function savePref(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
}
function displayName(p) {
  if (p.name) return p.name;
  const cat = CATEGORY_BY_ID[p.cat];
  return p.kind ? `Unnamed ${p.kind}` : `Unnamed ${cat.label.toLowerCase()}`;
}
function timeAgo(ts) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  const d = Math.round(s / 86400);
  return d === 1 ? '1 day ago' : `${d} days ago`;
}
async function fetchJson(url, ms = NOMINATIM_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------- online / offline ----------
function updateNet() {
  const pill = $('#netStatus');
  pill.textContent = navigator.onLine ? 'Online' : 'Offline';
  pill.classList.toggle('offline', !navigator.onLine);
  renderBanner();
}
window.addEventListener('online', updateNet);
window.addEventListener('online', () => setTimeout(() => upgradeRoads(), 3000));
window.addEventListener('offline', updateNet);

// ---------- location ----------
function updateLocStatus(msg) {
  if (msg) { $('#locStatus').textContent = msg; return; }
  const p = state.pos;
  if (!p) { $('#locStatus').textContent = 'Location unknown — turn on GPS'; return; }
  const acc = p.manual ? 'set by you' : `±${Math.round(p.acc)} m`;
  $('#locStatus').textContent = `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)} · ${acc} · ${timeAgo(p.ts)}`;
}

let gpsWatch = null;
function startGps() {
  if (!('geolocation' in navigator)) { updateLocStatus('GPS not available on this device'); return; }
  if (gpsWatch != null) navigator.geolocation.clearWatch(gpsWatch);
  gpsWatch = navigator.geolocation.watchPosition(
    (g) => {
      const prev = state.pos;
      state.pos = { lat: g.coords.latitude, lon: g.coords.longitude, acc: g.coords.accuracy, ts: Date.now() };
      savePref('lastPos', state.pos);
      updateLocStatus();
      // Only re-render if we moved noticeably, to keep scrolling smooth.
      if (!prev || prev.manual || distance(prev.lat, prev.lon, state.pos.lat, state.pos.lon) > 8) render();
      updateMeMarker();
      // Keep the open map on the user as they walk, unless they've moved the map themselves.
      if (map && state.view === 'map' && !map.userMoved) map.setView([state.pos.lat, state.pos.lon]);
      // Re-plan the route as the user walks (online routes less often, to spare the server).
      const r = state.route;
      if (r?.from) {
        const moved = distance(r.from.lat, r.from.lon, state.pos.lat, state.pos.lon);
        if (moved > (r.source === 'online' ? 150 : 25)) updateRoute(false);
      }
    },
    (err) => {
      const why = err.code === 1 ? 'Location permission denied' : 'Waiting for GPS signal…';
      updateLocStatus(state.pos ? `${why} · using last known spot` : why);
      if (err.code === 1) renderBanner(err);
    },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 },
  );
}

// ---------- compass ----------
function onOrientation(e) {
  let h = null;
  if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading; // iOS
  else if (e.absolute && typeof e.alpha === 'number') h = 360 - e.alpha; // Android
  if (h == null) return;
  const screenAngle = (screen.orientation && screen.orientation.angle) || 0;
  state.heading = (h + screenAngle + 360) % 360;
  scheduleArrowUpdate();
}

let compassOn = false;
async function toggleCompass() {
  if (compassOn) {
    window.removeEventListener('deviceorientationabsolute', onOrientation);
    window.removeEventListener('deviceorientation', onOrientation);
    compassOn = false;
    state.heading = null;
    $('#compassBtn').classList.remove('on');
    $('#compassBtn').setAttribute('aria-pressed', 'false');
    savePref('compass', false);
    scheduleArrowUpdate();
    toast('Compass off — arrows point relative to north (top of screen).');
    return;
  }
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') { toast('Compass permission denied'); return; }
    }
  } catch { toast('Compass not available on this device'); return; }
  if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrientation);
  else window.addEventListener('deviceorientation', onOrientation);
  compassOn = true;
  $('#compassBtn').classList.add('on');
  $('#compassBtn').setAttribute('aria-pressed', 'true');
  savePref('compass', true);
  setTimeout(() => {
    if (!compassOn) return;
    toast(state.heading == null
      ? 'No compass reading — arrows point relative to north (top of screen).'
      : 'Compass on — hold the phone flat and follow the arrows.');
  }, 1500);
}

let arrowFrame = 0;
function arrowAngle(b) { return ((b - (state.heading ?? 0) + 360) % 360).toFixed(1); }
function scheduleArrowUpdate() {
  if (arrowFrame) return;
  arrowFrame = requestAnimationFrame(() => {
    arrowFrame = 0;
    document.querySelectorAll('[data-bearing]').forEach((el) => {
      el.style.transform = `rotate(${arrowAngle(Number(el.dataset.bearing))}deg)`;
    });
  });
}

// ---------- filtering ----------
function filteredPlaces() {
  const q = state.query.trim().toLowerCase();
  const origin = state.pos;
  const now = new Date();
  let out = [];
  for (const p of state.places) {
    if (state.cat !== 'all' && p.cat !== state.cat) continue;
    if (q) {
      const cat = CATEGORY_BY_ID[p.cat];
      if (![p.name, p.localName, p.kind, p.note, p.address, cat.label].some((s) => s && s.toLowerCase().includes(q))) continue;
    }
    const open = p.hours ? isOpenAt(p.hours, now) : null;
    if (state.hideClosed && open === false) continue;
    out.push({ ...p, open });
  }
  if (origin) {
    out = out.map((p) => ({ ...p, d: distance(origin.lat, origin.lon, p.lat, p.lon), b: bearing(origin.lat, origin.lon, p.lat, p.lon) }));
    out.sort((a, b) => a.d - b.d);
  } else {
    out.sort((a, b) => displayName(a).localeCompare(displayName(b)));
  }
  return out;
}

// ---------- rendering ----------
function renderChips() {
  const counts = {};
  state.places.forEach((p) => { counts[p.cat] = (counts[p.cat] || 0) + 1; });
  const chips = [{ id: 'all', label: 'All', icon: '✨' }, ...CATEGORIES.filter((c) => c.id !== 'other' || counts.other)];
  $('#chips').innerHTML = chips.map((c) => {
    const n = c.id === 'all' ? state.places.length : counts[c.id] || 0;
    const active = state.cat === c.id;
    return `<button class="chip ${active ? 'active' : ''}" data-cat="${c.id}" aria-pressed="${active}">${c.icon} ${esc(c.label)}${n ? `<span class="count">${n}</span>` : ''}</button>`;
  }).join('');
}

const ARROW_SVG = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2l7 19-7-4-7 4z" fill="currentColor"/></svg>';

function placeItem(p) {
  const cat = CATEGORY_BY_ID[p.cat];
  const hasPos = p.d != null;
  const geoUrl = `geo:${p.lat},${p.lon}?q=${p.lat},${p.lon}(${encodeURIComponent(displayName(p))})`;
  const kind = p.kind && !cat.label.toLowerCase().includes(p.kind) ? p.kind : '';
  const openBadge = p.open === true ? '<span class="badge open">Open now</span>' : p.open === false ? '<span class="badge closed">Closed</span>' : '';
  return `<li class="place ${state.openId === p.id ? 'open' : ''}" data-id="${esc(p.id)}">
    <button class="place-main" aria-expanded="${state.openId === p.id}">
      <span class="ico" style="background:${cat.color}22" aria-hidden="true">${cat.icon}</span>
      <span class="body">
        <span class="name">${esc(displayName(p))}${p.source === 'user' ? '<span class="tag-user">added by you</span>' : ''}</span>
        <span class="meta">${openBadge}${esc([cat.label, kind].filter(Boolean).join(' · '))}</span>
      </span>
      <span class="dist">${hasPos
        ? `<span class="arrow" data-bearing="${p.b.toFixed(1)}" style="transform:rotate(${arrowAngle(p.b)}deg)">${ARROW_SVG}</span><b>${formatDistance(p.d)}</b><span class="meta">${compassPoint(p.b)}</span>`
        : '<span class="meta">—</span>'}</span>
    </button>
    <div class="details">
      ${p.localName ? `<p>🔤 ${esc(p.localName)}</p>` : ''}
      ${p.hours ? `<p>🕒 ${esc(p.hours)}</p>` : ''}
      ${p.address ? `<p>🏠 ${esc(p.address)}</p>` : ''}
      ${p.note ? `<p>📝 ${esc(p.note)}</p>` : ''}
      ${p.phone ? `<p>📞 <a href="tel:${esc(p.phone.replace(/[^+\d]/g, ''))}">${esc(p.phone)}</a></p>` : ''}
      ${hasPos ? `<p>🚶 ${walkTime(p.d)} · head ${compassPoint(p.b)} (${Math.round(p.b)}°)</p>` : ''}
      <p class="muted small">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</p>
      <div class="btn-row">
        <button class="btn small" data-act="route">🧭 Route</button>
        <button class="btn small ghost" data-act="map">🗺️ Show on map</button>
        <button class="btn small ghost" data-act="ext" data-url="${esc(geoUrl)}">📲 Open in maps app</button>
        ${p.source === 'user' ? '<button class="btn small danger" data-act="delete">Delete</button>' : ''}
      </div>
      ${p.cat === 'stay' && navigator.onLine ? `<div class="partner">
        <button class="btn small partner-btn" data-act="ext" data-url="${esc(hotelUrl(p, areaNameFor(p.lat, p.lon)))}">🏨 Check prices &amp; book</button>
        <span class="muted small">Opens Booking.com. We may earn a commission, at no extra cost to you.</span>
      </div>` : ''}
    </div>
  </li>`;
}

function renderBanner(gpsError) {
  const b = $('#banner');
  if (!b) return;
  if (!state.places.length) {
    b.hidden = false;
    b.innerHTML = navigator.onLine
      ? '<b>No places saved yet.</b><br>Save the area around you now so it works later without internet.<br><button class="btn small" id="bannerDl">⬇ Save area around me</button>'
      : '<b>No places saved yet.</b><br>Connect to the internet once to save an area, or tap ＋ to add places you find.';
    return;
  }
  if (!state.pos) {
    b.hidden = false;
    b.innerHTML = gpsError
      ? 'Location permission is off. Allow location for this app in your phone settings, or open the Map tab and tap “Set my location here”.'
      : 'Waiting for your location. Turn on GPS, or open the Map tab and tap “Set my location here”.';
    return;
  }
  const inside = state.regions.some((r) => distance(r.lat, r.lon, state.pos.lat, state.pos.lon) <= r.radius);
  if (!inside && state.regions.length) {
    b.hidden = false;
    b.innerHTML = `You are outside your saved areas, so some nearby places may be missing.${navigator.onLine ? '<br><button class="btn small" id="bannerDl">⬇ Save this area too</button>' : ''}`;
    return;
  }
  b.hidden = true;
}

/** Name of the saved area that contains a point (used for hotel searches). */
function areaNameFor(lat, lon) {
  let best = null; let bestD = Infinity;
  for (const r of state.regions) {
    const d = distance(r.lat, r.lon, lat, lon);
    if (d <= r.radius && d < bestD) { best = r; bestD = d; }
  }
  return best && !best.name.startsWith('Area at ') ? best.name : '';
}

function renderHotelCard() {
  const card = $('#hotelCard');
  const here = state.pos ? areaNameFor(state.pos.lat, state.pos.lon) : '';
  card.hidden = !(state.cat === 'stay' && navigator.onLine && here);
  if (card.hidden) return;
  card.innerHTML = `<div><b>Looking for a room in ${esc(here)}?</b><br><span class="muted small">Compare prices and book online. Partner link: we may earn a commission, at no extra cost to you.</span></div>
    <button class="btn small partner-btn" data-act="ext" data-url="${esc(areaHotelsUrl(here))}">Compare hotels</button>`;
}

function renderList() {
  renderHotelCard();
  const items = filteredPlaces();
  const shown = items.slice(0, MAX_LIST);
  $('#list').innerHTML = shown.map(placeItem).join('')
    || (state.places.length ? '<li class="muted center empty">Nothing matches. Try another category or search.</li>' : '');
  const more = $('#listMore');
  more.hidden = items.length <= MAX_LIST;
  more.textContent = `Showing the nearest ${MAX_LIST} of ${items.length}. Pick a category or search to narrow down.`;
}

function render() {
  renderChips();
  renderBanner();
  renderList();
  if (state.view === 'map') renderMarkers();
}

// ---------- map ----------
let map = null; // PlaceMap, created the first time it's needed
let mapFailed = false;
function initMap() {
  if (map || mapFailed) return map;
  const start = state.pos ? [state.pos.lat, state.pos.lon] : (state.regions[0] ? [state.regions[0].lat, state.regions[0].lon] : DEFAULT_CENTER);
  try {
    if (!webglSupported()) throw new Error('WebGL not available');
    map = new PlaceMap($('#map'), { center: start, zoom: state.pos ? 16 : 13 });
    map.on('moveend', renderMarkers);
    map.on('error', (e) => console.warn('map:', e.error?.message || e));
    updateMeMarker();
  } catch (err) {
    console.error(err);
    mapFailed = true;
    $('#map').innerHTML = '<p class="map-fallback">The map cannot be shown on this device. The Nearby list, distances and compass still work.</p>';
  }
  return map;
}

/** Map centre, or the user's position if the map is unavailable. */
function mapCenter() {
  if (initMap()) return map.getCenter();
  return state.pos ? { lat: state.pos.lat, lon: state.pos.lon } : null;
}

function updateMeMarker() {
  if (!map || !state.pos) return;
  map.setMe(state.pos.lat, state.pos.lon, state.pos.manual ? 0 : state.pos.acc || 0);
}

function renderMarkers() {
  if (!map) return;
  const c = map.getCenter();
  const items = filteredPlaces()
    .filter((p) => map.contains(p.lat, p.lon))
    .map((p) => ({ p, dc: distance(c.lat, c.lon, p.lat, p.lon) }))
    .sort((a, b) => a.dc - b.dc)
    .slice(0, MAX_MARKERS)
    .map(({ p }) => {
      const cat = CATEGORY_BY_ID[p.cat];
      const dist = p.d != null ? `<br>${formatDistance(p.d)} ${compassPoint(p.b)}` : '';
      const open = p.open === true ? '<br><span class="badge open">Open now</span>' : p.open === false ? '<br><span class="badge closed">Closed</span>' : '';
      return {
        lat: p.lat, lon: p.lon, color: cat.color, icon: cat.icon, title: displayName(p),
        popupHtml: `<b>${esc(displayName(p))}</b><br>${esc(cat.label)}${open}${p.hours ? `<br>🕒 ${esc(p.hours)}` : ''}${p.note ? `<br>📝 ${esc(p.note)}` : ''}${dist}<br><button class="btn small popup-route" data-route="${esc(p.id)}">🧭 Route</button>`,
      };
    });
  map.setMarkers(items);
}

// ---------- routes ----------
let graphCache = null; // { id, g }

/** The saved road graph that covers both points, if any (loaded from storage once). */
async function graphFor(a, b) {
  const inside = (r, p) => distance(r.lat, r.lon, p.lat, p.lon) <= (r.roadRadius || 0);
  const region = [...state.regions.filter((r) => r.roads), ...loadPref('roadPatches', [])]
    .filter((r) => inside(r, a) && inside(r, b))
    .sort((x, y) => x.roadRadius - y.roadRadius)[0];
  if (!region) return null;
  if (graphCache?.id === region.id) return graphCache.g;
  const g = await db.getOne('graphs', region.id).catch(() => null);
  if (g) graphCache = { id: region.id, g };
  return g;
}

/**
 * Download roads around a point and store them as a graph under `id`.
 * Busy servers often fail on big, dense areas, so retry with a smaller circle.
 * @returns the radius actually saved (metres)
 */
async function saveRoads(id, lat, lon, radius, signal, minRadius = 1500) {
  let r = Math.min(radius, MAX_ROAD_RADIUS);
  for (;;) {
    try {
      const graph = buildGraph(await fetchRoads(lat, lon, r, { signal }));
      if (!graph.count) throw new Error('no roads found');
      await db.put('graphs', { regionId: id, ...graph });
      if (graphCache?.id === id) graphCache = null;
      return r;
    } catch (err) {
      if (signal?.aborted || r / 2 < minRadius) throw err;
      r = Math.round(r / 2);
    }
  }
}

/** Merge fields into a saved area (re-reading it, so parallel updates don't overwrite each other). */
async function updateRegion(id, patch) {
  const current = await db.getOne('regions', id);
  if (current) await db.put('regions', { ...current, ...patch });
}

async function saveRegionRoads(region, signal) {
  const roadRadius = await saveRoads(region.id, region.lat, region.lon, region.radius, signal);
  await updateRegion(region.id, { roads: true, roadRadius, roadsVersion: GRAPH_VERSION });
}

/** The street map of a saved area at every zoom level, so zooming works offline. */
async function saveRegionMap(region, signal, onProgress) {
  const mapKeys = await downloadAreaMap(region.lat, region.lon, region.radius, { signal, onProgress });
  if (mapKeys.length < 5) throw new Error('map download failed');
  await updateRegion(region.id, { mapSaved: true, mapKeys });
}

/** Areas saved before offline routes existed get their roads in the background when online. */
let upgrading = false;
const upgradeTried = new Set();
async function upgradeRoads() {
  if (upgrading || !navigator.onLine) return;
  // Also refresh roads saved in an older format (e.g. without road speeds).
  // Areas saved by older versions: add roads (or refresh old-format roads) and the full map.
  const oldRoads = (r) => !r.roads || (r.roadsVersion || 1) < GRAPH_VERSION;
  const todo = state.regions.filter((r) => (oldRoads(r) || !r.mapSaved) && !upgradeTried.has(r.id));
  if (!todo.length) return;
  upgrading = true;
  let roads = 0; let maps = 0;
  try {
    for (const r of todo) {
      upgradeTried.add(r.id);
      if (!navigator.onLine) break;
      if (oldRoads(r)) { try { await saveRegionRoads(r); roads++; } catch { /* try again next start */ } }
      if (!r.mapSaved) { try { await saveRegionMap(r); maps++; } catch { /* try again next start */ } }
    }
  } finally {
    upgrading = false;
  }
  if (roads || maps) {
    await loadData();
    const what = [roads && 'roads', maps && 'map'].filter(Boolean).join(' and ');
    toast(`Saved ${what} for your areas: routes and zooming now work offline`);
    if (state.route) updateRoute(false);
  }
}

/** Roads covering one trip (start + destination + margin), saved for offline use. */
async function saveTripRoads(from, to) {
  const lat = (from.lat + to.lat) / 2; const lon = (from.lon + to.lon) / 2;
  const radius = distance(from.lat, from.lon, to.lat, to.lon) / 2 + 1000;
  if (radius > 8000) throw new Error('trip too long');
  const id = `patch:${lat.toFixed(4)},${lon.toFixed(4)},${Math.round(radius)}`;
  const saved = await saveRoads(id, lat, lon, radius, undefined, radius);
  const patches = [{ id, lat, lon, roadRadius: saved, savedAt: Date.now() }, ...loadPref('roadPatches', []).filter((p) => p.id !== id)];
  // Keep the 15 most recent trips.
  for (const old of patches.splice(15)) db.remove('graphs', old.id).catch(() => {});
  savePref('roadPatches', patches);
}

function routePanelSpace() {
  const el = $('#routePanel');
  return el && !el.hidden ? el.offsetHeight + 24 : 40;
}

function startRoute(place) {
  if (!place) return;
  state.route = { place, mode: state.route?.mode || 'walk' };
  showView('map', { route: true });
  updateRoute(true);
}

function closeRoute() {
  state.route = null;
  map?.setRoute(null);
  $('#routePanel').hidden = true;
}

async function updateRoute(fit) {
  const r = state.route;
  if (!r || !initMap()) return;
  if (!state.pos) { renderRoutePanel('Turn on location (GPS) to get a route.'); return; }
  const from = { lat: state.pos.lat, lon: state.pos.lon };
  const to = { lat: r.place.lat, lon: r.place.lon };
  if (!r.result) renderRoutePanel('Finding the shortest route…');
  let result = null; let source = 'straight';
  let g = await graphFor(from, to);
  if (!g && navigator.onLine) {
    // No saved roads here yet: fetch them now (once) so this route also works offline later.
    renderRoutePanel('Saving the roads for this route so it works offline…');
    try { await saveTripRoads(from, to); g = await graphFor(from, to); } catch { /* use the online service below */ }
    if (state.route !== r) return;
  }
  if (g) {
    const sp = shortestPath(g, from, to, r.mode);
    if (sp) { result = { ...sp, straight: false }; source = 'offline'; }
  }
  if (!result && navigator.onLine) {
    try { result = await fetchRoute(from, to, r.mode); source = 'online'; } catch { /* fall back below */ }
  }
  if (!result) result = straightLine(from, to, r.mode);
  if (state.route !== r) return; // the user picked another place meanwhile
  Object.assign(r, { result, source, from, hadRoads: Boolean(g) });
  map.setRoute(result);
  renderRoutePanel();
  if (fit) { map.fitPoints(result.coords, routePanelSpace()); map.userMoved = true; }
}

function renderRoutePanel(message) {
  const r = state.route;
  const panel = $('#routePanel');
  if (!r) { panel.hidden = true; return; }
  const cat = CATEGORY_BY_ID[r.place.cat];
  const res = r.result;
  const notes = {
    offline: r.mode === 'drive' ? 'Fastest route on saved roads (prefers main roads) · works offline' : 'Shortest route on saved roads · works offline',
    online: 'Route from the online routing service',
    straight: r.hadRoads
      ? 'No road connection found, so this is a straight line.'
      : navigator.onLine
        ? 'Couldn\'t get a road route, so this is a straight line.'
        : 'Straight line: the roads here aren\'t saved yet. Open this route once while online and they will be saved for offline use.',
  };
  const gmaps = `https://www.google.com/maps/dir/?api=1&destination=${r.place.lat},${r.place.lon}&travelmode=${r.mode === 'drive' ? 'driving' : 'walking'}`;
  panel.hidden = false;
  panel.innerHTML = `<div class="route-head">
      <span class="route-dest">${cat.icon} <b>${esc(displayName(r.place))}</b></span>
      <button class="icon-btn route-close" data-route-act="close" aria-label="Close route">✕</button>
    </div>
    <div class="segmented route-modes" role="radiogroup" aria-label="Travel mode">
      <button role="radio" data-route-mode="walk" aria-checked="${r.mode === 'walk'}">🚶 Walk</button>
      <button role="radio" data-route-mode="drive" aria-checked="${r.mode === 'drive'}">🚗 Drive</button>
    </div>
    ${message ? `<p class="muted small">${esc(message)}</p>` : res ? `<p class="route-sum"><b>${formatDuration(res.duration)}</b> · ${formatDistance(res.distance)}</p>
      <p class="muted small route-note">${esc(notes[r.source])}</p>` : ''}
    <button class="btn small ghost" data-route-act="ext" data-url="${esc(gmaps)}">↗ Turn-by-turn in Google Maps</button>`;
}

/** Show the map centred on the user (or on a given spot), following GPS until they pan. */
function centreMap(target) {
  if (!map) return;
  map.resize();
  if (target?.route) {
    map.userMoved = true; // the route will be fitted on screen
  } else if (!target && state.route?.result) {
    map.fitPoints(state.route.result.coords, routePanelSpace());
    map.userMoved = true;
  } else if (target) {
    map.setView(target.center, target.zoom);
    map.userMoved = true; // looking at something specific: don't jump back to the user
  } else if (state.pos) {
    map.setView([state.pos.lat, state.pos.lon], Math.max(map.getZoom(), 15));
    map.userMoved = false;
  }
  renderMarkers();
}

function showView(view, mapTarget) {
  state.view = view;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  document.querySelectorAll('.tabs button').forEach((b) => {
    const on = b.dataset.view === view;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  $('#chips').hidden = view === 'areas';
  $('#addBtn').hidden = view === 'areas';
  if (view === 'map') {
    // Wait one frame so the map's container has its real size before centring.
    if (initMap()) requestAnimationFrame(() => centreMap(mapTarget));
  }
  if (view === 'areas') renderRegions();
}

// ---------- offline areas ----------
async function requestPersistentStorage() {
  try {
    if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch { /* not supported */ }
}

function setDownloading(on) {
  ['#dlHereBtn', '#dlMapBtn'].forEach((s) => { $(s).disabled = on; });
  $('#dlCancelBtn').hidden = !on;
}

async function downloadArea(lat, lon, label) {
  if (state.download) { toast('A download is already running'); return false; }
  if (!navigator.onLine) { toast('You are offline. Connect to the internet to save an area.'); return false; }
  const radius = Number($('#radius').value);
  const id = `r:${lat.toFixed(3)},${lon.toFixed(3)},${radius}`;
  const limits = pro.limits();
  if (radius > limits.maxRadius) { showPro(`Free version saves areas up to ${FREE_MAX_RADIUS / 1000} km.`); return false; }
  const isRefresh = state.regions.some((r) => r.id === id);
  if (!isRefresh && state.regions.length >= limits.maxAreas) {
    showPro(`Free version keeps ${FREE_MAX_AREAS} saved areas. Delete one, or get Pro for unlimited areas.`);
    return false;
  }
  const status = $('#dlStatus');
  const ctrl = new AbortController();
  state.download = ctrl;
  setDownloading(true);
  status.textContent = `Downloading places within ${radius / 1000} km… this can take up to a minute.`;
  try {
    const places = await fetchPlaces(lat, lon, radius, id, { signal: ctrl.signal });
    const region = { id, lat, lon, radius, name: label || `Area at ${lat.toFixed(3)}, ${lon.toFixed(3)}`, count: places.length, savedAt: Date.now() };
    await db.saveRegion(region, places);
    await loadData();
    requestPersistentStorage();
    // Roads for offline routes. If this part fails the places are still saved.
    status.textContent = `Saved ${places.length} places. Now saving roads for offline routes…`;
    let roadsNote = '';
    try {
      await saveRegionRoads(region, ctrl.signal);
    } catch (err) {
      if (ctrl.signal.aborted) throw err;
      roadsNote = ' Roads could not be saved, so routes will need internet. Try ↻ later.';
    }
    // The street map for the whole area, every zoom level.
    status.textContent = 'Saving the map for offline use… 0%';
    let mapNote = '';
    try {
      await saveRegionMap(region, ctrl.signal, (f) => { status.textContent = `Saving the map for offline use… ${Math.round(f * 100)}%`; });
    } catch (err) {
      if (ctrl.signal.aborted) throw err;
      mapNote = ' The map could not be saved fully; it will be retried when you are online.';
    }
    await loadData();
    status.textContent = (places.length
      ? `Saved ${places.length} places${roadsNote ? '' : ', roads'}${mapNote ? '' : ' and the map'} for offline use. ✅`
      : 'Saved, but no places were found here. Try a bigger radius, or add places yourself with ＋.') + roadsNote + mapNote;
    toast(places.length ? `Saved ${places.length} places — works offline now` : 'No places found in this area');
    return true;
  } catch (err) {
    status.textContent = ctrl.signal.aborted ? 'Download cancelled.' : `Download failed: ${err.message}`;
    return false;
  } finally {
    state.download = null;
    setDownloading(false);
  }
}

async function reverseLabel(lat, lon) {
  try {
    const j = await fetchJson(`${NOMINATIM_URL}/reverse?format=jsonv2&zoom=14&lat=${lat}&lon=${lon}`);
    const a = j.address || {};
    return a.suburb || a.neighbourhood || a.town || a.city || a.village || j.name || '';
  } catch { return ''; }
}

async function downloadAroundMe() {
  if (!state.pos) { toast('No location yet. Turn on GPS, or set it on the map.'); return; }
  const label = await reverseLabel(state.pos.lat, state.pos.lon);
  downloadArea(state.pos.lat, state.pos.lon, label);
}

async function downloadAroundMap() {
  const c = mapCenter();
  if (!c) { toast('Map not available. Use “Around me” instead.'); return; }
  const label = await reverseLabel(c.lat, c.lon);
  downloadArea(c.lat, c.lon, label);
}

async function searchTown(e) {
  e.preventDefault();
  const q = $('#placeQuery').value.trim();
  if (!q) return;
  const box = $('#townResult');
  box.hidden = false;
  // "school", "ATM", "chemist"... means "find these near me", not a town name.
  const cat = categoryForQuery(q);
  if (cat) { await findCategoryNearMe(cat, box); return; }
  if (!navigator.onLine) { box.innerHTML = '<p class="muted small">Town search needs internet.</p>'; return; }
  await showTowns(q, box, false);
}

/** Show places of one category around the user, saving their area first if needed. */
async function findCategoryNearMe(cat, box) {
  const { label, icon } = CATEGORY_BY_ID[cat];
  const open = () => { box.hidden = true; state.cat = cat; state.query = ''; $('#search').value = ''; showView('list'); render(); };
  if (!state.pos) {
    box.innerHTML = `<div class="town-hint">Turn on location to find ${esc(label.toLowerCase())} near you.</div>`;
    return;
  }
  const covered = state.regions.some((r) => distance(r.lat, r.lon, state.pos.lat, state.pos.lon) <= r.radius * 0.8);
  if (covered) { open(); toast(`${icon} ${label} near you`); return; }
  if (!navigator.onLine) {
    box.innerHTML = `<div class="town-hint">Your current spot isn't saved yet. Connect to the internet once to find ${esc(label.toLowerCase())} near you.</div>`;
    return;
  }
  box.innerHTML = `<div class="town-hint">Finding ${esc(label.toLowerCase())} near you…</div>`;
  const ok = await downloadArea(state.pos.lat, state.pos.lon, await reverseLabel(state.pos.lat, state.pos.lon));
  if (ok) { open(); toast(`${icon} ${label} near you`); } else box.hidden = true;
}

/** Find towns by name, in the user's country unless `worldwide`. */
async function showTowns(q, box, worldwide) {
  const cc = worldwide ? '' : await userCountry();
  const countryName = cc ? countryLabel(cc) : '';
  box.innerHTML = '<p class="muted small">Searching…</p>';
  try {
    const hits = await findTowns(q, cc);
    const rows = hits.map((h, i) => {
      const away = state.pos ? ` · ${formatDistance(distance(state.pos.lat, state.pos.lon, h.lat, h.lon))} away` : '';
      return `<li><span><b>${esc(h.name)}</b><span class="muted small"> ${esc(h.where)}${away}</span></span>
        <button class="btn small" data-town="${i}">⬇ Save</button></li>`;
    }).join('');
    const none = `<p class="muted small">No town called “${esc(q)}” found${countryName ? ` in ${esc(countryName)}` : ''}.</p>`;
    const wider = cc ? `<button class="btn small ghost" data-worldwide>Search outside ${esc(countryName)}</button>` : '';
    box.innerHTML = `${rows ? `<ul class="town-list">${rows}</ul>` : none}${wider}`;
    box.onclick = (ev) => {
      const t = ev.target.closest('[data-town]');
      if (t) { const h = hits[Number(t.dataset.town)]; downloadArea(h.lat, h.lon, h.name); }
      if (ev.target.closest('[data-worldwide]')) showTowns(q, box, true);
    };
  } catch {
    box.innerHTML = '<p class="muted small">Search failed. Check your connection.</p>';
  }
}

function countryLabel(cc) {
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(cc.toUpperCase()) || cc.toUpperCase(); } catch { return cc.toUpperCase(); }
}

/** The user's country code (e.g. "in"), looked up once from their location and remembered. */
async function userCountry() {
  const saved = loadPref('country', null);
  if (saved?.cc && (!state.pos || distance(saved.lat, saved.lon, state.pos.lat, state.pos.lon) < 200000)) return saved.cc;
  if (state.pos && navigator.onLine) {
    try {
      const j = await fetchJson(`${NOMINATIM_URL}/reverse?format=jsonv2&zoom=3&lat=${state.pos.lat}&lon=${state.pos.lon}`);
      const cc = j.address?.country_code;
      if (cc) { savePref('country', { cc, lat: state.pos.lat, lon: state.pos.lon }); return cc; }
    } catch { /* fall through */ }
  }
  return saved?.cc || DEFAULT_COUNTRY;
}

/** Towns and cities matching a name, nearest to the user first. */
async function findTowns(q, cc) {
  const params = new URLSearchParams({ format: 'jsonv2', limit: '8', q, featureType: 'settlement' });
  if (cc) params.set('countrycodes', cc);
  if (state.pos) {
    const { lat, lon } = state.pos;
    params.set('viewbox', [lon - 5, lat + 5, lon + 5, lat - 5].map((n) => n.toFixed(4)).join(','));
  }
  let hits = await fetchJson(`${NOMINATIM_URL}/search?${params}`);
  if (!hits.length) {
    // Not a town: try landmarks too (e.g. "Kedarnath Temple"), still in the same country.
    params.delete('featureType');
    hits = await fetchJson(`${NOMINATIM_URL}/search?${params}`);
  }
  const out = hits
    .map((h) => {
      const name = h.name || String(h.display_name || q).split(',')[0];
      const where = String(h.display_name || '').split(',').slice(1).map((x) => x.trim()).filter(Boolean).slice(-3).join(', ');
      return { name, where, lat: Number(h.lat), lon: Number(h.lon) };
    })
    .filter((h) => Number.isFinite(h.lat) && Number.isFinite(h.lon));
  if (state.pos) out.sort((a, b) => distance(state.pos.lat, state.pos.lon, a.lat, a.lon) - distance(state.pos.lat, state.pos.lon, b.lat, b.lon));
  return out.slice(0, 5);
}

async function renderRegions() {
  const ul = $('#regions');
  const userCount = state.places.filter((p) => p.source === 'user').length;
  const staleMs = STALE_AFTER_DAYS * 86400000;
  ul.innerHTML = state.regions.length
    ? [...state.regions].sort((a, b) => b.savedAt - a.savedAt).map((r) => `<li data-id="${esc(r.id)}">
        <div><div class="r-name">${esc(r.name)}</div>
        <div class="muted small">${r.count} places · ${r.radius / 1000} km · ${r.roads ? 'routes ✓' : 'no routes yet'} · ${r.mapSaved ? 'map ✓' : 'map not saved yet'} · saved ${timeAgo(r.savedAt)}${Date.now() - r.savedAt > staleMs ? ' · <b>refresh recommended</b>' : ''}</div></div>
        <div class="btn-row nowrap">
          <button class="btn small ghost" data-act="refresh" aria-label="Download ${esc(r.name)} again">↻</button>
          <button class="btn small danger" data-act="del">Delete</button>
        </div></li>`).join('')
    : '<li class="muted">No areas saved yet.</li>';
  if (userCount) ul.insertAdjacentHTML('beforeend', `<li><div><div class="r-name">Added by you</div><div class="muted small">${userCount} places</div></div></li>`);
  const tiles = await cachedMapFileCount();
  let usage = '';
  try {
    if (navigator.storage?.estimate) usage = ` Storage used: about ${((await navigator.storage.estimate()).usage / 1048576).toFixed(1)} MB.`;
  } catch { /* ignore */ }
  $('#storage').textContent = `${tiles} map files saved for offline viewing.${usage}`;
}

// ---------- add / delete user places ----------
function openAddDialog() {
  $('#addForm').reset();
  if (state.cat !== 'all') $('#addCat').value = state.cat;
  if (state.view === 'map' || !state.pos) $('#addForm').where.value = 'map';
  $('#addDialog').showModal();
}

async function saveUserPlace(form) {
  const data = new FormData(form);
  let lat; let lon;
  if (data.get('where') === 'map') {
    const c = mapCenter();
    if (!c) { toast('Map not available — choose “My current location”.'); return; }
    ({ lat, lon } = c);
  } else if (state.pos) {
    ({ lat, lon } = state.pos);
  } else {
    toast('No GPS location yet — choose “Centre of the map” instead.');
    return;
  }
  const place = sanitizePlace({
    id: `user:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    lat, lon,
    cat: data.get('cat'),
    name: String(data.get('name')).trim(),
    note: String(data.get('note')).trim(),
    hours: String(data.get('hours') || '').trim(),
    addedAt: Date.now(),
  });
  await db.put('places', place);
  await loadData();
  toast(`Saved “${place.name}” on this phone`);
}

// ---------- import / export ----------
async function exportData() {
  const data = { app: 'nearby-offline', version: 1, exportedAt: new Date().toISOString(), regions: state.regions, places: state.places };
  try {
    await saveTextFile(`nearby-places-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data));
  } catch (err) {
    toast(`Export failed: ${err.message}`);
  }
}

async function importData(file) {
  try {
    if (file.size > MAX_IMPORT_BYTES) throw new Error('file is too large');
    const data = JSON.parse(await file.text());
    if (data?.app !== 'nearby-offline' || !Array.isArray(data.places)) throw new Error('this is not a Nearby Offline export file');
    const places = data.places.map(sanitizePlace).filter(Boolean);
    const regions = (Array.isArray(data.regions) ? data.regions : []).map(sanitizeRegion).filter(Boolean);
    for (const r of regions) await db.saveRegion(r, places.filter((p) => p.source === 'osm' && p.regionId === r.id));
    for (const p of places.filter((x) => x.source === 'user')) await db.put('places', p);
    await loadData();
    toast(`Imported ${regions.length} areas and ${places.length} places`);
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  }
}

// ---------- app updates (service worker) ----------
let updateRequested = false;
function registerServiceWorker() {
  if (isNative || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const offer = (worker) => {
      if (!worker || !navigator.serviceWorker.controller) return; // first install: nothing to update
      $('#updateBar').hidden = false;
      $('#updateBtn').onclick = () => { updateRequested = true; worker.postMessage('SKIP_WAITING'); };
    };
    if (reg.waiting) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
    });
    // Check for a new version now and then while the app is open.
    setInterval(() => { if (navigator.onLine) reg.update().catch(() => {}); }, 60 * 60 * 1000);
  }).catch(() => { /* app still works online */ });
  // Reload only when the user chose to update (not when the first worker takes control).
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateRequested) return;
    updateRequested = false;
    window.location.reload();
  });
}

// ---------- data ----------
async function loadData() {
  [state.places, state.regions] = await Promise.all([db.getAll('places'), db.getAll('regions')]);
  render();
  if (state.view === 'areas') renderRegions();
}

// ---------- Pro ----------
function renderPro() {
  $('#proBadge').hidden = !pro.active;
  document.querySelectorAll('#radius option[data-pro]').forEach((o) => {
    o.textContent = `${Number(o.value) / 1000} km${pro.active ? '' : ' (Pro)'}${o.value === '20000' ? ' — large, slower' : ''}`;
  });
  const card = $('#proCard');
  if (pro.active) {
    card.innerHTML = '<h2>⭐ Nearby Pro</h2><p class="muted">Thank you for supporting the app! Unlimited areas and large radius are unlocked.</p>';
    return;
  }
  const buyLabel = pro.canBuyHere ? `Get Pro${pro.price ? ` · ${esc(pro.price)}` : ''}` : 'Get Pro in the Android app';
  card.innerHTML = `<h2>⭐ Nearby Pro</h2>
    <p class="muted">One-time purchase, no subscription.</p>
    <ul class="tips"><li>Unlimited saved areas: whole trips, many cities</li><li>10 km and 20 km areas</li><li>Supports development of the app</li></ul>
    ${pro.pending ? '<p class="small"><b>Payment pending.</b> Pro unlocks as soon as Google Play confirms it.</p>' : ''}
    <div class="btn-row">
      <button class="btn" data-pro="buy">${buyLabel}</button>
      ${pro.canBuyHere ? '<button class="btn ghost" data-pro="restore">Restore purchase</button>' : ''}
    </div>
    <p class="muted small">Free: ${FREE_MAX_AREAS} areas, up to ${FREE_MAX_RADIUS / 1000} km. Payments are handled by Google Play.</p>`;
}

function showPro(reason) {
  $('#proReason').textContent = reason;
  $('#proDialogBuy').textContent = pro.canBuyHere ? `Get Pro${pro.price ? ` · ${pro.price}` : ''}` : 'Get Pro in the Android app';
  $('#proDialog').showModal();
}

async function buyPro() {
  if (!pro.canBuyHere) { openExternal(PLAY_STORE_URL); return; }
  if (!navigator.onLine) { toast('Buying needs internet'); return; }
  // Google Play only sells Pro once the product exists in Play Console and the app was
  // installed from Play. Without that there's no price; explain instead of showing an error.
  if (!pro.price) await pro.loadPrice();
  if (!pro.price) { showProUnavailable(); return; }
  try {
    const result = await pro.buy();
    if (result === 'active') toast('⭐ Pro unlocked. Thank you!');
    else if (result === 'pending') toast('Payment pending. Pro unlocks when Google Play confirms it.', 5000);
  } catch (err) {
    if (/product|not found|unavailable|billing|item/i.test(err?.message || String(err))) showProUnavailable();
    else toast(`Purchase failed: ${err.message || err}`);
  }
  renderPro();
}

function showProUnavailable() {
  toast('Pro can only be bought in the app installed from Google Play. If you got the app from Play, try again later.', 6000);
}

async function restorePro() {
  if (!navigator.onLine) { toast('Restoring needs internet'); return; }
  const active = await pro.restore().catch(() => false);
  toast(active ? '⭐ Pro restored' : 'No Pro purchase found for this Google account');
  renderPro();
}

// ---------- events ----------
function bindEvents() {
  $('#chips').addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.cat = chip.dataset.cat;
    render();
    $('#view-list').scrollTop = 0;
  });
  let searchTimer;
  $('#search').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { state.query = e.target.value; renderList(); if (state.view === 'map') renderMarkers(); }, 120);
  });
  $('#hideClosed').checked = state.hideClosed;
  $('#hideClosed').addEventListener('change', (e) => { state.hideClosed = e.target.checked; savePref('hideClosed', state.hideClosed); render(); });
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

  $('#list').addEventListener('click', async (e) => {
    const li = e.target.closest('.place');
    if (!li) return;
    const id = li.dataset.id;
    const actEl = e.target.closest('[data-act]');
    const act = actEl?.dataset.act;
    if (act === 'route') { startRoute(state.places.find((x) => x.id === id)); return; }
    if (act === 'map') {
      const p = state.places.find((x) => x.id === id);
      showView('map', { center: [p.lat, p.lon], zoom: 18 });
      return;
    }
    if (act === 'ext') { openExternal(actEl.dataset.url); return; }
    if (act === 'delete') {
      if (!window.confirm('Delete this place from your phone?')) return;
      await db.remove('places', id);
      await loadData();
      return;
    }
    if (!e.target.closest('.place-main')) return;
    state.openId = state.openId === id ? null : id;
    document.querySelectorAll('.place.open').forEach((el) => {
      if (el !== li) { el.classList.remove('open'); el.querySelector('.place-main').setAttribute('aria-expanded', 'false'); }
    });
    li.classList.toggle('open', state.openId === id);
    li.querySelector('.place-main').setAttribute('aria-expanded', String(state.openId === id));
  });

  $('#banner').addEventListener('click', (e) => { if (e.target.id === 'bannerDl') { showView('areas'); downloadAroundMe(); } });
  $('#compassBtn').addEventListener('click', toggleCompass);
  $('#dlHereBtn').addEventListener('click', downloadAroundMe);
  $('#dlMapBtn').addEventListener('click', downloadAroundMap);
  $('#dlCancelBtn').addEventListener('click', () => state.download?.abort());
  $('#placeSearch').addEventListener('submit', searchTown);
  const THEMES = ['system', 'light', 'dark'];
  const THEME_LABEL = { system: 'System (follows your phone)', light: 'Light', dark: 'Dark' };
  $('#themePicker').addEventListener('click', (e) => {
    const b = e.target.closest('[data-theme-choice]');
    if (b) setTheme(b.dataset.themeChoice);
  });
  $('#themeBtn').addEventListener('click', () => {
    const next = THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length];
    setTheme(next);
    toast(`Appearance: ${THEME_LABEL[next]}`);
  });
  onThemeChange(({ theme }) => {
    document.querySelectorAll('[data-theme-choice]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.themeChoice === theme)));
    $('#themeBtn').setAttribute('aria-label', `Appearance: ${THEME_LABEL[theme]}`);
    $('#themeBtn').textContent = theme === 'system' ? '🌓' : theme === 'light' ? '☀️' : '🌙';
  });

  $('#proCard').addEventListener('click', (e) => {
    const act = e.target.closest('[data-pro]')?.dataset.pro;
    if (act === 'buy') buyPro();
    if (act === 'restore') restorePro();
  });
  $('#proDialog').addEventListener('close', () => { if ($('#proDialog').returnValue === 'buy') buyPro(); });
  $('#radius').addEventListener('change', (e) => {
    if (Number(e.target.value) > pro.limits().maxRadius) {
      e.target.value = String(FREE_MAX_RADIUS);
      showPro(`Free version saves areas up to ${FREE_MAX_RADIUS / 1000} km.`);
    }
  });
  $('#hotelCard').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act="ext"]');
    if (btn) openExternal(btn.dataset.url);
  });
  $('#regions').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const r = state.regions.find((x) => x.id === btn.closest('li').dataset.id);
    if (!r) return;
    if (btn.dataset.act === 'del') {
      if (!window.confirm(`Delete “${r.name}” and its ${r.count} places?`)) return;
      await db.deleteRegion(r.id);
      // Remove its map files, keeping any another saved area also uses.
      const keep = new Set(state.regions.filter((x) => x.id !== r.id).flatMap((x) => x.mapKeys || []));
      await removeAreaMap(r.mapKeys || [], keep);
      await loadData();
    } else {
      $('#radius').value = String(r.radius);
      downloadArea(r.lat, r.lon, r.name);
    }
  });
  $('#clearTilesBtn').addEventListener('click', async () => {
    if (!window.confirm('Remove map data you only browsed? Maps of your saved areas and your places are kept.')) return;
    await clearMapCache();
    renderRegions();
  });

  $('#routePanel').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.routeMode && state.route && b.dataset.routeMode !== state.route.mode) {
      state.route.mode = b.dataset.routeMode;
      state.route.result = null;
      updateRoute(true);
    }
    if (b.dataset.routeAct === 'close') closeRoute();
    if (b.dataset.routeAct === 'ext') openExternal(b.dataset.url);
  });
  $('#map').addEventListener('click', (e) => {
    const b = e.target.closest('[data-route]');
    if (b) startRoute(state.places.find((x) => x.id === b.dataset.route));
  });

  $('#recenterBtn').addEventListener('click', () => {
    if (state.pos) { map?.setView([state.pos.lat, state.pos.lon], 16); if (map) map.userMoved = false; }
    else toast('No location yet');
  });
  $('#setHereBtn').addEventListener('click', () => {
    if (!map) return;
    const c = map.getCenter();
    state.pos = { lat: c.lat, lon: c.lon, acc: 0, ts: Date.now(), manual: true };
    savePref('lastPos', state.pos);
    updateLocStatus();
    updateMeMarker();
    render();
    toast('Location set to the map centre. GPS will take over when it gets a fix.');
  });

  $('#addBtn').addEventListener('click', openAddDialog);
  $('#addDialog').addEventListener('close', () => {
    if ($('#addDialog').returnValue === 'save') saveUserPlace($('#addForm')).catch((err) => toast(`Could not save: ${err.message}`));
  });
  $('#exportBtn').addEventListener('click', exportData);
  $('#importInput').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });

  // In the Android app, links meant for a new tab go to the system browser instead,
  // and the back button closes dialogs / returns to the list before leaving the app.
  if (isNative) {
    window.Capacitor?.Plugins?.App?.addListener('backButton', ({ canGoBack }) => {
      const dialog = $('#addDialog');
      if (dialog.open) dialog.close('cancel');
      else if (state.view !== 'list') showView('list');
      else if (canGoBack) window.history.back();
      else window.Capacitor.Plugins.App.exitApp();
    });
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[target="_blank"]');
      if (a) { e.preventDefault(); openExternal(a.href); }
    });
  }

  // Keep "Open now" and "x min ago" fresh.
  setInterval(() => { if (state.pos) updateLocStatus(); if (state.places.some((p) => p.hours)) renderList(); }, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { updateLocStatus(); renderList(); } });
}

// ---------- start ----------
window.addEventListener('error', (e) => { console.error(e.error || e.message); toast('Something went wrong. Please try again.'); });
window.addEventListener('unhandledrejection', (e) => { console.error(e.reason); toast('Something went wrong. Please try again.'); });

async function main() {
  $('#addCat').innerHTML = CATEGORIES.map((c) => `<option value="${c.id}">${c.icon} ${esc(c.label)}</option>`).join('');
  $('#supportLink').href = SUPPORT_URL;
  updateNet();
  updateLocStatus(state.pos ? undefined : 'Finding your location…');
  bindEvents();
  try {
    await loadData();
  } catch (err) {
    console.error(err);
    $('#banner').hidden = false;
    $('#banner').textContent = 'This browser is blocking storage (private mode?), so places cannot be saved. Please open the app in a normal window.';
  }
  startGps();
  if (loadPref('compass', false) && typeof DeviceOrientationEvent?.requestPermission !== 'function') toggleCompass();
  setTimeout(() => upgradeRoads(), 4000);
  registerServiceWorker();
  pro.onChange(renderPro);
  renderPro();
  pro.refresh().then(() => pro.loadPrice()).then(renderPro);
}

main();
