// "Nearby Pro" — a one-time Google Play purchase that removes the free limits.
// Purchases are handled by Google Play (via the @capgo/native-purchases plugin); we never see
// payment details. The result is remembered on the phone so Pro keeps working offline.
import { PRO_PRODUCT_ID, FREE_MAX_AREAS, FREE_MAX_RADIUS } from './config.js';

const KEY = 'pro';

export class ProStore {
  /**
   * @param {object} opts
   * @param {object|null} opts.plugin  NativePurchases plugin (null on the web)
   * @param {Storage|null} opts.storage localStorage-like object
   * @param {string} [opts.productId]
   */
  constructor({ plugin, storage, productId = PRO_PRODUCT_ID }) {
    this.plugin = plugin;
    this.storage = storage;
    this.productId = productId;
    this.price = '';
    this.pending = false;
    this.listeners = new Set();
    let saved = null;
    try { saved = JSON.parse(storage?.getItem(KEY) || 'null'); } catch { /* ignore */ }
    this.active = Boolean(saved?.active);
  }

  get canBuyHere() { return Boolean(this.plugin); }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  setActive(active) {
    const changed = active !== this.active;
    this.active = active;
    try { this.storage?.setItem(KEY, JSON.stringify({ active, checkedAt: Date.now() })); } catch { /* ignore */ }
    if (changed) this.listeners.forEach((fn) => fn(active));
  }

  /** Limits for the current user. */
  limits() {
    return this.active
      ? { maxAreas: Infinity, maxRadius: Infinity }
      : { maxAreas: FREE_MAX_AREAS, maxRadius: FREE_MAX_RADIUS };
  }

  /**
   * Ask Google Play what this account owns. Call at start-up and after restoring.
   * If Play can't be reached (offline), the remembered state is kept.
   */
  async refresh() {
    if (!this.plugin) return this.active;
    try {
      const { purchases = [] } = await this.plugin.getPurchases({ productType: 'inapp' });
      const mine = purchases.filter((p) => p.productIdentifier === this.productId);
      const owned = mine.find((p) => p.purchaseState === '1' || p.purchaseState === undefined);
      this.pending = !owned && mine.some((p) => p.purchaseState === '0');
      if (owned) await this.acknowledge(owned);
      this.setActive(Boolean(owned)); // refunded purchases disappear from the list
    } catch (err) {
      console.warn('Could not check purchases:', err?.message || err);
    }
    return this.active;
  }

  async loadPrice() {
    if (!this.plugin) return '';
    try {
      const { products = [] } = await this.plugin.getProducts({ productIdentifiers: [this.productId], productType: 'inapp' });
      this.price = products[0]?.priceString || '';
    } catch { this.price = ''; }
    return this.price;
  }

  /** Google Play refunds purchases that aren't acknowledged within 3 days. */
  async acknowledge(purchase) {
    if (purchase.isAcknowledged === false && purchase.purchaseToken) {
      try { await this.plugin.acknowledgePurchase({ purchaseToken: purchase.purchaseToken }); } catch { /* retried next start */ }
    }
  }

  /** @returns {'active'|'pending'|'cancelled'} */
  async buy() {
    if (!this.plugin) throw new Error('Purchases are only available in the Android app');
    let tx;
    try {
      tx = await this.plugin.purchaseProduct({ productIdentifier: this.productId, productType: 'inapp' });
    } catch (err) {
      if (/cancel/i.test(err?.message || err?.code || '')) return 'cancelled';
      throw err;
    }
    if (tx?.purchaseState === '0') { this.pending = true; return 'pending'; }
    await this.acknowledge(tx || {});
    this.pending = false;
    this.setActive(true);
    return 'active';
  }

  async restore() {
    if (!this.plugin) throw new Error('Restore is only available in the Android app');
    try { await this.plugin.restorePurchases(); } catch { /* getPurchases below is what matters */ }
    return this.refresh();
  }
}
