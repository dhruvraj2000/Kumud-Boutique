'use strict';
// Security layer: headers/CSP, HTTPS, CSRF, global rate limit + IP blocking, hashed server-side sessions with idle expiry,
// account lockout, TOTP multi-factor auth, RBAC, audit/security event log, request/error monitoring.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { db, getSetting, setSetting } = require('./db');
const { alertAdmin } = require('./notify');

const PROD = process.env.NODE_ENV === 'production';
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const now = () => Date.now();
const LOOPBACK = { has: ip => /^(127\.|::1$|::ffff:127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:(10|192\.168)\.|f[cd][0-9a-f]{2}:)/i.test(ip || '') };   // loopback/private = a proxy or dev machine: never auto-block
const STAFF = ['admin', 'manager', 'delivery'];
const PERMS = { admin: ['*'], manager: ['orders', 'products', 'inquiries', 'analytics'], delivery: ['delivery'] };
const can = (user, perm) => !!user && (PERMS[user.role] || []).some(p => p === '*' || p === perm);
const requireMfa = () => (process.env.REQUIRE_ADMIN_MFA ?? (PROD ? '1' : '0')) === '1';

/* ---------- secrets & at-rest encryption (TOTP secrets) ---------- */
function serverSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  let s = getSetting('server_secret');
  if (!s) { s = crypto.randomBytes(32).toString('hex'); setSetting('server_secret', s); }
  return s;
}
const key = () => crypto.createHash('sha256').update('kb-seal|' + serverSecret()).digest();
function seal(text) {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map(b => b.toString('base64')).join('.');
}
function unseal(blob) {
  try {
    const [iv, tag, enc] = String(blob).split('.').map(p => Buffer.from(p, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', key(), iv); d.setAuthTag(tag);
    return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
  } catch { return ''; }
}
const csrfFor = tokenHash => crypto.createHmac('sha256', serverSecret()).update('csrf|' + tokenHash).digest('hex').slice(0, 40);

/* ---------- events, audit, IP reputation ---------- */
const blocked = new Map();
for (const r of db.prepare('SELECT ip,until FROM blocked_ips WHERE until>?').all(now())) blocked.set(r.ip, r.until);
// invalid_session is deliberately NOT watched: a stale cookie (e.g. after a server restart) makes every request look invalid and must never block a real visitor.
const WATCH = ['track_miss', 'login_failed', 'mfa_failed', 'forbidden', 'csrf_blocked', 'rate_limited'];

function logEvent(type, severity, req, o = {}) {
  const ip = req ? req.ip || '' : '';
  db.prepare('INSERT INTO security_events(ts,type,severity,ip,user_id,email,detail,ua) VALUES(?,?,?,?,?,?,?,?)').run(now(), type, severity, ip,
    o.userId ?? (req && req.user ? req.user.id : null), String(o.email || (req && req.user ? req.user.email : '')).slice(0, 120), String(o.detail || '').slice(0, 300),
    req ? String(req.headers['user-agent'] || '').slice(0, 200) : '');
  if (ip && WATCH.includes(type)) {
    const n = db.prepare(`SELECT COUNT(*) c FROM security_events WHERE ip=? AND ts>? AND type IN (${WATCH.map(() => '?').join(',')})`).get(ip, now() - 600000, ...WATCH).c;
    if (n >= 15 && !blocked.has(ip)) {
      if (!LOOPBACK.has(ip)) { blockIp(ip, 30, `${n} suspicious requests in 10 minutes`); }
      alertAdmin('high', `Suspicious activity from ${ip}`, `${n} failed/blocked requests in 10 minutes (latest: ${type}). ${LOOPBACK.has(ip) ? '' : 'The address is blocked for 30 minutes.'}`);
    }
  }
}
function blockIp(ip, minutes, reason) {
  const until = now() + minutes * 60000; blocked.set(ip, until);
  db.prepare('INSERT INTO blocked_ips(ip,until,reason) VALUES(?,?,?) ON CONFLICT(ip) DO UPDATE SET until=excluded.until, reason=excluded.reason').run(ip, until, reason);
  db.prepare('INSERT INTO security_events(ts,type,severity,ip,detail) VALUES(?,?,?,?,?)').run(now(), 'ip_blocked', 'high', ip, reason);
}
function audit(req, action, target = '', detail = '') {
  db.prepare('INSERT INTO audit_log(ts,actor_id,actor_email,action,target,detail,ip) VALUES(?,?,?,?,?,?,?)').run(now(), req.user ? req.user.id : null, req.user ? req.user.email : '', action, String(target).slice(0, 80), typeof detail === 'string' ? detail.slice(0, 400) : JSON.stringify(detail).slice(0, 400), req.ip || '');
}

/* ---------- headers / CSP / HTTPS ---------- */
function inlineScriptHashes() {
  const out = [];
  for (const f of ['index.html', 'admin/index.html']) {
    try {
      const h = fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
      for (const m of h.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)) if (!/ld\+json/.test(m[1])) out.push(`'sha256-${crypto.createHash('sha256').update(m[2]).digest('base64')}'`);
    } catch { /* optional */ }
  }
  return [...new Set(out)];
}
const GOOGLE = 'https://maps.googleapis.com https://maps.gstatic.com https://*.googleapis.com https://*.gstatic.com';
function csp(prod = PROD) {
  return [
    "default-src 'self'", `script-src 'self' ${inlineScriptHashes().join(' ')} https://checkout.razorpay.com ${GOOGLE}`,
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com", "font-src 'self' data: https://fonts.gstatic.com",
    `img-src 'self' data: blob: ${GOOGLE} https://*.google.com https://*.ggpht.com https://api.qrserver.com`,
    `connect-src 'self' ${GOOGLE} https://api.razorpay.com https://lumberjack.razorpay.com`,
    'frame-src https://api.razorpay.com https://checkout.razorpay.com https://www.google.com https://www.openstreetmap.org', "worker-src 'self' blob:",
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'", prod ? 'upgrade-insecure-requests' : ''
  ].filter(Boolean).join('; ');
}
const NO_STORE = /^\/api\/(auth|admin|orders|track|account|addresses|portal|courier|security)/;
function headers() {
  const policy = csp();
  return (req, res, next) => {
    if (PROD && process.env.FORCE_HTTPS !== '0' && req.headers['x-forwarded-proto'] === 'http') return res.redirect(308, 'https://' + req.headers.host + req.originalUrl);
    res.setHeader('Content-Security-Policy', policy);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=(), payment=(self), usb=()');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    if (PROD) res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
    if (NO_STORE.test(req.path === '/' ? req.originalUrl : req.originalUrl)) res.setHeader('Cache-Control', 'no-store');
    next();
  };
}

/* ---------- CSRF: block cross-site state changes ---------- */
function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin, site = req.headers['sec-fetch-site'];
  const extra = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  let ok = true;
  if (site === 'cross-site') ok = false;
  if (origin && origin !== 'null') { try { const h = new URL(origin).host; ok = ok && (h === req.headers.host || extra.includes(origin)); } catch { ok = false; } }
  else if (origin === 'null') ok = false;
  if (!ok) { logEvent('csrf_blocked', 'warn', req, { detail: `origin=${origin || '-'} site=${site || '-'} ${req.method} ${req.path}` }); return res.status(403).json({ error: 'Request blocked for your security.' }); }
  next();
}

/* ---------- global rate limit + IP blocks ---------- */
const buckets = new Map();
setInterval(() => { buckets.clear(); for (const [ip, u] of blocked) if (u < now()) blocked.delete(ip); }, 120000).unref();
const lastRL = new Map();
function guard(req, res, next) {
  const ip = req.ip || '', u = blocked.get(ip);
  if (u && u > now()) return res.status(403).json({ error: 'Access from your network is temporarily restricted. Please try again later.' });
  const b = buckets.get(ip) || { n: 0, t: now() };
  if (now() - b.t > 60000) { b.n = 0; b.t = now(); }
  b.n++; buckets.set(ip, b);
  if (b.n > Number(process.env.RATE_LIMIT_PER_MIN || 300)) {
    if (!(lastRL.get(ip) > now() - 60000)) { lastRL.set(ip, now()); logEvent('rate_limited', 'warn', req, { detail: `${b.n} requests/min` }); }
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Too many requests. Please slow down.' });
  }
  next();
}

/* ---------- performance + error monitoring ---------- */
const recent = [];
function monitor(req, res, next) {
  const t0 = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number((process.hrtime.bigint() - t0) / 1000000n), route = (req.route && req.route.path) || req.path;
    recent.push({ ts: now(), ms, status: res.statusCode }); if (recent.length > 1000) recent.shift();
    if (res.statusCode >= 500 || (ms > 1500 && req.path.startsWith('/api'))) {
      db.prepare('INSERT INTO error_log(ts,kind,route,status,ms,message) VALUES(?,?,?,?,?,?)').run(now(), res.statusCode >= 500 ? 'error' : 'slow', `${req.method} ${String(route).slice(0, 100)}`, res.statusCode, ms, res.locals.errMsg || '');
      if (res.statusCode >= 500) alertAdmin('warn', `Server error on ${req.method} ${String(route).slice(0, 60)}`, res.locals.errMsg || 'HTTP ' + res.statusCode);
    }
  });
  next();
}
setInterval(() => db.prepare('DELETE FROM error_log WHERE id NOT IN (SELECT id FROM error_log ORDER BY id DESC LIMIT 2000)').run(), 3600000).unref();
function perfStats() {
  const last = recent.filter(r => r.ts > now() - 900000), ms = last.map(r => r.ms).sort((a, b) => a - b), q = p => (ms.length ? ms[Math.min(ms.length - 1, Math.floor(ms.length * p))] : 0);
  return { requests15m: last.length, p50: q(0.5), p95: q(0.95), errors15m: last.filter(r => r.status >= 500).length, uptimeSec: Math.round(process.uptime()), memoryMb: Math.round(process.memoryUsage().rss / 1048576) };
}

/* ---------- sessions ---------- */
const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(c => c[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const setCookie = (res, token, maxAge, sameSite = 'Lax') => res.setHeader('Set-Cookie', `kb_session=${token}; Path=/; HttpOnly; SameSite=${sameSite}; Max-Age=${maxAge}${PROD ? '; Secure' : ''}`);
const IDLE = { staff: 30 * 60000, customer: 14 * 86400000 };

function createSession(req, res, user, mfa) {
  const token = crypto.randomBytes(32).toString('hex'), staff = STAFF.includes(user.role), maxAge = staff ? 8 * 3600 : 30 * 86400, h = sha(token);
  db.prepare('INSERT INTO sessions(token,user_id,expires_at,created_at,last_seen,ip,ua,mfa) VALUES(?,?,?,?,?,?,?,?)').run(h, user.id, now() + maxAge * 1000, now(), now(), req.ip || '', String(req.headers['user-agent'] || '').slice(0, 200), mfa ? 1 : 0);
  setCookie(res, token, maxAge, staff ? 'Strict' : 'Lax');
  return { csrf: csrfFor(h) };
}
function loadSession(req, res, next) {
  req.user = null;
  const t = cookies(req).kb_session;
  if (t) {
    const h = sha(t);
    const row = db.prepare('SELECT u.id,u.name,u.email,u.phone,u.role,u.totp_enabled,s.expires_at,s.last_seen,s.mfa FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get(h);
    const idle = row && (STAFF.includes(row.role) ? IDLE.staff : IDLE.customer);
    if (row && row.expires_at > now() && now() - (row.last_seen || 0) < idle) {
      req.user = { ...row, sid: h, csrf: csrfFor(h), mfaDone: !!row.mfa };
      if (now() - row.last_seen > 60000) db.prepare('UPDATE sessions SET last_seen=? WHERE token=?').run(now(), h);
    } else {
      db.prepare('DELETE FROM sessions WHERE token=?').run(h);
      if (row) logEvent('session_expired', 'info', req, { userId: row.id, email: row.email });
      else { setCookie(res, '', 0); logEvent('invalid_session', 'info', req, { detail: 'unknown session token (cookie cleared)' }); }   // clear it so the browser stops sending it
    }
  }
  next();
}
const endSession = (res, req) => { if (req.user) db.prepare('DELETE FROM sessions WHERE token=?').run(req.user.sid); setCookie(res, '', 0); };
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at<? OR created_at=0').run(now()), 3600000).unref();

/* ---------- access control ---------- */
class Denied extends Error { constructor(status, message, extra) { super(message); this.status = status; Object.assign(this, extra); } }
const needUser = (req, res, next) => (req.user ? next() : next(new Denied(401, 'Please sign in to continue.')));
// Staff permission gate: role check, CSRF token on writes, and mandatory MFA for the owner account in production.
const needPerm = (perm, opts = {}) => (req, res, next) => {
  if (!req.user) { logEvent('forbidden', 'warn', req, { detail: `unauthenticated ${req.method} ${req.originalUrl.split('?')[0]}` }); return next(new Denied(401, 'Please sign in to continue.')); }
  if (!can(req.user, perm)) { logEvent('forbidden', 'warn', req, { detail: `${req.user.role} denied ${perm} ${req.method} ${req.originalUrl.split('?')[0]}` }); return next(new Denied(403, 'You do not have permission to do that.')); }
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const sent = Buffer.from(String(req.headers['x-csrf-token'] || '')), want = Buffer.from(req.user.csrf);
    if (sent.length !== want.length || !crypto.timingSafeEqual(sent, want)) { logEvent('csrf_blocked', 'warn', req, { detail: 'missing/invalid CSRF token on staff action' }); return next(new Denied(403, 'Security check failed. Please reload the page.')); }
  }
  if (!opts.mfaExempt && requireMfa() && req.user.role === 'admin' && !req.user.mfaDone) return next(new Denied(403, 'Two-factor authentication is required for administrators. Set it up under Admin → Security.', { code: 'mfa_required' }));
  next();
};
const needAdmin = needPerm('*');
// Read-only pages an admin must be able to open BEFORE 2FA is enrolled (the Security page is where 2FA is set up).
const needAdminSetup = needPerm('*', { mfaExempt: true });

/* ---------- TOTP (RFC 6238) ---------- */
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const b32 = buf => { let bits = '', out = ''; for (const b of buf) bits += b.toString(2).padStart(8, '0'); for (let i = 0; i < bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2)]; return out; };
const unb32 = s => { let bits = ''; for (const c of s.replace(/=+$/, '')) bits += B32.indexOf(c).toString(2).padStart(5, '0'); const out = []; for (let i = 0; i + 8 <= bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8), 2)); return Buffer.from(out); };
function hotp(secret, counter) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', secret).update(buf).digest(), o = h[19] & 15;
  return String(((h[o] & 0x7f) << 24 | h[o + 1] << 16 | h[o + 2] << 8 | h[o + 3]) % 1000000).padStart(6, '0');
}
const newTotpSecret = () => b32(crypto.randomBytes(20));
const totpUri = (secret, email) => `otpauth://totp/${encodeURIComponent('Kumud Boutique:' + email)}?secret=${secret}&issuer=${encodeURIComponent('Kumud Boutique')}&digits=6&period=30`;
function verifyTotp(userRow, code) {
  const secret = unseal(userRow.totp_secret); code = String(code || '').replace(/\s/g, '');
  if (!secret || !/^\d{6}$/.test(code)) return false;
  const step = Math.floor(now() / 30000);
  for (const w of [-1, 0, 1]) {
    const s = step + w;
    if (s <= userRow.totp_last) continue;   // each code works once (replay protection)
    const want = hotp(unb32(secret), s);
    if (crypto.timingSafeEqual(Buffer.from(want), Buffer.from(code))) { db.prepare('UPDATE users SET totp_last=? WHERE id=?').run(s, userRow.id); return true; }
  }
  return false;
}
function makeRecoveryCodes() {
  const codes = Array.from({ length: 8 }, () => crypto.randomBytes(5).toString('hex').replace(/^(.{5})(.{5})$/, '$1-$2'));
  return { codes, stored: JSON.stringify(codes.map(c => sha(c))) };
}
function useRecoveryCode(userRow, code) {
  const h = sha(String(code || '').trim().toLowerCase()); let list = []; try { list = JSON.parse(userRow.recovery_codes || '[]'); } catch { /* none */ }
  if (!list.includes(h)) return false;
  db.prepare('UPDATE users SET recovery_codes=? WHERE id=?').run(JSON.stringify(list.filter(x => x !== h)), userRow.id);
  return true;
}

/* ---------- account lockout ---------- */
const MAX_FAILS = 5, LOCK_MIN = 15;
function noteFailure(u, req, type, detail) {
  const fails = (u.failed_attempts || 0) + 1, lock = fails >= MAX_FAILS;
  db.prepare('UPDATE users SET failed_attempts=?, locked_until=? WHERE id=?').run(lock ? 0 : fails, lock ? now() + LOCK_MIN * 60000 : 0, u.id);
  logEvent(type, STAFF.includes(u.role) ? 'warn' : 'info', req, { userId: u.id, email: u.email, detail });
  if (lock) {
    logEvent('account_locked', 'warn', req, { userId: u.id, email: u.email, detail: `locked for ${LOCK_MIN} minutes` });
    if (STAFF.includes(u.role)) alertAdmin('high', `Staff account locked: ${u.email}`, `Too many failed sign-ins from ${req.ip}. Locked for ${LOCK_MIN} minutes.`);
  }
}
function noteSuccess(u, req, mfa) {
  const ip = req.ip || '', known = db.prepare("SELECT 1 FROM security_events WHERE type='login_ok' AND user_id=? AND ip=? LIMIT 1").get(u.id, ip);
  db.prepare("UPDATE users SET failed_attempts=0, locked_until=0, last_login_at=datetime('now'), last_login_ip=? WHERE id=?").run(ip, u.id);
  logEvent('login_ok', 'info', req, { userId: u.id, email: u.email, detail: (mfa ? 'with MFA' : 'password only') + (STAFF.includes(u.role) ? ' · ' + u.role : '') });
  if (STAFF.includes(u.role) && !known) alertAdmin('warn', `${u.role} sign-in from a new address`, `${u.email} signed in from ${ip} (${String(req.headers['user-agent'] || '').slice(0, 80)}).`);
}

module.exports = {
  PROD, csp, isPrivateIp: ip => LOOPBACK.has(ip), STAFF, PERMS, can, sha, seal, unseal, logEvent, audit, blockIp, blocked, headers, csrfGuard, guard, monitor, perfStats, recent,
  cookies, createSession, loadSession, endSession, setCookie, Denied, needUser, needPerm, needAdmin, needAdminSetup, requireMfa,
  newTotpSecret, totpUri, verifyTotp, makeRecoveryCodes, useRecoveryCode, noteFailure, noteSuccess, LOCK_MIN, csrfFor
};
