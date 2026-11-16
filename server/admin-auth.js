'use strict';
// Admin portal authentication: scrypt passwords, DB-backed sessions (hash stored), CSRF token, lockout.
const crypto = require('crypto');
const express = require('express');
const mysql = require('./mysql');
const { ServiceError } = require('./booking-service');

const COOKIE = 'kb_admin';
const SESSION_HOURS = 12, MAX_FAILS = 5, LOCK_MINUTES = 15;

const scrypt = (pw, salt) => new Promise((res, rej) => crypto.scrypt(pw, salt, 64, (e, k) => (e ? rej(e) : res(k))));
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${(await scrypt(pw, salt)).toString('hex')}`;
}
async function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, 'hex'), got = await scrypt(pw, Buffer.from(saltHex, 'hex'));
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const cookieOf = req => { const m = (req.headers.cookie || '').split(';').map(c => c.trim()).find(c => c.startsWith(COOKIE + '=')); return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : ''; };
const setCookie = (res, token, maxAge) => res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

async function sessionFor(req) {
  const t = cookieOf(req);
  if (!t) return null;
  const [row] = await mysql.query('SELECT a.id,a.email,a.name,s.csrf_token FROM admin_sessions s JOIN admins a ON a.id=s.admin_id WHERE s.id_hash=? AND s.expires_at > UTC_TIMESTAMP()', [sha(t)]);
  return row || null;
}

const requireAdmin = wrap(async (req, res, next) => {
  if (!mysql.isConfigured()) throw new ServiceError(503, 'The admin portal needs the MySQL database to be configured.');
  const s = await sessionFor(req);
  if (!s) throw new ServiceError(401, 'Please sign in.');
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const sent = Buffer.from(String(req.headers['x-csrf-token'] || '')), want = Buffer.from(s.csrf_token);
    if (sent.length !== want.length || !crypto.timingSafeEqual(sent, want)) throw new ServiceError(403, 'Security check failed. Please reload the page.');
  }
  req.admin = { id: s.id, email: s.email, name: s.name, csrf: s.csrf_token };
  next();
});

const hits = new Map();
const ipLimit = (max, ms) => (req, res, next) => {
  const now = Date.now(), arr = (hits.get(req.ip) || []).filter(t => now - t < ms);
  if (arr.length >= max) return next(new ServiceError(429, 'Too many attempts. Please wait a minute and try again.'));
  arr.push(now); hits.set(req.ip, arr); next();
};

const authRouter = express.Router();
const BAD = 'Incorrect email or password.';

authRouter.post('/login', ipLimit(30, 60000), wrap(async (req, res) => {
  if (!mysql.isConfigured()) throw new ServiceError(503, 'The admin portal needs the MySQL database to be configured.');
  const email = String((req.body || {}).email || '').trim().toLowerCase().slice(0, 190);
  const password = String((req.body || {}).password || '').slice(0, 200);
  const [a] = await mysql.query('SELECT id,email,name,password_hash,failed_attempts,(locked_until IS NOT NULL AND locked_until > UTC_TIMESTAMP()) AS locked FROM admins WHERE email=?', [email]);
  if (a && Number(a.locked)) throw new ServiceError(429, `Too many failed attempts. Try again in ${LOCK_MINUTES} minutes.`);
  const ok = await verifyPassword(password, a ? a.password_hash : 'scrypt$00$00'); // equalise timing for unknown emails
  if (!a || !ok) {
    if (a) {
      const fails = a.failed_attempts + 1;
      await mysql.query(`UPDATE admins SET failed_attempts=?, locked_until=${fails >= MAX_FAILS ? `DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${LOCK_MINUTES} MINUTE)` : 'NULL'} WHERE id=?`, [fails >= MAX_FAILS ? 0 : fails, a.id]);
    }
    throw new ServiceError(401, BAD);
  }
  await mysql.query('UPDATE admins SET failed_attempts=0, locked_until=NULL, last_login_at=UTC_TIMESTAMP() WHERE id=?', [a.id]);
  await mysql.query('DELETE FROM admin_sessions WHERE expires_at < UTC_TIMESTAMP()');
  const token = crypto.randomBytes(32).toString('hex'), csrf = crypto.randomBytes(32).toString('hex');
  await mysql.query(`INSERT INTO admin_sessions(id_hash,admin_id,csrf_token,expires_at) VALUES(?,?,?,DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${SESSION_HOURS} HOUR))`, [sha(token), a.id, csrf]);
  setCookie(res, token, SESSION_HOURS * 3600);
  res.json({ admin: { id: a.id, email: a.email, name: a.name }, csrf });
}));

authRouter.get('/me', requireAdmin, (req, res) => res.json({ admin: { id: req.admin.id, email: req.admin.email, name: req.admin.name }, csrf: req.admin.csrf }));

authRouter.post('/logout', requireAdmin, wrap(async (req, res) => {
  await mysql.query('DELETE FROM admin_sessions WHERE id_hash=?', [sha(cookieOf(req))]);
  setCookie(res, '', 0);
  res.json({ ok: true });
}));

module.exports = { hashPassword, verifyPassword, requireAdmin, authRouter };
