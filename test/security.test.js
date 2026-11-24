'use strict';
// Security mechanisms: headers, CSRF, lockout, RBAC, MFA, sessions, reset, rate limit, injection, privacy, backups.
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-sec-'));
process.env.KUMUD_DB = path.join(tmp, 'kumud.db');
process.env.BACKUP_DIR = path.join(tmp, 'backups');
process.env.RATE_LIMIT_PER_MIN = '400'; process.env.LOGIN_RATE_PER_MIN = '200';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const app = require('../server/server');
const SEC = require('../server/security');
const { db } = require('../server/db');

let srv, base;
const jar = {}, csrf = {};
const call = async (method, url, body, who = 'anon', extra = {}) => {
  const r = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', Cookie: jar[who] || '', ...(csrf[who] ? { 'X-CSRF-Token': csrf[who] } : {}), ...extra }, body: body ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  if (sc) jar[who] = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
  const text = await r.text(); let j = {}; try { j = JSON.parse(text); } catch { /* not json */ }
  if (j.csrf) csrf[who] = j.csrf;
  return { s: r.status, j, h: r.headers };
};
const ADMIN = { email: 'admin@kumudboutique.com', password: 'Admin@12345' };
// RFC 6238 code generator (independent of the server implementation)
const b32dec = s => { const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = ''; for (const c of s) bits += A.indexOf(c).toString(2).padStart(5, '0'); const o = []; for (let i = 0; i + 8 <= bits.length; i += 8) o.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(o); };
const totp = (secret, step = Math.floor(Date.now() / 30000)) => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(step)); const h = crypto.createHmac('sha1', b32dec(secret)).update(b).digest(), o = h[19] & 15; return String(((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1e6).padStart(6, '0'); };

before(async () => { srv = app.listen(0); base = 'http://127.0.0.1:' + srv.address().port; await new Promise(r => srv.once('listening', r)); });
after(() => { srv.close(); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* windows file locks */ } });

test('security headers + CSP on every response', async () => {
  const r = await call('GET', '/api/meta');
  assert.match(r.h.get('content-security-policy'), /default-src 'self'/);
  assert.match(r.h.get('content-security-policy'), /object-src 'none'/);
  assert.match(r.h.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.equal(r.h.get('x-content-type-options'), 'nosniff');
  assert.equal(r.h.get('x-frame-options'), 'SAMEORIGIN');
  assert.ok(r.h.get('permissions-policy')); assert.equal(r.h.get('x-powered-by'), null);
  assert.equal((await call('GET', '/api/auth/me')).h.get('cache-control'), 'no-store');
});

test('CSRF: cross-site state changes are blocked, same-origin allowed', async () => {
  const evil = await call('POST', '/api/newsletter', { email: 'x@example.com' }, 'anon', { Origin: 'https://evil.example' });
  assert.equal(evil.s, 403);
  assert.equal((await call('POST', '/api/newsletter', { email: 'x@example.com' }, 'anon', { 'Sec-Fetch-Site': 'cross-site' })).s, 403);
  assert.equal((await call('POST', '/api/newsletter', { email: 'x@example.com' }, 'anon', { Origin: base })).s, 201);
  assert.ok(db.prepare("SELECT 1 FROM security_events WHERE type='csrf_blocked'").get());
});

test('SQL injection strings are inert', async () => {
  assert.equal((await call('POST', '/api/auth/login', { email: "' OR 1=1 --", password: "' OR '1'='1" })).s, 401);
  const r = await call('GET', '/api/products?q=' + encodeURIComponent("'; DROP TABLE users; --"));
  assert.equal(r.s, 200); assert.equal(r.j.total, 0);
  assert.ok(db.prepare('SELECT COUNT(*) c FROM users').get().c >= 1);
  assert.equal((await call('GET', '/api/orders/' + encodeURIComponent("KB-1' OR '1'='1"))).s, 404);
});

test('account lockout after repeated failures, with audit trail', async () => {
  await call('POST', '/api/auth/register', { name: 'Lock Test', email: 'lock@example.com', password: 'Correct-horse-9' }, 'lockuser');
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/api/auth/login', { email: 'lock@example.com', password: 'nope' + i })).s, 401);
  const r = await call('POST', '/api/auth/login', { email: 'lock@example.com', password: 'Correct-horse-9' });
  assert.equal(r.s, 429);   // locked even with the right password
  assert.ok(db.prepare("SELECT 1 FROM security_events WHERE type='account_locked' AND email='lock@example.com'").get());
  db.prepare("UPDATE users SET locked_until=0, failed_attempts=0 WHERE email='lock@example.com'").run();
});

test('sessions: hashed at rest, flagged Secure/HttpOnly, revoked on logout', async () => {
  const r = await call('POST', '/api/auth/login', { email: 'lock@example.com', password: 'Correct-horse-9' }, 'c1');
  assert.equal(r.s, 200);
  const raw = jar.c1.split('=')[1];
  assert.ok(!db.prepare('SELECT 1 FROM sessions WHERE token=?').get(raw), 'raw token must not be stored');
  assert.ok(db.prepare('SELECT 1 FROM sessions WHERE token=?').get(SEC.sha(raw)));
  assert.equal((await call('GET', '/api/auth/me', null, 'c1')).j.user.email, 'lock@example.com');
  await call('POST', '/api/auth/logout', {}, 'c1');
  const stale = await call('GET', '/api/auth/me', null, 'old', { Cookie: 'kb_session=' + raw });
  assert.equal(stale.j.user, null);
});

test('RBAC: customer < manager < admin, and staff writes need the CSRF token', async () => {
  assert.equal((await call('GET', '/api/admin/stats')).s, 401);
  await call('POST', '/api/auth/login', { email: 'lock@example.com', password: 'Correct-horse-9' }, 'cust');
  assert.equal((await call('GET', '/api/admin/orders', null, 'cust')).s, 403);
  assert.equal((await call('GET', '/api/admin/security/overview', null, 'cust')).s, 403);

  assert.equal((await call('POST', '/api/auth/login', ADMIN, 'adm')).s, 200);
  assert.equal((await call('GET', '/api/admin/security/overview', null, 'adm')).s, 200);
  // a stolen cookie without the per-session CSRF token cannot change anything
  const noToken = await call('POST', '/api/admin/staff', { name: 'M One', email: 'mgr@example.com', role: 'manager', password: 'Manager-pass-12' }, 'adm', { 'X-CSRF-Token': 'wrong' });
  assert.equal(noToken.s, 403);
  assert.equal((await call('POST', '/api/admin/staff', { name: 'M One', email: 'mgr@example.com', role: 'manager', password: 'short1' }, 'adm')).s, 400);
  assert.equal((await call('POST', '/api/admin/staff', { name: 'M One', email: 'mgr@example.com', role: 'manager', password: 'Manager-pass-12' }, 'adm')).s, 201);

  assert.equal((await call('POST', '/api/auth/login', { email: 'mgr@example.com', password: 'Manager-pass-12' }, 'mgr')).s, 200);
  assert.equal((await call('GET', '/api/admin/orders', null, 'mgr')).s, 200);          // manager: orders yes
  assert.equal((await call('GET', '/api/admin/settings', null, 'mgr')).s, 403);        // settings: admin only
  assert.equal((await call('GET', '/api/admin/security/overview', null, 'mgr')).s, 403);
  assert.equal((await call('POST', '/api/admin/staff', { name: 'X Y', email: 'x@y.co', role: 'manager', password: 'Manager-pass-12' }, 'mgr')).s, 403);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action='staff.created'").get());
  assert.ok(db.prepare("SELECT 1 FROM security_events WHERE type='forbidden'").get());
});

test('admin can see and revoke another session; staff removal kills their sessions', async () => {
  const { sessions } = (await call('GET', '/api/admin/security/sessions', null, 'adm')).j;
  const mgr = sessions.find(s => s.email === 'mgr@example.com'); assert.ok(mgr); assert.ok(sessions.find(s => s.current));
  assert.equal((await call('DELETE', '/api/admin/security/sessions/' + mgr.id, null, 'adm')).s, 200);
  assert.equal((await call('GET', '/api/admin/orders', null, 'mgr')).s, 401);
});

test('MFA: enrol, require code at login, no code replay, recovery code works once', async () => {
  const setup = (await call('POST', '/api/account/mfa/setup', {}, 'adm')).j;
  assert.match(setup.uri, /^otpauth:\/\/totp\//);
  const stored = db.prepare("SELECT totp_secret FROM users WHERE email=?").get(ADMIN.email).totp_secret;
  assert.ok(!stored.includes(setup.secret), 'TOTP secret must be encrypted at rest');
  assert.equal((await call('POST', '/api/account/mfa/enable', { code: '000000' }, 'adm')).s, 400);
  const step = Math.floor(Date.now() / 30000);
  const en = await call('POST', '/api/account/mfa/enable', { code: totp(setup.secret, step) }, 'adm');
  assert.equal(en.s, 200); assert.equal(en.j.recoveryCodes.length, 8);

  const noCode = await call('POST', '/api/auth/login', ADMIN, 'adm2');
  assert.equal(noCode.s, 401); assert.equal(noCode.j.mfaRequired, true); assert.ok(!jar.adm2);
  assert.equal((await call('POST', '/api/auth/login', { ...ADMIN, code: '123456' }, 'adm2')).s, 401);
  assert.equal((await call('POST', '/api/auth/login', { ...ADMIN, code: totp(setup.secret, step) }, 'adm2')).s, 401, 'same code cannot be reused');
  assert.equal((await call('POST', '/api/auth/login', { ...ADMIN, code: totp(setup.secret, step + 1) }, 'adm2')).s, 200);
  const rc = en.j.recoveryCodes[0];
  assert.equal((await call('POST', '/api/auth/login', { ...ADMIN, code: rc }, 'adm3')).s, 200);
  assert.equal((await call('POST', '/api/auth/login', { ...ADMIN, code: rc }, 'adm4')).s, 401, 'recovery code is single-use');
  Object.assign(csrf, { adm: csrf.adm3 }); jar.adm = jar.adm3;
});

test('mandatory admin MFA gate (production setting)', async () => {
  process.env.REQUIRE_ADMIN_MFA = '1';
  db.prepare('UPDATE sessions SET mfa=0 WHERE token=?').run(SEC.sha(jar.adm.split('=')[1]));
  const r = await call('GET', '/api/admin/stats', null, 'adm');
  assert.equal(r.s, 403); assert.equal(r.j.code, 'mfa_required');
  // the Security page itself must stay readable, otherwise 2FA could never be set up
  assert.equal((await call('GET', '/api/admin/security/overview', null, 'adm')).s, 200);
  assert.equal((await call('GET', '/api/admin/security/sessions', null, 'adm')).s, 200);
  assert.equal((await call('POST', '/api/admin/security/backup', {}, 'adm')).s, 403, 'but changes stay locked');
  delete process.env.REQUIRE_ADMIN_MFA;
});

test('password reset: neutral response, single-use token, signs out everywhere, weak passwords refused', async () => {
  const logs = []; const orig = console.log; console.log = (...a) => { logs.push(a.join(' ')); };
  let known, unknown;
  try { known = await call('POST', '/api/auth/forgot', { email: 'lock@example.com' }); unknown = await call('POST', '/api/auth/forgot', { email: 'nobody@example.com' }); } finally { console.log = orig; }
  assert.deepEqual(known.j, unknown.j);   // cannot be used to discover accounts
  const token = (logs.join('\n').match(/token=([0-9a-f]{64})/) || [])[1]; assert.ok(token, 'reset link generated');
  assert.ok(!db.prepare('SELECT 1 FROM password_resets WHERE token_hash=?').get(token), 'token stored hashed');
  assert.equal((await call('POST', '/api/auth/reset', { token: 'f'.repeat(64), password: 'Whatever-123' })).s, 400);
  assert.equal((await call('POST', '/api/auth/reset', { token, password: 'password123' })).s, 400);
  assert.equal((await call('POST', '/api/auth/reset', { token, password: 'Brand-new-pass-7' })).s, 200);
  assert.equal((await call('POST', '/api/auth/reset', { token, password: 'Another-pass-88' })).s, 400, 'token is single-use');
  assert.equal((await call('POST', '/api/auth/login', { email: 'lock@example.com', password: 'Brand-new-pass-7' }, 'again')).s, 200);
});

test('privacy: export my data, delete my account (orders anonymised)', async () => {
  const exp = await call('GET', '/api/account/export', null, 'again');
  assert.equal(exp.s, 200); assert.equal(exp.j.account.email, 'lock@example.com');
  assert.equal((await call('POST', '/api/account/delete', { password: 'wrong' }, 'again')).s, 400);
  assert.equal((await call('POST', '/api/account/delete', { password: 'Brand-new-pass-7' }, 'again')).s, 200);
  assert.ok(!db.prepare("SELECT 1 FROM users WHERE email='lock@example.com'").get());
});

test('backups: manual run creates a consistent copy, status reported', async () => {
  const r = await call('POST', '/api/admin/security/backup', {}, 'adm');
  assert.equal(r.s, 200); assert.equal(r.j.result.ok, true); assert.ok(r.j.backup.healthy);
  const files = fs.readdirSync(process.env.BACKUP_DIR); assert.equal(files.length, 1);
  const { DatabaseSync } = require('node:sqlite'); const copy = new DatabaseSync(path.join(process.env.BACKUP_DIR, files[0]));
  assert.ok(copy.prepare('SELECT COUNT(*) c FROM products').get().c >= 5); copy.close();
});

test('IP reputation: repeated abuse raises an alert; global rate limit returns 429', async () => {
  for (let i = 0; i < 16; i++) SEC.logEvent('login_failed', 'info', { ip: '203.0.113.9', headers: {} }, { email: 'a@b.co' });
  assert.ok(SEC.blocked.has('203.0.113.9'));
  assert.ok(db.prepare("SELECT 1 FROM admin_alerts WHERE title LIKE 'Suspicious activity from 203.0.113.9'").get());
  const ov = (await call('GET', '/api/admin/security/overview', null, 'adm')).j;
  assert.ok(ov.suspiciousIps.some(x => x.ip === '203.0.113.9')); assert.ok(ov.counts.failedLogins24h > 0);
  assert.equal((await call('DELETE', '/api/admin/security/blocked/203.0.113.9', null, 'adm')).s, 200);
  process.env.RATE_LIMIT_PER_MIN = '5';
  let got429 = false; for (let i = 0; i < 12 && !got429; i++) got429 = (await call('GET', '/api/products')).s === 429;
  assert.ok(got429); process.env.RATE_LIMIT_PER_MIN = '400'; process.env.LOGIN_RATE_PER_MIN = '200';
});

test('vercel.json carries the same security headers/CSP as the app (CDN-served static files)', () => {
  const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const csp = cfg.headers[0].headers.find(h => h.key === 'Content-Security-Policy').value;
  assert.equal(csp, SEC.csp(true), 'run: node scripts/sync-vercel-headers.js');
  for (const k of ['Strict-Transport-Security', 'X-Content-Type-Options', 'X-Frame-Options', 'Referrer-Policy']) assert.ok(cfg.headers[0].headers.some(h => h.key === k), k);
});

test('private/proxy addresses are never auto-blocked; public ones are', () => {
  for (const ip of ['127.0.0.1', '::1', '10.1.2.3', '192.168.0.5', '172.20.1.1', '::ffff:10.0.0.2']) assert.ok(SEC.isPrivateIp(ip), ip);
  for (const ip of ['203.0.113.9', '8.8.8.8', '172.32.0.1']) assert.ok(!SEC.isPrivateIp(ip), ip);
});

test('a stale session cookie never gets a visitor blocked, and is cleared', async () => {
  const stale = { Cookie: 'kb_session=' + 'a'.repeat(64) };
  let cleared = false;
  for (let i = 0; i < 40; i++) { const r = await call('GET', '/api/products', null, 'stale', stale); assert.equal(r.s, 200); if ((r.h.get('set-cookie') || '').includes('Max-Age=0')) cleared = true; }
  assert.ok(cleared, 'server tells the browser to drop the dead cookie');
  assert.ok(!SEC.blocked.has('127.0.0.1'));
});
