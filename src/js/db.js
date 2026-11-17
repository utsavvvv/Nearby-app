// IndexedDB storage for downloaded areas and places, so everything works offline.

const DB_NAME = 'nearby-app';
const DB_VERSION = 2;
let dbPromise;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('places')) {
        const s = db.createObjectStore('places', { keyPath: 'id' });
        s.createIndex('regionId', 'regionId');
      }
      if (!db.objectStoreNames.contains('regions')) {
        db.createObjectStore('regions', { keyPath: 'id' });
      }
      // v2: road graphs for offline routes, one per saved area.
      if (!db.objectStoreNames.contains('graphs')) {
        db.createObjectStore('graphs', { keyPath: 'regionId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function reqP(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll(store) {
  const db = await open();
  return reqP(db.transaction(store).objectStore(store).getAll());
}

export async function put(store, value) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).put(value);
  return done(tx);
}

export async function remove(store, key) {
  const db = await open();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  return done(tx);
}

/** Save a downloaded region and its places in one transaction. */
export async function saveRegion(region, places) {
  const db = await open();
  const tx = db.transaction(['regions', 'places'], 'readwrite');
  const placeStore = tx.objectStore('places');
  // Drop places from a previous download of the same region (refresh).
  const old = await reqP(placeStore.index('regionId').getAllKeys(region.id));
  old.forEach((k) => placeStore.delete(k));
  tx.objectStore('regions').put(region);
  places.forEach((p) => placeStore.put(p));
  return done(tx);
}

export async function deleteRegion(regionId) {
  const db = await open();
  const tx = db.transaction(['regions', 'places'], 'readwrite');
  const placeStore = tx.objectStore('places');
  const keys = await reqP(placeStore.index('regionId').getAllKeys(regionId));
  keys.forEach((k) => placeStore.delete(k));
  tx.objectStore('regions').delete(regionId);
  await done(tx);
  await remove('graphs', regionId);
}

export async function getOne(store, key) {
  const db = await open();
  return reqP(db.transaction(store).objectStore(store).get(key));
}
