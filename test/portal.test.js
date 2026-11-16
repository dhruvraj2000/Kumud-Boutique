'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');
let ids, srv, base, cookie = '', csrf = '';
before(async () => {
  if (!h.have()) return;
  await h.freshDb(); ids = await h.seed();
  const { hashPassword } = require('../server/admin-auth');
  await require('../server/mysql').query('INSERT INTO admins(email,password_hash,name) VALUES(?,?,?)', ['boss@kb.test', await hashPassword('correct horse battery'), 'Boss']);
  srv = require('../server/server').listen(0); base = 'http://127.0.0.1:' + srv.address().port;
  const l = await call('POST', '/api/portal/auth/login', { email: 'boss@kb.test', password: 'correct horse battery' });
  csrf = l.j.csrf;
});
after(async () => { if (srv) srv.close(); await h.dropDb(); });
const opt = { skip: h.SKIP };
const call = async (method, url, body, withCsrf = true) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(withCsrf && csrf ? { 'X-CSRF-Token': csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
const person = { name: 'Asha Verma', phone: '9876543210' };

test('bookings: manual create, list filters, phone search, detail with history', opt, async () => {
  const a = await call('POST', '/api/portal/bookings', { ...person, itemId: ids.rental, from: h.future(5), to: h.future(7) });
  assert.equal(a.s, 201);
  await call('POST', '/api/bookings', { name: 'Other', phone: '9123456780', itemId: ids.rental, from: h.future(20), to: h.future(21) });
  assert.equal((await call('GET', '/api/portal/bookings?status=confirmed')).j.bookings.length, 1);
  assert.equal((await call('GET', '/api/portal/bookings?q=98765 4')).j.bookings.length, 1);
  const d = (await call('GET', '/api/portal/bookings/' + a.j.id)).j;
  assert.equal(d.booking.customer_name, 'Asha Verma'); assert.equal(d.events.length, 1);
  assert.equal(d.booking.price_breakdown.length, 2);
});
test('bookings: status change writes event with admin; invalid status 400', opt, async () => {
  const id = (await call('GET', '/api/portal/bookings?q=Asha')).j.bookings[0].id;
  assert.equal((await call('PATCH', '/api/portal/bookings/' + id, { status: 'completed', note: 'Returned' })).s, 200);
  assert.equal((await call('PATCH', '/api/portal/bookings/' + id, { status: 'bogus' })).s, 400);
  const ev = (await call('GET', '/api/portal/bookings/' + id)).j.events;
  assert.equal(ev[ev.length - 1].admin_name, 'Boss');
});
test('writes without CSRF are rejected', opt, async () => {
  assert.equal((await call('POST', '/api/portal/items', { name: 'X', kind: 'rental', base_price: 1 }, false)).s, 403);
});
test('customers list and dashboard', opt, async () => {
  const c = (await call('GET', '/api/portal/customers?q=asha')).j;
  assert.equal(c.customers.length, 1);
  assert.equal((await call('PATCH', '/api/portal/customers/' + c.customers[0].id, { notes: 'VIP' })).s, 200);
  const d = (await call('GET', '/api/portal/dashboard')).j;
  assert.equal(d.pending, 1); assert(d.revenue.total >= 2000);
});
test('rules: weekday/date change the calendar; delete restores; bad bodies 400', opt, async () => {
  const month = h.future(40).slice(0, 7);
  const cal = async () => (await call('GET', `/api/portal/rates/calendar?item=${ids.rental}&month=${month}`)).j.days;
  assert((await cal()).every(d => d.price === 1000));
  const r = await call('POST', '/api/portal/rules', { item_id: ids.rental, type: 'weekday', weekday: 6, price: 1800 });
  assert.equal(r.s, 201);
  const days = await cal();
  assert(days.filter(d => d.price === 1800).length >= 4); assert(days.every(d => d.price === 1800 || d.price === 1000));
  const one = days.find(d => d.price === 1800).date;
  await call('POST', '/api/portal/rules', { item_id: ids.rental, type: 'date', start_date: one, price: 4000 });
  assert.equal((await cal()).find(d => d.date === one).price, 4000);
  await call('DELETE', '/api/portal/rules/' + r.j.id);
  assert.equal((await cal()).filter(d => d.price === 1800).length, 0);
  for (const bad of [{ type: 'weekday', weekday: 9, price: 1 }, { type: 'weekday', weekday: 1, price: -5 }, { type: 'period', start_date: '2026-12-10', end_date: '2026-12-01', price: 1 }, { type: 'x', price: 1 }])
    assert.equal((await call('POST', '/api/portal/rules', bad)).s, 400);
});
test('rate changes never alter an existing booking snapshot', opt, async () => {
  const b = await call('POST', '/api/portal/bookings', { name: 'Snap', phone: '9000000001', itemId: ids.rental, from: h.future(100), to: h.future(102) });
  await call('POST', '/api/portal/rules', { type: 'period', start_date: h.future(99), end_date: h.future(110), price: 9999 });
  const d = (await call('GET', '/api/portal/bookings/' + b.j.id)).j.booking;
  assert.equal(d.total_price, 2000);
  assert.equal((await call('GET', `/api/rates/quote?item=${ids.rental}&from=${h.future(100)}&to=${h.future(102)}`, undefined, false)).j.total, 19998);
});
test('items: delete deactivates when bookings exist; slots and blocked dates', opt, async () => {
  assert.equal((await call('DELETE', '/api/portal/items/' + ids.rental)).j.deactivated, true);
  const n = (await call('POST', '/api/portal/items', { name: 'Fresh', kind: 'rental', base_price: 700 })).j.id;
  assert.equal((await call('DELETE', '/api/portal/items/' + n)).j.deleted, true);
  assert.equal((await call('POST', '/api/portal/slots', { weekday: 1, start_time: '14:00', end_time: '13:00' })).s, 400);
  assert.equal((await call('POST', '/api/portal/slots', { weekday: 1, start_time: '14:00', end_time: '15:00', capacity: 2 })).s, 201);
  assert.equal((await call('POST', '/api/portal/blocked-dates', { date: h.future(200), reason: 'Diwali' })).s, 201);
  assert.equal((await call('DELETE', '/api/portal/blocked-dates/' + h.future(200))).s, 200);
});
