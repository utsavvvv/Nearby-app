import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProStore } from '../../src/js/pro.js';

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)) };
}

function fakePlugin({ purchases = [], buyResult, buyError } = {}) {
  const calls = [];
  return {
    calls,
    async getPurchases() { calls.push('getPurchases'); return { purchases }; },
    async getProducts() { return { products: [{ identifier: 'nearby_pro', priceString: '₹79.00' }] }; },
    async purchaseProduct(o) { calls.push(['purchaseProduct', o.productIdentifier]); if (buyError) throw buyError; return buyResult; },
    async acknowledgePurchase(o) { calls.push(['ack', o.purchaseToken]); },
    async restorePurchases() { calls.push('restore'); },
  };
}

test('free limits by default, unlimited with Pro', () => {
  const pro = new ProStore({ plugin: null, storage: memoryStorage() });
  assert.equal(pro.active, false);
  assert.deepEqual(pro.limits(), { maxAreas: 2, maxRadius: 5000 });
  pro.setActive(true);
  assert.equal(pro.limits().maxAreas, Infinity);
});

test('Pro is remembered across restarts (works offline)', () => {
  const storage = memoryStorage();
  new ProStore({ plugin: null, storage }).setActive(true);
  assert.equal(new ProStore({ plugin: null, storage }).active, true);
});

test('web cannot buy', async () => {
  const pro = new ProStore({ plugin: null, storage: memoryStorage() });
  assert.equal(pro.canBuyHere, false);
  await assert.rejects(pro.buy(), /Android app/);
});

test('refresh unlocks an owned purchase and acknowledges it', async () => {
  const plugin = fakePlugin({ purchases: [{ productIdentifier: 'nearby_pro', purchaseState: '1', isAcknowledged: false, purchaseToken: 't1' }] });
  const pro = new ProStore({ plugin, storage: memoryStorage() });
  const changes = [];
  pro.onChange((a) => changes.push(a));
  assert.equal(await pro.refresh(), true);
  assert.deepEqual(changes, [true]);
  assert.deepEqual(plugin.calls.find((c) => c[0] === 'ack'), ['ack', 't1']);
});

test('refresh removes Pro after a refund', async () => {
  const storage = memoryStorage();
  new ProStore({ plugin: null, storage }).setActive(true);
  const pro = new ProStore({ plugin: fakePlugin({ purchases: [] }), storage });
  assert.equal(await pro.refresh(), false);
});

test('refresh keeps the saved state when Play is unreachable', async () => {
  const storage = memoryStorage();
  new ProStore({ plugin: null, storage }).setActive(true);
  const plugin = fakePlugin();
  plugin.getPurchases = async () => { throw new Error('offline'); };
  assert.equal(await new ProStore({ plugin, storage }).refresh(), true);
});

test('pending payments do not unlock yet', async () => {
  const pro = new ProStore({ plugin: fakePlugin({ purchases: [{ productIdentifier: 'nearby_pro', purchaseState: '0' }] }), storage: memoryStorage() });
  assert.equal(await pro.refresh(), false);
  assert.equal(pro.pending, true);
});

test('buy: success, pending and cancel', async () => {
  let pro = new ProStore({ plugin: fakePlugin({ buyResult: { purchaseState: '1', isAcknowledged: true } }), storage: memoryStorage() });
  assert.equal(await pro.buy(), 'active');
  assert.equal(pro.active, true);

  pro = new ProStore({ plugin: fakePlugin({ buyResult: { purchaseState: '0' } }), storage: memoryStorage() });
  assert.equal(await pro.buy(), 'pending');
  assert.equal(pro.active, false);

  pro = new ProStore({ plugin: fakePlugin({ buyError: new Error('User cancelled the purchase') }), storage: memoryStorage() });
  assert.equal(await pro.buy(), 'cancelled');
  assert.equal(pro.active, false);
});

test('price comes from Google Play', async () => {
  const pro = new ProStore({ plugin: fakePlugin(), storage: memoryStorage() });
  assert.equal(await pro.loadPrice(), '₹79.00');
});
