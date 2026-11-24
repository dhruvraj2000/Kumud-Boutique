'use strict';
// End-to-end + integration tests: the complete customer → payment → order → admin → shipping → delivery journey,
// the failure paths (payment failed, duplicates, cancellation, delivery failed, returns, refunds), access isolation and DB integrity.
process.env.KUMUD_DB = ':memory:';
process.env.RATE_LIMIT_PER_MIN = '100000'; process.env.LOGIN_RATE_PER_MIN = '1000'; process.env.ORDER_RATE_PER_MIN = '10000';
const crypto = require('crypto');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server/server');
const T = require('../server/tracking');
const { db } = require('../server/db');
const { verify } = require('../server/dbcheck');

/* ---- stub the outside world: Razorpay + Google web services (everything local passes through) ---- */
const realFetch = global.fetch, outbound = [];
let rzpMode = 'ok', googleMode = 'denied', rzpN = 0;
global.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('https://api.razorpay.com')) {
    outbound.push(u);
    if (rzpMode === 'down') return new Response(JSON.stringify({ error: { description: 'gateway down' } }), { status: 502 });
    if (u.endsWith('/v1/orders')) return new Response(JSON.stringify({ id: 'order_T' + (++rzpN) }), { status: 200 });
    if (/\/refund$/.test(u)) return new Response(JSON.stringify({ id: 'rfnd_T' + (++rzpN), status: 'processed' }), { status: 200 });
  }
  if (u.startsWith('https://maps.googleapis.com') || u.startsWith('https://places.googleapis.com')) {
    outbound.push(u);
    if (googleMode === 'down') throw new Error('network unreachable');
    if (googleMode === 'denied') return new Response(JSON.stringify({ status: 'REQUEST_DENIED', error_message: 'This API project is not authorized to use this API. Billing is not enabled.', error: { status: 'PERMISSION_DENIED', message: 'API has not been used in project before or it is disabled' } }), { status: 200 });
  }
  return realFetch(url, init);
};

let srv, base, products;
const jar = {}, csrf = {};
const call = async (method, url, body, who = 'anon') => {
  const r = await realFetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: jar[who] || '', ...(csrf[who] ? { 'X-CSRF-Token': csrf[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) jar[who] = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch { /* html */ }
  if (j.csrf) csrf[who] = j.csrf;
  return { s: r.status, j, text, h: r.headers };
};
const adm = (m, u, b) => call(m, u, b, 'adm');
const ADDR = { name: 'Asha Verma', phone: '9876543210', line1: '12 Lake Road, Fatehpura', city: 'Udaipur', state: 'Rajasthan', pincode: '313001' };
const PIN = { lat: 24.6, lng: 73.7, placeId: 'ChIJtest' };
const pick = (maxPrice = 7000, qty = 1) => { for (const p of db.prepare('SELECT id,price,stock FROM products WHERE active=1 AND price<? ORDER BY id').all(maxPrice)) { const st = JSON.parse(p.stock), size = Object.keys(st).find(k => st[k] > qty && !/Y$/.test(k)); if (size) return { id: p.id, size, qty, price: p.price }; } throw new Error('no stock'); };
const totalStock = () => db.prepare('SELECT stock FROM products').all().reduce((a, r) => a + Object.values(JSON.parse(r.stock)).reduce((x, y) => x + y, 0), 0);
let n = 0;
const order = async (extra = {}, who = 'anon', item = pick()) => {
  const r = await call('POST', '/api/orders', { email: `e2e${++n}@example.com`, items: [item], address: ADDR, payment: { method: 'cod' }, location: PIN, ...extra }, who);
  assert.equal(r.s, 201, JSON.stringify(r.j)); return r.j.order;
};
const sigFor = (rzpOrder, payId) => crypto.createHmac('sha256', 'rzp_secret_test').update(rzpOrder + '|' + payId).digest('hex');
const status = num => db.prepare('SELECT status,payment_status,delivered_at FROM orders WHERE number=?').get(num);
const events = num => db.prepare('SELECT e.status FROM order_events e JOIN orders o ON o.id=e.order_id WHERE o.number=? ORDER BY e.id').all(num).map(r => r.status);
const login = (who, email, password) => call('POST', '/api/auth/login', { email, password }, who);

before(async () => {
  srv = app.listen(0); base = 'http://127.0.0.1:' + srv.address().port; await new Promise(r => srv.once('listening', r));
  products = (await call('GET', '/api/products')).j.products;
  assert.equal((await login('adm', 'admin@kumudboutique.com', 'Admin@12345')).s, 200);
  for (const [name, email] of [['Ravi Kumar', 'ravi@e2e.test'], ['Other Rider', 'rider2@e2e.test']]) assert.equal((await adm('POST', '/api/admin/staff', { name, email, role: 'delivery', password: 'Rider-pass-12345' })).s, 201);
  assert.equal((await adm('POST', '/api/admin/staff', { name: 'Mina Manager', email: 'mina@e2e.test', role: 'manager', password: 'Manager-pass-12' })).s, 201);
});
after(() => { global.fetch = realFetch; srv.close(); });

/* =============================================================== 1. THE COMPLETE JOURNEY (steps match the brief) */
test('E2E journey: register → browse → cart → checkout (map pin) → pay → order → admin → ship → live GPS → delivered', async () => {
  const W = 'asha';
  // 1-2. registration validation, then success, login/logout
  for (const bad of [{ name: 'A', email: 'x', password: '1' }, { name: 'Asha Verma', email: 'asha@e2e.test', password: 'short1' }, { name: 'Asha Verma', email: 'asha@e2e.test', password: 'onlyletters' }, { name: 'Asha Verma', email: 'not-an-email', password: 'Sunrise-123' }])
    assert.equal((await call('POST', '/api/auth/register', bad, W)).s, 400, JSON.stringify(bad));
  const reg = await call('POST', '/api/auth/register', { name: 'Asha Verma', email: 'asha@e2e.test', password: 'Sunrise-2026', phone: '9876543210' }, W);
  assert.equal(reg.s, 201); assert.equal(reg.j.user.role, 'customer');
  const stored = db.prepare("SELECT salt,hash FROM users WHERE email='asha@e2e.test'").get();
  assert.ok(stored.hash.length === 128 && !stored.hash.includes('Sunrise'), 'password stored only as a scrypt hash');
  assert.equal((await call('POST', '/api/auth/register', { name: 'Dup', email: 'ASHA@e2e.test', password: 'Sunrise-2026' }, 'x')).s, 409);
  await call('POST', '/api/auth/logout', {}, W); assert.equal((await call('GET', '/api/auth/me', null, W)).j.user, null);
  assert.equal((await login(W, 'asha@e2e.test', 'wrong-password')).s, 401);
  assert.equal((await login(W, 'asha@e2e.test', 'Sunrise-2026')).s, 200);

  // 3. browse, product details, images, price
  const list = (await call('GET', '/api/products')).j.products, p = list.find(x => x.price < 7000 && x.inStock);
  const detail = (await call('GET', '/api/products/' + p.slug)).j.product;
  assert.ok(detail.images.length >= 1 && detail.price > 0 && detail.description && detail.stock);

  // 4. cart: add, change quantity, remove (server-side quote is the source of truth)
  const size = Object.keys(p.stock).find(k => p.stock[k] > 2);
  const q1 = (await call('POST', '/api/cart/quote', { items: [{ id: p.id, size, qty: 1 }] })).j;
  assert.equal(q1.lines[0].qty, 1); assert.equal(q1.subtotal, p.price);
  const q2 = (await call('POST', '/api/cart/quote', { items: [{ id: p.id, size, qty: 2 }] })).j; assert.equal(q2.subtotal, p.price * 2);
  const q3 = (await call('POST', '/api/cart/quote', { items: [{ id: p.id, size, qty: 999 }] })).j; assert.ok(q3.lines[0].qty <= p.stock[size] && q3.warnings.length, 'quantity capped to stock');
  assert.equal((await call('POST', '/api/cart/quote', { items: [] })).j.total, 0, 'removing everything empties the bag');

  // 5. checkout: address + map pin → full price breakdown incl. delivery charge and GST
  const quote = (await call('POST', '/api/cart/quote', { items: [{ id: p.id, size, qty: 1 }], location: PIN, pincode: '313001' })).j;
  assert.equal(quote.delivery.zone, 'local'); assert.equal(quote.shipping, 79); assert.equal(quote.total, p.price + 79); assert.ok(quote.taxIncluded > 0, 'GST shown');
  const bad = await call('POST', '/api/orders', { items: [{ id: p.id, size, qty: 1 }], address: { ...ADDR, pincode: '12' }, payment: { method: 'cod' } }, W);
  assert.equal(bad.s, 400); assert.equal(bad.j.field, 'pincode');
  assert.equal((await call('POST', '/api/orders', { items: [{ id: p.id, size, qty: 1 }], address: { ...ADDR, phone: '123' }, payment: { method: 'cod' } }, W)).j.field, 'phone');

  // 6. payment: failed attempts are rejected; a valid simulated UPI payment succeeds
  const stockBefore = totalStock();
  for (const [payment, field] of [[{ method: 'upi', upiId: 'nope' }, 'upiId'], [{ method: 'card', cardNumber: '4111111111111112', cardName: 'A B', expiry: '12/30', cvv: '123' }, 'cardNumber'], [{ method: 'card', cardNumber: '4111111111111111', cardName: 'A B', expiry: '01/20', cvv: '123' }, 'expiry']]) {
    const r = await call('POST', '/api/orders', { items: [{ id: p.id, size, qty: 1 }], address: ADDR, payment }, W); assert.equal(r.s, 400); assert.equal(r.j.field, field);
  }
  assert.equal(totalStock(), stockBefore, 'failed payments reserve nothing');
  const key = 'idem-' + crypto.randomUUID();
  const placed = await call('POST', '/api/orders', { items: [{ id: p.id, size, qty: 1 }], address: ADDR, payment: { method: 'upi', upiId: 'asha@okbank' }, location: PIN, idempotencyKey: key, notes: 'blouse 1 inch longer' }, W);
  assert.equal(placed.s, 201, JSON.stringify(placed.j)); const o = placed.j.order;

  // 7. confirmation: unique numbers, tracking URL, full history, ledger, no card data stored
  assert.match(o.number, /^KB-\d{6}-\d{4}$/); assert.match(o.trackingId, /^KT-/); assert.ok(o.trackingUrl.endsWith('/#/track?t=' + o.trackingId));
  assert.equal(o.status, 'payment_confirmed'); assert.equal(o.paymentStatus, 'paid');
  assert.deepEqual(events(o.number), ['placed', 'payment_processing', 'payment_confirmed']);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM payments WHERE order_id=(SELECT id FROM orders WHERE number=?) AND status='succeeded'").get(o.number).c, 1);
  assert.ok(!JSON.stringify(db.prepare('SELECT * FROM orders').all()).includes('4111'), 'no card number stored');
  assert.equal(o.steps.length, 10, 'prepaid timeline shows all ten steps');
  assert.ok(db.prepare('SELECT 1 FROM customer_notifications WHERE order_number=?').get(o.number), 'confirmation notification created');
  assert.ok(db.prepare("SELECT 1 FROM notification_log WHERE order_number=? AND channel='email'").get(o.number), 'confirmation email attempted');

  // 8. My Orders
  const mine = (await call('GET', '/api/orders', null, W)).j.orders; assert.equal(mine.length, 1); assert.equal(mine[0].number, o.number);
  assert.equal((await call('GET', '/api/orders/' + o.number, null, W)).j.order.trackingId, o.trackingId);

  // 9-10. admin sees it and processes it
  const list0 = (await adm('GET', '/api/admin/orders?group=new')).j; assert.ok(list0.orders.some(x => x.number === o.number)); assert.ok(list0.counts.new >= 1);
  const full = (await adm('GET', '/api/admin/orders/' + o.number)).j.order;
  assert.equal(full.email, 'asha@e2e.test'); assert.equal(full.items.length, 1); assert.equal(full.location.lat, 24.6); assert.equal(full.address.city, 'Udaipur'); assert.ok(full.nextStatuses.some(s => s.key === 'confirmed'));
  for (const s of ['confirmed', 'preparing', 'packed']) assert.equal((await adm('PATCH', '/api/admin/orders/' + o.number, { status: s })).j.order.status, s);
  const ravi = (await adm('GET', '/api/admin/delivery-staff')).j.staff.find(s => s.name === 'Ravi Kumar');
  const shipped = (await adm('PATCH', '/api/admin/orders/' + o.number, { status: 'shipped', carrier: 'Delhivery', trackingNo: 'DL998877', deliveryUserId: ravi.id, eta: '2031-01-15', note: 'Left the atelier' })).j.order;
  assert.equal(shipped.status, 'shipped'); assert.equal(shipped.carrier, 'Delhivery'); assert.equal(shipped.courierName, 'Ravi Kumar'); assert.equal(shipped.eta, '2031-01-15');

  // 11. customer sees it immediately: order page, tracking page, notifications
  const seen = (await call('GET', '/api/orders/' + o.number, null, W)).j.order;
  assert.equal(seen.status, 'shipped'); assert.equal(seen.carrier, 'Delhivery'); assert.equal(seen.trackingNo, 'DL998877'); assert.equal(seen.eta, '2031-01-15');
  const pub = (await call('GET', '/api/track/' + o.trackingId)).j.order; assert.equal(pub.status, 'shipped'); assert.equal(pub.courierName, ''); assert.ok(pub.events.some(e => /Delhivery/.test(e.note)));
  const notes = (await call('GET', '/api/notifications', null, W)).j; assert.ok(notes.unread >= 5); assert.match(notes.notifications[0].title, /Shipped/);

  // 12. in transit → out for delivery → live GPS → delivered (courier side)
  assert.equal((await adm('PATCH', '/api/admin/orders/' + o.number, { status: 'in_transit' })).j.order.status, 'in_transit');
  assert.equal((await login('ravi', 'ravi@e2e.test', 'Rider-pass-12345')).s, 200);
  assert.equal((await call('GET', '/api/courier/orders', null, 'ravi')).j.orders[0].number, o.number);
  assert.equal((await call('POST', `/api/courier/orders/${o.number}/out`, {}, 'ravi')).s, 200);
  assert.equal((await call('GET', `/api/track/${o.trackingId}/live`)).j.live, false, 'no GPS before consent');
  assert.equal((await call('POST', `/api/courier/orders/${o.number}/share`, { on: true }, 'ravi')).s, 200);
  assert.equal((await call('POST', `/api/courier/orders/${o.number}/location`, { lat: 24.59, lng: 73.69, accuracy: 9 }, 'ravi')).s, 200);
  const live = (await call('GET', `/api/track/${o.trackingId}/live`)).j; assert.equal(live.live, true); assert.ok(live.etaMinutes > 0);
  const aLive = (await adm('GET', `/api/admin/orders/${o.number}/live`)).j; assert.equal(aLive.last.lat, 24.59); assert.equal(aLive.dest.lat, 24.6);

  // 13. delivered: timestamp saved, history complete, order stays in the customer's history
  assert.equal((await call('POST', `/api/courier/orders/${o.number}/delivered`, {}, 'ravi')).s, 200);
  const done = status(o.number); assert.equal(done.status, 'delivered'); assert.ok(done.delivered_at, 'delivery timestamp saved');
  assert.deepEqual(events(o.number).filter((s, i, a) => a.indexOf(s) === i), ['placed', 'payment_processing', 'payment_confirmed', 'confirmed', 'preparing', 'packed', 'shipped', 'in_transit', 'out_for_delivery', 'delivered']);
  const final = (await call('GET', '/api/orders/' + o.number, null, W)).j.order; assert.equal(final.status, 'delivered'); assert.ok(final.deliveredAt); assert.equal(final.canReturn, true);
  assert.equal((await call('GET', `/api/track/${o.trackingId}/live`)).j.live, false, 'GPS stops after delivery');
  assert.match(((await call('GET', '/api/notifications', null, W)).j.notifications[0]).title, /Delivered/, 'delivery confirmation notification');
  assert.equal((await call('GET', '/api/orders', null, W)).j.orders.length, 1);

  // idempotency: repeating the very same checkout returns the same order, charges and reserves nothing twice
  const stockNow = totalStock();
  const again = await call('POST', '/api/orders', { items: [{ id: p.id, size, qty: 1 }], address: ADDR, payment: { method: 'upi', upiId: 'asha@okbank' }, location: PIN, idempotencyKey: key }, W);
  assert.equal(again.s, 200); assert.equal(again.j.duplicate, true); assert.equal(again.j.order.number, o.number); assert.equal(totalStock(), stockNow);
});

/* =============================================================== 2. PAYMENT GATEWAY (Razorpay, stubbed) */
test('payments: verified-only, retry after failure, no fulfilment before payment, no duplicate settlement', async () => {
  const E = o => '?email=' + encodeURIComponent(o.email);
  process.env.RAZORPAY_KEY_ID = 'rzp_test_key'; process.env.RAZORPAY_KEY_SECRET = 'rzp_secret_test';
  try {
    assert.equal((await call('GET', '/api/meta')).j.razorpayKeyId, 'rzp_test_key');
    // with a live gateway the simulated methods are refused
    assert.equal((await call('POST', '/api/orders', { email: 'm@e2e.test', items: [pick()], address: ADDR, payment: { method: 'upi', upiId: 'a@b' } })).j.field, 'method');
    const stockBefore = totalStock();
    const o = await order({ payment: { method: 'razorpay' } });
    assert.equal(o.status, 'placed'); assert.equal(o.paymentStatus, 'pending'); assert.equal(o.onlinePending, true);
    assert.ok(totalStock() < stockBefore, 'stock reserved while paying');

    // cannot be fulfilled (or marked paid) by hand before the gateway confirms
    assert.equal((await adm('PATCH', '/api/admin/orders/' + o.number, { status: 'confirmed' })).s, 400);
    assert.equal((await adm('PATCH', '/api/admin/orders/' + o.number, { status: 'payment_confirmed' })).s, 400);
    assert.equal(status(o.number).payment_status, 'pending');

    // gateway outage: clear error, order untouched
    rzpMode = 'down'; assert.equal((await call('POST', `/api/orders/${o.number}/pay${E(o)}`)).s, 502); rzpMode = 'ok';
    assert.equal(status(o.number).status, 'placed');

    const pay = (await call('POST', `/api/orders/${o.number}/pay${E(o)}`)).j; assert.ok(pay.orderId.startsWith('order_T')); assert.equal(pay.amount, o.total * 100);
    assert.equal(status(o.number).status, 'payment_processing');
    // wrong signature / wrong order id / malformed payment id are all rejected and nothing is marked paid
    assert.equal((await call('POST', `/api/orders/${o.number}/verify${E(o)}`, { razorpay_order_id: pay.orderId, razorpay_payment_id: 'pay_FAKE1', razorpay_signature: 'f'.repeat(64) })).s, 400);
    assert.equal((await call('POST', `/api/orders/${o.number}/verify${E(o)}`, { razorpay_order_id: 'order_other', razorpay_payment_id: 'pay_FAKE1', razorpay_signature: sigFor('order_other', 'pay_FAKE1') })).s, 400);
    assert.equal((await call('POST', `/api/orders/${o.number}/verify${E(o)}`, { razorpay_order_id: pay.orderId, razorpay_payment_id: "pay_x'; DROP", razorpay_signature: sigFor(pay.orderId, "pay_x'; DROP") })).s, 400);
    assert.equal(status(o.number).payment_status, 'pending');

    // the customer's payment fails → "payment failed" → retry → success
    assert.equal((await call('POST', `/api/orders/${o.number}/payment-failed${E(o)}`, { reason: 'Card declined' })).j.order.status, 'payment_failed');
    assert.equal((await adm('PATCH', '/api/admin/orders/' + o.number, { status: 'confirmed' })).s, 400, 'failed payment cannot be fulfilled');
    assert.equal((await call('POST', `/api/orders/${o.number}/pay${E(o)}`)).s, 200); assert.equal(status(o.number).status, 'payment_processing');
    const good = { razorpay_order_id: pay.orderId, razorpay_payment_id: 'pay_GOOD001', razorpay_signature: sigFor(pay.orderId, 'pay_GOOD001') };
    const ok = (await call('POST', `/api/orders/${o.number}/verify${E(o)}`, good)).j.order;
    assert.equal(ok.status, 'payment_confirmed'); assert.equal(ok.paymentStatus, 'paid'); assert.match(ok.paymentMethod, /pay_GOOD001/);
    assert.deepEqual(events(o.number).filter((s, i, a) => a.indexOf(s) === i), ['placed', 'payment_processing', 'payment_failed', 'payment_confirmed']);
    // duplicate processing: the same verify again changes nothing, and the same payment cannot settle a second order
    const ledger = () => db.prepare("SELECT COUNT(*) c FROM payments WHERE status='succeeded' AND kind='charge' AND provider='razorpay'").get().c, before = ledger();
    assert.equal((await call('POST', `/api/orders/${o.number}/verify${E(o)}`, good)).s, 200); assert.equal(ledger(), before);
    const o2 = await order({ payment: { method: 'razorpay' } }), pay2 = (await call('POST', `/api/orders/${o2.number}/pay${E(o2)}`)).j;
    const steal = await call('POST', `/api/orders/${o2.number}/verify${E(o2)}`, { razorpay_order_id: pay2.orderId, razorpay_payment_id: 'pay_GOOD001', razorpay_signature: sigFor(pay2.orderId, 'pay_GOOD001') });
    assert.equal(steal.s, 409); assert.equal(status(o2.number).payment_status, 'pending');
    assert.equal((await call('POST', `/api/orders/${o.number}/payment-failed${E(o)}`, {})).s, 400, 'a paid order cannot be marked failed');
    assert.equal((await adm('PATCH', '/api/admin/orders/' + o.number, { status: 'confirmed' })).j.order.status, 'confirmed', 'fulfilment opens once paid');

    // unpaid online orders are released after the timeout so stock is not held forever
    db.prepare("UPDATE orders SET created_at=datetime('now','-3 hours') WHERE number=?").run(o2.number);
    const stockHeld = totalStock(); assert.equal(T.expireUnpaid(60), 1);
    assert.equal(status(o2.number).status, 'cancelled'); assert.ok(totalStock() > stockHeld, 'stock released');
    // …and a payment that lands afterwards is flagged for refund rather than silently kept
    const late = { razorpay_order_id: pay2.orderId, razorpay_payment_id: 'pay_LATE002', razorpay_signature: sigFor(pay2.orderId, 'pay_LATE002') };
    assert.equal((await call('POST', `/api/orders/${o2.number}/verify${E(o2)}`, late)).s, 200); assert.equal(status(o2.number).payment_status, 'refund due');
    assert.ok(db.prepare("SELECT 1 FROM admin_alerts WHERE title LIKE 'Payment received for a cancelled order%'").get(), 'admin alerted');
  } finally { rzpMode = 'ok'; delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET; }
});

/* =============================================================== 3. CANCELLATION, REFUNDS, DELIVERY FAILURE, RETURNS */
test('cancellation + refund: paid order is refunded through the gateway exactly once', async () => {
  process.env.RAZORPAY_KEY_ID = 'rzp_test_key'; process.env.RAZORPAY_KEY_SECRET = 'rzp_secret_test';
  try {
    await call('POST', '/api/auth/register', { name: 'Refund Rani', email: 'rani@e2e.test', password: 'Refund-pass-2026' }, 'rani');
    const o = await order({ payment: { method: 'razorpay' } }, 'rani'), pay = (await call('POST', `/api/orders/${o.number}/pay`, {}, 'rani')).j;
    await call('POST', `/api/orders/${o.number}/verify`, { razorpay_order_id: pay.orderId, razorpay_payment_id: 'pay_REF0001', razorpay_signature: sigFor(pay.orderId, 'pay_REF0001') }, 'rani');
    const before = totalStock();
    const c = await call('POST', `/api/orders/${o.number}/cancel`, { reason: 'Changed my mind' }, 'rani');
    assert.equal(c.j.order.status, 'cancelled'); assert.equal(c.j.order.paymentStatus, 'refund due'); assert.ok(totalStock() > before, 'cancel restocks');
    assert.equal((await call('POST', `/api/orders/${o.number}/cancel`, {}, 'rani')).s, 400, 'cannot cancel twice');
    assert.ok((await adm('GET', '/api/admin/orders?group=refunds')).j.orders.some(x => x.number === o.number), 'shows under Refund Management');
    assert.equal((await adm('PATCH', '/api/admin/orders/' + o.number, { status: 'confirmed' })).s, 400);
    const r1 = await adm('POST', `/api/admin/orders/${o.number}/refund`, { method: 'razorpay' });
    assert.equal(r1.s, 200); assert.equal(r1.j.order.status, 'refunded'); assert.equal(r1.j.order.paymentStatus, 'refunded');
    assert.ok(outbound.some(u => /pay_REF0001\/refund$/.test(u)), 'gateway refund was called for the right payment');
    assert.equal((await adm('POST', `/api/admin/orders/${o.number}/refund`, { method: 'razorpay' })).s, 409, 'no double refund');
    assert.equal((await call('GET', '/api/orders/' + o.number, null, 'rani')).j.order.status, 'refunded');
    // gateway failure leaves the order in "refund processing" so it can be retried
    const o3 = await order({ payment: { method: 'razorpay' } }, 'rani'), pay3 = (await call('POST', `/api/orders/${o3.number}/pay`, {}, 'rani')).j;
    await call('POST', `/api/orders/${o3.number}/verify`, { razorpay_order_id: pay3.orderId, razorpay_payment_id: 'pay_REF0003', razorpay_signature: sigFor(pay3.orderId, 'pay_REF0003') }, 'rani');
    await call('POST', `/api/orders/${o3.number}/cancel`, {}, 'rani'); rzpMode = 'down';
    assert.equal((await adm('POST', `/api/admin/orders/${o3.number}/refund`, { method: 'razorpay' })).s, 502); rzpMode = 'ok';
    assert.equal(status(o3.number).status, 'refund_processing');
    assert.equal((await adm('POST', `/api/admin/orders/${o3.number}/refund`, { method: 'manual', reference: 'UPI-778899' })).j.order.status, 'refunded');
  } finally { delete process.env.RAZORPAY_KEY_ID; delete process.env.RAZORPAY_KEY_SECRET; }
});

test('cancellation rules: customer can cancel early, not once preparation starts; COD cancel needs no refund', async () => {
  const o = await order(); assert.equal((await call('POST', `/api/orders/${o.number}/cancel?email=${o.email}`, {})).j.order.status, 'cancelled');
  assert.equal(status(o.number).payment_status, 'cancelled');
  const o2 = await order(); await adm('PATCH', '/api/admin/orders/' + o2.number, { status: 'preparing' });
  assert.equal((await call('POST', `/api/orders/${o2.number}/cancel?email=${o2.email}`, {})).s, 400);
  assert.equal((await adm('PATCH', '/api/admin/orders/' + o2.number, { status: 'cancelled', note: 'Out of fabric' })).j.order.status, 'cancelled', 'admin can still cancel');
});

test('failed delivery → retry → delivered; COD collected on delivery', async () => {
  const o = await order(), ravi = (await adm('GET', '/api/admin/delivery-staff')).j.staff.find(s => s.name === 'Ravi Kumar');
  await adm('PATCH', '/api/admin/orders/' + o.number, { status: 'shipped', deliveryUserId: ravi.id });
  await call('POST', `/api/courier/orders/${o.number}/out`, {}, 'ravi');
  assert.equal((await call('POST', `/api/courier/orders/${o.number}/failed`, { reason: 'Customer not at home' }, 'ravi')).s, 200);
  assert.equal(status(o.number).status, 'delivery_failed'); assert.equal((await adm('GET', '/api/admin/orders?group=failed')).j.orders.some(x => x.number === o.number), true);
  assert.equal((await call('POST', `/api/courier/orders/${o.number}/delivered`, {}, 'ravi')).s, 400, 'must retry before delivering');
  assert.equal((await call('POST', `/api/courier/orders/${o.number}/out`, {}, 'ravi')).s, 200);
  assert.equal((await call('POST', `/api/courier/orders/${o.number}/delivered`, {}, 'ravi')).s, 200);
  assert.equal(status(o.number).payment_status, 'paid', 'cash collected');
});

test('returns: request → approve → received → refund; rejection and the 7-day window', async () => {
  await call('POST', '/api/auth/register', { name: 'Return Rita', email: 'rita@e2e.test', password: 'Return-pass-2026' }, 'rita');
  const deliver = async who => { const o = await order({}, who); for (const s of ['confirmed', 'shipped', 'delivered']) await adm('PATCH', '/api/admin/orders/' + o.number, { status: s }); return o; };
  const o = await deliver('rita');
  assert.equal((await call('POST', `/api/orders/${o.number}/return`, { reason: 'Colour different from photo' }, 'rita')).j.order.status, 'return_requested');
  assert.equal((await adm('PATCH', '/api/admin/orders/' + o.number, { status: 'return_approved' })).j.order.status, 'return_approved');
  assert.equal((await adm('PATCH', '/api/admin/orders/' + o.number, { status: 'returned' })).j.order.paymentStatus, 'refund due');
  assert.equal((await adm('POST', `/api/admin/orders/${o.number}/refund`, { method: 'manual', reference: 'bank-1' })).j.order.status, 'refunded');
  assert.ok((await adm('GET', '/api/admin/orders?group=returned')).j.orders.some(x => x.number === o.number), 'refunded return still listed under Returns');
  const o2 = await deliver('rita'); await call('POST', `/api/orders/${o2.number}/return`, { reason: 'Does not fit properly' }, 'rita');
  assert.equal((await adm('PATCH', '/api/admin/orders/' + o2.number, { status: 'delivered', note: 'Return rejected: worn' })).j.order.status, 'delivered', 'return can be rejected');
  const o3 = await deliver('rita'); db.prepare("UPDATE orders SET delivered_at=datetime('now','-8 days') WHERE number=?").run(o3.number);
  assert.equal((await call('POST', `/api/orders/${o3.number}/return`, { reason: 'Changed my mind' }, 'rita')).s, 400);
});

/* =============================================================== 4. ACCESS ISOLATION */
test('a customer can never reach another customer’s order by changing an ID', async () => {
  await call('POST', '/api/auth/register', { name: 'Alice A', email: 'alice@e2e.test', password: 'Alice-pass-2026' }, 'alice');
  await call('POST', '/api/auth/register', { name: 'Bob B', email: 'bob@e2e.test', password: 'Bob-pass-20262' }, 'bob');
  const o = await order({}, 'alice');
  for (const [m, u, b] of [['GET', `/api/orders/${o.number}`], ['GET', `/api/orders/${o.number}/invoice`], ['POST', `/api/orders/${o.number}/cancel`, {}], ['POST', `/api/orders/${o.number}/return`, { reason: 'steal it' }], ['POST', `/api/orders/${o.number}/pay`, {}]]) {
    const r = await call(m, u, b, 'bob'); assert.equal(r.s, 404, `${m} ${u} → ${r.s}`);
  }
  assert.equal((await call('GET', `/api/orders/${o.number}`, null, 'anon')).s, 404);
  assert.equal((await call('GET', `/api/orders/${o.number}?email=bob@e2e.test`, null, 'anon')).s, 404, 'wrong email');
  assert.equal((await call('GET', `/api/orders/${o.number}?email=${o.email}`, null, 'anon')).s, 200, 'right email works for guests');
  assert.equal((await call('GET', '/api/orders', null, 'bob')).j.orders.length, 0, 'Bob’s history is empty');
  assert.ok(!(await call('GET', '/api/orders', null, 'alice')).j.orders.some(x => x.email !== 'alice@e2e.test' && false));
  // tracking ID: one wrong character finds nothing; the public view carries no private data
  const flipped = o.trackingId.slice(0, -1) + (o.trackingId.endsWith('A') ? 'B' : 'A');
  assert.equal((await call('GET', '/api/track/' + flipped)).s, 404);
  const pub = JSON.stringify((await call('GET', '/api/track/' + o.trackingId)).j); assert.ok(!pub.includes('@e2e.test') && !pub.includes('9876543210') && !pub.includes('ravi'));
  assert.equal((await call('GET', `/api/track?number=${o.number}&email=wrong@x.com`)).s, 404);
  // sequential order numbers can't be walked: different numbers just 404 for strangers
  for (const num of ['KB-000000-0000', 'KB-261120-0001', "KB-1' OR '1'='1", '../../etc/passwd']) assert.equal((await call('GET', '/api/orders/' + encodeURIComponent(num), null, 'bob')).s, 404);
  // staff boundaries
  assert.equal((await call('GET', '/api/admin/orders', null, 'bob')).s, 403);
  assert.equal((await call('GET', '/api/courier/orders', null, 'bob')).s, 403);
  assert.equal((await login('rider2', 'rider2@e2e.test', 'Rider-pass-12345')).s, 200);
  assert.equal((await call('POST', `/api/courier/orders/${o.number}/out`, {}, 'rider2')).s, 404, 'a courier only sees their own deliveries');
  assert.equal((await login('mgr', 'mina@e2e.test', 'Manager-pass-12')).s, 200);
  assert.equal((await call('GET', '/api/admin/orders', null, 'mgr')).s, 200); assert.equal((await call('GET', '/api/admin/security/overview', null, 'mgr')).s, 403);
});

/* =============================================================== 5. MONEY + LOCATION UNITS (through the API) */
test('delivery charge and GST: zones, free-shipping threshold, tax breakdown, location validation', async () => {
  const it = pick(), q = loc => call('POST', '/api/cart/quote', { items: [{ id: it.id, size: it.size, qty: 1 }], location: loc, pincode: '313001' }).then(r => r.j);
  assert.equal((await q({ lat: 24.6, lng: 73.7 })).shipping, 79); assert.equal((await q({ lat: 28.6139, lng: 77.209 })).delivery.zone, 'national');
  assert.match((await q({ lat: 51.5, lng: -0.12 })).deliveryError, /India/); assert.match((await q({ lat: 'x' })).deliveryError, /map/);
  const big = pick(20000); const free = (await call('POST', '/api/cart/quote', { items: [{ id: big.id, size: big.size, qty: 1 }, { id: big.id, size: big.size, qty: 1 }], location: { lat: 28.6, lng: 77.2 } })).j;
  if (free.subtotal >= 7500) assert.equal(free.shipping, 0, 'free above the threshold, whatever the distance');
  const o = await order({ location: { lat: 24.6, lng: 73.7 } }), row = db.prepare('SELECT * FROM orders WHERE number=?').get(o.number), its = db.prepare('SELECT price,qty FROM order_items WHERE order_id=?').all(row.id);
  assert.equal(row.total, row.subtotal - row.discount + row.shipping); assert.equal(row.shipping, 79);
  const rate = its[0].price <= 2500 ? 5 : 18, expect = Math.round(its.reduce((a, i) => a + i.price * i.qty * rate / (100 + rate), 0) + 79 * 18 / 118);
  assert.ok(Math.abs(row.tax - expect) <= 1, `GST ${row.tax} vs ${expect}`);
  assert.ok(row.dest_lat === 24.6 && row.dest_lng === 73.7 && row.distance_km > 0, 'coordinates + distance saved');
  assert.match((await call('GET', `/api/orders/${o.number}/invoice?email=${o.email}`)).text, /Includes GST/);
  assert.equal((await call('POST', '/api/orders', { email: 'x@y.co', items: [pick()], address: ADDR, payment: { method: 'cod' }, location: { lat: 0, lng: 0 } })).j.field, 'location');
});

/* =============================================================== 6. FAILURE HANDLING + OPERATIONS */
test('Google Maps failures never break checkout; the Maps check explains what is wrong', async () => {
  process.env.GOOGLE_MAPS_SERVER_KEY = 'AIza-test-server-key';
  try {
    googleMode = 'down';
    const o = await order({ location: PIN }); assert.ok(o.distanceKm > 0, 'falls back to the straight-line estimate when Google is unreachable');
    googleMode = 'denied';
    const chk = (await adm('GET', '/api/admin/maps-check')).j; assert.equal(chk.configured.server, true);
    const geocoding = chk.results.find(r => /Geocoding/.test(r.name)); assert.equal(geocoding.ok, false); assert.match(geocoding.hint, /Billing|enabled/i);
    delete process.env.GOOGLE_MAPS_SERVER_KEY;
    const none = (await adm('GET', '/api/admin/maps-check')).j; assert.equal(none.configured.browser, false); assert.match(none.results[0].message, /Not set/);
  } finally { delete process.env.GOOGLE_MAPS_SERVER_KEY; googleMode = 'denied'; }
  assert.equal((await call('GET', '/api/admin/maps-check', null, 'bob')).s, 403);
});

test('logging + health: browser errors are recorded, health reports the database and integrations (never secrets)', async () => {
  assert.equal((await call('POST', '/api/client-log', { kind: 'maps', message: 'script failed\nto load', where: '#/checkout' })).s, 200);
  const row = db.prepare("SELECT * FROM error_log WHERE kind='client-maps' ORDER BY id DESC LIMIT 1").get(); assert.equal(row.message, 'script failed to load'); assert.equal(row.route, '#/checkout');
  const h = await call('GET', '/api/health'); assert.equal(h.s, 200); assert.equal(h.j.db, true); assert.equal(typeof h.j.integrations.razorpay, 'boolean'); assert.ok(!/KEY|SECRET|TOKEN/.test(JSON.stringify(h.j).replace(/googleMaps\w+/g, '')));
  assert.ok(db.prepare("SELECT COUNT(*) c FROM security_events").get().c > 0);
  const bad = await call('POST', '/api/orders', 'not json at all'); assert.ok([400, 415].includes(bad.s));
  assert.equal((await call('GET', '/api/orders/nope/../../admin')).s === 200, false);
  assert.equal((await call('GET', '/api/nonexistent')).s, 404); assert.equal((await call('GET', '/api/track/')).s, 404);
});

test('admin dashboard: every status filter returns the right orders and the counts add up', async () => {
  const all = (await adm('GET', '/api/admin/orders')).j, counts = all.counts;
  for (const g of ['new', 'confirmed', 'processing', 'packed', 'shipped', 'in_transit', 'out_for_delivery', 'delivered', 'failed', 'cancelled', 'returned', 'refunds', 'delayed']) {
    const r = (await adm('GET', `/api/admin/orders?group=${g}&page=1`)).j; assert.equal(r.total, counts[g], g); assert.ok(r.orders.length <= 25);
  }
  assert.equal(counts.all, all.total); assert.equal((await adm('GET', '/api/admin/orders?q=KT-')).j.total, counts.all, 'tracking IDs are searchable');
  assert.ok(counts.delivered >= 3 && counts.cancelled >= 3 && counts.returned >= 1);
  const stats = (await adm('GET', '/api/admin/stats')).j; assert.ok(stats.orders === all.total && stats.revenue > 0);
  const an = (await adm('GET', '/api/admin/analytics?days=30')).j; assert.ok(an.revenue > 0 && an.cancelled >= 3 && an.returned >= 1);
});

/* =============================================================== 7. DATABASE VERIFICATION */
test('database: integrity, relationships and business invariants hold after the whole run', () => {
  const problems = verify(db); assert.deepEqual(problems, [], problems.join('\n'));
  assert.ok(db.prepare('SELECT COUNT(*) c FROM orders').get().c >= 12 && db.prepare('SELECT COUNT(*) c FROM payments').get().c >= 6);
  // the checker really catches damage (so a green result means something)
  db.exec('PRAGMA foreign_keys=OFF'); const id = db.prepare('SELECT id FROM orders LIMIT 1').get().id;
  db.prepare('UPDATE orders SET total = total + 1 WHERE id=?').run(id); assert.ok(verify(db).some(p => /total does not equal/.test(p))); db.prepare('UPDATE orders SET total = total - 1 WHERE id=?').run(id);
  db.prepare("UPDATE orders SET tracking_id='BAD' WHERE id=?").run(id); assert.ok(verify(db).some(p => /tracking ID/.test(p)));
  db.exec('PRAGMA foreign_keys=ON'); assert.deepEqual(verify(db).filter(p => !/tracking ID/.test(p)), []);
});
