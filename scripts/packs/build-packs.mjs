// Builds the city packs in packs/ from Overture Maps Places.
// Usage: node scripts/packs/build-packs.mjs [cityId ...]
// Needs Python 3 with pyarrow (pip install pyarrow). Set PYTHON to choose the interpreter.
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PACKS, overtureToPlace } from '../../src/js/packs.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const out = join(root, 'packs');
const tmp = join(root, '.packs-tmp');
const wanted = process.argv.slice(2);
const cities = wanted.length ? PACKS.filter((p) => wanted.includes(p.id)) : PACKS;

await rm(tmp, { recursive: true, force: true });
await mkdir(tmp, { recursive: true });
await mkdir(out, { recursive: true });
await writeFile(join(tmp, 'cities.json'), JSON.stringify(cities));

const py = spawnSync(process.env.PYTHON || 'python3', [join(root, 'scripts/packs/fetch_overture.py'), join(tmp, 'cities.json'), tmp], { stdio: 'inherit' });
if (py.status !== 0) process.exit(py.status || 1);

const index = { app: 'nearby-packs', version: 1, builtAt: new Date().toISOString(), packs: [] };
let existing = {};
try { existing = Object.fromEntries(JSON.parse(await readFile(join(out, 'index.json'), 'utf8')).packs.map((p) => [p.id, p])); } catch { /* first build */ }

for (const city of cities) {
  const { release, rows } = JSON.parse(await readFile(join(tmp, `${city.id}.json`), 'utf8'));
  const seen = new Set();
  const places = rows.map((r) => overtureToPlace(r)).filter((p) => p && !seen.has(p.id) && seen.add(p.id));
  const counts = {};
  for (const p of places) counts[p.cat] = (counts[p.cat] || 0) + 1;
  const pack = {
    app: 'nearby-pack', version: 1, id: city.id, name: city.name, state: city.state,
    lat: city.lat, lon: city.lon, radius: city.radius, builtAt: new Date().toISOString(),
    source: `Overture Maps Places ${release}`,
    license: 'CDLA-Permissive-2.0 (Overture Maps Foundation). See https://docs.overturemaps.org/attribution/',
    places,
  };
  const body = JSON.stringify(pack);
  await writeFile(join(out, `${city.id}.json`), body);
  existing[city.id] = { id: city.id, name: city.name, count: places.length, bytes: body.length, counts, release, builtAt: pack.builtAt };
  console.log(`${city.id}: ${rows.length} Overture places -> ${places.length} in pack (${Math.round(body.length / 1024)} KB)`, counts);
}

index.packs = PACKS.map((p) => existing[p.id]).filter(Boolean);
await writeFile(join(out, 'index.json'), JSON.stringify(index, null, 2));
await rm(tmp, { recursive: true, force: true });
console.log('Packs written to packs/');
