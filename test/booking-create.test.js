'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');
let ids, svc, q;
before(async () => { if (!h.have()) return; await h.freshDb(); ids = await h.seed(); svc = require('../server/booking-service'); q = require('../server/mysql').query; });
after(async () => { await h.dropDb(); });
const opt = { skip: h.SKIP };
const person = { name: 'Asha', phone: '9876543210' };
const fail = async p => { try { await p; return null; } catch (e) { return e; } };

test('rental booking stores quoted total, breakdown and first event; client price ignored', opt, async () => {
  const r = await svc.createBooking({ ...person, itemId: ids.rental, from: h.future(5), to: h.future(8), total: 1 });
  assert.equal(r.total, 3000); assert.match(r.ref, /^KB-[0-9A-F]{6}$/);
  const [b] = await q('SELECT total_price,price_breakdown FROM bookings WHERE id=?', [r.id]);
  assert.equal(b.total_price, 3000);
  assert.equal(JSON.parse(typeof b.price_breakdown === 'string' ? b.price_breakdown : JSON.stringify(b.price_breakdown)).length, 3);
  assert.equal((await q('SELECT * FROM booking_events WHERE booking_id=?', [r.id])).length, 1);
});
test('simultaneous bookings of the same dates: exactly one wins', opt, async () => {
  const input = { ...person, itemId: ids.rental, from: h.future(50), to: h.future(53) };
  const res = await Promise.allSettled([svc.createBooking(input), svc.createBooking({ ...input, name: 'B', phone: '9876543211' })]);
  assert.equal(res.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(res.find(r => r.status === 'rejected').reason.status, 409);
});
test('appointment into a full slot is rejected', opt, async () => {
  const d = h.future(60);
  await svc.createBooking({ ...person, itemId: ids.appt, from: d, slotTime: '10:00' });
  assert.equal((await fail(svc.createBooking({ ...person, itemId: ids.appt, from: d, slotTime: '10:00' }))).status, 409);
  assert.equal((await fail(svc.createBooking({ ...person, itemId: ids.appt, from: h.future(61), slotTime: '03:33' }))).status, 409);
});
test('phone formats map to one customer', opt, async () => {
  const a = await svc.createBooking({ name: 'P', phone: '+91 98765 43299', itemId: ids.rental, from: h.future(70), to: h.future(71) });
  const b = await svc.createBooking({ name: 'P', phone: '09876543299', itemId: ids.rental, from: h.future(72), to: h.future(73) });
  const [x] = await q('SELECT customer_id FROM bookings WHERE id=?', [a.id]);
  const [y] = await q('SELECT customer_id FROM bookings WHERE id=?', [b.id]);
  assert.equal(x.customer_id, y.customer_id);
});
test('validation errors name the field', opt, async () => {
  assert.equal((await fail(svc.createBooking({ name: 'X', phone: '123', itemId: ids.rental, from: h.future(5), to: h.future(6) }))).field, 'phone');
  assert.equal((await fail(svc.createBooking({ name: ' ', phone: '9876543210', itemId: ids.rental, from: h.future(5), to: h.future(6) }))).field, 'name');
});
test('cancel frees dates; reopening into a conflict is 409', opt, async () => {
  const input = { ...person, itemId: ids.rental, from: h.future(80), to: h.future(82) };
  const a = await svc.createBooking(input);
  await svc.setStatus(a.id, 'cancelled', 'changed mind', null);
  const b = await svc.createBooking({ ...input, name: 'B', phone: '9876543212' });
  assert(b.id);
  assert.equal((await fail(svc.setStatus(a.id, 'confirmed', '', null))).status, 409);
  const ev = await q('SELECT status FROM booking_events WHERE booking_id=? ORDER BY id', [a.id]);
  assert.deepStrictEqual(ev.map(e => e.status), ['pending', 'cancelled']);
});
