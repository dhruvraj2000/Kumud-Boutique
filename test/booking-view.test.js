'use strict';
// No MySQL needed: wiring checks for the customer booking flows.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
let srv, base;
before(() => { srv = require('../server/server').listen(0); base = 'http://127.0.0.1:' + srv.address().port; });
after(() => srv.close());

test('booking view module is wired to #/rent and #/book before the info pages', () => {
  assert.match(read('public/js/views/booking.js'), /export default async function booking/);
  const app = read('public/js/app.js');
  assert(app.indexOf("'booking'") > 0 && app.indexOf("'booking'") < app.indexOf("'info'"));
  assert.match(app, /\(rent\|book\)/);
});
test('booking endpoints say 503 (readable) instead of crashing when MySQL is not configured', async () => {
  if (process.env.MYSQL_URL) return;
  const r = await fetch(base + '/api/items');
  assert.equal(r.status, 503);
  assert.match((await r.json()).error, /temporarily unavailable/);
});
test('storefront still loads', async () => { assert.equal((await fetch(base + '/')).status, 200); });
