import { CATEGORIES, CATEGORY_BY_ID } from './categories.js';
import { distance, bearing, compassPoint, formatDistance, walkTime } from './geo.js';
import * as db from './db.js';
import { fetchPlaces } from './overpass.js';
import { isOpenAt } from './hours.js';
import { sanitizePlace, sanitizeRegion } from './model.js';
import { PlaceMap, webglSupported, cachedMapFileCount, clearMapCache } from './map.js';
import { isNative, openExternal, saveTextFile } from './platform.js';
import {
  DEFAULT_CENTER, NOMINATIM_TIMEOUT_MS, NOMINATIM_URL, STALE_AFTER_DAYS, SUPPORT_URL,
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
};

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
  const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}&travelmode=walking`;
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
        <button class="btn small" data-act="map">🗺️ Show on map</button>
        <button class="btn small ghost" data-act="ext" data-url="${esc(geoUrl)}">📲 Open in maps app</button>
        <button class="btn small ghost" data-act="ext" data-url="${esc(navUrl)}">↗ Directions (online)</button>
        ${p.source === 'user' ? '<button class="btn small danger" data-act="delete">Delete</button>' : ''}
      </div>
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

function renderList() {
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
        popupHtml: `<b>${esc(displayName(p))}</b><br>${esc(cat.label)}${open}${p.hours ? `<br>🕒 ${esc(p.hours)}` : ''}${p.note ? `<br>📝 ${esc(p.note)}` : ''}${dist}`,
      };
    });
  map.setMarkers(items);
}

function showView(view) {
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
    if (initMap()) setTimeout(() => { map.resize(); renderMarkers(); }, 0);
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
  if (state.download) { toast('A download is already running'); return; }
  if (!navigator.onLine) { toast('You are offline. Connect to the internet to save an area.'); return; }
  const radius = Number($('#radius').value);
  const status = $('#dlStatus');
  const ctrl = new AbortController();
  state.download = ctrl;
  setDownloading(true);
  status.textContent = `Downloading places within ${radius / 1000} km… this can take up to a minute.`;
  try {
    const id = `r:${lat.toFixed(3)},${lon.toFixed(3)},${radius}`;
    const places = await fetchPlaces(lat, lon, radius, id, { signal: ctrl.signal });
    const region = { id, lat, lon, radius, name: label || `Area at ${lat.toFixed(3)}, ${lon.toFixed(3)}`, count: places.length, savedAt: Date.now() };
    await db.saveRegion(region, places);
    await loadData();
    requestPersistentStorage();
    status.textContent = places.length
      ? `Saved ${places.length} places for offline use. ✅`
      : 'Saved, but no places were found here. Try a bigger radius, or add places yourself with ＋.';
    toast(places.length ? `Saved ${places.length} places — works offline now` : 'No places found in this area');
  } catch (err) {
    status.textContent = ctrl.signal.aborted ? 'Download cancelled.' : `Download failed: ${err.message}`;
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
  if (!navigator.onLine) { toast('Town search needs internet'); return; }
  try {
    const [hit] = await fetchJson(`${NOMINATIM_URL}/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`);
    if (!hit) { toast(`Couldn't find “${q}”`); return; }
    const label = hit.name || q;
    $('#townResult').hidden = false;
    $('#townResult').innerHTML = `<span>📍 <b>${esc(label)}</b> <span class="muted small">${esc(hit.display_name || '')}</span></span>
      <button class="btn small" id="townDl">⬇ Save this town</button>`;
    $('#townDl').onclick = () => downloadArea(Number(hit.lat), Number(hit.lon), label);
    if (map) map.setView([Number(hit.lat), Number(hit.lon)], 14);
  } catch { toast('Search failed — check your connection'); }
}

async function renderRegions() {
  const ul = $('#regions');
  const userCount = state.places.filter((p) => p.source === 'user').length;
  const staleMs = STALE_AFTER_DAYS * 86400000;
  ul.innerHTML = state.regions.length
    ? [...state.regions].sort((a, b) => b.savedAt - a.savedAt).map((r) => `<li data-id="${esc(r.id)}">
        <div><div class="r-name">${esc(r.name)}</div>
        <div class="muted small">${r.count} places · ${r.radius / 1000} km · saved ${timeAgo(r.savedAt)}${Date.now() - r.savedAt > staleMs ? ' · <b>refresh recommended</b>' : ''}</div></div>
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
    if (act === 'map') {
      const p = state.places.find((x) => x.id === id);
      showView('map');
      map?.setView([p.lat, p.lon], 18);
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
  $('#regions').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const r = state.regions.find((x) => x.id === btn.closest('li').dataset.id);
    if (!r) return;
    if (btn.dataset.act === 'del') {
      if (!window.confirm(`Delete “${r.name}” and its ${r.count} places?`)) return;
      await db.deleteRegion(r.id);
      await loadData();
    } else {
      $('#radius').value = String(r.radius);
      downloadArea(r.lat, r.lon, r.name);
    }
  });
  $('#clearTilesBtn').addEventListener('click', async () => {
    if (!window.confirm('Remove saved map pictures? Your places are kept.')) return;
    await clearMapCache();
    renderRegions();
  });

  $('#recenterBtn').addEventListener('click', () => {
    if (state.pos) map?.setView([state.pos.lat, state.pos.lon], 16);
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
  registerServiceWorker();
}

main();
