// Regenerates Android launcher icons and splash screens from src/icons/icon.svg.
// Run after changing the icon: node scripts/android-assets.mjs
import { chromium } from '@playwright/test';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const res = join(root, 'android/app/src/main/res');
const svg = await readFile(join(root, 'src/icons/icon.svg'), 'utf8');
const BG = '#0f766e';
// The icon artwork without its square background, for adaptive icons and splash screens.
const glyph = svg.replace(/<rect[^>]*\/>/, '');

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

function pngSize(buf) {
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

const browser = await chromium.launch();
const page = await browser.newPage();

async function render(path, w, h, html) {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<style>html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:transparent}
    .c{width:100%;height:100%;display:grid;place-items:center}</style>${html}`);
  await page.screenshot({ path, omitBackground: true });
}

for (const [d, k] of Object.entries(DENSITIES)) {
  const dir = join(res, `mipmap-${d}`);
  const legacy = Math.round(48 * k);
  const fg = Math.round(108 * k);
  await render(join(dir, 'ic_launcher.png'), legacy, legacy,
    `<div style="width:100%;height:100%;border-radius:18%;overflow:hidden">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div>`);
  await render(join(dir, 'ic_launcher_round.png'), legacy, legacy,
    `<div style="width:100%;height:100%;border-radius:50%;overflow:hidden">${svg.replace('<svg ', '<svg width="100%" height="100%" ')}</div>`);
  // Adaptive foreground: 108dp canvas, artwork kept inside the 66dp safe zone.
  await render(join(dir, 'ic_launcher_foreground.png'), fg, fg,
    `<div class="c"><div style="width:66%;height:66%">${glyph.replace('<svg ', '<svg width="100%" height="100%" ')}</div></div>`);
}

// Splash screens: keep each file's existing size, teal background with the icon in the middle.
for (const dir of (await readdir(res)).filter((d) => d.startsWith('drawable'))) {
  const files = (await readdir(join(res, dir))).filter((f) => f === 'splash.png');
  for (const f of files) {
    const path = join(res, dir, f);
    const { w, h } = pngSize(await readFile(path));
    const s = Math.round(Math.min(w, h) * 0.35);
    await render(path, w, h, `<div class="c" style="background:${BG}"><div style="width:${s}px;height:${s}px">${glyph.replace('<svg ', '<svg width="100%" height="100%" ')}</div></div>`);
  }
}

await browser.close();
console.log('Android icons and splash screens updated');
