'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');
let srv, base, cookie = '', csrf = '';
before(async () => {
  if (!h.have()) return;
  await h.freshDb();
  const { hashPassword } = require('../server/admin-auth');
  await require('../server/mysql').query('INSERT INTO admins(email,password_hash,name) VALUES(?,?,?)', ['boss@kb.test', await hashPassword('correct horse battery'), 'Boss']);
  srv = require('../server/server').listen(0); base = 'http://127.0.0.1:' + srv.address().port;
});
after(async () => { if (srv) srv.close(); await h.dropDb(); });
const opt = { skip: h.SKIP };
const call = async (method, url, body, headers = {}) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: cookie, ...headers }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
  return { s: r.status, j: await r.json().catch(() => ({})), sc };
};

test('wrong password and unknown email give the same message', opt, async () => {
  const a = await call('POST', '/api/portal/auth/login', { email: 'boss@kb.test', password: 'nope' });
  const b = await call('POST', '/api/portal/auth/login', { email: 'nobody@kb.test', password: 'nope' });
  assert.equal(a.s, 401); assert.equal(a.j.error, b.j.error);
});
test('login sets a strict httpOnly cookie; protected GET works; CSRF enforced', opt, async () => {
  const l = await call('POST', '/api/portal/auth/login', { email: 'BOSS@kb.test', password: 'correct horse battery' });
  assert.equal(l.s, 200); csrf = l.j.csrf;
  assert.match(l.sc, /HttpOnly/); assert.match(l.sc, /SameSite=Strict/);
  assert.equal((await call('GET', '/api/portal/auth/me')).s, 200);
  assert.equal((await call('POST', '/api/portal/auth/logout')).s, 403);
});
test('logout invalidates the session; expired sessions are rejected', opt, async () => {
  assert.equal((await call('POST', '/api/portal/auth/logout', undefined, { 'X-CSRF-Token': csrf })).s, 200);
  assert.equal((await call('GET', '/api/portal/auth/me')).s, 401);
  const l = await call('POST', '/api/portal/auth/login', { email: 'boss@kb.test', password: 'correct horse battery' });
  await require('../server/mysql').query('UPDATE admin_sessions SET expires_at = UTC_TIMESTAMP() - INTERVAL 1 MINUTE');
  assert.equal((await call('GET', '/api/portal/auth/me')).s, 401); assert(l.j.csrf);
});
test('five failures lock the account even for the right password', opt, async () => {
  cookie = '';
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/portal/auth/login', { email: 'boss@kb.test', password: 'bad' + i })).s, 401);
  assert.equal((await call('POST', '/api/portal/auth/login', { email: 'boss@kb.test', password: 'correct horse battery' })).s, 429);
});
test('unauthenticated portal requests are 401', opt, async () => {
  cookie = '';
  assert.equal((await call('GET', '/api/portal/bookings')).s, 401);
});
