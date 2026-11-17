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
];

test.use({ geolocation: HOME, permissions: ['geolocation'] });

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

test.beforeEach(async ({ context }) => {
  // Never hit real servers in tests.
  await context.route(/\/api\/interpreter$/, (r) => r.fulfill({ json: { elements: ELEMENTS } }));
  await context.route(/nominatim\.openstreetmap\.org\/reverse/, (r) => r.fulfill({ json: { address: { suburb: 'Godowlia' } } }));
  await context.route(/nominatim\.openstreetmap\.org\/search/, (r) => {
    const q = new URL(r.request().url()).searchParams.get('q').toLowerCase();
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

async function saveArea(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Save area around me/ }).click();
  await expect(page.locator('#dlStatus')).toContainText('Saved 7 places');
  await page.getByRole('button', { name: 'Nearby' }).click();
}

test('saves an area and lists places nearest first', async ({ page }) => {
  await saveArea(page);
  const names = page.locator('.place .name');
  await expect(names).toHaveCount(7);
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
  await expect(page.locator('#netStatus')).toHaveText('Offline');
  await expect(page.locator('.place .name').first()).toHaveText('Raju Pan Bhandar');

  // Adding a place works offline too.
  await page.getByRole('button', { name: 'Add a place' }).click();
  await page.locator('#addForm [name=name]').fill('Tea stall by the ghat');
  await page.locator('#addCat').selectOption('tea');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.place', { hasText: 'Tea stall by the ghat' })).toContainText('added by you');

  await page.getByRole('button', { name: 'Map' }).click();
  await expect(page.locator('.pin').first()).toBeVisible();
  await expect(page.locator('.map-fallback')).toHaveCount(0);
});

test('map shows places and keeps map data for offline use', async ({ page, context }) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await saveArea(page);
  await page.getByRole('button', { name: 'Map' }).click();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  // Street zoom: only places in view get markers.
  await expect(page.locator('.pin-btn[aria-label="Raju Pan Bhandar"]')).toBeVisible();
  await expect(page.locator('.pin-btn[aria-label="SBI ATM"]')).toHaveCount(0);
  await expect(page.locator('.me-dot')).toBeVisible();

  // Map files are cached, with the weekly version stripped from tile keys.
  await expect.poll(async () => page.evaluate(async () => (await (await caches.open('nearby-map')).keys()).map((r) => r.url)))
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
  await page.getByRole('button', { name: 'Map' }).click();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect(page.locator('.pin-btn[aria-label="Raju Pan Bhandar"]')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.querySelector('.maplibregl-canvas')?.width > 0)).toBe(true);
  expect(errors).toEqual([]);
});

test('export and import round-trip', async ({ page }) => {
  await saveArea(page);
  await page.getByRole('button', { name: 'Offline areas' }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export' }).click()]);
  const file = await download.path();

  page.once('dialog', (d) => d.accept());
  await page.locator('#regions [data-act=del]').click();
  await expect(page.locator('#regions')).toContainText('No areas saved yet');

  await page.locator('#importInput').setInputFiles(file);
  await expect(page.locator('#toast')).toContainText('Imported 1 areas and 7 places');
  await expect(page.locator('#regions')).toContainText('Godowlia');
});

test('town search offers to save that town', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Offline areas' }).click();
  await page.locator('#placeQuery').fill('Varanasi');
  await page.getByRole('button', { name: 'Find' }).click();
  await expect(page.locator('#townResult')).not.toContainText('Looking for');
  await page.locator('.town-list').getByRole('button', { name: /Save/ }).first().click();
  await expect(page.locator('#dlStatus')).toContainText('Saved 7 places');
  await expect(page.locator('#regions')).toContainText('Varanasi');
});

test('privacy policy is reachable', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Offline areas' }).click();
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
  await expect(page.locator('#hotelCard')).toContainText('Looking for a room in Godowlia?');
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
  await page.getByRole('button', { name: 'Offline areas' }).click();
  await expect(page.locator('#proCard')).toContainText('Get Pro in the Android app');

  // Bigger radius needs Pro.
  await page.locator('#radius').selectOption('10000');
  await expect(page.locator('#proDialog')).toBeVisible();
  await expect(page.locator('#proReason')).toContainText('up to 5 km');
  await page.getByRole('button', { name: 'Not now' }).click();
  await expect(page.locator('#radius')).toHaveValue('5000');

  // Two areas are free; the third asks for Pro.
  await page.getByRole('button', { name: /Around me/ }).click();
  await expect(page.locator('#dlStatus')).toContainText('Saved 7 places');
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
  await page.getByRole('button', { name: 'Offline areas' }).click();
  const buy = page.locator('#proCard').getByRole('button', { name: 'Get Pro · ₹79.00' });
  await expect(buy).toBeVisible();
  await expect(page.locator('#proCard')).toContainText('Restore purchase');
  await buy.click();
  await expect(page.locator('#toast')).toContainText('Pro unlocked');
  await expect(page.locator('#proBadge')).toBeVisible();
  await expect(page.locator('#proCard')).toContainText('Thank you');
  expect(await page.evaluate(() => window.__acked)).toBe(true);

  // Big areas now allowed without the Pro dialog.
  await page.locator('#radius').selectOption('20000');
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
  await page.getByRole('button', { name: 'Offline areas' }).click();
  await page.locator('#radius').selectOption('10000');
  await page.locator('#proDialogBuy').click();
  await expect(page.locator('#toast')).toContainText('installed from Google Play');
  await expect(page.locator('#toast')).not.toContainText('No product found');
  expect(await page.evaluate(() => window.__bought)).toBeUndefined();
});

test('typing "school" explains categories and lists nearest towns first', async ({ page }) => {
  const requests = [];
  page.on('request', (r) => { if (r.url().includes('nominatim.openstreetmap.org/search')) requests.push(new URL(r.url())); });
  await page.goto('/');
  await page.getByRole('button', { name: 'Offline areas' }).click();
  await page.locator('#placeQuery').fill('School');
  await page.getByRole('button', { name: 'Find' }).click();

  const hint = page.locator('.town-hint');
  await expect(hint).toContainText('Looking for schools & colleges?');
  await expect(page.locator('.town-list li')).toHaveCount(2);
  await expect(page.locator('.town-list li').first()).toContainText('Ghazipur'); // nearest first
  await expect(page.locator('.town-list li').last()).toContainText('South Korea');
  await expect(page.locator('.town-list li').last()).toContainText('km away');

  // Search asks for towns, biased to where the user is.
  expect(requests[0].searchParams.get('featureType')).toBe('settlement');
  expect(requests[0].searchParams.get('viewbox')).toBeTruthy();

  // The hint button jumps to the category on the Nearby tab.
  await hint.getByRole('button', { name: /Schools & Colleges/ }).click();
  await expect(page.locator('#view-list')).toBeVisible();
  await expect(page.locator('.chip[data-cat=education]')).toHaveAttribute('aria-pressed', 'true');
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
  await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#134e48');

  // The map uses the dark street style.
  await page.getByRole('button', { name: 'Map' }).click();
  await expect(page.locator('.maplibregl-canvas')).toBeVisible();
  await expect.poll(() => styles.includes('dark')).toBe(true);

  // The choice is remembered, with no flash of light colours on reload.
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

  // Picker in Offline areas; "System" follows the phone.
  await page.getByRole('button', { name: 'Offline areas' }).click();
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
