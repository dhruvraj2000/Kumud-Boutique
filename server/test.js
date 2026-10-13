'use strict';
// End-to-end API test: registers, shops, checks out, tracks, cancels, and exercises the admin flow.
process.env.KUMUD_DB = ':memory:';
const assert = require('assert');
const app = require('./server');
let base;
const jar = {};
const call = async (method, url, body, who = 'a') => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: jar[who] || '' }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  if (sc) jar[who] = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
  const j = await r.json().catch(() => ({}));
  return { s: r.status, j };
};
let passed = 0;
const t = async (name, fn) => {
  try { await fn(); passed++; console.log('  ok  ', name); } catch (e) { console.error('  FAIL', name, '\n      ', e.message); process.exitCode = 1; }
};
const addr = { name: 'Asha Verma', phone: '9876543210', line1: '12 MG Road, Indiranagar', city: 'Bengaluru', state: 'Karnataka', pincode: '560038' };

const srv = app.listen(0, async () => {
  base = 'http://127.0.0.1:' + srv.address().port;
  let products, orderNo;
  await t('catalog lists products & meta', async () => {
    const r = await call('GET', '/api/products'); assert.equal(r.s, 200); products = r.j.products; assert(products.length >= 5);
    const m = await call('GET', '/api/meta'); assert(m.j.categories.length >= 2);
  });
  await t('filters: category, price, search, sort', async () => {
    assert.equal((await call('GET', '/api/products?category=Skirt%20%26%20Choli%20Sets')).j.total, 1);
    assert((await call('GET', '/api/products?min=10000')).j.products.every(p => p.price >= 10000));
    assert((await call('GET', '/api/products?q=indigo')).j.total >= 1);
    assert.equal((await call('GET', '/api/products?q=zzzz')).j.total, 0);
    const asc = (await call('GET', '/api/products?sort=price-asc')).j.products.map(p => p.price);
    assert.deepEqual(asc, [...asc].sort((a, b) => a - b));
  });
  await t('product detail + 404', async () => {
    const r = await call('GET', '/api/products/' + products[0].slug); assert.equal(r.s, 200); assert(r.j.related.length);
    assert.equal((await call('GET', '/api/products/nope')).s, 404);
  });
  await t('register validates and logs in', async () => {
    assert.equal((await call('POST', '/api/auth/register', { name: 'A', email: 'x', password: '1' })).s, 400);
    const r = await call('POST', '/api/auth/register', { name: 'Asha Verma', email: 'asha@example.com', password: 'Sunrise123', phone: '9876543210' });
    assert.equal(r.s, 201);
    assert.equal((await call('GET', '/api/auth/me')).j.user.email, 'asha@example.com');
    assert.equal((await call('POST', '/api/auth/register', { name: 'Asha V', email: 'ASHA@example.com', password: 'Sunrise123' })).s, 409);
  });
  await t('logout/login and bad password', async () => {
    await call('POST', '/api/auth/logout'); assert.equal((await call('GET', '/api/auth/me')).j.user, null);
    assert.equal((await call('POST', '/api/auth/login', { email: 'asha@example.com', password: 'wrong' })).s, 401);
    assert.equal((await call('POST', '/api/auth/login', { email: 'asha@example.com', password: 'Sunrise123' })).s, 200);
  });
  await t('wishlist add/merge/remove', async () => {
    assert.equal((await call('POST', '/api/wishlist/' + products[0].id)).j.ids.length, 1);
    assert.equal((await call('PUT', '/api/wishlist', { ids: [products[1].id, 9999] })).j.ids.length, 2);
    assert.equal((await call('DELETE', '/api/wishlist/' + products[0].id)).j.ids.length, 1);
  });
  await t('cart quote: totals, shipping, coupons, stock caps', async () => {
    const p = products[3], cheap = products.find(x => x.price < 7000);
    let r = await call('POST', '/api/cart/quote', { items: [{ id: cheap.id, size: 'M', qty: 1 }] });
    assert.equal(r.j.shipping, 199); assert.equal(r.j.total, cheap.price + 199);
    r = await call('POST', '/api/cart/quote', { items: [{ id: p.id, size: 'M', qty: 2 }], coupon: 'kumud10' });
    assert.equal(r.j.shipping, 0); assert.equal(r.j.discount, Math.round(p.price * 2 * 0.1));
    r = await call('POST', '/api/cart/quote', { items: [{ id: p.id, size: 'M', qty: 999 }] }); assert(r.j.lines[0].qty <= 10);
    r = await call('POST', '/api/cart/quote', { items: [{ id: p.id, size: 'M', qty: 1 }], coupon: 'BOGUS' }); assert.equal(r.j.discount, 0);
  });
  await t('checkout rejects bad input, accepts COD with coupon', async () => {
    const items = [{ id: products[1].id, size: 'S', qty: 1 }];
    assert.equal((await call('POST', '/api/orders', { items, address: { ...addr, pincode: '12' }, payment: { method: 'cod' } })).s, 400);
    assert.equal((await call('POST', '/api/orders', { items, address: addr, payment: { method: 'card', cardNumber: '4111111111111112', expiry: '12/40', cvv: '123', cardName: 'A B' } })).s, 400);
    const r = await call('POST', '/api/orders', { items, address: addr, payment: { method: 'cod' }, coupon: 'WELCOME500' });
    assert.equal(r.s, 201, JSON.stringify(r.j)); orderNo = r.j.order.number; assert.equal(r.j.order.status, 'placed'); assert.equal(r.j.order.discount, 500);
  });
  await t('card + UPI marked paid; stock decrements; no card data stored', async () => {
    const before = (await call('GET', '/api/products/' + products[2].slug)).j.product.stock.M;
    const r = await call('POST', '/api/orders', { items: [{ id: products[2].id, size: 'M', qty: 2 }], address: addr, payment: { method: 'card', cardNumber: '4111 1111 1111 1111', expiry: '12/40', cvv: '123', cardName: 'Asha Verma' } });
    assert.equal(r.s, 201); assert.equal(r.j.order.paymentStatus, 'paid'); assert(!JSON.stringify(r.j).includes('4111111111111111'));
    assert.equal((await call('GET', '/api/products/' + products[2].slug)).j.product.stock.M, before - 2);
    const u = await call('POST', '/api/orders', { items: [{ id: products[2].id, size: 'L', qty: 1 }], address: addr, payment: { method: 'upi', upiId: 'asha@okbank' } });
    assert.equal(u.j.order.paymentStatus, 'paid');
  });
  await t('cannot oversell', async () => {
    const r = await call('POST', '/api/orders', { items: [{ id: products[0].id, size: 'XS', qty: 10 }], address: addr, payment: { method: 'cod' } });
    assert.equal(r.s, 409);
  });
  await t('order list/detail; tracking by email; no leak to others', async () => {
    assert((await call('GET', '/api/orders')).j.orders.length >= 3);
    assert.equal((await call('GET', '/api/track?number=' + orderNo + '&email=asha@example.com', null, 'g')).s, 200);
    assert.equal((await call('GET', '/api/track?number=' + orderNo + '&email=evil@example.com', null, 'g')).s, 404);
    assert.equal((await call('GET', '/api/orders/' + orderNo, null, 'g')).s, 404);
  });
  await t('guest checkout works', async () => {
    const r = await call('POST', '/api/orders', { email: 'guest@example.com', items: [{ id: products[4].id, size: 'M', qty: 1 }], address: addr, payment: { method: 'cod' } }, 'g');
    assert.equal(r.s, 201);
  });
  await t('admin guarded; status update; customer cancel restocks', async () => {
    assert.equal((await call('GET', '/api/admin/stats')).s, 403);
    assert.equal((await call('POST', '/api/auth/login', { email: 'admin@kumudboutique.com', password: 'Admin@12345' }, 'adm')).s, 200);
    assert((await call('GET', '/api/admin/stats', null, 'adm')).j.orders >= 4);
    assert.equal((await call('PATCH', '/api/admin/orders/' + orderNo, { status: 'confirmed' }, 'adm')).j.order.status, 'confirmed');
    const before = (await call('GET', '/api/products/' + products[1].slug)).j.product.stock.S;
    assert.equal((await call('POST', '/api/orders/' + orderNo + '/cancel')).j.order.status, 'cancelled');
    assert.equal((await call('GET', '/api/products/' + products[1].slug)).j.product.stock.S, before + 1);
    assert.equal((await call('PATCH', '/api/admin/orders/' + orderNo, { status: 'shipped' }, 'adm')).s, 400);
  });
  await t('shipped orders cannot be cancelled online', async () => {
    const o = (await call('POST', '/api/orders', { items: [{ id: products[3].id, size: 'S', qty: 1 }], address: addr, payment: { method: 'cod' } })).j.order;
    await call('PATCH', '/api/admin/orders/' + o.number, { status: 'shipped', carrier: 'Delhivery', trackingNo: 'DL123' }, 'adm');
    assert.equal((await call('POST', '/api/orders/' + o.number + '/cancel')).s, 400);
  });
  await t('addresses, profile, password, review', async () => {
    assert.equal((await call('POST', '/api/addresses', addr)).s, 201);
    assert.equal((await call('PATCH', '/api/account', { name: 'Asha V', phone: '9123456780' })).j.user.name, 'Asha V');
    assert.equal((await call('POST', '/api/account/password', { currentPassword: 'nope', newPassword: 'NewPass123' })).s, 400);
    assert.equal((await call('POST', '/api/account/password', { currentPassword: 'Sunrise123', newPassword: 'NewPass123' })).s, 200);
    const rv = { rating: 5, body: 'Lovely craftsmanship and fit.' };
    assert.equal((await call('POST', '/api/products/' + products[0].slug + '/reviews', rv)).s, 201);
    assert.equal((await call('POST', '/api/products/' + products[0].slug + '/reviews', rv)).s, 400);
  });
  await t('inquiry + newsletter', async () => {
    assert.equal((await call('POST', '/api/inquiries', { name: 'Ria', email: 'ria@example.com', message: 'Looking for a bridal outfit.' })).s, 201);
    assert.equal((await call('POST', '/api/inquiries', { name: 'Ria', email: 'bad', message: 'x' })).s, 400);
    assert.equal((await call('POST', '/api/newsletter', { email: 'ria@example.com' })).s, 201);
  });
  await t('lookbook resolves hotspots to products', async () => {
    const r = await call('GET', '/api/lookbook'); assert.equal(r.s, 200); assert(r.j.looks.length >= 3);
    assert(r.j.looks.every(l => l.spots.every(s => s.product && s.product.slug === s.slug)));
  });
  await t('twinning pair discount in quote and order', async () => {
    const all = (await call('GET', '/api/products')).j.products, mom = all.find(p => p.slug === 'safed-patchwork-lehenga-set'), kid = all.find(p => p.slug === 'safed-patchwork-mini-set');
    assert.equal(kid.kids, true); assert('6Y' in kid.stock); assert.equal(mom.twinSlug, kid.slug);
    const solo = (await call('POST', '/api/cart/quote', { items: [{ id: mom.id, size: 'M', qty: 1 }] })).j; assert.equal(solo.twinning, 0);
    const q = (await call('POST', '/api/cart/quote', { items: [{ id: mom.id, size: 'M', qty: 1 }, { id: kid.id, size: '6Y', qty: 2 }] })).j;
    assert.equal(q.twinPairs, 1); assert.equal(q.twinning, Math.round((mom.price + kid.price) * 0.10));
    assert.equal(q.total, q.subtotal - q.twinning + q.shipping);
    const o = await call('POST', '/api/orders', { email: 'twin@example.com', items: [{ id: mom.id, size: 'M', qty: 1 }, { id: kid.id, size: '6Y', qty: 1 }], address: addr, payment: { method: 'cod' } }, 'g');
    assert.equal(o.s, 201); assert.equal(o.j.order.discount, q.twinning); assert.equal(o.j.order.coupon, 'TWINNING');
  });
  await t('made-to-measure: profile + order snapshot', async () => {
    assert.equal((await call('GET', '/api/account/measurements', null, 'g')).s, 401);
    assert.equal((await call('PUT', '/api/account/measurements', { bust: 34 })).s, 400);
    assert.equal((await call('PUT', '/api/account/measurements', { bust: 34, waist: 99, hip: 38 })).j.field, 'm_waist');
    const m = (await call('PUT', '/api/account/measurements', { bust: '34.5', waist: 28, hip: 38, blouseLength: 14, notes: 'Slightly loose fit' })).j.measurements;
    assert.equal(m.bust, 34.5); assert.equal((await call('GET', '/api/account/measurements')).j.measurements.hip, 38);
    const p = (await call('GET', '/api/products')).j.products.find(x => !x.kids && x.stock.L > 0);
    const o = await call('POST', '/api/orders', { items: [{ id: p.id, size: 'L', qty: 1 }], address: addr, payment: { method: 'cod' }, fit: 'saved' });
    assert.equal(o.s, 201); assert.equal(o.j.order.measurements.waist, 28);
    const g = await call('POST', '/api/orders', { email: 'mtm@example.com', items: [{ id: p.id, size: 'L', qty: 1 }], address: addr, payment: { method: 'cod' }, fit: 'custom', measurements: { bust: 36 } }, 'g');
    assert.equal(g.s, 400); assert.equal(g.j.field, 'm_waist');
  });
  await t('admin settings: whatsapp + twinning percent', async () => {
    assert.equal((await call('PUT', '/api/admin/settings', { whatsapp: '9876543210', twinningPercent: 10 }, 'g')).s, 403);
    assert.equal((await call('PUT', '/api/admin/settings', { whatsapp: '12345', twinningPercent: 10 }, 'adm')).j.field, 'whatsapp');
    const r = await call('PUT', '/api/admin/settings', { whatsapp: '98765 43210', twinningPercent: 15 }, 'adm');
    assert.equal(r.j.whatsapp, '919876543210'); assert.equal((await call('GET', '/api/meta')).j.twinningPercent, 15);
    await call('PUT', '/api/admin/settings', { whatsapp: '', twinningPercent: 10 }, 'adm');
  });
  console.log(`\n${passed} checks passed${process.exitCode ? ' - WITH FAILURES' : ''}`);
  srv.close(); setTimeout(() => process.exit(process.exitCode || 0), 100);
});
