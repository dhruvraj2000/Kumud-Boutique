'use strict';
// Authentication, MFA, password reset, privacy controls and the admin security console.
const crypto = require('crypto');
const express = require('express');
const { db, hashPassword } = require('./db');
const S = require('./security');
const { send, alertAdmin } = require('./notify');
const backup = require('./backup');
const QR = require('qrcode');

const { Denied, logEvent, audit, needUser, needPerm, needAdmin, sha } = S;
const router = express.Router();
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bad = (m, field) => new Denied(400, m, { field });
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const COMMON = new Set(['password1', 'password123', 'qwerty123', 'welcome123', 'admin@12345', 'admin12345', '12345678a', 'iloveyou1', 'abcd1234']);
function pwProblem(pw, role = 'customer') {
  const min = S.STAFF.includes(role) ? 12 : 8;
  if (pw.length < min || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return `Password needs ${min}+ characters with a letter and a number.`;
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common. Please choose another.';
  return '';
}
const publicUser = u => u && ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role, staff: S.STAFF.includes(u.role), mfa: !!u.totp_enabled });
const rl = new Map();
const limit = (name, max, ms) => (req, res, next) => {
  const k = name + ':' + req.ip, t = Date.now(), a = (rl.get(k) || []).filter(x => t - x < ms);
  if (a.length >= max) { logEvent('rate_limited', 'warn', req, { detail: name }); return next(new Denied(429, 'Too many attempts. Please wait a few minutes and try again.')); }
  a.push(t); rl.set(k, a); next();
};
setInterval(() => rl.clear(), 15 * 60000).unref();
const verifyPw = (pw, u) => { const h = hashPassword(pw, u ? u.salt : '00'.repeat(16)).hash; return !!u && crypto.timingSafeEqual(Buffer.from(h), Buffer.from(u.hash)); };

/* ---------- sign in / out ---------- */
router.post('/auth/login', limit('login', Number(process.env.LOGIN_RATE_PER_MIN || 12), 60000), (req, res, next) => {
  const email = str(req.body.email, 120).toLowerCase(), pw = String(req.body.password || '').slice(0, 200), code = str(req.body.code, 20);
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (u && u.locked_until > Date.now()) {
    logEvent('login_locked', 'info', req, { userId: u.id, email, detail: 'attempt while locked' });
    return next(new Denied(429, `Too many failed attempts. Try again in ${Math.ceil((u.locked_until - Date.now()) / 60000)} minutes.`));
  }
  const ok = verifyPw(pw, u);
  if (!ok) {
    if (u) S.noteFailure(u, req, 'login_failed', 'wrong password'); else logEvent('login_failed', 'info', req, { email, detail: 'unknown account' });
    return next(new Denied(401, 'Incorrect email or password.'));
  }
  if (u.totp_enabled) {
    if (!code) return res.status(401).json({ error: 'Enter the 6-digit code from your authenticator app.', mfaRequired: true, field: 'code' });
    if (!(S.verifyTotp(u, code) || S.useRecoveryCode(u, code))) {
      S.noteFailure(u, req, 'mfa_failed', 'wrong second-factor code');
      return res.status(401).json({ error: 'That code is not correct or has already been used.', mfaRequired: true, field: 'code' });
    }
  }
  S.noteSuccess(u, req, !!u.totp_enabled);
  const { csrf } = S.createSession(req, res, u, !!u.totp_enabled);
  res.json({ user: publicUser(u), csrf, mfaSetupRequired: u.role === 'admin' && !u.totp_enabled });
});
router.post('/auth/logout', (req, res) => { if (req.user) logEvent('logout', 'info', req); S.endSession(res, req); res.json({ ok: true }); });
router.get('/auth/me', (req, res) => res.json({ user: req.user ? publicUser(req.user) : null, csrf: req.user ? req.user.csrf : undefined }));

/* ---------- password reset (token emailed; only the hash is stored) ---------- */
db.exec('CREATE TABLE IF NOT EXISTS password_resets(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL, used INTEGER DEFAULT 0)');
router.post('/auth/forgot', limit('forgot', 5, 10 * 60000), (req, res) => {
  const email = str(req.body.email, 120).toLowerCase(), u = isEmail(email) && db.prepare('SELECT * FROM users WHERE email=?').get(email);
  if (u) {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('DELETE FROM password_resets WHERE user_id=? OR expires_at<?').run(u.id, Date.now());
    db.prepare('INSERT INTO password_resets(token_hash,user_id,expires_at) VALUES(?,?,?)').run(sha(token), u.id, Date.now() + 3600000);
    const base = (process.env.BASE_URL || `${req.protocol}://${req.headers.host}`).replace(/\/$/, ''), link = `${base}/#/reset?token=${token}`;
    logEvent('password_reset_requested', 'info', req, { userId: u.id, email });
    send('email', u.email, 'Reset your Kumud Boutique password', `Hello ${u.name},\n\nUse this link to choose a new password (valid for 1 hour):\n${link}\n\nIf you did not ask for this, you can ignore this email — your password has not changed.`);
    if (!S.PROD && !process.env.RESEND_API_KEY) console.log('[dev] password reset link for', email, '→', link);
  }
  res.json({ ok: true, message: 'If an account exists for that email, a reset link is on its way.' });   // same answer either way
});
router.post('/auth/reset', limit('reset', 10, 10 * 60000), (req, res, next) => {
  const row = db.prepare('SELECT * FROM password_resets WHERE token_hash=? AND used=0 AND expires_at>?').get(sha(str(req.body.token, 100)), Date.now());
  if (!row) return next(bad('This reset link is invalid or has expired. Please request a new one.'));
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(row.user_id), pw = String(req.body.password || ''), problem = pwProblem(pw, u.role);
  if (problem) return next(bad(problem, 'password'));
  const { salt, hash } = hashPassword(pw);
  db.prepare('UPDATE users SET salt=?, hash=?, failed_attempts=0, locked_until=0 WHERE id=?').run(salt, hash, u.id);
  db.prepare('UPDATE password_resets SET used=1 WHERE token_hash=?').run(row.token_hash);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id);   // sign out everywhere
  logEvent('password_reset_done', 'warn', req, { userId: u.id, email: u.email });
  if (S.STAFF.includes(u.role)) alertAdmin('warn', `Password reset for ${u.role} ${u.email}`, `Completed from ${req.ip}.`);
  res.json({ ok: true });
});

/* ---------- multi-factor authentication ---------- */
router.post('/account/mfa/setup', needUser, async (req, res, next) => {
  if (!S.STAFF.includes(req.user.role)) return next(new Denied(403, 'Two-factor sign-in is for staff accounts.'));
  if (req.user.totp_enabled) return next(bad('Two-factor authentication is already on.'));
  const secret = S.newTotpSecret();
  db.prepare('UPDATE users SET totp_secret=? WHERE id=?').run(S.seal(secret), req.user.id);
  const uri = S.totpUri(secret, req.user.email);
  res.json({ secret, uri, qrSvg: await QR.toString(uri, { type: 'svg', margin: 1, width: 192 }) });
});
router.post('/account/mfa/enable', needUser, (req, res, next) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (!u.totp_secret || u.totp_enabled) return next(bad('Start the setup first.'));
  if (!S.verifyTotp(u, req.body.code)) return next(bad('That code is not correct. Check the time on your phone and try again.', 'code'));
  const { codes, stored } = S.makeRecoveryCodes();
  db.prepare('UPDATE users SET totp_enabled=1, recovery_codes=? WHERE id=?').run(stored, u.id);
  db.prepare('UPDATE sessions SET mfa=1 WHERE token=?').run(req.user.sid);
  audit(req, 'mfa.enabled', u.email); logEvent('mfa_enabled', 'info', req);
  res.json({ ok: true, recoveryCodes: codes });
});
router.post('/account/mfa/disable', needUser, (req, res, next) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (S.requireMfa() && u.role === 'admin') return next(new Denied(403, 'Administrators must keep two-factor authentication on.'));
  if (!verifyPw(String(req.body.password || ''), u) || !(S.verifyTotp(u, req.body.code) || S.useRecoveryCode(u, req.body.code))) return next(bad('Password or code is incorrect.'));
  db.prepare("UPDATE users SET totp_enabled=0, totp_secret='', recovery_codes='' WHERE id=?").run(u.id);
  audit(req, 'mfa.disabled', u.email); alertAdmin('warn', `Two-factor turned off for ${u.email}`, `From ${req.ip}.`);
  res.json({ ok: true });
});

/* ---------- privacy: export + delete my data ---------- */
router.get('/account/export', needUser, (req, res) => {
  const id = req.user.id, one = (sql, ...p) => db.prepare(sql).all(...p);
  res.setHeader('Content-Disposition', 'attachment; filename="my-kumud-boutique-data.json"');
  res.json({
    exportedAt: new Date().toISOString(), account: one('SELECT id,name,email,phone,role,created_at FROM users WHERE id=?', id)[0],
    addresses: one('SELECT label,name,phone,line1,line2,city,state,pincode FROM addresses WHERE user_id=?', id),
    measurements: one('SELECT data,updated_at FROM measurements WHERE user_id=?', id),
    orders: one('SELECT number,status,total,payment_method,payment_status,address,created_at FROM orders WHERE user_id=?', id),
    reviews: one('SELECT product_id,rating,title,body,created_at FROM reviews WHERE user_id=?', id)
  });
});
router.post('/account/delete', needUser, limit('delete', 5, 600000), (req, res, next) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  if (S.STAFF.includes(u.role)) return next(new Denied(403, 'Staff accounts are removed by an administrator.'));
  if (!verifyPw(String(req.body.password || ''), u)) return next(bad('Password is incorrect.', 'password'));
  db.exec('BEGIN');
  try {   // orders are kept for tax/accounting but stripped of personal details
    db.prepare("UPDATE orders SET user_id=NULL, email='deleted@invalid', phone='', address='{\"name\":\"Deleted customer\",\"line1\":\"\",\"city\":\"\",\"state\":\"\",\"pincode\":\"\"}', notes='', measurements='' WHERE user_id=?").run(u.id);
    db.prepare('DELETE FROM users WHERE id=?').run(u.id); db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); return next(e); }
  logEvent('account_deleted', 'info', req, { userId: null, email: u.email }); S.endSession(res, req);
  res.json({ ok: true });
});

/* ---------- admin security console ---------- */
const A = needAdmin;
const since = h => Date.now() - h * 3600000;
router.get('/admin/security/overview', S.needAdminSetup, (req, res) => {
  const q = (sql, ...p) => db.prepare(sql).all(...p), one = (sql, ...p) => db.prepare(sql).get(...p);
  const staff = q("SELECT id,name,email,role,totp_enabled mfa,last_login_at lastLogin,last_login_ip lastIp FROM users WHERE role IN ('admin','manager','delivery') ORDER BY id");
  res.json({
    counts: {
      failedLogins24h: one("SELECT COUNT(*) c FROM security_events WHERE type IN ('login_failed','mfa_failed') AND ts>?", since(24)).c,
      unauthorized24h: one("SELECT COUNT(*) c FROM security_events WHERE type IN ('forbidden','csrf_blocked','invalid_session') AND ts>?", since(24)).c,
      blockedIps: one('SELECT COUNT(*) c FROM blocked_ips WHERE until>?', Date.now()).c, unreadAlerts: one('SELECT COUNT(*) c FROM admin_alerts WHERE read=0').c,
      activeSessions: one('SELECT COUNT(*) c FROM sessions WHERE expires_at>?', Date.now()).c
    },
    alerts: q('SELECT id,ts,severity,title,body,read FROM admin_alerts ORDER BY id DESC LIMIT 30'),
    recentLogins: q("SELECT ts,email,ip,detail,ua FROM security_events WHERE type='login_ok' ORDER BY id DESC LIMIT 15"),
    failedLogins: q("SELECT ts,type,email,ip,detail FROM security_events WHERE type IN ('login_failed','mfa_failed','account_locked','login_locked') ORDER BY id DESC LIMIT 25"),
    unauthorized: q("SELECT ts,type,email,ip,detail FROM security_events WHERE type IN ('forbidden','csrf_blocked','invalid_session','rate_limited') ORDER BY id DESC LIMIT 25"),
    suspiciousIps: q("SELECT ip, COUNT(*) hits, MAX(ts) last, SUM(type IN ('login_failed','mfa_failed')) logins FROM security_events WHERE ts>? AND ip<>'' AND type IN ('login_failed','mfa_failed','forbidden','csrf_blocked','rate_limited','invalid_session') GROUP BY ip HAVING hits>=3 ORDER BY hits DESC LIMIT 15", since(24)),
    blocked: q('SELECT ip,until,reason FROM blocked_ips WHERE until>? ORDER BY until DESC', Date.now()),
    activity: q('SELECT ts,actor_email,action,target,detail,ip FROM audit_log ORDER BY id DESC LIMIT 40'),
    staff, backup: backup.status(), perf: S.perfStats(),
    errors: q('SELECT ts,kind,route,status,ms,message FROM error_log ORDER BY id DESC LIMIT 15'),
    config: {
      https: S.PROD, mfaRequired: S.requireMfa(), adminMfaOn: staff.some(s => s.role === 'admin' && s.mfa),
      defaultAdminPassword: !process.env.ADMIN_PASSWORD, emailAlerts: !!(process.env.ALERT_EMAIL && process.env.RESEND_API_KEY), webhookAlerts: !!process.env.ALERT_WEBHOOK_URL,
      sessionSecretSet: !!process.env.SESSION_SECRET
    }
  });
});
router.get('/admin/security/sessions', S.needAdminSetup, (req, res) => res.json({
  sessions: db.prepare('SELECT s.rowid id,u.email,u.role,s.ip,s.ua,s.created_at createdAt,s.last_seen lastSeen,s.mfa,(s.token=?) current FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.expires_at>? ORDER BY s.last_seen DESC LIMIT 100').all(req.user.sid, Date.now())
}));
router.delete('/admin/security/sessions/:id', A, (req, res, next) => {
  const r = db.prepare('SELECT s.token,u.email FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.rowid=?').get(Number(req.params.id));
  if (!r) return next(new Denied(404, 'Session not found.'));
  db.prepare('DELETE FROM sessions WHERE token=?').run(r.token); audit(req, 'session.revoked', r.email);
  res.json({ ok: true });
});
router.delete('/admin/security/blocked/:ip', A, (req, res) => {
  const ip = decodeURIComponent(req.params.ip); db.prepare('DELETE FROM blocked_ips WHERE ip=?').run(ip); S.blocked.delete(ip); audit(req, 'ip.unblocked', ip);
  res.json({ ok: true });
});
router.post('/admin/security/block', A, (req, res, next) => {
  const ip = str(req.body.ip, 60); if (!/^[0-9a-fA-F:.]{3,45}$/.test(ip)) return next(bad('Enter a valid IP address.'));
  if (ip === req.ip) return next(bad('You cannot block your own address.'));
  S.blockIp(ip, Math.min(10080, Math.max(5, Number(req.body.minutes) || 1440)), 'Blocked by ' + req.user.email); audit(req, 'ip.blocked', ip);
  res.json({ ok: true });
});
router.post('/admin/security/alerts/read', A, (req, res) => { db.prepare('UPDATE admin_alerts SET read=1').run(); res.json({ ok: true }); });
router.post('/admin/security/backup', A, (req, res) => { const r = backup.run('manual by ' + req.user.email); audit(req, 'backup.manual', r.file || '', r.ok ? 'ok' : r.note); res.json({ result: r, backup: backup.status() }); });

/* staff accounts (RBAC) */
router.post('/admin/staff', A, (req, res, next) => {
  const name = str(req.body.name, 80), email = str(req.body.email, 120).toLowerCase(), role = str(req.body.role, 20), pw = String(req.body.password || '');
  if (!['manager', 'delivery'].includes(role)) return next(bad('Role must be manager or delivery.', 'role'));
  if (name.length < 2 || !isEmail(email)) return next(bad('Enter a name and a valid email.', 'email'));
  const problem = pwProblem(pw, role); if (problem) return next(bad(problem, 'password'));
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return next(new Denied(409, 'That email already has an account.', { field: 'email' }));
  const { salt, hash } = hashPassword(pw);
  db.prepare('INSERT INTO users(name,email,phone,salt,hash,role) VALUES(?,?,?,?,?,?)').run(name, email, str(req.body.phone, 15).replace(/\D/g, ''), salt, hash, role);
  audit(req, 'staff.created', email, role); res.status(201).json({ ok: true });
});
router.delete('/admin/staff/:id', A, (req, res, next) => {
  const u = db.prepare("SELECT * FROM users WHERE id=? AND role IN ('manager','delivery')").get(Number(req.params.id));
  if (!u) return next(new Denied(404, 'Staff member not found.'));
  db.prepare("UPDATE users SET role='customer' WHERE id=?").run(u.id); db.prepare('DELETE FROM sessions WHERE user_id=?').run(u.id); audit(req, 'staff.removed', u.email);
  res.json({ ok: true });
});

module.exports = { router, publicUser, pwProblem, limit };
