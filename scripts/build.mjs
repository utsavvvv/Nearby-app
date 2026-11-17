// Builds the deployable app into dist/:
//  - copies src/ and the MapLibre map library
//  - writes a service worker whose cache name is a content hash, so every
//    release invalidates old caches and users get the update.
import { createHash } from 'node:crypto';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const src = join(root, 'src');
// `--target=android` builds into www/ for Capacitor: no service worker (the app files are
// already on the phone) and no CSP meta tag (Capacitor injects its own inline bridge script).
const android = process.argv.includes('--target=android');
const out = join(root, android ? 'www' : 'dist');
const config = await import(new URL('../src/js/config.js', import.meta.url));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
await cp(src, out, { recursive: true, filter: (p) => !p.endsWith(`${sep}sw.js`) });

// MapLibre GL (map renderer). The main module loads its worker from the same folder.
const maplibre = join(root, 'node_modules', 'maplibre-gl', 'dist');
await mkdir(join(out, 'vendor', 'maplibre'), { recursive: true });
for (const f of ['maplibre-gl.mjs', 'maplibre-gl-worker.mjs', 'maplibre-gl.css']) await cp(join(maplibre, f), join(out, 'vendor', 'maplibre', f));
await cp(join(root, 'node_modules', 'maplibre-gl', 'LICENSE.txt'), join(out, 'vendor', 'maplibre', 'LICENSE.txt'));

async function walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.map((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)])));
  return files.flat();
}

// Stamp the app version and (web only) a Content-Security-Policy into the HTML.
const origin = (u) => new URL(u.replace(/[{}]/g, '')).origin;
const mapOrigin = origin(config.MAP_STYLE_URL);
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  `connect-src 'self' ${[...new Set([...config.OVERPASS_ENDPOINTS.map(origin), origin(config.NOMINATIM_URL), mapOrigin, origin(config.ROUTING_URL)])].join(' ')}`,
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');
const indexPath = join(out, 'index.html');
await writeFile(indexPath, (await readFile(indexPath, 'utf8'))
  .replaceAll('__APP_VERSION__', pkg.version)
  .replace('<!--CSP-->', android ? '' : `<meta http-equiv="Content-Security-Policy" content="${csp}">`));
if (!android) await writeFile(join(out, '.nojekyll'), '');

if (android) {
  console.log('Built www/ for Android');
  process.exit(0);
}

const files = (await walk(out)).map((f) => relative(out, f).split(sep).join('/')).filter((f) => !f.startsWith('.')).sort();
const hash = createHash('sha256');
for (const f of files) hash.update(f).update(await readFile(join(out, f)));
const version = `${pkg.version}-${hash.digest('hex').slice(0, 10)}`;

const sw = (await readFile(join(src, 'sw.js'), 'utf8'))
  .replace("'__VERSION__'", JSON.stringify(version))
  .replace('[/* __FILES__ */]', JSON.stringify(['./', ...files], null, 2));
await writeFile(join(out, 'sw.js'), sw);

console.log(`Built dist/ — ${files.length + 1} files, cache version ${version}`);
