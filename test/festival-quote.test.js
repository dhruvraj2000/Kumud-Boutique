'use strict';
process.env.KUMUD_DB = ':memory:';
delete process.env.MYSQL_URL;
const test = require('node:test');
const assert = require('node:assert/strict');
const fest = require('../server/festival-data');
const app = require('../server/server');

let server, base;
test.before(async () => { await new Promise(r => { server = app.listen(0, r); }); base = `http://127.0.0.1:${server.address().port}`; });
test.after(() => server.close());

const camp = (o = {}) => ({ id: 1, slug: 'diwali-2026', name: 'Diwali Sale 2026', theme: 'diwali', tagline: '', active: 1, show_popup: 1, festival_date: '2026-11-08',
  starts_at: '2020-01-01 00:00:00', ends_at: '2099-01-01 00:00:00', discount_pct: 30, min_pct: 10, max_pct: 40, rules: [], ...o });
const json = (url, body) => fetch(base + url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined).then(r => r.json());
const firstInStock = async () => (await json('/api/products')).products.find(p => p.inStock);

test('no live campaign: prices are the normal prices', async () => {
  fest.setSnapshot({ campaigns: [] });
  const p = await firstInStock();
  assert.equal(p.festivalPct, undefined);
  const cur = await json('/api/festivals/current');
  assert.deepEqual(cur.live, []);
});

test('live campaign: catalogue shows sale price with the old price struck through', async () => {
  fest.setSnapshot({ campaigns: [camp()] });
  const all = (await json('/api/products')).products;
  for (const p of all) { assert.equal(p.festivalPct, 30); assert.ok(p.compareAt >= p.price); }
  const cur = await json('/api/festivals/current');
  assert.equal(cur.live[0].name, 'Diwali Sale 2026'); assert.equal(cur.live[0].upTo, 30);
});

test('checkout charges the sale price and records it', async () => {
  fest.setSnapshot({ campaigns: [camp()] });
  const p = await firstInStock(), size = Object.keys(p.stock).find(s => p.stock[s] > 0);
  const q = await json('/api/cart/quote', { items: [{ id: p.id, size, qty: 1 }] });
  assert.equal(q.lines[0].price, p.price);                  // p.price is already the sale price from the catalogue
  assert.equal(q.subtotal, p.price);
  assert.equal(q.festivalSavings, q.originalSubtotal - q.subtotal);
  assert.ok(q.festivalSavings > 0);
});

test('expired and scheduled campaigns give no discount; deactivated ones neither', async () => {
  for (const o of [{ starts_at: '2020-01-01 00:00:00', ends_at: '2020-02-01 00:00:00' }, { starts_at: '2098-01-01 00:00:00', ends_at: '2098-02-01 00:00:00' }, { active: 0 }]) {
    fest.setSnapshot({ campaigns: [camp(o)] });
    const p = await firstInStock(); assert.equal(p.festivalPct, undefined);
  }
});

test('margin guard: sale + coupon + twinning never exceed the campaign maximum', async () => {
  // 30% sale, 40% cap -> 10% of the original bag is all a coupon may add
  fest.setSnapshot({ campaigns: [camp()], coupons: { BIG: { code: 'BIG', label: '₹50,000 off', type: 'flat', value: 50000, min_order: 0, active: 1, starts_at: null, ends_at: null, max_uses: null, used_count: 0 } } });
  const p = await firstInStock(), size = Object.keys(p.stock).find(s => p.stock[s] > 0);
  const q = await json('/api/cart/quote', { items: [{ id: p.id, size, qty: 1 }], coupon: 'BIG' });
  const totalSaved = q.originalSubtotal - q.subtotal + q.discount + q.twinning;
  assert.ok(totalSaved <= Math.floor(q.originalSubtotal * 40 / 100), `saved ${totalSaved} of ${q.originalSubtotal}`);
  assert.equal(q.discountLimited, true);
  assert.match(q.couponMessage, /maximum discount/);
});

test('expired / exhausted / inactive coupons are rejected', async () => {
  const k = (o) => ({ code: 'X', label: 'x', type: 'percent', value: 10, min_order: 0, active: 1, starts_at: null, ends_at: null, max_uses: null, used_count: 0, ...o });
  const p = await firstInStock(), size = Object.keys(p.stock).find(s => p.stock[s] > 0), items = [{ id: p.id, size, qty: 1 }];
  for (const o of [{ ends_at: '2020-01-01 00:00:00' }, { starts_at: '2098-01-01 00:00:00' }, { active: 0 }, { max_uses: 5, used_count: 5 }]) {
    fest.setSnapshot({ campaigns: [], coupons: { X: k(o) } });
    const q = await json('/api/cart/quote', { items, coupon: 'X' });
    assert.equal(q.coupon, null); assert.match(q.couponMessage, /not valid or has expired/);
  }
  fest.setSnapshot({ campaigns: [], coupons: { X: k() } });
  assert.equal((await json('/api/cart/quote', { items, coupon: 'X' })).coupon, 'X');
});

test('category rule gives a different discount, bounded by the campaign max', async () => {
  fest.setSnapshot({ campaigns: [camp({ rules: [{ scope: 'category', target: 'Kids', discount_pct: 99 }, { scope: 'category', target: 'Anarkali', discount_pct: 15 }] })] });
  const all = (await json('/api/products')).products;
  assert.equal(all.find(p => p.category === 'Anarkali').festivalPct, 15);
  const kids = all.find(p => p.category === 'Kids'); if (kids) assert.equal(kids.festivalPct, 40);
});
