'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');
let ids, svc, q;
before(async () => { if (!h.have()) return; await h.freshDb(); ids = await h.seed(); svc = require('../server/booking-service'); q = require('../server/mysql').query; });
after(async () => { await h.dropDb(); });
const opt = { skip: h.SKIP };
const status = async (p) => { try { await p; return 200; } catch (e) { return e.status; } };

test('quote returns breakdown total from rules', opt, async () => {
  await q("INSERT INTO rate_rules(item_id,type,start_date,price,priority) VALUES(?, 'date', ?, 2500, 0)", [ids.rental, h.future(10)]);
  const r = await svc.quote(ids.rental, h.future(10), h.future(12));
  assert.equal(r.total, 3500); assert.equal(r.days.length, 2);
});
test('quote rejects bad ranges and items', opt, async () => {
  assert.equal(await status(svc.quote(ids.rental, h.future(5), h.future(5))), 400);
  assert.equal(await status(svc.quote(ids.rental, '2020-01-01', '2020-01-03')), 400);
  assert.equal(await status(svc.quote(ids.rental, h.future(5), h.future(70))), 400);
  assert.equal(await status(svc.quote(ids.rental, '2026-02-30', '2026-03-02')), 400);
  assert.equal(await status(svc.quote(99999, h.future(5), h.future(6))), 404);
});
test('isRentalFree: overlap blocks, back-to-back and cancelled do not', opt, async () => {
  const c = (await q("INSERT INTO customers(name,phone) VALUES('A','9876543210')")).insertId;
  const ins = async (from, to, st) => (await q("INSERT INTO bookings(ref,customer_id,item_id,kind,start_date,end_date,status,total_price,price_breakdown) VALUES(?,?,?,'rental',?,?,?,0,'[]')", ['T' + Math.random(), c, ids.rental, from, to, st])).insertId;
  await ins(h.future(20), h.future(23), 'pending');
  assert.equal(await svc.isRentalFree(null, ids.rental, h.future(22), h.future(25)), false);
  assert.equal(await svc.isRentalFree(null, ids.rental, h.future(23), h.future(25)), true);
  assert.equal(await svc.isRentalFree(null, ids.rental, h.future(17), h.future(20)), true);
  await ins(h.future(30), h.future(33), 'cancelled');
  assert.equal(await svc.isRentalFree(null, ids.rental, h.future(30), h.future(33)), true);
});
test('slotsFor counts bookings and honours blocked dates', opt, async () => {
  const d = h.future(40);
  assert.deepStrictEqual(await svc.slotsFor(ids.appt, d), [{ time: '10:00', left: 1 }]);
  await svc.createBooking({ itemId: ids.appt, from: d, slotTime: '10:00', name: 'S', phone: '9876500000' });
  assert.deepStrictEqual(await svc.slotsFor(ids.appt, d), [{ time: '10:00', left: 0 }]);
  await q('INSERT INTO blocked_dates(date,reason) VALUES(?,?)', [h.future(41), 'Holiday']);
  assert.deepStrictEqual(await svc.slotsFor(ids.appt, h.future(41)), []);
});
