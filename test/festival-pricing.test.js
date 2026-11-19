'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const f = require('../server/festival-pricing');

const camp = (o = {}) => ({ active: 1, starts_at: '2026-11-01 00:00:00', ends_at: '2026-11-10 23:59:59', discount_pct: 30, min_pct: 10, max_pct: 50, rules: [], ...o });
const at = s => f.toMs(s);

test('status follows the IST clock and the active switch', () => {
  const c = camp();
  assert.equal(f.status(c, at('2026-10-31 23:59:59')), 'scheduled');
  assert.equal(f.status(c, at('2026-11-01 00:00:00')), 'live');
  assert.equal(f.status(c, at('2026-11-10 23:59:59')), 'live');
  assert.equal(f.status(c, at('2026-11-11 00:00:00')), 'ended');
  assert.equal(f.status({ ...c, active: 0 }, at('2026-11-05 12:00:00')), 'off');
});

test('toMs treats wall-clock times as IST', () => {
  assert.equal(f.toMs('2026-11-01 00:00:00'), Date.UTC(2026, 9, 31, 18, 30));
  assert.ok(Number.isNaN(f.toMs('nonsense')));
});

test('nextCampaign picks the soonest scheduled, skipping live/off/ended', () => {
  const list = [camp({ name: 'B', starts_at: '2027-01-01 00:00:00', ends_at: '2027-01-02 00:00:00' }), camp({ name: 'A', starts_at: '2026-12-01 00:00:00', ends_at: '2026-12-02 00:00:00' }),
    camp({ name: 'Off', active: 0, starts_at: '2026-11-25 00:00:00', ends_at: '2026-11-26 00:00:00' })];
  assert.equal(f.nextCampaign(list, at('2026-11-20 10:00:00')).name, 'A');
});

test('product rule beats category rule beats campaign default', () => {
  const c = camp({ rules: [{ scope: 'category', target: 'Anarkali', discount_pct: 20 }, { scope: 'product', target: '9', discount_pct: 45 }] });
  assert.equal(f.campaignPct(c, { id: 9, category: 'Anarkali' }), 45);
  assert.equal(f.campaignPct(c, { id: 5, category: 'Anarkali' }), 20);
  assert.equal(f.campaignPct(c, { id: 1, category: 'Kids' }), 30);
});

test('discount never leaves the campaign min/max or the shop-wide cap', () => {
  const c = camp({ rules: [{ scope: 'category', target: 'Kids', discount_pct: 90 }, { scope: 'category', target: 'Lehenga Sets', discount_pct: 2 }] });
  assert.equal(f.campaignPct(c, { id: 1, category: 'Kids' }), 50);
  assert.equal(f.campaignPct(c, { id: 2, category: 'Lehenga Sets' }), 10);
  assert.equal(f.campaignPct(c, { id: 1, category: 'Kids' }, 40), 40);
});

test('bestOffer takes the biggest live discount; salePrice rounds to whole rupees', () => {
  const live = [camp({ name: 'A', discount_pct: 20 }), camp({ name: 'B', discount_pct: 35 })];
  const o = f.bestOffer(live, { id: 1, category: 'x' });
  assert.equal(o.pct, 35); assert.equal(o.campaign.name, 'B');
  assert.equal(f.bestOffer([], { id: 1, category: 'x' }).pct, 0);
  assert.equal(f.salePrice(12490, 20), 9992);
  assert.equal(f.salePrice(999, 33), 669);
});

test('capExtras keeps festival + coupon + twinning under the campaign maximum', () => {
  // bag worth 10000, 30% already given in sale prices, cap 40% -> only 1000 room left
  assert.deepEqual(f.capExtras(10000, 3000, 40, 800, 500), { coupon: 800, twinning: 200, limited: true });
  assert.deepEqual(f.capExtras(10000, 3000, 40, 1500, 500), { coupon: 1000, twinning: 0, limited: true });
  assert.deepEqual(f.capExtras(10000, 3000, 40, 300, 200), { coupon: 300, twinning: 200, limited: false });
  assert.deepEqual(f.capExtras(10000, 4000, 40, 300, 0), { coupon: 0, twinning: 0, limited: true });
  assert.deepEqual(f.capExtras(10000, 0, null, 999, 999), { coupon: 999, twinning: 999, limited: false });
});

test('validateCampaign rejects unsafe or inconsistent campaigns', () => {
  const ok = { name: 'Diwali Sale', discount_pct: 30, min_pct: 10, max_pct: 50, starts_at: '2026-11-01', ends_at: '2026-11-10' };
  assert.equal(f.validateCampaign(ok, 70), '');
  assert.match(f.validateCampaign({ ...ok, name: ' ' }), /name/);
  assert.match(f.validateCampaign({ ...ok, max_pct: 80 }, 70), /cap of 70%/);
  assert.match(f.validateCampaign({ ...ok, min_pct: 60 }, 90), /minimum/);
  assert.match(f.validateCampaign({ ...ok, discount_pct: 5 }, 70), /between/);
  assert.match(f.validateCampaign({ ...ok, discount_pct: 12.5 }, 70), /whole numbers/);
  assert.match(f.validateCampaign({ ...ok, ends_at: '2026-10-30' }, 70), /after the start/);
  assert.match(f.validateCampaign({ ...ok, starts_at: 'x' }, 70), /valid/);
});

test('upTo reports the highest real discount across products', () => {
  const c = camp({ rules: [{ scope: 'category', target: 'Kids', discount_pct: 45 }] });
  assert.equal(f.upTo(c, [{ id: 1, category: 'Kids' }, { id: 2, category: 'Anarkali' }]), 45);
  assert.equal(f.upTo(c, []), 30);
});
