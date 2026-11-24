'use strict';
// Visitor analytics + enquiry management.
const os = require('os');
const path = require('path');
const fs = require('fs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-vis-'));
process.env.KUMUD_DB = path.join(tmp, 'kumud.db');
process.env.BACKUP_DIR = path.join(tmp, 'backups');
process.env.RATE_LIMIT_PER_MIN = '1000'; process.env.LOGIN_RATE_PER_MIN = '200';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server/server');
const { db } = require('../server/db');

let srv, base, cookie = '', csrf = '';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1';
const call = async (method, url, body, headers = {}) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'User-Agent': UA, Cookie: cookie, ...(csrf ? { 'X-CSRF-Token': csrf } : {}), ...headers }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch { /* empty */ }
  if (j.csrf) csrf = j.csrf;
  return { s: r.status, j };
};
const V1 = 'aaaaaaaa-1111-4222-8333-444444444444', V2 = 'bbbbbbbb-1111-4222-8333-444444444444';
const rows = () => db.prepare('SELECT * FROM visits ORDER BY id').all();

before(async () => { srv = app.listen(0); base = 'http://127.0.0.1:' + srv.address().port; });
after(() => srv.close());

test('beacon stores a page view without raw IP or query string', async () => {
  const r = await call('POST', '/api/visit', { vid: V1, page: '/product/silk-lehenga?email=a@b.com', ref: 'https://www.google.com/search?q=x' });
  assert.equal(r.s, 204);
  const v = rows().at(-1);
  assert.equal(v.vid, V1); assert.equal(v.page, '/product/silk-lehenga'); assert.equal(v.ref, 'google.com');
  assert.equal(v.device, 'Mobile'); assert.equal(v.os, 'iOS');
  assert.match(v.ip_hash, /^[0-9a-f]{16}$/); assert.ok(!JSON.stringify(v).includes('127.0.0.1'));
});

test('bots, bad ids and admin pages are not recorded', async () => {
  const n = rows().length;
  await call('POST', '/api/visit', { vid: V1, page: '/' }, { 'User-Agent': 'Googlebot/2.1 (+http://www.google.com/bot.html)' });
  await call('POST', '/api/visit', { vid: 'short', page: '/' });
  await call('POST', '/api/visit', { vid: V1, page: '/admin/orders' });
  assert.equal(rows().length, n);
});

test('traffic and visitors endpoints require staff', async () => {
  for (const u of ['/api/admin/traffic', '/api/admin/visitors', '/api/admin/visitors/' + V1, '/api/admin/inquiries']) assert.ok([401, 403].includes((await call('GET', u)).s), u);
  assert.ok([401, 403].includes((await call('PATCH', '/api/admin/inquiries/1', { status: 'read' })).s));
});

test('enquiry is linked to the visitor, notifies, and is manageable by admin', async () => {
  await call('POST', '/api/visit', { vid: V1, page: '/contact' });
  const e = await call('POST', '/api/inquiries', { name: 'Ria Sharma', email: 'ria@example.com', message: 'Looking for a bridal outfit.', topic: 'Bridal' }, { 'X-Visitor-Id': V1 });
  assert.equal(e.s, 201);
  assert.equal(db.prepare('SELECT visitor_id, status FROM inquiries ORDER BY id DESC').get().visitor_id, V1);
  assert.ok(db.prepare("SELECT 1 FROM admin_alerts WHERE title LIKE 'New enquiry from Ria%'").get());

  await call('POST', '/api/visit', { vid: V2, page: '/' });
  cookie = ''; csrf = '';
  const li = await call('POST', '/api/auth/login', { email: 'admin@kumudboutique.com', password: 'Admin@12345' });
  assert.equal(li.s, 200, JSON.stringify(li.j));
  const before = rows().length;
  await call('POST', '/api/visit', { vid: 'cccccccc-1111-4222-8333-444444444444', page: '/' });
  assert.equal(rows().length, before, 'staff visits are not counted');

  const t = await call('GET', '/api/admin/traffic?days=7');
  assert.equal(t.s, 200);
  assert.equal(t.j.daily.length, 7);
  assert.ok(t.j.visitors >= 2 && t.j.views >= 3);
  assert.equal(t.j.today.visitors, t.j.visitors);

  const vs = await call('GET', '/api/admin/visitors?days=7');
  const ria = vs.j.visitors.find(v => v.id === V1);
  assert.equal(ria.name, 'Ria Sharma'); assert.equal(ria.inquiries, 1);
  assert.equal(vs.j.visitors.find(v => v.id === V2).name, '');
  assert.equal((await call('GET', '/api/admin/visitors?only=identified')).j.visitors.every(v => v.name || v.email), true);

  const trail = await call('GET', '/api/admin/visitors/' + V1);
  assert.equal(trail.s, 200); assert.ok(trail.j.trail.length >= 2); assert.equal(trail.j.inquiries.length, 1);
  assert.equal((await call('GET', '/api/admin/visitors/nope')).s, 404);

  const list = await call('GET', '/api/admin/inquiries?status=new&q=bridal');
  assert.equal(list.j.inquiries.length, 1);
  const id = list.j.inquiries[0].id;
  assert.equal((await call('PATCH', '/api/admin/inquiries/' + id, { status: 'bogus' })).s, 400);
  assert.equal((await call('PATCH', '/api/admin/inquiries/' + id, { status: 'replied' })).s, 200);
  assert.equal((await call('GET', '/api/admin/inquiries?status=new')).j.inquiries.length, 0);
  assert.equal((await call('GET', '/api/admin/inquiries')).j.counts.replied, 1);
  assert.equal((await call('GET', '/api/admin/stats')).j.newInquiries, 0);
});
