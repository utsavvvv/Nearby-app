import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const HOME = { latitude: 25.3176, longitude: 82.9739 };

const ELEMENTS = [
  { type: 'node', id: 1, lat: 25.3180, lon: 82.9740, tags: { shop: 'tobacco', name: 'Raju Pan Bhandar', opening_hours: '24/7' } },
  { type: 'node', id: 2, lat: 25.3150, lon: 82.9760, tags: { shop: 'convenience', name: 'Gupta General Store', opening_hours: 'Mo-Su 00:00-00:01' } },
  { type: 'way', id: 3, center: { lat: 25.3200, lon: 82.9700 }, tags: { amenity: 'pharmacy', name: 'Apollo Pharmacy', phone: '+91 542 000 0000' } },
  { type: 'node', id: 4, lat: 25.3176, lon: 82.9800, tags: { amenity: 'atm', name: 'SBI ATM' } },
  { type: 'node', id: 5, lat: 25.3100, lon: 82.9739, tags: { shop: 'kiosk' } },
  { type: 'node', id: 6, lat: 25.3190, lon: 82.9745, tags: { amenity: 'cafe', name: 'Chai Point' } },
  { type: 'node', id: 7, lat: 25.3190, lon: 82.9745, tags: { amenity: 'bench' } },
  { type: 'node', id: 8, lat: 25.3300, lon: 82.9900, tags: { tourism: 'hotel', name: 'Hotel Ganges View' } },
  { type: 'node', id: 9, lat: 25.3220, lon: 82.9760, tags: { amenity: 'school', name: 'Central Hindu School' } },
];

test.use({ geolocation: HOME, permissions: ['geolocation'] });

// A street grid around the test location (every ~200 m), for offline routes.
const ROADS = (() => {
  const els = [];
  const rows = 21; const cols = 21;
  const id = (r, c) => 1 + r * cols + c;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) els.push({ type: 'node', id: id(r, c), lat: 25.30 + r * 0.002, lon: 82.96 + c * 0.002 });
  let w = 1;
  for (let r = 0; r < rows; r++) els.push({ type: 'way', id: w++, nodes: Array.from({ length: cols }, (_, c) => id(r, c)), tags: { highway: 'residential' } });
  for (let c = 0; c < cols; c++) els.push({ type: 'way', id: w++, nodes: Array.from({ length: rows }, (_, r) => id(r, c)), tags: { highway: 'residential' } });
  return els;
})();

// A tiny stand-in for the OpenFreeMap style, tile index and tiles.
const MAP_STYLE = {
  version: 8,
  sources: { openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' } },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#f2efe9' } },
    { id: 'water', type: 'fill', source: 'openmaptiles', 'source-layer': 'water', paint: { 'fill-color': '#9ec7f3' } },
  ],
};
const TILEJSON = { tilejson: '3.0.0', tiles: ['https://tiles.openfreemap.org/planet/20261110_001001_pt/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 };

async function mockMap(context) {
  const seen = [];
  await context.route(/tiles\.openfreemap\.org/, (r) => {
    const url = r.request().url();
    seen.push(url);
    if (url.endsWith('/styles/liberty')) return r.fulfill({ json: MAP_STYLE });
    if (url.endsWith('/styles/dark')) return r.fulfill({ json: { ...MAP_STYLE, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#111111' } }] } });
    if (url.endsWith('/planet')) return r.fulfill({ json: TILEJSON });
    return r.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) });
  });
  return seen;
}

test.beforeEach(async ({ context }, testInfo) => {
  // Skip the first-run onboarding, except in the test about it.
  if (!testInfo.title.includes('onboarding')) await context.addInitScript(() => localStorage.setItem('onboarded', 'true'));
  // Never hit real servers in tests.
  await context.route(/\/api\/interpreter$/, (r) => r.fulfill({ json: { elements: decodeURIComponent(r.request().postData() || '').includes('"highway"') ? ROADS : ELEMENTS } }));
  await context.route(/routing\.openstreetmap\.de/, (r) => r.fulfill({ json: {
    code: 'Ok', routes: [{ distance: 999, duration: 600, geometry: { type: 'LineString', coordinates: [[82.9739, 25.3176], [82.98, 25.32], [82.99, 25.33]] } }],
  } }));
  await context.route(/nominatim\.openstreetmap\.org\/reverse/, (r) => r.fulfill({ json: { address: { suburb: 'Godowlia', country_code: 'in' } } }));
  await context.route(/nominatim\.openstreetmap\.org\/search/, (r) => {
    const params = new URL(r.request().url()).searchParams;
    const q = params.get('q').toLowerCase();
    if (q === 'paris') {
      return r.fulfill({ json: params.get('countrycodes') ? [] : [{ lat: '48.8566', lon: '2.3522', name: 'Paris', display_name: 'Paris, Île-de-France, France' }] });
    }
    if (q === 'school') {
      // Like the real service: a far-away place literally named "School", and one nearby.
      return r.fulfill({ json: [
        { lat: '35.1796', lon: '129.0756', name: 'School', display_name: 'School, Soemi-ro, Busan, 47856, South Korea' },
        { lat: '25.6000', lon: '83.1000', name: 'School', display_name: 'School, Ghazipur, Uttar Pradesh, India' },
      ] });
    }
    return r.fulfill({ json: [{ lat: '25.3176', lon: '82.9739', name: 'Varanasi', display_name: 'Varanasi, Uttar Pradesh, India' }] });
  });
  await mockMap(context);
  await context.route(/^https:\/\/(www\.booking\.com|play\.google\.com)\//, (r) => r.fulfill({ contentType: 'text/html', body: '<h1>partner</h1>' }));
});

/** Count pixels of the route's blue (#3d5afe) in a screenshot of the map. */
async function routeBluePixels(page) {
  const png = (await page.locator('#map').screenshot()).toString('base64');
  return page.evaluate(async (b64) => {
    const img = new Image();
    img.src = `data:image/png;base64,${b64}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - 61) < 20 && Math.abs(d[i + 1] - 90) < 20 && Math.abs(d[i + 2] - 254) < 20) n++;
    return n;
  }, png);
}

async function saveArea(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Download my area now/i }).click();
  await expect(page.locator('#dlStatus')).toContainText('Saved 8 places, roads and the map');
  await page.getByRole('button', { name: 'Nearby' }).click();
}

test('saves an area and lists places nearest first', async ({ page }) => {
  await saveArea(page);
  const names = page.locator('.place .name');
  await expect(names).toHaveCount(8);
  await expect(names.first()).toHaveText('Raju Pan Bhandar');
  await expect(page.locator('.place').first()).toContainText('Open now');
  await expect(page.locator('.place', { hasText: 'Gupta' })).toContainText('Closed');

  await page.locator('.place-main').first().click();
  await expect(page.locator('.place.open')).toContainText('min walk');

  await page.locator('.chip[data-cat=pan]').click();
  await expect(names).toHaveText(['Raju Pan Bhandar', 'Unnamed kiosk']);

  await page.locator('.chip[data-cat=all]').click();
  await page.locator('#hideClosed').check();
  await expect(page.locator('.place', { hasText: 'Gupta' })).toHaveCount(0);

  await page.locator('#hideClosed').uncheck();
  await page.locator('#search').fill('apollo');
  await expect(names).toHaveText(['Apollo Pharmacy']);
});

test('works fully offline after the first visit', async ({ page, context }) => {
  await saveArea(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // let the service worker control the page

  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('#netStatus')).toContainText('offline');
  await expect(page.locator('.place .name').first()).toHaveText('Raju Pan Bhandar');

  // Adding a place works offline too.
  await page.getByRole('button', { name: 'Add a place' }).click();
  await page.locator('#addForm [name=name]').fill('Tea stall by the ghat');
  await page.locator('#addCat input[value=tea]').check();
  await page.getByRole('button', { name: /Save offline pin/i }).click();
  await expect(page.locator('.place', { hasText: 'Tea stall by the ghat' })).toContainText('added by you');

  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.locator('.pin').first()).toBeVisible();
  await expect(page.locator('.map-fallback')).toHaveCount(0);
});

test('map shows places and keeps map data for offline use', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await saveArea(page);
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  // Street zoom: only places in view get markers.
  await expect(page.locator('.pin-btn[aria-label="Raju Pan Bhandar"]')).toBeVisible();
  await expect(page.locator('.pin-btn[aria-label="SBI ATM"]')).toHaveCount(0);
  await expect(page.locator('.me-dot')).toBeVisible();

  // Map files are cached, with the weekly version stripped from tile keys.
  await expect.poll(async () => page.evaluate(async () => {
    const urls = [];
    for (const name of ['nearby-map', 'nearby-map-areas']) urls.push(...(await (await caches.open(name)).keys()).map((r) => r.url));
    return urls;
  }))
    .toEqual(expect.arrayContaining(['https://tiles.openfreemap.org/styles/liberty', expect.stringMatching(/\/planet\/\d+\/\d+\/\d+\.pbf$/)]));

  // Tapping a marker shows its details.
  await page.locator('.pin-btn[aria-label="Raju Pan Bhandar"]').click();
  await expect(page.locator('.maplibregl-popup')).toContainText('Open now');

  // Offline: the map still loads from the cache.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await context.unroute(/tiles\.openfreemap\.org/);
  await context.route(/tiles\.openfreemap\.org/, (r) => r.abort('internetdisconnected'));
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect(page.locator('.pin-btn[aria-label="Raju Pan Bhandar"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.querySelector('.maplibregl-canvas')?.width > 0)).toBe(true);
  expect(errors).toEqual([]);
});

test('export and import round-trip', async ({ page }) => {
  await saveArea(page);
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).click()]);
  const file = await download.path();

  page.once('dialog', (d) => d.accept());
  await page.locator('#regions [data-act=del]').click();
  await expect(page.locator('#regions')).toContainText('No areas saved yet');

  await page.locator('#importInput').setInputFiles(file);
  await expect(page.locator('#toast')).toContainText('Imported 1 areas and 8 places');
  await expect(page.locator('#regions')).toContainText('Godowlia');
});

test('town search offers to save that town', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await page.locator('#placeQuery').fill('Varanasi');
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.locator('#townResult')).not.toContainText('Looking for');
  await page.locator('.town-list').getByRole('button', { name: /Save/ }).first().click();
  await expect(page.locator('#dlStatus')).toContainText('Saved 8 places, roads and the map');
  await expect(page.locator('#regions')).toContainText('Varanasi');
});

test('privacy policy is reachable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await page.getByRole('link', { name: 'Privacy policy' }).click();
  await expect(page.getByRole('heading', { name: 'Privacy Policy' })).toBeVisible();
});

test('offers an update when a new version is deployed', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect(page.locator('#updateBar')).toBeHidden();

  // Simulate a new release by changing the built service worker's cache version.
  const swPath = new URL('../../dist/sw.js', import.meta.url);
  const original = await readFile(swPath, 'utf8');
  await writeFile(swPath, original.replace(/const VERSION = "[^"]+"/, 'const VERSION = "test-next"'));
  try {
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await expect(page.locator('#updateBar')).toBeVisible();
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Update' }).click()]);
    await expect(page.locator('#updateBar')).toBeHidden();
    expect(await page.evaluate(() => caches.keys())).toContain('nearby-shell-test-next');
  } finally {
    await writeFile(swPath, original);
  }
});

test('hotels link to Booking.com with a commission notice', async ({ page, context }) => {
  await saveArea(page);
  await page.locator('.chip[data-cat=stay]').click();
  await expect(page.locator('#hotelCard')).toContainText('looking for a room in Godowlia?');
  await page.locator('.place-main', { hasText: 'Hotel Ganges View' }).click();
  const partner = page.locator('.place.open .partner');
  await expect(partner).toContainText('may earn a commission');

  const [popup] = await Promise.all([context.waitForEvent('page'), partner.getByRole('button', { name: /Check prices/ }).click()]);
  await popup.waitForLoadState();
  const url = new URL(popup.url());
  expect(url.host).toBe('www.booking.com');
  expect(url.searchParams.get('ss')).toBe('Hotel Ganges View, Godowlia');

  // No booking buttons offline.
  await context.setOffline(true);
  await page.locator('.chip[data-cat=all]').click();
  await page.locator('.chip[data-cat=stay]').click();
  await expect(page.locator('#hotelCard')).toBeHidden();
});

test('free version limits areas and radius, Pro dialog explains', async ({ page, context }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await expect(page.locator('#proCard')).toContainText('Get Pro in the Android app');

  // Bigger radius needs Pro.
  await page.locator('#radiusTiles [data-radius="10000"]').click();
  await expect(page.locator('#proDialog')).toBeVisible();
  await expect(page.locator('#proReason')).toContainText('up to 5 km');
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.locator('#radius')).toHaveValue('5000');

  // Two areas are free; the third asks for Pro.
  await page.getByRole('button', { name: /Around me/ }).click();
  await expect(page.locator('#dlStatus')).toContainText('Saved 8 places, roads and the map');
  await context.setGeolocation({ latitude: 25.4, longitude: 82.9 });
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Around me/ }).click();
  await expect(page.locator('#regions li')).toHaveCount(2);
  await context.setGeolocation({ latitude: 25.5, longitude: 82.8 });
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: /Around me/ }).click();
  await expect(page.locator('#proReason')).toContainText('keeps 2 saved areas');

  // On the web, "Get Pro" goes to the Play Store listing.
  const [popup] = await Promise.all([context.waitForEvent('page'), page.locator('#proDialogBuy').click()]);
  await popup.waitForLoadState();
  expect(popup.url()).toContain('play.google.com/store/apps/details?id=app.nearbyoffline.travel');
});

test('Android app: buying Pro through Google Play unlocks it', async ({ page }) => {
  // Pretend to be the Android app with a fake Google Play Billing plugin.
  await page.addInitScript(() => {
    // The fake "Google Play" remembers purchases across reloads, like the real one.
    const owned = JSON.parse(sessionStorage.getItem('fakePlay') || '[]');
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        App: { addListener() {} },
        NativePurchases: {
          async getPurchases() { return { purchases: owned }; },
          async getProducts() { return { products: [{ identifier: 'nearby_pro', priceString: '₹79.00' }] }; },
          async purchaseProduct() {
            const tx = { productIdentifier: 'nearby_pro', purchaseState: '1', isAcknowledged: false, purchaseToken: 'tok' };
            owned.push(tx);
            sessionStorage.setItem('fakePlay', JSON.stringify(owned));
            return tx;
          },
          async acknowledgePurchase() { window.__acked = true; },
          async restorePurchases() {},
        },
      },
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  const buy = page.locator('#proCard').getByRole('button', { name: /Get Pro · ₹79\.00/ });
  await expect(buy).toBeVisible();
  await expect(page.locator('#proCard')).toContainText('Restore purchase');
  await buy.click();
  await expect(page.locator('#toast')).toContainText('Pro unlocked');
  await expect(page.locator('#proBadge')).toBeVisible();
  await expect(page.locator('#proCard')).toContainText('Thank you');
  expect(await page.evaluate(() => window.__acked)).toBe(true);

  // Big areas now allowed without the Pro dialog.
  await page.locator('#radiusTiles [data-radius="20000"]').click();
  await expect(page.locator('#proDialog')).toBeHidden();
  await expect(page.locator('#radius')).toHaveValue('20000');

  // Still Pro after restarting the app.
  await page.reload();
  await expect(page.locator('#proBadge')).toBeVisible();
});

test('Android app without a Play product explains instead of erroring', async ({ page }) => {
  await page.addInitScript(() => {
    window.Capacitor = {
      isNativePlatform: () => true,
      Plugins: {
        App: { addListener() {} },
        NativePurchases: {
          async getPurchases() { return { purchases: [] }; },
          async getProducts() { throw new Error('No product found'); },
          async purchaseProduct() { window.__bought = true; throw new Error('No product found'); },
          async restorePurchases() {},
        },
      },
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await page.locator('#radiusTiles [data-radius="10000"]').click();
  await page.locator('#proDialogBuy').click();
  await expect(page.locator('#toast')).toContainText('installed from Google Play');
  await expect(page.locator('#toast')).not.toContainText('No product found');
  expect(await page.evaluate(() => window.__bought)).toBeUndefined();
});

test('typing "school" finds schools near me, not towns abroad', async ({ page }) => {
  const townSearches = [];
  page.on('request', (r) => { if (r.url().includes('nominatim.openstreetmap.org/search')) townSearches.push(r.url()); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await page.locator('#placeQuery').fill('School');
  await page.getByRole('button', { name: 'Find' }).click();

  // It saves the area around the user and opens the Schools category.
  await expect(page.locator('#view-list')).toBeVisible();
  await expect(page.locator('.chip[data-cat=education]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.place .name')).toHaveText(['Central Hindu School']);
  expect(townSearches).toEqual([]); // never looked for towns called "School"

  // Second time: area already saved, goes straight to the list.
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await page.locator('#placeQuery').fill('ATM');
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.locator('.chip[data-cat=atm]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.place .name')).toHaveText(['SBI ATM']);
});

test('town search stays in my country unless asked', async ({ page }) => {
  const searches = [];
  page.on('request', (r) => { if (r.url().includes('nominatim.openstreetmap.org/search')) searches.push(new URL(r.url())); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await page.locator('#placeQuery').fill('Paris');
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.locator('#townResult')).toContainText('No town called “Paris” found in India');
  expect(searches[0].searchParams.get('countrycodes')).toBe('in');

  await page.getByRole('button', { name: 'Search outside India' }).click();
  await expect(page.locator('.town-list li')).toContainText('France');
});

test('map opens on my current location', async ({ page, context }) => {
  const meIsCentred = () => page.evaluate(() => {
    const m = document.querySelector('#map').getBoundingClientRect();
    const d = document.querySelector('.me-dot')?.getBoundingClientRect();
    if (!d || !d.width) return false;
    return Math.abs(d.x + d.width / 2 - (m.x + m.width / 2)) < 20 && Math.abs(d.y + d.height / 2 - (m.y + m.height / 2)) < 20;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect.poll(meIsCentred).toBe(true);

  // Move somewhere else while on another tab; opening the map again centres on the new spot.
  await page.getByRole('button', { name: 'Nearby' }).click();
  await context.setGeolocation({ latitude: 25.36, longitude: 83.02 });
  await expect(page.locator('#locStatus')).toContainText('25.3600');
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect.poll(meIsCentred).toBe(true);

  // "Show on map" for a place centres on that place instead.
  await saveArea(page);
  await page.locator('.place-main').first().click();
  await page.locator('.place.open [data-act=map]').click();
  await expect.poll(meIsCentred).toBe(false);
});

test('light, dark and system appearance', async ({ page }) => {
  const styles = [];
  page.on('request', (r) => { if (r.url().includes('/styles/')) styles.push(r.url().split('/').pop()); });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('/');
  const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const lightBg = await bg();

  // Header button cycles System -> Light -> Dark.
  await page.locator('#themeBtn').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.locator('#themeBtn').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await bg()).not.toBe(lightBg);
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#14130f');

  // The street map itself stays light in dark mode.
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect.poll(() => styles.includes('liberty')).toBe(true);
  expect(styles).not.toContain('dark');

  // The choice is remembered, with no flash of light colours on reload.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Picker in Offline areas; "System" follows the phone.
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await page.getByRole('radio', { name: /System/ }).click();
  await expect(page.getByRole('radio', { name: /System/ })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);
  expect(await bg()).toBe(lightBg);
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(await bg()).not.toBe(lightBg);

  // "Light" wins even when the phone is in dark mode.
  await page.getByRole('radio', { name: /Light/ }).click();
  expect(await bg()).toBe(lightBg);
});

test('route to a place: shortest path on saved roads, offline', async ({ page, context }) => {
  await saveArea(page);
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await expect(page.locator('#regions')).toContainText('routes ✓');
  await page.getByRole('button', { name: 'Nearby' }).click();

  await context.setOffline(true);
  await page.locator('.place-main', { hasText: 'Hotel Ganges View' }).click();
  await page.locator('.place.open').getByRole('button', { name: /route/i }).click();

  const panel = page.locator('#routePanel');
  await expect(page.locator('#view-map')).toBeVisible();
  await expect(panel).toContainText('Hotel Ganges View');
  await expect(panel).toContainText('Shortest route on saved roads · works offline');
  // Along the grid (1.4 km north + 1.6 km east) it is longer than the straight line (~2.1 km).
  await expect(panel.locator('.route-sum')).toContainText(/3\.0 km/);
  const walk = await panel.locator('.route-sum').textContent();
  // The blue route line is really drawn on the map.
  await expect.poll(() => routeBluePixels(page), { timeout: 10000 }).toBeGreaterThan(500);

  // Driving: same roads, shorter time.
  await panel.getByRole('radio', { name: /Drive/ }).click();
  await expect(panel.getByRole('radio', { name: /Drive/ })).toHaveAttribute('aria-checked', 'true');
  await expect(panel.locator('.route-sum')).not.toHaveText(walk);

  await panel.getByRole('button', { name: 'Close route' }).click();
  await expect(panel).toBeHidden();
  await expect.poll(() => routeBluePixels(page)).toBeLessThan(50);
});

/** Put an area saved by an older version (places, no roads) into storage. */
async function addOldArea(page) {
  await page.evaluate(async () => {
    const db = await new Promise((res) => { const q = indexedDB.open('nearby-app', 2); q.onsuccess = () => res(q.result); });
    const tx = db.transaction(['regions', 'places'], 'readwrite');
    tx.objectStore('regions').put({ id: 'old', lat: 25.3176, lon: 82.9739, radius: 5000, name: 'Old area', count: 1, savedAt: Date.now() });
    tx.objectStore('places').put({ id: 'osm:node/1', source: 'osm', regionId: 'old', lat: 25.33, lon: 82.99, cat: 'pan', name: 'Far Pan Shop' });
    await new Promise((res) => { tx.oncomplete = res; });
  });
}

test('areas saved before roads existed get roads automatically', async ({ page }) => {
  await page.goto('/');
  await addOldArea(page);
  await page.reload();
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await expect(page.locator('#regions')).toContainText('routes ✓', { timeout: 15000 });
  await expect(page.locator('#regions')).toContainText('map ✓', { timeout: 15000 });
  await expect(page.locator('#toast')).toContainText('now work offline');
});

test('route saves the roads it needs when online, then works offline', async ({ page, context }) => {
  await page.goto('/');
  await addOldArea(page);
  await page.reload();
  await page.locator('.place-main').first().click();
  await page.locator('.place.open').getByRole('button', { name: /route/i }).click();
  await expect(page.locator('#routePanel')).toContainText('Shortest route on saved roads · works offline');
  await expect(page.locator('#routePanel .route-sum')).toContainText('3.0 km');

  // Same route with no internet: still follows the roads.
  await page.getByRole('button', { name: 'Close route' }).click();
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Nearby' }).click();
  await page.locator('.place.open').getByRole('button', { name: /route/i }).click();
  await expect(page.locator('#routePanel')).toContainText('works offline');
  await expect.poll(() => routeBluePixels(page), { timeout: 10000 }).toBeGreaterThan(500);
});

test('if roads cannot be downloaded: online routing service, then a straight line', async ({ page, context }) => {
  // The road server fails (e.g. busy), places still load.
  await context.route(/\/api\/interpreter$/, (r) => (decodeURIComponent(r.request().postData() || '').includes('"highway"')
    ? r.fulfill({ status: 504, body: 'busy' }) : r.fulfill({ json: { elements: ELEMENTS } })));
  await page.goto('/');
  await addOldArea(page);
  await page.reload();
  await page.locator('.place-main').first().click();
  await page.locator('.place.open').getByRole('button', { name: /route/i }).click();
  await expect(page.locator('#routePanel')).toContainText('Route from the online routing service');
  await expect(page.locator('#routePanel .route-sum')).toContainText('10 min');

  await page.getByRole('button', { name: 'Nearby' }).click();
  await context.setOffline(true);
  await page.locator('.place.open').getByRole('button', { name: /route/i }).click();
  await expect(page.locator('#routePanel')).toContainText('Open this route once while online');
});

test('route button in a map marker popup', async ({ page }) => {
  await saveArea(page);
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await page.locator('.pin-btn[aria-label="Raju Pan Bhandar"]').click();
  await page.locator('.maplibregl-popup').getByRole('button', { name: /route/i }).click();
  await expect(page.locator('#routePanel')).toContainText('Raju Pan Bhandar');
  await expect(page.locator('#routePanel')).toContainText('works offline');
});

test('a too-big road download is retried with a smaller area', async ({ page, context }) => {
  const radii = [];
  await context.route(/\/api\/interpreter$/, (r) => {
    const q = decodeURIComponent(r.request().postData() || '');
    if (!q.includes('"highway"')) return r.fulfill({ json: { elements: ELEMENTS } });
    radii.push(Number(q.match(/around:(\d+)/)[1]));
    // The server gives up on the full 5 km area (like a busy server on a dense city).
    return radii.length <= 3 ? r.fulfill({ json: { elements: [], remark: 'runtime error: Query timed out' } }) : r.fulfill({ json: { elements: ROADS } });
  });
  await saveArea(page);
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await expect(page.locator('#regions')).toContainText('routes ✓');
  // 3 failed tries at 5 km (one per server), then 2.5 km works.
  expect(radii).toEqual([5000, 5000, 5000, 2500]);
});

test('saving an area stores its map at every zoom level, so zooming works offline', async ({ page, context }) => {
  await saveArea(page);
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  await expect(page.locator('#regions')).toContainText('map ✓');
  const zooms = await page.evaluate(async () => {
    const keys = (await (await caches.open('nearby-map-areas')).keys()).map((r) => r.url);
    const z = {};
    for (const k of keys) { const m = k.match(/\/planet\/(\d+)\/\d+\/\d+\.pbf$/); if (m) z[m[1]] = (z[m[1]] || 0) + 1; }
    return z;
  });
  // Every zoom from 0 to 14 (the most detailed; closer zooms reuse 14), with more tiles as it gets closer.
  expect(Object.keys(zooms).map(Number).sort((a, b) => a - b)).toEqual([...Array(15).keys()]);
  expect(zooms[14]).toBeGreaterThanOrEqual(16);

  // Offline, zoomed right in: every tile the map asks for is already saved.
  const missing = [];
  await context.unroute(/tiles\.openfreemap\.org/);
  await context.route(/tiles\.openfreemap\.org/, (r) => { missing.push(r.request().url()); return r.abort('internetdisconnected'); });
  await context.setOffline(true);
  await page.getByRole('button', { name: 'Map', exact: true }).click();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await page.locator('.maplibregl-ctrl-zoom-in').click();
  await page.locator('.maplibregl-ctrl-zoom-in').click();
  await page.waitForTimeout(1500);
  expect(missing).toEqual([]);

  // Deleting the area removes its map files.
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  page.once('dialog', (d) => d.accept());
  await page.locator('#regions [data-act=del]').click();
  await expect.poll(() => page.evaluate(async () => (await (await caches.open('nearby-map-areas')).keys()).length)).toBe(0);
});

test('first-run onboarding: 3 slides, then never again', async ({ page }) => {
  await page.goto('/');
  const ob = page.locator('#onboarding');
  await expect(ob).toBeVisible();
  await expect(ob).toContainText('works with zero signal');
  await ob.getByRole('button', { name: /Next/ }).click();
  await expect(ob).toContainText('find pan, chai, ATMs in seconds');
  await ob.getByRole('button', { name: /Next/ }).click();
  await expect(ob).toContainText('routes that work offline');
  await ob.getByRole('button', { name: /go/ }).click();
  await expect(ob).toBeHidden();
  await page.reload();
  await expect(ob).toBeHidden();
});

test('download shows a progress bar; route sheet can start navigation', async ({ page, context }) => {
  // Slow the map download a little so the progress card is visible.
  await context.route(/tiles\.openfreemap\.org\/planet\/.+\.pbf$/, async (r) => { await new Promise((res) => setTimeout(res, 30)); return r.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) }); });
  await page.goto('/');
  await page.getByRole('button', { name: /Download my area now/i }).click();
  await expect(page.locator('#dlProgress')).toBeVisible();
  await expect(page.locator('#dlProgressLabel')).toContainText(/Saving/);
  await expect(page.locator('#dlStatus')).toContainText('Saved 8 places, roads and the map', { timeout: 30000 });
  await expect(page.locator('#dlProgress')).toBeHidden();
  await expect(page.locator('#regions')).toContainText('100% ready');

  await page.getByRole('button', { name: 'Nearby', exact: true }).click();
  await page.locator('.place-main', { hasText: 'Hotel Ganges View' }).click();
  await page.locator('.place.open').getByRole('button', { name: /route/i }).click();
  const panel = page.locator('#routePanel');
  await expect(panel.getByRole('radio', { name: /Walk \(\d+ min\)/ })).toBeVisible();
  await expect(panel.getByRole('radio', { name: /Drive \(\d+ min\)/ })).toBeVisible();
  await expect(panel).toContainText('steps');
  await expect(panel).toContainText(/Head [NESW]+/);
  await panel.getByRole('button', { name: /Start offline navigation/i }).click();
  await expect(panel).toHaveClass(/nav-mode/);
  await expect(page.locator('#toast')).toContainText('navigation on');
  await panel.getByRole('button', { name: /End navigation/i }).click();
  await expect(panel).not.toHaveClass(/nav-mode/);
});

test('Uttarakhand city packs: save one, big ones need Pro, town search suggests a pack', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Saved', exact: true }).click();
  const packs = page.locator('#packs');
  await expect(packs.locator('[data-pack]')).toHaveCount(9);
  await expect(packs.locator('[data-pack=rishikesh]')).toContainText(/\+[\d,]+ places/);
  await expect(packs.locator('[data-pack=dehradun]')).toContainText('pro');

  // Big pack on the free version: Pro dialog.
  await packs.getByRole('button', { name: 'Save Dehradun pack' }).click();
  await expect(page.locator('#proReason')).toContainText('Dehradun pack covers 10 km');
  await page.getByRole('button', { name: 'Not now' }).click();

  // Town search offers the pack.
  await page.locator('#placeQuery').fill('Rishikesh');
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.locator('#townResult')).toContainText('Rishikesh city pack');

  // Save the Rishikesh pack: OpenStreetMap places plus the real Overture extras.
  await page.locator('#townResult').getByRole('button', { name: /Save pack/ }).click();
  await expect(page.locator('#dlStatus')).toContainText(/extra from the city pack/, { timeout: 30000 });
  await expect(packs.locator('[data-pack=rishikesh]')).toContainText('saved ✓');
  await expect(page.locator('#regions')).toContainText('Rishikesh');

  // Pack places show up in the list, marked with their source.
  await page.getByRole('button', { name: 'Nearby', exact: true }).click();
  await page.locator('#search').fill('ganga');
  await page.locator('.place-main').first().click();
  await expect(page.locator('.place.open')).toContainText(/from (Overture Maps|OpenStreetMap)/);
});
