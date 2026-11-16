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
    if (url.endsWith('/planet')) return r.fulfill({ json: TILEJSON });
    return r.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) });
  });
  return seen;
}

test.beforeEach(async ({ context }) => {
  // Never hit real servers in tests.
  await context.route(/\/api\/interpreter$/, (r) => r.fulfill({ json: { elements: ELEMENTS } }));
  await context.route(/nominatim\.openstreetmap\.org\/reverse/, (r) => r.fulfill({ json: { address: { suburb: 'Godowlia' } } }));
  await context.route(/nominatim\.openstreetmap\.org\/search/, (r) => r.fulfill({ json: [{ lat: '25.3176', lon: '82.9739', name: 'Varanasi', display_name: 'Varanasi, Uttar Pradesh, India' }] }));
  await mockMap(context);
});

async function saveArea(page) {
  await page.goto('/');
  await page.getByRole('button', { name: /Save area around me/ }).click();
  await expect(page.locator('#dlStatus')).toContainText('Saved 6 places');
  await page.getByRole('button', { name: 'Nearby' }).click();
}

test('saves an area and lists places nearest first', async ({ page }) => {
  await saveArea(page);
  const names = page.locator('.place .name');
  await expect(names).toHaveCount(6);
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
  await expect(page.locator('#toast')).toContainText('Imported 1 areas and 6 places');
  await expect(page.locator('#regions')).toContainText('Godowlia');
});

test('town search offers to save that town', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Offline areas' }).click();
  await page.locator('#placeQuery').fill('Varanasi');
  await page.getByRole('button', { name: 'Find' }).click();
  await page.getByRole('button', { name: /Save this town/ }).click();
  await expect(page.locator('#dlStatus')).toContainText('Saved 6 places');
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
