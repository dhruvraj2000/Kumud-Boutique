'use strict';
// Visitor analytics + enquiry management.
//  - POST /api/visit             public beacon from the storefront router (one row per page view)
//  - GET  /api/admin/traffic     daily visitors/page views, top pages, sources, devices, countries
//  - GET  /api/admin/visitors    one row per visitor (anonymous ID), with name once they sign in or send an enquiry
//  - GET  /api/admin/visitors/:vid   that visitor's page trail
//  - GET/PATCH /api/admin/inquiries  list with status/search, update status
// Privacy: no raw IP is stored (salted hash only), query strings are dropped, Do-Not-Track is honoured client-side,
// and rows older than RETENTION_DAYS are purged.
const crypto = require('crypto');
const express = require('express');
const { db, getSetting, setSetting } = require('./db');
const SEC = require('./security');
const { alertAdmin, send } = require('./notify');

const RETENTION_DAYS = Number(process.env.VISIT_RETENTION_DAYS) || 400;
const IST = "'unixepoch','+330 minutes'";

db.exec(`
CREATE TABLE IF NOT EXISTS visits(
  id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, vid TEXT NOT NULL, page TEXT NOT NULL, ref TEXT DEFAULT '',
  device TEXT DEFAULT '', browser TEXT DEFAULT '', os TEXT DEFAULT '', country TEXT DEFAULT '', ip_hash TEXT DEFAULT '', user_id INTEGER);
CREATE INDEX IF NOT EXISTS idx_visits_ts ON visits(ts);
CREATE INDEX IF NOT EXISTS idx_visits_vid ON visits(vid, ts);
`);
const hasCol = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some(r => r.name === c);
if (!hasCol('inquiries', 'status')) db.exec("ALTER TABLE inquiries ADD COLUMN status TEXT NOT NULL DEFAULT 'new'");
if (!hasCol('inquiries', 'visitor_id')) db.exec("ALTER TABLE inquiries ADD COLUMN visitor_id TEXT DEFAULT ''");
const STATUSES = ['new', 'read', 'replied', 'closed'];

/* ---------- helpers ---------- */
const BOT = /bot|crawl|spider|slurp|facebookexternalhit|preview|headless|lighthouse|pingdom|uptime|monitor|curl|wget|python-requests|axios|node-fetch|go-http|java\//i;
function salt() { let s = getSetting('visit_salt'); if (!s) { s = crypto.randomBytes(16).toString('hex'); setSetting('visit_salt', s); } return s; }
const ipHash = ip => crypto.createHash('sha256').update(salt() + '|' + (ip || '')).digest('hex').slice(0, 16);
function parseUa(ua) {
  const device = /ipad|tablet/i.test(ua) ? 'Tablet' : /mobi|android|iphone/i.test(ua) ? 'Mobile' : 'Desktop';
  const browser = /edg\//i.test(ua) ? 'Edge' : /opr\/|opera/i.test(ua) ? 'Opera' : /chrome|crios/i.test(ua) ? 'Chrome' : /firefox|fxios/i.test(ua) ? 'Firefox' : /safari/i.test(ua) ? 'Safari' : 'Other';
  const os = /android/i.test(ua) ? 'Android' : /iphone|ipad|ios/i.test(ua) ? 'iOS' : /windows/i.test(ua) ? 'Windows' : /mac os/i.test(ua) ? 'macOS' : /linux/i.test(ua) ? 'Linux' : 'Other';
  return { device, browser, os };
}
const countryOf = req => String(req.headers['x-vercel-ip-country'] || req.headers['cf-ipcountry'] || req.headers['cloudfront-viewer-country'] || '').toUpperCase().slice(0, 2).replace(/[^A-Z]/g, '');
const refHost = (ref, host) => { try { const h = new URL(ref).host; return h === host ? '' : h.replace(/^www\./, '').slice(0, 80); } catch { return ''; } };
const cleanPage = p => { const s = String(p || '/').split('?')[0].replace(/[^\x20-\x7e]/g, '').slice(0, 120); return s.startsWith('/') ? s : '/' + s; };
const VID = /^[A-Za-z0-9-]{16,40}$/;

const hits = new Map();
setInterval(() => hits.clear(), 60000).unref();
const rateOk = (ip, max) => { const n = (hits.get(ip) || 0) + 1; hits.set(ip, n); return n <= max; };

function purge() { db.prepare('DELETE FROM visits WHERE ts < ?').run(Date.now() - RETENTION_DAYS * 86400000); }
purge(); setInterval(purge, 24 * 3600000).unref();

/* ---------- router ---------- */
const router = express.Router();

router.post('/visit', (req, res) => {
  res.status(204).end();                                   // never make the page wait on analytics
  const ua = String(req.headers['user-agent'] || '');
  const b = req.body || {}, vid = String(b.vid || '');
  if (!ua || BOT.test(ua) || !VID.test(vid) || !rateOk(req.ip, 120)) return;
  const page = cleanPage(b.page);
  if (page.startsWith('/admin') || (req.user && SEC.STAFF.includes(req.user.role))) return;   // staff screens and staff browsing never count
  const u = parseUa(ua);
  db.prepare('INSERT INTO visits(ts,vid,page,ref,device,browser,os,country,ip_hash,user_id) VALUES(?,?,?,?,?,?,?,?,?,?)')
    .run(Date.now(), vid, page, refHost(String(b.ref || ''), req.headers.host), u.device, u.browser, u.os, countryOf(req), ipHash(req.ip), req.user ? req.user.id : null);
});

const A = SEC.needPerm('analytics'), Q = SEC.needPerm('inquiries');
const rangeDays = req => Math.min(365, Math.max(1, parseInt(req.query.days, 10) || 30));

router.get('/admin/traffic', A, (req, res) => {
  const days = rangeDays(req), since = Date.now() - days * 86400000;
  const one = (s, ...p) => db.prepare(s).get(...p), all = (s, ...p) => db.prepare(s).all(...p);
  const tot = one('SELECT COUNT(*) views, COUNT(DISTINCT vid) visitors FROM visits WHERE ts>=?', since);
  const fresh = one('SELECT COUNT(*) n FROM (SELECT vid FROM visits GROUP BY vid HAVING MIN(ts)>=?)', since).n;
  const rows = all(`SELECT date(ts/1000,${IST}) d, COUNT(*) views, COUNT(DISTINCT vid) visitors FROM visits WHERE ts>=? GROUP BY d`, since);
  const byDay = new Map(rows.map(r => [r.d, r])), daily = [];
  for (let i = days - 1; i >= 0; i--) {                    // fill empty days so the chart has no gaps
    const d = new Date(Date.now() + 330 * 60000 - i * 86400000).toISOString().slice(0, 10);
    daily.push({ d, views: byDay.get(d)?.views || 0, visitors: byDay.get(d)?.visitors || 0 });
  }
  const today = daily[daily.length - 1];
  const top = col => all(`SELECT ${col} k, COUNT(*) n, COUNT(DISTINCT vid) u FROM visits WHERE ts>=? AND ${col}<>'' GROUP BY k ORDER BY n DESC LIMIT 8`, since);
  res.json({
    days, views: tot.views, visitors: tot.visitors, newVisitors: fresh, returning: tot.visitors - fresh, today, daily,
    online: one('SELECT COUNT(DISTINCT vid) n FROM visits WHERE ts>=?', Date.now() - 5 * 60000).n,
    pages: top('page'),
    sources: all("SELECT CASE WHEN ref='' THEN 'Direct / none' ELSE ref END k, COUNT(DISTINCT vid) u FROM visits WHERE ts>=? GROUP BY k ORDER BY u DESC LIMIT 8", since),
    devices: top('device'), browsers: top('browser'), countries: top('country'),
    enquiries: one('SELECT COUNT(*) n FROM inquiries WHERE created_at >= datetime(?/1000,\'unixepoch\')', since).n
  });
});

const visitorSelect = (where = 'v.ts>=?') => `
  SELECT g.*, u.name user_name, u.email user_email,
    (SELECT q.name FROM inquiries q WHERE q.visitor_id=g.vid ORDER BY q.id DESC LIMIT 1) inq_name,
    (SELECT q.email FROM inquiries q WHERE q.visitor_id=g.vid ORDER BY q.id DESC LIMIT 1) inq_email,
    (SELECT COUNT(*) FROM inquiries q WHERE q.visitor_id=g.vid) inquiries
  FROM (SELECT v.vid, MIN(v.ts) first_seen, MAX(v.ts) last_seen, COUNT(*) views, COUNT(DISTINCT date(v.ts/1000,${IST})) days,
      MAX(v.device) device, MAX(v.browser) browser, MAX(v.country) country, MAX(v.ref) ref, MAX(v.user_id) uid
    FROM visits v WHERE ${where} GROUP BY v.vid) g LEFT JOIN users u ON u.id=g.uid`;
const shapeVisitor = r => ({
  id: r.vid, firstSeen: r.first_seen, lastSeen: r.last_seen, views: r.views, days: r.days, device: r.device, browser: r.browser, country: r.country, source: r.ref || 'Direct',
  name: r.user_name || r.inq_name || '', email: r.user_email || r.inq_email || '', signedIn: !!r.uid, inquiries: r.inquiries, returning: r.days > 1
});

router.get('/admin/visitors', A, (req, res) => {
  const days = rangeDays(req), since = Date.now() - days * 86400000, q = String(req.query.q || '').trim().toLowerCase().slice(0, 60);
  const only = req.query.only === 'identified' ? 'WHERE name<>\'\' OR email<>\'\'' : req.query.only === 'returning' ? 'WHERE days>1' : '';
  let rows = db.prepare(`${visitorSelect()} ORDER BY last_seen DESC LIMIT 500`).all(since).map(shapeVisitor);
  if (only === 'WHERE days>1') rows = rows.filter(r => r.returning);
  else if (only) rows = rows.filter(r => r.name || r.email);
  if (q) rows = rows.filter(r => [r.name, r.email, r.id, r.country, r.device, r.source].some(s => String(s).toLowerCase().includes(q)));
  res.json({ visitors: rows.slice(0, 200) });
});

router.get('/admin/visitors/:vid', A, (req, res, next) => {
  const vid = String(req.params.vid);
  if (!VID.test(vid)) return next(Object.assign(new Error('Not found'), { status: 404 }));
  const row = db.prepare(visitorSelect('v.vid=?')).get(vid);
  if (!row) return next(Object.assign(new Error('Visitor not found'), { status: 404 }));
  res.json({
    visitor: shapeVisitor(row),
    trail: db.prepare('SELECT ts,page,ref FROM visits WHERE vid=? ORDER BY ts DESC LIMIT 300').all(vid),
    inquiries: db.prepare('SELECT id,topic,status,created_at FROM inquiries WHERE visitor_id=? ORDER BY id DESC').all(vid)
  });
});

router.get('/admin/inquiries', Q, (req, res) => {
  const status = STATUSES.includes(req.query.status) ? req.query.status : '', q = String(req.query.q || '').trim().slice(0, 60);
  const where = [], p = [];
  if (status) { where.push('status=?'); p.push(status); }
  if (q) { where.push('(name LIKE ? OR email LIKE ? OR phone LIKE ? OR message LIKE ? OR topic LIKE ?)'); p.push(...Array(5).fill('%' + q.replace(/[%_]/g, '') + '%')); }
  const counts = Object.fromEntries(db.prepare('SELECT status, COUNT(*) n FROM inquiries GROUP BY status').all().map(r => [r.status, r.n]));
  res.json({ inquiries: db.prepare(`SELECT * FROM inquiries ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT 200`).all(...p), counts, statuses: STATUSES });
});
router.patch('/admin/inquiries/:id', Q, (req, res, next) => {
  const status = String(req.body && req.body.status || '');
  if (!STATUSES.includes(status)) return next(Object.assign(new Error('Unknown status.'), { status: 400 }));
  const r = db.prepare('UPDATE inquiries SET status=? WHERE id=?').run(status, Number(req.params.id) || 0);
  if (!r.changes) return next(Object.assign(new Error('Enquiry not found.'), { status: 404 }));
  res.json({ ok: true });
});

/* Called by the enquiry form handler after the row is saved. */
function notifyEnquiry(q) {
  const body = `${q.name} · ${q.email}${q.phone ? ' · ' + q.phone : ''}\n${q.topic ? q.topic + '\n' : ''}${q.message.slice(0, 300)}`;
  alertAdmin('info', `New enquiry from ${q.name} (#${q.id})`, body);                     // in-app + ALERT_EMAIL + ALERT_WEBHOOK_URL when configured
  const wa = String(getSetting('whatsapp') || '').replace(/\D/g, '').replace(/^91(?=\d{10}$)/, '');
  if (wa.length === 10) send('whatsapp', wa, 'New enquiry', `Kumud Boutique — new enquiry\n${body}`);
}

module.exports = { router, notifyEnquiry, VID };
