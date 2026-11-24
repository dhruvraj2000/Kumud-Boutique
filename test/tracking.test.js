'use strict';
// Order tracking, delivery pricing, courier GPS, returns, invoices, QR, notifications, analytics.
process.env.KUMUD_DB = ':memory:';
process.env.RATE_LIMIT_PER_MIN = '5000'; process.env.LOGIN_RATE_PER_MIN = '500';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server/server');
const { db } = require('../server/db');

let srv, base, products;
const jar = {}, csrf = {};
const call = async (method, url, body, who = 'anon') => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: jar[who] || '', ...(csrf[who] ? { 'X-CSRF-Token': csrf[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch { /* html/svg/csv */ }
  if (j.csrf) csrf[who] = j.csrf;
  return { s: r.status, j, text, h: r.headers };
};
const ADDR = { name: 'Asha Verma', phone: '9876543210', line1: '12 MG Road, Indiranagar', city: 'Udaipur', state: 'Rajasthan', pincode: '313001' };
const UDAIPUR = { lat: 24.60, lng: 73.70 }, MUMBAI = { lat: 19.076, lng: 72.8777 }, DELHI = { lat: 28.6139, lng: 77.209 }, LONDON = { lat: 51.5, lng: -0.12 };
let n = 0;
const pick = () => { const fresh = db.prepare('SELECT id,price,stock FROM products WHERE active=1 AND price<7000 ORDER BY id').all(); for (const p of fresh) { const st = JSON.parse(p.stock), size = Object.keys(st).find(k => st[k] > 1 && !/Y$/.test(k)); if (size) return { id: p.id, size }; } throw new Error('no stock left in the test catalogue'); };
const place = async (extra = {}, who = 'anon') => {
  const it = pick();
  const r = await call('POST', '/api/orders', { email: `buyer${++n}@example.com`, items: [{ id: it.id, size: it.size, qty: 1 }], address: ADDR, payment: { method: 'cod' }, ...extra }, who);
  assert.equal(r.s, 201, JSON.stringify(r.j)); return r.j.order;
};
const admin = (m, u, b) => call(m, u, b, 'adm');
const login = (who, email, password) => call('POST', '/api/auth/login', { email, password }, who);

before(async () => {
  srv = app.listen(0); base = 'http://127.0.0.1:' + srv.address().port; await new Promise(r => srv.once('listening', r));
  products = (await call('GET', '/api/products')).j.products;
  assert.equal((await login('adm', 'admin@kumudboutique.com', 'Admin@12345')).s, 200);
  for (const [name, email] of [['Ravi Kumar', 'ravi@example.com'], ['Other Rider', 'rider2@example.com']]) assert.equal((await admin('POST', '/api/admin/staff', { name, email, role: 'delivery', password: 'Rider-pass-12345' })).s, 201);
  assert.equal((await admin('POST', '/api/admin/staff', { name: 'Mina Manager', email: 'mina@example.com', role: 'manager', password: 'Manager-pass-12' })).s, 201);
});
after(() => srv.close());

test('every order gets a unique, unguessable tracking ID', async () => {
  const a = await place(), b = await place();
  assert.match(a.trackingId, /^KT-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/); assert.notEqual(a.trackingId, b.trackingId);
  assert.ok(!/[01OIL]/.test(a.trackingId.replace('KT-', '').replace(/-/g, '')), 'no look-alike characters');
  assert.ok(a.eta, 'estimated delivery date set at checkout');
});

test('public tracking shows progress but never email, full phone or other orders', async () => {
  const o = await place({ notes: 'ring bell' });
  const r = await call('GET', '/api/track/' + o.trackingId);
  assert.equal(r.s, 200); assert.equal(r.j.order.number, o.number); assert.equal(r.j.order.address.city, 'Udaipur');
  assert.ok(!JSON.stringify(r.j).includes('@example.com'), 'no email'); assert.ok(!JSON.stringify(r.j).includes('9876543210'), 'phone masked');
  assert.ok(!('notes' in r.j.order)); assert.equal(r.j.order.events[0].status, 'placed');
  assert.equal((await call('GET', '/api/track/' + o.trackingId.toLowerCase())).s, 200, 'case-insensitive');
  assert.equal((await call('GET', '/api/track/KT-AAAA-BBBB-CCCC')).s, 404);
  assert.equal((await call('GET', "/api/track/KT-AAAA'--")).s, 404);
  assert.ok(db.prepare("SELECT 1 FROM security_events WHERE type='track_miss'").get(), 'guessing attempts are logged');
});

test('QR code per order points at its tracking page', async () => {
  const o = await place(), r = await call('GET', `/api/track/${o.trackingId}/qr.svg`);
  assert.equal(r.s, 200); assert.match(r.h.get('content-type'), /svg/); assert.match(r.text, /<svg/);
});

test('delivery charge follows distance; serviceability is validated', async () => {
  const cheap = products.find(p => p.price < 7000 && p.inStock), items = [{ id: cheap.id, size: Object.keys(cheap.stock).find(k => cheap.stock[k] > 0), qty: 1 }];
  const quote = loc => call('POST', '/api/cart/quote', { items, location: loc, pincode: '313001' });
  const local = (await quote(UDAIPUR)).j, regional = (await quote(DELHI)).j, national = (await quote(MUMBAI)).j;   // Udaipur→Delhi ~ 600km straight*1.3
  assert.equal(local.delivery.zone, 'local'); assert.equal(local.shipping, 79);
  assert.notEqual(regional.shipping, 79); assert.equal(national.delivery.zone, 'national'); assert.equal(national.shipping, 199);
  assert.equal(local.total, local.subtotal - local.discount - local.twinning + 79);
  assert.match((await quote(LONDON)).j.deliveryError, /India/);
  assert.match((await quote({ lat: 'x', lng: 1 })).j.deliveryError, /map/);
  const flat = (await call('POST', '/api/cart/quote', { items })).j; assert.equal(flat.shipping, 199, 'no pin → the old flat fee still applies');
  const bad = await call('POST', '/api/orders', { email: 'x@example.com', items, address: ADDR, payment: { method: 'cod' }, location: LONDON });
  assert.equal(bad.s, 400); assert.equal(bad.j.field, 'location');
  const o = await place({ location: { ...UDAIPUR, placeId: 'abc' } });
  assert.equal(o.shipping, 79); assert.ok(o.distanceKm > 0 && o.distanceKm < 30);
  assert.equal(db.prepare('SELECT place_id FROM orders WHERE number=?').get(o.number).place_id, 'abc');
});

test('blocked PIN codes cannot be ordered', async () => {
  db.prepare("INSERT INTO settings(key,value) VALUES('blockedPincodes','999999') ON CONFLICT(key) DO UPDATE SET value=excluded.value").run();
  const cheap = products.find(p => p.price < 7000 && p.inStock);
  const r = await call('POST', '/api/orders', { email: 'x@example.com', items: [{ id: cheap.id, size: Object.keys(cheap.stock).find(k => cheap.stock[k] > 0), qty: 1 }], address: { ...ADDR, pincode: '999999' }, payment: { method: 'cod' } });
  assert.equal(r.s, 400); assert.equal(r.j.field, 'pincode');
  db.prepare("DELETE FROM settings WHERE key='blockedPincodes'").run();
});

test('status machine: forward only, notifications on every change, cancel restocks', async () => {
  await call('POST', '/api/auth/register', { name: 'Notify Me', email: 'notify@example.com', password: 'Notify-pass-9' }, 'cust');
  const o = await place({}, 'cust'), stockOf = () => db.prepare('SELECT stock FROM products ORDER BY id').all().map(r => r.stock);
  assert.equal((await admin('PATCH', '/api/admin/orders/' + o.number, { status: 'confirmed' })).j.order.status, 'confirmed');
  assert.equal((await admin('PATCH', '/api/admin/orders/' + o.number, { status: 'packed' })).j.order.status, 'packed');
  assert.equal((await admin('PATCH', '/api/admin/orders/' + o.number, { status: 'preparing' })).s, 400, 'cannot go backwards');
  assert.equal((await admin('PATCH', '/api/admin/orders/' + o.number, { status: 'nonsense' })).s, 400);
  assert.equal((await admin('PATCH', '/api/admin/orders/' + o.number, { status: 'shipped', carrier: 'Delhivery', trackingNo: 'DL1' })).j.order.status, 'shipped');
  const notes = (await call('GET', '/api/notifications', null, 'cust')).j;
  assert.ok(notes.unread >= 3); assert.match(notes.notifications[0].title, /Shipped/);
  assert.ok(db.prepare("SELECT 1 FROM notification_log WHERE order_number=? AND channel='email'").get(o.number), 'email attempted (skipped without provider keys)');
  await call('POST', '/api/notifications/read', {}, 'cust'); assert.equal((await call('GET', '/api/notifications', null, 'cust')).j.unread, 0);
  const o2 = await place(), before = JSON.stringify(stockOf());
  assert.equal((await admin('PATCH', '/api/admin/orders/' + o2.number, { status: 'cancelled', note: 'Customer asked' })).j.order.status, 'cancelled');
  assert.notEqual(JSON.stringify(stockOf()), before, 'cancel returned stock');
  assert.equal((await admin('PATCH', '/api/admin/orders/' + o2.number, { status: 'confirmed' })).s, 400, 'cancelled is final');
});

test('courier GPS: consent-gated, assignment-gated, customer sees only their own order', async () => {
  const o = await place({ location: UDAIPUR });
  const staff = (await admin('GET', '/api/admin/delivery-staff')).j.staff, ravi = staff.find(s => s.name === 'Ravi Kumar'), other = staff.find(s => s.name === 'Other Rider');
  assert.equal((await admin('PATCH', '/api/admin/orders/' + o.number, { status: 'shipped', deliveryUserId: ravi.id })).j.order.courierName, 'Ravi Kumar');
  assert.equal((await login('ravi', 'ravi@example.com', 'Rider-pass-12345')).s, 200); assert.equal((await login('rider2', 'rider2@example.com', 'Rider-pass-12345')).s, 200);
  assert.equal((await call('GET', '/api/courier/orders', null, 'ravi')).j.orders.length, 1);
  assert.equal((await call('GET', '/api/courier/orders', null, 'rider2')).j.orders.length, 0);
  assert.equal((await call('GET', '/api/admin/orders', null, 'ravi')).s, 403, 'delivery role has no order admin');
  const loc = { lat: 24.58, lng: 73.69, accuracy: 12 };
  assert.equal((await call('POST', `/api/courier/orders/${o.number}/location`, loc, 'ravi')).s, 400, 'no GPS stored before consent/out-for-delivery');
  assert.equal((await call('POST', `/api/courier/orders/${o.number}/share`, { on: true }, 'ravi')).s, 400, 'must be out for delivery first');
  assert.equal((await call('POST', `/api/courier/orders/${o.number}/out`, {}, 'rider2')).s, 404, 'unassigned courier cannot touch it');
  assert.equal((await call('POST', `/api/courier/orders/${o.number}/out`, {}, 'ravi')).s, 200);
  assert.equal((await call('GET', `/api/track/${o.trackingId}/live`)).j.live, false, 'not live until the courier opts in');
  assert.equal((await call('POST', `/api/courier/orders/${o.number}/share`, { on: true }, 'ravi')).j.sharing, true);
  assert.equal((await call('POST', `/api/courier/orders/${o.number}/location`, { lat: 0, lng: 0 }, 'ravi')).s, 400, 'implausible position rejected');
  assert.equal((await call('POST', `/api/courier/orders/${o.number}/location`, { lat: 24.58, lng: 73.69 }, 'rider2')).s, 404);
  assert.equal((await call('POST', `/api/courier/orders/${o.number}/location`, loc, 'ravi')).s, 200);
  const live = (await call('GET', `/api/track/${o.trackingId}/live`)).j;
  assert.equal(live.live, true); assert.equal(live.lat, 24.58); assert.ok(live.etaMinutes > 0); assert.equal(live.courierName, 'Ravi');
  assert.ok(!JSON.stringify(live).includes('ravi@example.com'));
  const adm = (await admin('GET', `/api/admin/orders/${o.number}/live`)).j; assert.equal(adm.last.lat, 24.58); assert.equal(adm.courier.name, 'Ravi Kumar'); assert.equal(adm.trail.length, 1);
  db.prepare('UPDATE courier_locations SET ts=? WHERE order_id=(SELECT id FROM orders WHERE number=?)').run(Date.now() - 11 * 60000, o.number);
  assert.equal((await call('GET', `/api/track/${o.trackingId}/live`)).j.live, false, 'stale positions are not shown');
  assert.equal((await call('POST', `/api/courier/orders/${o.number}/delivered`, {}, 'ravi')).s, 200);
  assert.equal((await call('GET', `/api/track/${o.trackingId}/live`)).j.live, false, 'sharing ends on delivery');
  assert.equal(db.prepare('SELECT sharing FROM orders WHERE number=?').get(o.number).sharing, 0);
  assert.ok(other);
});

test('returns: only delivered orders, inside the window; admin approves → refund due + restock', async () => {
  await call('POST', '/api/auth/register', { name: 'Return Rita', email: 'rita@example.com', password: 'Return-pass-9' }, 'rita');
  const o = await place({}, 'rita');
  assert.equal((await call('POST', `/api/orders/${o.number}/return`, { reason: 'Does not fit properly' }, 'rita')).s, 400, 'not delivered yet');
  for (const s of ['confirmed', 'shipped', 'delivered']) await admin('PATCH', '/api/admin/orders/' + o.number, { status: s });
  assert.equal((await call('POST', `/api/orders/${o.number}/return`, { reason: 'no' }, 'rita')).s, 400, 'reason required');
  assert.equal((await call('POST', `/api/orders/${o.number}/return`, { reason: 'Does not fit properly' }, 'stranger')).s, 404);
  const r = await call('POST', `/api/orders/${o.number}/return`, { reason: 'Does not fit properly' }, 'rita');
  assert.equal(r.s, 200); assert.equal(r.j.order.status, 'return_requested');
  assert.equal((await admin('PATCH', '/api/admin/orders/' + o.number, { status: 'returned' })).s, 400, 'must be approved before it can be received');
  assert.equal((await admin('PATCH', '/api/admin/orders/' + o.number, { status: 'return_approved' })).j.order.status, 'return_approved');
  assert.equal((await admin('PATCH', '/api/admin/orders/' + o.number, { status: 'returned' })).j.order.status, 'returned');
  assert.equal(db.prepare('SELECT payment_status FROM orders WHERE number=?').get(o.number).payment_status, 'refund due');
  const late = await place({}, 'rita'); for (const s of ['confirmed', 'shipped', 'delivered']) await admin('PATCH', '/api/admin/orders/' + late.number, { status: s });
  db.prepare("UPDATE orders SET delivered_at=datetime('now','-9 days') WHERE number=?").run(late.number);
  assert.equal((await call('POST', `/api/orders/${late.number}/return`, { reason: 'Changed my mind' }, 'rita')).s, 400, 'window closed');
});

test('invoice: owner/admin only, HTML-escaped, downloadable', async () => {
  const o = await place({ address: { ...ADDR, name: '<script>alert(1)</script>' } }, 'rita');
  const mine = await call('GET', `/api/orders/${o.number}/invoice`, null, 'rita');
  assert.equal(mine.s, 200); assert.match(mine.text, /Invoice|INVOICE/); assert.ok(!mine.text.includes('<script>alert(1)</script>')); assert.match(mine.text, /&lt;script&gt;/);
  assert.equal((await call('GET', `/api/orders/${o.number}/invoice`, null, 'cust')).s, 404);
  assert.equal((await call('GET', `/api/orders/${o.number}/invoice`)).s, 404);
  assert.equal((await call('GET', `/api/orders/${o.number}/invoice`, null, 'adm')).s, 200);
  assert.match((await call('GET', `/api/orders/${o.number}/invoice?download=1`, null, 'adm')).h.get('content-disposition'), /attachment/);
});

test('admin dashboard: search by order/tracking/email, status groups, delayed detection, pagination', async () => {
  const o = await place({ location: UDAIPUR });
  const find = async q => (await admin('GET', '/api/admin/orders?q=' + encodeURIComponent(q))).j;
  assert.equal((await find(o.number)).orders[0].number, o.number); assert.equal((await find(o.trackingId)).orders[0].number, o.number);
  assert.ok((await find('buyer')).total >= 3); assert.equal((await find("x' OR 1=1 --")).total, 0);
  const all = (await admin('GET', '/api/admin/orders')).j; assert.ok(all.counts.new > 0); assert.equal(all.counts.all, all.total); assert.ok(all.orders[0].email, 'admins see customer details');
  assert.ok((await admin('GET', '/api/admin/orders?group=new')).j.orders.every(x => ['placed', 'payment_processing', 'payment_confirmed'].includes(x.status)));
  await admin('PATCH', '/api/admin/orders/' + o.number, { status: 'shipped' });
  db.prepare("UPDATE orders SET eta='2020-01-01' WHERE number=?").run(o.number);
  const delayed = (await admin('GET', '/api/admin/orders?group=delayed')).j; assert.ok(delayed.orders.some(x => x.number === o.number && x.delayed));
  assert.equal((await admin('PATCH', '/api/admin/orders/' + o.number, { eta: 'tomorrow' })).s, 400);
  assert.equal((await admin('PATCH', '/api/admin/orders/' + o.number, { eta: '2030-01-05' })).j.order.eta, '2030-01-05');
  assert.ok((await admin('GET', '/api/admin/delivery-map')).j.orders.some(x => x.number === o.number));
  const mgr = await login('mgr', 'mina@example.com', 'Manager-pass-12'); assert.equal(mgr.s, 200);
  assert.equal((await call('GET', '/api/admin/orders', null, 'mgr')).s, 200);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action='order.assign' OR action='order.status'").get());
});

test('analytics + CSV export (spreadsheet-injection safe)', async () => {
  await place({ address: { ...ADDR, city: '=HYPERLINK("http://evil")' } });
  const a = (await admin('GET', '/api/admin/analytics?days=30')).j;
  assert.ok(a.orders >= 5 && a.revenue > 0 && a.aov > 0); assert.ok(a.daily.length >= 1); assert.ok(a.topProducts.length >= 1); assert.ok(a.payments.length >= 1);
  const csv = await admin('GET', '/api/admin/reports/sales.csv?days=30');
  assert.equal(csv.s, 200); assert.match(csv.h.get('content-type'), /csv/); assert.match(csv.text, /^Order,Tracking ID/); assert.ok(csv.text.includes("'=HYPERLINK"), 'formula neutralised');
  assert.equal((await call('GET', '/api/admin/analytics', null, 'ravi')).s, 403);
  assert.equal((await call('GET', '/api/admin/reports/sales.csv')).s, 401);
});
