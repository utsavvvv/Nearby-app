import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as db from '../../src/js/db.js';

const place = (id, regionId) => ({ id, regionId, source: 'osm', lat: 1, lon: 1, cat: 'pan', name: id });

test('save, refresh and delete regions', async () => {
  await db.saveRegion({ id: 'A', lat: 1, lon: 1, radius: 1000 }, [place('osm:node/1', 'A'), place('osm:node/2', 'A')]);
  await db.saveRegion({ id: 'B', lat: 2, lon: 2, radius: 1000 }, [place('osm:node/3', 'B')]);
  await db.put('places', { ...place('user:x', 'user'), source: 'user' });
  assert.equal((await db.getAll('places')).length, 4);

  // Refreshing A replaces its places.
  await db.saveRegion({ id: 'A', lat: 1, lon: 1, radius: 1000 }, [place('osm:node/9', 'A')]);
  const ids = (await db.getAll('places')).map((p) => p.id).sort();
  assert.deepEqual(ids, ['osm:node/3', 'osm:node/9', 'user:x']);

  await db.deleteRegion('B');
  assert.deepEqual((await db.getAll('regions')).map((r) => r.id), ['A']);
  assert.deepEqual((await db.getAll('places')).map((p) => p.id).sort(), ['osm:node/9', 'user:x']);

  await db.remove('places', 'user:x');
  assert.equal((await db.getAll('places')).length, 1);
});
