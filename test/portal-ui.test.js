'use strict';
// Needs no MySQL: checks the portal shell is served safely and the client code covers every planned view.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
let srv, base;
before(() => { srv = require('../server/server').listen(0); base = 'http://127.0.0.1:' + srv.address().port; });
after(() => srv.close());

test('/admin serves the shell with noindex and no-store', async () => {
  const r = await fetch(base + '/admin');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-robots-tag'), 'noindex');
  assert.match(r.headers.get('cache-control'), /no-store/);
  assert.match(await r.text(), /<script type="module" src="\/admin\/admin\.js"><\/script>/);
  assert.equal((await fetch(base + '/admin/admin.js')).status, 200);
});
test('portal API answers 503 (not a crash) when MySQL is not configured, or 401 when it is', async () => {
  const r = await fetch(base + '/api/portal/bookings');
  assert([401, 503].includes(r.status));
});
test('admin.js defines every planned view and escapes through the html tag', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'admin.js'), 'utf8');
  for (const route of ["'#/rates'", "'#/items'", "'#/slots'", "'#/bookings'", "'#/customers'"]) assert(src.includes(route), route);
  assert(src.includes("from '/js/core.js'"));
  assert(!/\.innerHTML\s*=/.test(src), 'no direct innerHTML assignment');
});
test('robots.txt disallows /admin', () => {
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'public', 'robots.txt'), 'utf8'), /Disallow:\s*\/admin/);
});
