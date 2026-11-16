import { CATEGORIES, CATEGORY_BY_ID } from './categories.js';
import { distance, bearing, compassPoint, formatDistance, walkTime } from './geo.js';
import * as db from './db.js';
import { fetchPlaces } from './overpass.js';

const $ = (sel) => document.querySelector(sel);
const MAX_LIST = 150;
const MAX_MARKERS = 400;

const state = {
  places: [],
  regions: [],
  pos: loadLastPos(), // {lat, lon, acc, ts, manual}
  heading: null, // degrees from north, from the compass
  cat: 'all',
  query: '',
  view: 'list',
  openId: null,
};

// ---------- utilities ----------
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, ms);
}
function loadLastPos() {
  try { return JSON.parse(localStorage.getItem('lastPos')) || null; } catch { return null; }
}
function saveLastPos() {
  try { localStorage.setItem('lastPos', JSON.stringify(state.pos)); } catch { /* storage blocked */ }
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
  return `${Math.round(s / 86400)} days ago`;
}

// ---------- online / offline ----------
function updateNet() {
  const pill = $('#netStatus');
  pill.textContent = navigator.onLine ? 'Online' : 'Offline';
  pill.classList.toggle('offline', !navigator.onLine);
}
window.addEventListener('online', updateNet);
window.addEventListener('offline', updateNet);

// ---------- location ----------
function updateLocStatus(msg) {
  if (msg) { $('#locStatus').textContent = msg; return; }
  const p = state.pos;
  if (!p) { $('#locStatus').textContent = 'Location unknown — turn on GPS'; return; }
  const acc = p.manual ? 'set manually' : `±${Math.round(p.acc)} m`;
  $('#locStatus').textContent = `📡 ${p.lat.toFixed(4)}, ${p.lon.toFixed(4)} · ${acc} · ${timeAgo(p.ts)}`;
}

function startGps() {
  if (!('geolocation' in navigator)) { updateLocStatus('GPS not available on this device'); return; }
  navigator.geolocation.watchPosition(
    (g) => {
      const prev = state.pos;
      state.pos = { lat: g.coords.latitude, lon: g.coords.longitude, acc: g.coords.accuracy, ts: Date.now() };
      saveLastPos();
      updateLocStatus();
      // Only re-render the list if we moved noticeably, to keep scrolling smooth.
      if (!prev || prev.manual || distance(prev.lat, prev.lon, state.pos.lat, state.pos.lon) > 8) render();
      updateMeMarker();
    },
    (err) => {
      const why = err.code === 1 ? 'Location permission denied' : 'Waiting for GPS signal…';
      updateLocStatus(state.pos ? `${why} · using last known spot` : why);
    },
    { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 },
  );
  setInterval(() => { if (state.pos) updateLocStatus(); }, 30000);
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

async function enableCompass() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') { toast('Compass permission denied'); return; }
    }
  } catch { toast('Compass not available'); return; }
  if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrientation);
  else window.addEventListener('deviceorientation', onOrientation);
  $('#compassBtn').classList.add('on');
  try { localStorage.setItem('compass', '1'); } catch { /* ignore */ }
  setTimeout(() => {
    if (state.heading == null) toast('No compass reading yet — arrows point relative to north.');
    else toast('Compass on — arrows point where to walk.');
  }, 1500);
}

let arrowFrame = 0;
function scheduleArrowUpdate() {
  if (arrowFrame) return;
  arrowFrame = requestAnimationFrame(() => {
    arrowFrame = 0;
    const h = state.heading ?? 0;
    document.querySelectorAll('[data-bearing]').forEach((el) => {
      el.style.transform = `rotate(${(Number(el.dataset.bearing) - h + 360) % 360}deg)`;
    });
  });
}

// ---------- filtering ----------
function filteredPlaces() {
  const q = state.query.trim().toLowerCase();
  const origin = state.pos;
  let out = state.places.filter((p) => {
    if (state.cat !== 'all' && p.cat !== state.cat) return false;
    if (!q) return true;
    const cat = CATEGORY_BY_ID[p.cat];
    return [p.name, p.localName, p.kind, p.note, p.address, cat.label].some((s) => s && s.toLowerCase().includes(q));
  });
  if (origin) {
    out = out.map((p) => ({ ...p, d: distance(origin.lat, origin.lon, p.lat, p.lon), b: bearing(origin.lat, origin.lon, p.lat, p.lon) }));
    out.sort((a, b) => a.d - b.d);
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
    return `<button class="chip ${state.cat === c.id ? 'active' : ''}" data-cat="${c.id}">${c.icon} ${esc(c.label)}${n ? `<span class="count">${n}</span>` : ''}</button>`;
  }).join('');
}

function placeItem(p) {
  const cat = CATEGORY_BY_ID[p.cat];
  const hasPos = p.d != null;
  const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lon}&travelmode=walking`;
  const geoUrl = `geo:${p.lat},${p.lon}?q=${p.lat},${p.lon}(${encodeURIComponent(displayName(p))})`;
  const metaBits = [cat.label, p.kind && !cat.label.toLowerCase().includes(p.kind) ? p.kind : '', p.hours ? `🕒 ${p.hours}` : ''].filter(Boolean);
  return `<li class="place ${state.openId === p.id ? 'open' : ''}" data-id="${esc(p.id)}">
    <div class="ico" style="background:${cat.color}22">${cat.icon}</div>
    <div>
      <div class="name">${esc(displayName(p))}${p.source === 'user' ? '<span class="tag-user">added by you</span>' : ''}</div>
      <div class="meta">${esc(metaBits.join(' · '))}</div>
    </div>
    <div class="dist">${hasPos
      ? `<span class="arrow" data-bearing="${p.b.toFixed(1)}" style="transform:rotate(${((p.b - (state.heading ?? 0) + 360) % 360).toFixed(1)}deg)"><svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M12 2l7 19-7-4-7 4z" fill="currentColor"/></svg></span><b>${formatDistance(p.d)}</b><span class="meta">${compassPoint(p.b)}</span>`
      : '<span class="meta">—</span>'}</div>
    <div class="details">
      ${p.localName ? `<p>🔤 ${esc(p.localName)}</p>` : ''}
      ${p.address ? `<p>🏠 ${esc(p.address)}</p>` : ''}
      ${p.note ? `<p>📝 ${esc(p.note)}</p>` : ''}
      ${p.phone ? `<p>📞 <a href="tel:${esc(p.phone.replace(/[^+\d]/g, ''))}">${esc(p.phone)}</a></p>` : ''}
      ${hasPos ? `<p>🚶 ${walkTime(p.d)} · head ${compassPoint(p.b)} (${Math.round(p.b)}°)</p>` : ''}
      <p class="muted small">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</p>
      <div class="btn-row">
        <button class="btn small" data-act="map">🗺️ Show on map</button>
        <a class="btn small ghost" href="${geoUrl}">📲 Open in maps app</a>
        <a class="btn small ghost" href="${navUrl}" target="_blank" rel="noopener">↗ Directions (online)</a>
        ${p.source === 'user' ? '<button class="btn small danger" data-act="delete">Delete</button>' : ''}
      </div>
    </div>
  </li>`;
}

function renderBanner() {
  const b = $('#banner');
  if (!state.places.length) {
    b.hidden = false;
    b.innerHTML = navigator.onLine
      ? '<b>No places saved yet.</b><br>Save the area around you now so it works later without internet.<br><button class="btn small" id="bannerDl">⬇ Save area around me</button>'
      : '<b>No places saved yet.</b><br>Connect to the internet once to save an area, or tap ＋ to add places you find.';
    return;
  }
  if (!state.pos) {
    b.hidden = false;
    b.innerHTML = 'Waiting for your location. Turn on GPS, or go to the Map tab and tap “Set my location here”.';
    return;
  }
  const inside = state.regions.some((r) => distance(r.lat, r.lon, state.pos.lat, state.pos.lon) <= r.radius);
  if (!inside && state.regions.length) {
    b.hidden = false;
    b.innerHTML = `You are outside your saved areas, so nearby results may be missing.${navigator.onLine ? '<br><button class="btn small" id="bannerDl">⬇ Save this area too</button>' : ''}`;
    return;
  }
  b.hidden = true;
}

function renderList() {
  const items = filteredPlaces();
  const shown = items.slice(0, MAX_LIST);
  $('#list').innerHTML = shown.map(placeItem).join('')
    || (state.places.length ? '<li class="muted center">Nothing matches. Try another category or search.</li>' : '');
  const more = $('#listMore');
  more.hidden = items.length <= MAX_LIST;
  more.textContent = `Showing the nearest ${MAX_LIST} of ${items.length}. Pick a category or search to narrow down.`;
  scheduleArrowUpdate();
}

function render() {
  renderChips();
  renderBanner();
  renderList();
  if (state.view === 'map') renderMarkers();
}

// ---------- map ----------
let map; let markerLayer; let meMarker; let accCircle;
function initMap() {
  if (map) return;
  const start = state.pos ? [state.pos.lat, state.pos.lon] : (state.regions[0] ? [state.regions[0].lat, state.regions[0].lon] : [22.5726, 88.3639]);
  map = L.map('map', { zoomControl: true }).setView(start, state.pos ? 16 : 13);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
  map.on('moveend', renderMarkers);
  updateMeMarker();
}

function updateMeMarker() {
  if (!map || !state.pos) return;
  const ll = [state.pos.lat, state.pos.lon];
  if (!meMarker) {
    meMarker = L.marker(ll, { icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18] }), zIndexOffset: 1000 }).addTo(map);
    accCircle = L.circle(ll, { radius: state.pos.acc || 0, weight: 1, fillOpacity: 0.08 }).addTo(map);
  } else {
    meMarker.setLatLng(ll);
    accCircle.setLatLng(ll).setRadius(state.pos.manual ? 0 : state.pos.acc || 0);
  }
}

function renderMarkers() {
  if (!map) return;
  markerLayer.clearLayers();
  const c = map.getCenter();
  const bounds = map.getBounds().pad(0.2);
  const items = filteredPlaces()
    .filter((p) => bounds.contains([p.lat, p.lon]))
    .map((p) => ({ p, dc: distance(c.lat, c.lng, p.lat, p.lon) }))
    .sort((a, b) => a.dc - b.dc)
    .slice(0, MAX_MARKERS);
  for (const { p } of items) {
    const cat = CATEGORY_BY_ID[p.cat];
    const icon = L.divIcon({ className: '', html: `<div class="pin" style="background:${cat.color}"><span>${cat.icon}</span></div>`, iconSize: [30, 30], iconAnchor: [15, 30], popupAnchor: [0, -28] });
    const dist = p.d != null ? `<br>${formatDistance(p.d)} ${compassPoint(p.b)}` : '';
    L.marker([p.lat, p.lon], { icon, title: displayName(p) })
      .bindPopup(`<b>${esc(displayName(p))}</b><br>${esc(cat.label)}${p.hours ? `<br>🕒 ${esc(p.hours)}` : ''}${p.note ? `<br>📝 ${esc(p.note)}` : ''}${dist}`)
      .addTo(markerLayer);
  }
}

function showView(view) {
  state.view = view;
  document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${view}`));
  document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#chips').style.display = view === 'areas' ? 'none' : '';
  if (view === 'map') {
    initMap();
    setTimeout(() => { map.invalidateSize(); renderMarkers(); }, 0);
  }
  if (view === 'areas') renderRegions();
}

// ---------- offline areas ----------
async function downloadArea(lat, lon, label) {
  if (!navigator.onLine) { toast('You are offline. Connect to the internet to save an area.'); return; }
  const radius = Number($('#radius').value);
  const status = $('#dlStatus');
  const buttons = [$('#dlHereBtn'), $('#dlMapBtn')];
  buttons.forEach((b) => { b.disabled = true; });
  status.textContent = `Downloading places within ${radius / 1000} km… this can take up to a minute.`;
  try {
    const id = `r:${lat.toFixed(3)},${lon.toFixed(3)},${radius}`;
    const places = await fetchPlaces(lat, lon, radius, id);
    const region = { id, lat, lon, radius, name: label || `Area at ${lat.toFixed(3)}, ${lon.toFixed(3)}`, count: places.length, savedAt: Date.now() };
    await db.saveRegion(region, places);
    await loadData();
    status.textContent = `Saved ${places.length} places for offline use. ✅`;
    toast(`Saved ${places.length} places — works offline now`);
  } catch (err) {
    status.textContent = `Download failed: ${err.message}. Please try again in a moment.`;
  } finally {
    buttons.forEach((b) => { b.disabled = false; });
  }
}

async function reverseLabel(lat, lon) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${lat}&lon=${lon}`);
    const j = await res.json();
    const a = j.address || {};
    return a.suburb || a.neighbourhood || a.town || a.city || a.village || j.name || '';
  } catch { return ''; }
}

async function downloadAroundMe() {
  if (!state.pos) { toast('No location yet. Turn on GPS or set it on the map.'); return; }
  const label = await reverseLabel(state.pos.lat, state.pos.lon);
  downloadArea(state.pos.lat, state.pos.lon, label);
}

async function downloadAroundMap() {
  initMap();
  const c = map.getCenter();
  const label = await reverseLabel(c.lat, c.lng);
  downloadArea(c.lat, c.lng, label);
}

async function searchTown(e) {
  e.preventDefault();
  const q = $('#placeQuery').value.trim();
  if (!q) return;
  if (!navigator.onLine) { toast('Town search needs internet'); return; }
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`);
    const [hit] = await res.json();
    if (!hit) { toast(`Couldn't find “${q}”`); return; }
    showView('map');
    map.setView([Number(hit.lat), Number(hit.lon)], 14);
    toast('Move the map if needed, then tap “Around map centre” on the Offline areas tab.', 4500);
    setTimeout(() => showView('areas'), 2500);
  } catch { toast('Search failed — check your connection'); }
}

function renderRegions() {
  const ul = $('#regions');
  const userCount = state.places.filter((p) => p.source === 'user').length;
  ul.innerHTML = state.regions.length
    ? state.regions.sort((a, b) => b.savedAt - a.savedAt).map((r) => `<li data-id="${esc(r.id)}">
        <div><div class="r-name">${esc(r.name)}</div>
        <div class="muted small">${r.count} places · ${r.radius / 1000} km · saved ${timeAgo(r.savedAt)}</div></div>
        <div class="btn-row">
          <button class="btn small ghost" data-act="refresh" title="Download again">↻</button>
          <button class="btn small danger" data-act="del">Delete</button>
        </div></li>`).join('')
    : '<li class="muted">No areas saved yet.</li>';
  if (userCount) ul.insertAdjacentHTML('beforeend', `<li><div><div class="r-name">Added by you</div><div class="muted small">${userCount} places</div></div></li>`);
  if (navigator.storage?.estimate) {
    navigator.storage.estimate().then(({ usage }) => {
      $('#storage').textContent = `Using about ${(usage / 1048576).toFixed(1)} MB on this device (includes map tiles).`;
    });
  }
}

// ---------- add / delete user places ----------
function openAddDialog() {
  $('#addForm').reset();
  if (state.cat !== 'all') $('#addCat').value = state.cat;
  if (state.view === 'map') $('#addForm').where.value = 'map';
  $('#addDialog').showModal();
}

async function saveUserPlace(form) {
  const data = new FormData(form);
  let lat; let lon;
  if (data.get('where') === 'map') {
    initMap();
    ({ lat, lng: lon } = map.getCenter());
  } else if (state.pos) {
    ({ lat, lon } = state.pos);
  } else {
    toast('No GPS location yet — choose “Centre of the map” instead.');
    return;
  }
  const place = {
    id: `user:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    source: 'user', regionId: 'user', lat, lon,
    cat: data.get('cat'), name: data.get('name').trim(), note: data.get('note').trim(),
    kind: '', hours: '', phone: '', address: '', localName: '', addedAt: Date.now(),
  };
  await db.put('places', place);
  await loadData();
  toast(`Saved “${place.name}” on this phone`);
}

// ---------- import / export ----------
async function exportData() {
  const data = { app: 'nearby-offline', version: 1, exportedAt: new Date().toISOString(), regions: state.regions, places: state.places };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nearby-places-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'nearby-offline' || !Array.isArray(data.places)) throw new Error('not a Nearby Offline export');
    const valid = data.places.filter((p) => p && typeof p.id === 'string' && Number.isFinite(p.lat) && Number.isFinite(p.lon) && CATEGORY_BY_ID[p.cat]);
    for (const r of data.regions || []) {
      if (r && typeof r.id === 'string' && Number.isFinite(r.lat) && Number.isFinite(r.lon)) {
        await db.saveRegion(r, valid.filter((p) => p.regionId === r.id));
      }
    }
    for (const p of valid.filter((x) => x.source === 'user')) await db.put('places', p);
    await loadData();
    toast(`Imported ${valid.length} places`);
  } catch (err) {
    toast(`Import failed: ${err.message}`);
  }
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
  $('#search').addEventListener('input', (e) => { state.query = e.target.value; renderList(); if (state.view === 'map') renderMarkers(); });
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));

  $('#list').addEventListener('click', async (e) => {
    const li = e.target.closest('.place');
    if (!li) return;
    const id = li.dataset.id;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'map') {
      const p = state.places.find((x) => x.id === id);
      showView('map');
      map.setView([p.lat, p.lon], 18);
      return;
    }
    if (act === 'delete') {
      if (!confirm('Delete this place from your phone?')) return;
      await db.remove('places', id);
      await loadData();
      return;
    }
    if (e.target.closest('a')) return;
    state.openId = state.openId === id ? null : id;
    document.querySelectorAll('.place.open').forEach((el) => { if (el !== li) el.classList.remove('open'); });
    li.classList.toggle('open', state.openId === id);
  });

  $('#banner').addEventListener('click', (e) => { if (e.target.id === 'bannerDl') { showView('areas'); downloadAroundMe(); } });
  $('#compassBtn').addEventListener('click', enableCompass);
  $('#dlHereBtn').addEventListener('click', downloadAroundMe);
  $('#dlMapBtn').addEventListener('click', downloadAroundMap);
  $('#placeSearch').addEventListener('submit', searchTown);
  $('#regions').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const r = state.regions.find((x) => x.id === btn.closest('li').dataset.id);
    if (btn.dataset.act === 'del') {
      if (!confirm(`Delete “${r.name}” and its ${r.count} places?`)) return;
      await db.deleteRegion(r.id);
      await loadData();
    } else {
      $('#radius').value = String(r.radius);
      downloadArea(r.lat, r.lon, r.name);
    }
  });

  $('#recenterBtn').addEventListener('click', () => {
    if (state.pos) map.setView([state.pos.lat, state.pos.lon], 16);
    else toast('No location yet');
  });
  $('#setHereBtn').addEventListener('click', () => {
    const c = map.getCenter();
    state.pos = { lat: c.lat, lon: c.lng, acc: 0, ts: Date.now(), manual: true };
    saveLastPos();
    updateLocStatus();
    updateMeMarker();
    render();
    toast('Location set to map centre');
  });

  $('#addBtn').addEventListener('click', openAddDialog);
  $('#addDialog').addEventListener('close', () => {
    if ($('#addDialog').returnValue === 'save') saveUserPlace($('#addForm'));
  });
  $('#exportBtn').addEventListener('click', exportData);
  $('#importInput').addEventListener('change', (e) => { if (e.target.files[0]) importData(e.target.files[0]); e.target.value = ''; });
}

// ---------- start ----------
async function main() {
  $('#addCat').innerHTML = CATEGORIES.map((c) => `<option value="${c.id}">${c.icon} ${esc(c.label)}</option>`).join('');
  updateNet();
  updateLocStatus(state.pos ? undefined : 'Finding your location…');
  bindEvents();
  await loadData();
  startGps();
  try { if (localStorage.getItem('compass') === '1' && typeof DeviceOrientationEvent?.requestPermission !== 'function') enableCompass(); } catch { /* ignore */ }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { /* app still works online */ });
  }
}

main();
