// Generates Google Play store graphics into store/:
//   store/feature-graphic.png   1024x500 feature graphic
//   store/icon-512.png          512x512 app icon
//   store/screenshots/*.png     1080x2160 phone screenshots of the real app with demo data
// Usage: npm run build && node scripts/store-assets.mjs
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdir, readFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const out = join(root, 'store');
await mkdir(join(out, 'screenshots'), { recursive: true });

const font = async (f) => (await readFile(join(root, 'dist/fonts', f))).toString('base64');
const fontCss = `
@font-face { font-family: SG; font-weight: 700; src: url(data:font/woff2;base64,${await font('space-grotesk-700.woff2')}) format('woff2'); }
@font-face { font-family: PJ; font-weight: 600; src: url(data:font/woff2;base64,${await font('plus-jakarta-sans-600.woff2')}) format('woff2'); }`;

const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

// ---------- feature graphic ----------
{
  const page = await browser.newPage({ viewport: { width: 1024, height: 500 } });
  await page.setContent(`<!doctype html><style>${fontCss}
  * { box-sizing: border-box; margin: 0; }
  body { width: 1024px; height: 500px; background: #fff8ec; font-family: PJ, sans-serif; color: #111; overflow: hidden; position: relative;
    background-image: radial-gradient(#11111122 1.4px, transparent 1.4px); background-size: 22px 22px; }
  .left { position: absolute; left: 64px; top: 70px; width: 520px; }
  h1 { font: 700 92px/0.9 SG; letter-spacing: -4px; }
  .tag { display: inline-block; margin-top: 26px; background: #ff8a1f; border: 4px solid #111; border-radius: 16px; box-shadow: 6px 6px 0 #111;
    padding: 14px 22px; font: 700 30px/1 SG; text-transform: uppercase; transform: rotate(-1.5deg); }
  .sub { margin-top: 26px; font-size: 22px; font-weight: 600; color: #3b2f26; }
  .st { position: absolute; border: 3px solid #111; border-radius: 999px; box-shadow: 3px 3px 0 #111; padding: 9px 16px; font: 700 20px/1 SG; text-transform: uppercase; }
  .card { position: absolute; width: 330px; background: #fff; border: 4px solid #111; border-radius: 26px; box-shadow: 8px 8px 0 #111; padding: 20px; }
  .row { display: flex; gap: 14px; align-items: center; }
  .ico { width: 58px; height: 58px; border: 3px solid #111; border-radius: 14px; display: grid; place-items: center; font-size: 30px; box-shadow: 2px 2px 0 #111; }
  .name { font: 700 24px/1.1 SG; }
  .meta { font-size: 15px; color: #5d4b3f; margin-top: 4px; }
  .dist { margin-left: auto; font: 700 30px/1 SG; }
  .btn { margin-top: 16px; background: #c6ff3d; border: 3px solid #111; border-radius: 14px; box-shadow: 4px 4px 0 #111; text-align: center; padding: 12px; font: 700 19px/1 SG; text-transform: uppercase; }
  .route { position: absolute; right: 26px; bottom: 30px; width: 190px; height: 110px; }
  </style>
  <div class="left">
    <h1>nearby<br>offline</h1>
    <div class="tag">no signal? no stress ⚡</div>
    <p class="sub">paan, chai, ATMs, chemists & routes, with zero internet.</p>
  </div>
  <span class="st" style="left:640px;top:40px;background:#c6ff3d;transform:rotate(-3deg)">100% offline</span>
  <span class="st" style="left:842px;top:62px;background:#ff4fa3;transform:rotate(4deg)">zero tracking</span>
  <div class="card" style="left:640px;top:110px;transform:rotate(2deg)">
    <div class="row"><span class="ico" style="background:#c6ff3d55">🌿</span><div><div class="name">Paan Corner</div><div class="meta">bas 1 min walk</div></div><span class="dist">45m</span></div>
    <div class="btn">🧭 offline route</div>
  </div>
  <div class="card" style="left:560px;top:330px;width:262px;padding:14px 16px;transform:rotate(-2deg)">
    <div class="row"><span class="ico" style="background:#ffb78377;width:46px;height:46px;font-size:24px">☕</span><div><div class="name" style="font-size:20px">Chai Tapri</div><div class="meta">open now · 2 min</div></div><span class="dist" style="font-size:24px">160m</span></div>
  </div>
  <svg class="route" viewBox="0 0 260 120" preserveAspectRatio="none"><path d="M10 110 L10 70 L120 70 L120 25 L245 25" fill="none" stroke="#111" stroke-width="16" stroke-linejoin="round" stroke-linecap="round"/><path d="M10 110 L10 70 L120 70 L120 25 L245 25" fill="none" stroke="#3d5afe" stroke-width="10" stroke-linejoin="round" stroke-linecap="round"/><path d="M10 110 L10 70 L120 70 L120 25 L245 25" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="6 8"/><circle cx="10" cy="110" r="10" fill="#1a73e8" stroke="#fff" stroke-width="4"/></svg>`);
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: join(out, 'feature-graphic.png') });
  await page.close();
}

await copyFile(join(root, 'src/icons/icon-512.png'), join(out, 'icon-512.png'));

// ---------- screenshots of the real app ----------
const port = 4190;
const server = spawn(process.execPath, [join(root, 'scripts/serve.mjs'), join(root, 'dist'), String(port)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 700));

const HOME = { latitude: 25.3176, longitude: 82.9739 };
// Demo places with generic names (not real businesses).
const DEMO = [
  [25.3180, 82.9740, { shop: 'tobacco', name: 'Paan Corner', opening_hours: '24/7' }],
  [25.3189, 82.9748, { amenity: 'cafe', name: 'Chai Tapri', opening_hours: '05:00-23:00' }],
  [25.3162, 82.9761, { shop: 'convenience', name: 'Kirana General Store', opening_hours: '08:00-22:00' }],
  [25.3196, 82.9712, { amenity: 'pharmacy', name: 'City Chemist', opening_hours: '24/7' }],
  [25.3171, 82.9783, { amenity: 'atm', name: 'Bank ATM' }],
  [25.3150, 82.9725, { amenity: 'restaurant', name: 'Dosa Dhaba', opening_hours: '07:00-22:30' }],
  [25.3205, 82.9768, { amenity: 'toilets', name: 'Public Toilet' }],
  [25.3221, 82.9752, { amenity: 'school', name: 'Ghat Road School' }],
  [25.3140, 82.9790, { tourism: 'guest_house', name: 'Riverside Guest House' }],
  [25.3233, 82.9705, { amenity: 'drinking_water', name: 'Water Point' }],
].map(([lat, lon, tags], i) => ({ type: 'node', id: i + 1, lat, lon, tags }));
const ROADS = (() => {
  const els = []; const n = 21; const id = (r, c) => 1000 + r * n + c;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) els.push({ type: 'node', id: id(r, c), lat: 25.307 + r * 0.0012, lon: 82.962 + c * 0.0012 });
  let w = 1;
  for (let r = 0; r < n; r++) els.push({ type: 'way', id: w++, nodes: Array.from({ length: n }, (_, c) => id(r, c)), tags: { highway: r % 4 ? 'residential' : 'secondary' } });
  for (let c = 0; c < n; c++) els.push({ type: 'way', id: w++, nodes: Array.from({ length: n }, (_, r) => id(r, c)), tags: { highway: c % 4 ? 'residential' : 'secondary' } });
  return els;
})();
// A simple stand-in street map style: paper ground, white roads drawn from the road data.
const STYLE = {
  version: 8,
  sources: {
    openmaptiles: { type: 'vector', url: 'https://tiles.openfreemap.org/planet' },
    roads: { type: 'geojson', data: { type: 'FeatureCollection', features: ROADS.filter((e) => e.type === 'way').map((w) => {
    const pts = w.nodes.map((nid) => ROADS.find((e) => e.id === nid)).map((p) => [p.lon, p.lat]);
    return { type: 'Feature', properties: { k: w.tags.highway }, geometry: { type: 'LineString', coordinates: pts } };
  }) } },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#f2efe6' } },
    { id: 'casing', type: 'line', source: 'roads', paint: { 'line-color': '#d9d2c3', 'line-width': ['match', ['get', 'k'], 'secondary', 14, 9] } },
    { id: 'road', type: 'line', source: 'roads', paint: { 'line-color': ['match', ['get', 'k'], 'secondary', '#ffe7a8', '#ffffff'], 'line-width': ['match', ['get', 'k'], 'secondary', 11, 6] } },
  ],
};

const ctx = await browser.newContext({
  viewport: { width: 360, height: 720 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
  geolocation: HOME, permissions: ['geolocation'], serviceWorkers: 'block',
});
await ctx.addInitScript(() => localStorage.setItem('onboarded', 'true'));
await ctx.route(/\/api\/interpreter$/, (r) => r.fulfill({ json: { elements: decodeURIComponent(r.request().postData() || '').includes('"highway"') ? ROADS : DEMO } }));
await ctx.route(/nominatim/, (r) => r.fulfill({ json: { address: { suburb: 'Godowlia', country_code: 'in' } } }));
await ctx.route(/tiles\.openfreemap\.org/, (r) => {
  const url = r.request().url();
  if (url.endsWith('/styles/liberty')) return r.fulfill({ json: STYLE });
  if (url.endsWith('/planet')) return r.fulfill({ json: { tilejson: '3.0.0', tiles: ['https://tiles.openfreemap.org/planet/demo/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14 } });
  return r.fulfill({ status: 200, contentType: 'application/x-protobuf', body: Buffer.alloc(0) });
});
const page = await ctx.newPage();
const shot = async (name, { top = true } = {}) => {
  await page.evaluate((scrollTop) => {
    document.querySelector('#toast').hidden = true;
    if (scrollTop) document.querySelectorAll('.view').forEach((v) => v.scrollTo(0, 0));
  }, top);
  await page.waitForTimeout(150);
  await page.screenshot({ path: join(out, 'screenshots', name) });
};
const wait = (ms) => page.waitForTimeout(ms);

await page.goto(`http://localhost:${port}/`);
await page.getByRole('button', { name: /Download my area now/i }).click();
await page.locator('#dlStatus').filter({ hasText: 'Saved' }).waitFor({ timeout: 30000 });
await page.getByRole('button', { name: 'Nearby', exact: true }).click();
await wait(600);
await shot('1-nearby.png');

await page.locator('.place-main').first().click();
await wait(400);
await shot('2-place.png');

await page.getByRole('button', { name: 'Map', exact: true }).click();
await wait(1500);
await shot('3-map.png', { top: false });
await page.getByRole('button', { name: 'Nearby', exact: true }).click();
await page.locator('.place-main', { hasText: 'Ghat Road School' }).click();
await page.locator('.place.open').getByRole('button', { name: /route/i }).click();
await wait(2000);
await shot('4-route.png');

await page.getByRole('button', { name: 'Close route' }).click();
await page.getByRole('button', { name: 'Saved', exact: true }).click();
await wait(500);
await shot('5-saved.png');

await page.emulateMedia({ colorScheme: 'dark' });
await page.getByRole('button', { name: 'Nearby', exact: true }).click();
await page.locator('.place-main').first().click();
await wait(400);
await shot('6-dark.png');

await browser.close();
server.kill();
console.log('Store assets written to store/');
