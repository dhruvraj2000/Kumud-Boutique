'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');
let ids, srv, base;
before(async () => {
  if (!h.have()) return;
  await h.freshDb(); ids = await h.seed();
  srv = require('../server/server').listen(0); base = 'http://127.0.0.1:' + srv.address().port;
});
after(async () => { if (srv) srv.close(); await h.dropDb(); });
const opt = { skip: h.SKIP };
const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
const person = { name: 'Asha', phone: '9876543210' };

test('items and quote', opt, async () => {
  assert.equal((await call('GET', '/api/items?kind=rental')).j.items.length, 1);
  const q = await call('GET', `/api/rates/quote?item=${ids.rental}&from=${h.future(5)}&to=${h.future(7)}`);
  assert.equal(q.s, 200); assert.equal(q.j.total, 2000);
  const badq = await call('GET', `/api/rates/quote?item=${ids.rental}&from=${h.future(7)}&to=${h.future(5)}`);
  assert.equal(badq.s, 400); assert(badq.j.error);
});
test('booking is stored, duplicate dates are 409, script text stored verbatim', opt, async () => {
  const body = { ...person, name: '<script>x</script>', itemId: ids.rental, from: h.future(30), to: h.future(32), total: 1 };
  const a = await call('POST', '/api/bookings', body);
  assert.equal(a.s, 201); assert.equal(a.j.total, 2000);
  const row = (await require('../server/mysql').query('SELECT c.name FROM bookings b JOIN customers c ON c.id=b.customer_id WHERE b.ref=?', [a.j.ref]))[0];
  assert.equal(row.name, '<script>x</script>');
  assert.equal((await call('POST', '/api/bookings', body)).s, 409);
  const av = await call('GET', `/api/availability?item=${ids.rental}&from=${h.future(30)}&to=${h.future(32)}`);
  assert.equal(av.j.available, false);
});
test('booking endpoint is rate limited', opt, async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await call('POST', '/api/bookings', { ...person, itemId: ids.rental, from: h.future(90 + i), to: h.future(91 + i) });
  assert.equal(last.s, 429);
});
