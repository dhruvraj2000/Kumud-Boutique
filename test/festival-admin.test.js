'use strict';
// Festival admin portal + auto-scheduling against a real (throwaway) MySQL schema; skipped without MYSQL_TEST_URL.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');
let srv, base, cookie = '', csrf = '';
process.env.KUMUD_DB = ':memory:';
before(async () => {
  if (!h.have()) return;
  await h.freshDb();
  const { hashPassword } = require('../server/admin-auth');
  await require('../server/mysql').query('INSERT INTO admins(email,password_hash,name) VALUES(?,?,?)', ['boss@kb.test', await hashPassword('correct horse battery'), 'Boss']);
  srv = require('../server/server').listen(0); base = 'http://127.0.0.1:' + srv.address().port;
  csrf = (await call('POST', '/api/portal/auth/login', { email: 'boss@kb.test', password: 'correct horse battery' })).j.csrf;
});
after(async () => { if (srv) srv.close(); await h.dropDb(); });
const opt = { skip: h.SKIP };
const call = async (method, url, body, withCsrf = true) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(withCsrf && csrf ? { 'X-CSRF-Token': csrf } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { s: r.status, j: await r.json().catch(() => ({})) };
};
const P = '/api/portal';
const day = n => new Date(Date.now() + 5.5 * 3600e3 + n * 86400e3).toISOString().slice(0, 10);

test('first load seeds the festival templates and auto-schedules upcoming years', opt, async () => {
  await require('../server/festival-data').refresh();
  const r = (await call('GET', P + '/festivals')).j;
  const names = r.templates.map(t => t.slug);
  for (const s of ['diwali', 'holi', 'dhanteras', 'navratri', 'christmas', 'new-year', 'valentines-day']) assert.ok(names.includes(s), s);
  const y = new Date().getFullYear();
  assert.ok(r.campaigns.some(c => c.slug === `christmas-${y + 1}`), 'fixed-date festival scheduled for next year');
  assert.ok(r.campaigns.some(c => c.slug === `christmas-${y + 3}`), 'and three years ahead');
  assert.ok(r.missing.every(m => m.year >= y), 'lunar festivals without dates are flagged, not invented');
  const dw = r.campaigns.find(c => c.slug.startsWith('diwali-'));
  assert.ok(dw.max_pct <= r.cap);
});

test('generation never overwrites edits, and deleted auto-campaigns stay deleted', opt, async () => {
  const list = (await call('GET', P + '/festivals')).j.campaigns, xm = list.find(c => c.slug.startsWith('christmas-'));
  assert.equal((await call('PATCH', `${P}/festivals/${xm.id}`, { discount_pct: 25 })).s, 200);
  await require('../server/festival-data').generateCampaigns();
  assert.equal((await call('GET', P + '/festivals')).j.campaigns.find(c => c.id === xm.id).discount_pct, 25);
  assert.equal((await call('DELETE', `${P}/festivals/${xm.id}`)).s, 200);
  await require('../server/festival-data').generateCampaigns();
  assert.ok(!(await call('GET', P + '/festivals')).j.campaigns.some(c => c.slug === xm.slug));
  const g = await call('POST', P + '/festivals/generate');
  assert.ok(g.j.created.includes(xm.slug), 'explicit generate restores it');
});

test('campaign validation: cap, ordering, dates, CSRF', opt, async () => {
  const ok = { name: 'Flash Sale', discount_pct: 20, min_pct: 5, max_pct: 30, starts_at: day(-1), ends_at: day(2) };
  assert.equal((await call('POST', P + '/festivals', { ...ok, max_pct: 95 })).s, 400);
  assert.equal((await call('POST', P + '/festivals', { ...ok, min_pct: 40 })).s, 400);
  assert.equal((await call('POST', P + '/festivals', { ...ok, ends_at: day(-3) })).s, 400);
  assert.equal((await call('POST', P + '/festivals', ok, false)).s, 403);
  assert.equal((await call('POST', P + '/festivals', ok)).s, 201);
});

test('a live campaign changes storefront prices at once; rules respect the max; deactivating removes it', opt, async () => {
  const { id } = (await call('GET', P + '/festivals')).j.campaigns.find(c => c.name === 'Flash Sale');
  const before = (await (await fetch(base + '/api/products')).json()).products[0];
  assert.equal(before.festivalPct, 20);
  assert.equal((await call('POST', `${P}/festivals/${id}/rules`, { scope: 'category', target: before.category, discount_pct: 31 })).s, 400);
  assert.equal((await call('POST', `${P}/festivals/${id}/rules`, { scope: 'category', target: before.category, discount_pct: 28 })).s, 200);
  const after1 = (await (await fetch(base + '/api/products')).json()).products.find(p => p.id === before.id);
  assert.equal(after1.festivalPct, 28);
  assert.equal((await call('PATCH', `${P}/festivals/${id}`, { max_pct: 25 })).s, 400, 'cannot lower max below an existing rule');
  assert.equal((await call('PATCH', `${P}/festivals/${id}`, { active: 0 })).s, 200);
  assert.equal((await (await fetch(base + '/api/products')).json()).products[0].festivalPct, undefined);
  const cur = (await (await fetch(base + '/api/festivals/current')).json());
  assert.ok(!cur.live.some(c => c.name === 'Flash Sale'));
});

test('entering a lunar festival date schedules its campaign; wrong-year dates are rejected', opt, async () => {
  const r = (await call('GET', P + '/festivals')).j, m = r.missing[0];
  if (!m) return;
  assert.equal((await call('PUT', P + '/festival-dates', { template_id: m.template_id, year: m.year, date: `${m.year + 1}-01-01` })).s, 400);
  assert.equal((await call('PUT', P + '/festival-dates', { template_id: m.template_id, year: m.year, date: `${m.year}-11-10` })).s, 200);
  assert.ok((await call('GET', P + '/festivals')).j.campaigns.some(c => c.year === m.year && c.template_id === m.template_id));
});

test('shop-wide cap cannot be set below a live campaign maximum', opt, async () => {
  assert.equal((await call('PUT', P + '/festival-settings', { max_discount_cap: 3 })).s, 400);
  assert.equal((await call('PUT', P + '/festival-settings', { max_discount_cap: 50 })).s, 200);
  const r = (await call('GET', P + '/festivals')).j;
  assert.equal(r.cap, 50);
});

test('coupons: create, validate, expire, delete', opt, async () => {
  assert.equal((await call('POST', P + '/coupons', { code: 'EID15', type: 'percent', value: 95 })).s, 400);
  assert.equal((await call('POST', P + '/coupons', { code: 'EID15', label: '15% off', type: 'percent', value: 15, ends_at: day(5) })).s, 201);
  assert.equal((await call('POST', P + '/coupons', { code: 'eid15', type: 'percent', value: 5 })).s, 400, 'duplicate (case-insensitive)');
  let meta = await (await fetch(base + '/api/meta')).json();
  assert.ok(meta.coupons.some(c => c.code === 'EID15'));
  assert.ok(meta.coupons.some(c => c.code === 'KUMUD10'), 'original codes were migrated');
  assert.equal((await call('PATCH', P + '/coupons/EID15', { ends_at: day(-1) + ' 00:00:00', starts_at: day(-9) + ' 00:00:00' })).s, 200);
  meta = await (await fetch(base + '/api/meta')).json();
  assert.ok(!meta.coupons.some(c => c.code === 'EID15'), 'expired coupon disappears');
  assert.equal((await call('DELETE', P + '/coupons/EID15')).s, 200);
});
