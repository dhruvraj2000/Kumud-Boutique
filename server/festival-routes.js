'use strict';
// Admin portal API for festival campaigns, rules, festival dates, coupons and the shop-wide discount cap.
// Mounted inside the portal router, so every route is already behind requireAdmin (session cookie + CSRF token).
const express = require('express');
const mysql = require('./mysql');
const { db } = require('./db');
const P = require('./festival-pricing');
const F = require('./festival-data');
const { ServiceError } = require('./booking-service');

const router = express.Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (m, f) => new ServiceError(400, m, f);
const idOf = req => { const n = Number(req.params.id); if (!Number.isInteger(n) || n < 1) throw new ServiceError(404, 'Not found.'); return n; };
const done = res => async data => { await F.refresh(); res.json(data || { ok: true }); };   // every edit is live within the request
const slugify = s => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'sale';
const THEMES = ['gold', 'diwali', 'holi', 'navratri', 'christmas', 'rose', 'midnight'];
const dt = v => { const s = String(v || '').trim().replace('T', ' '); return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s + ' 00:00:00' : /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s) ? s + ':00' : s; };

async function capValue() {
  const [r] = await mysql.query("SELECT v FROM festival_settings WHERE k='max_discount_cap'");
  return r ? Number(r.v) : F.DEFAULT_CAP;
}
function readCampaign(b, cap) {
  const c = { name: String(b.name || '').trim(), theme: THEMES.includes(b.theme) ? b.theme : 'gold', tagline: String(b.tagline || '').trim().slice(0, 200),
    starts_at: dt(b.starts_at), ends_at: dt(b.ends_at), discount_pct: Number(b.discount_pct), min_pct: b.min_pct === '' || b.min_pct == null ? 0 : Number(b.min_pct),
    max_pct: Number(b.max_pct), active: b.active === undefined ? 1 : (Number(b.active) ? 1 : 0), show_popup: b.show_popup === undefined ? 1 : (Number(b.show_popup) ? 1 : 0),
    festival_date: /^\d{4}-\d{2}-\d{2}$/.test(b.festival_date || '') ? b.festival_date : null };
  const err = P.validateCampaign(c, cap); if (err) throw bad(err);
  return c;
}
function readRule(b, c) {
  const scope = b.scope === 'product' ? 'product' : b.scope === 'category' ? 'category' : '';
  const target = String(b.target || '').trim().slice(0, 120), d = Number(b.discount_pct);
  if (!scope || !target) throw bad('Choose a category or product for this rule.');
  if (!Number.isInteger(d) || d < 0 || d > 100) throw bad('Discount must be a whole number from 0 to 100.');
  if (d > c.max_pct) throw bad(`This campaign's maximum discount is ${c.max_pct}%. Raise the maximum first if you really want more.`);
  if (scope === 'product' && !db.prepare('SELECT 1 FROM products WHERE id=?').get(Number(target))) throw bad('That product does not exist.');
  if (scope === 'category' && !db.prepare('SELECT 1 FROM products WHERE category=?').get(target)) throw bad('That category does not exist.');
  return { scope, target, discount_pct: d };
}
const withStatus = (c, now = Date.now()) => ({ ...c, status: P.status(c, now) });

/* ---------- overview ---------- */
router.get('/festivals', wrap(async (req, res) => {
  const [campaigns, rules, templates, dates, cap] = await Promise.all([
    mysql.query('SELECT * FROM campaigns ORDER BY starts_at DESC'), mysql.query('SELECT * FROM campaign_rules ORDER BY id'),
    mysql.query('SELECT * FROM festival_templates ORDER BY id'), mysql.query('SELECT template_id,year,date FROM festival_dates ORDER BY year'), capValue()]);
  const y0 = Number(F.istToday().slice(0, 4)), missing = [];
  for (const t of templates) if (t.kind === 'movable' && t.active) for (let y = y0; y <= y0 + F.HORIZON_YEARS; y++) if (!dates.some(d => d.template_id === t.id && d.year === y)) missing.push({ template_id: t.id, name: t.name, year: y });
  res.json({ cap, campaigns: campaigns.map(c => withStatus({ ...c, rules: rules.filter(r => r.campaign_id === c.id) })),
    templates: templates.map(t => ({ ...t, dates: dates.filter(d => d.template_id === t.id).map(d => ({ year: d.year, date: String(d.date).slice(0, 10) })) })), missing });
}));
router.get('/festivals/catalog', wrap(async (req, res) => {
  res.json({ categories: db.prepare('SELECT DISTINCT category FROM products ORDER BY category').all().map(r => r.category),
    products: db.prepare('SELECT id,name,category,price FROM products WHERE active=1 ORDER BY name').all() });
}));

/* ---------- campaigns ---------- */
router.post('/festivals', wrap(async (req, res) => {
  const c = readCampaign(req.body || {}, await capValue());
  let slug = slugify(c.name + (c.starts_at ? '-' + c.starts_at.slice(0, 4) : ''));
  if ((await mysql.query('SELECT 1 x FROM campaigns WHERE slug=?', [slug])).length) slug += '-' + Date.now().toString(36).slice(-4);
  const r = await mysql.query('INSERT INTO campaigns(name,slug,theme,tagline,festival_date,starts_at,ends_at,discount_pct,min_pct,max_pct,active,show_popup) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
    [c.name, slug, c.theme, c.tagline, c.festival_date, c.starts_at, c.ends_at, c.discount_pct, c.min_pct, c.max_pct, c.active, c.show_popup]);
  res.status(201);
  await done(res)({ id: r.insertId });
}));
router.patch('/festivals/:id', wrap(async (req, res) => {
  const id = idOf(req), [cur] = await mysql.query('SELECT * FROM campaigns WHERE id=?', [id]);
  if (!cur) throw new ServiceError(404, 'Campaign not found.');
  const b = { ...cur, ...req.body, starts_at: req.body.starts_at ?? String(cur.starts_at), ends_at: req.body.ends_at ?? String(cur.ends_at), festival_date: req.body.festival_date ?? (cur.festival_date ? String(cur.festival_date).slice(0, 10) : null) };
  const c = readCampaign(b, await capValue());
  const rules = await mysql.query('SELECT discount_pct FROM campaign_rules WHERE campaign_id=?', [id]);
  if (rules.some(r => r.discount_pct > c.max_pct)) throw bad('An existing product/category rule is higher than this maximum. Lower that rule first.');
  await mysql.query('UPDATE campaigns SET name=?,theme=?,tagline=?,festival_date=?,starts_at=?,ends_at=?,discount_pct=?,min_pct=?,max_pct=?,active=?,show_popup=? WHERE id=?',
    [c.name, c.theme, c.tagline, c.festival_date, c.starts_at, c.ends_at, c.discount_pct, c.min_pct, c.max_pct, c.active, c.show_popup, id]);
  await done(res)();
}));
router.delete('/festivals/:id', wrap(async (req, res) => {
  const id = idOf(req), [cur] = await mysql.query('SELECT template_id,year FROM campaigns WHERE id=?', [id]);
  if (cur && cur.template_id) await mysql.query('INSERT IGNORE INTO campaign_skips(template_id,year) VALUES(?,?)', [cur.template_id, cur.year]);   // do not auto-recreate it
  await mysql.query('DELETE FROM campaigns WHERE id=?', [id]);
  await done(res)();
}));
router.post('/festivals/generate', wrap(async (req, res) => {
  await mysql.query('DELETE FROM campaign_skips');          // an explicit "generate" brings back anything deleted earlier
  const created = await F.generateCampaigns();
  await done(res)({ created });
}));

/* ---------- per-product / per-category rules ---------- */
router.post('/festivals/:id/rules', wrap(async (req, res) => {
  const id = idOf(req), [c] = await mysql.query('SELECT max_pct FROM campaigns WHERE id=?', [id]);
  if (!c) throw new ServiceError(404, 'Campaign not found.');
  const r = readRule(req.body || {}, c);
  await mysql.query('INSERT INTO campaign_rules(campaign_id,scope,target,discount_pct) VALUES(?,?,?,?) ON DUPLICATE KEY UPDATE discount_pct=VALUES(discount_pct)', [id, r.scope, r.target, r.discount_pct]);
  await done(res)();
}));
router.delete('/festival-rules/:id', wrap(async (req, res) => { await mysql.query('DELETE FROM campaign_rules WHERE id=?', [idOf(req)]); await done(res)(); }));

/* ---------- templates (what repeats every year) ---------- */
router.patch('/festival-templates/:id', wrap(async (req, res) => {
  const id = idOf(req), [t] = await mysql.query('SELECT * FROM festival_templates WHERE id=?', [id]);
  if (!t) throw new ServiceError(404, 'Festival not found.');
  const b = { ...t, ...req.body };
  const err = P.validateCampaign({ ...b, starts_at: '2000-01-01', ends_at: '2000-01-02' }, await capValue());
  if (err) throw bad(err);
  const lead = Number(b.lead_days), tail = Number(b.tail_days);
  if (!Number.isInteger(lead) || lead < 0 || lead > 60 || !Number.isInteger(tail) || tail < 0 || tail > 30) throw bad('Lead days must be 0–60 and tail days 0–30.');
  await mysql.query('UPDATE festival_templates SET name=?,theme=?,tagline=?,lead_days=?,tail_days=?,discount_pct=?,min_pct=?,max_pct=?,auto_create=?,active=? WHERE id=?',
    [String(b.name).trim(), THEMES.includes(b.theme) ? b.theme : t.theme, String(b.tagline || '').slice(0, 200), lead, tail, Number(b.discount_pct), Number(b.min_pct), Number(b.max_pct), Number(b.auto_create) ? 1 : 0, Number(b.active) ? 1 : 0, id]);
  await done(res)();
}));
router.put('/festival-dates', wrap(async (req, res) => {
  const { template_id, year, date } = req.body || {};
  if (!Number.isInteger(Number(template_id)) || !Number.isInteger(Number(year)) || Number(year) < 2020 || Number(year) > 2100 || !/^\d{4}-\d{2}-\d{2}$/.test(date || '') || String(date).slice(0, 4) !== String(year)) throw bad('Enter the festival date inside the chosen year.');
  const [t] = await mysql.query("SELECT id FROM festival_templates WHERE id=? AND kind='movable'", [Number(template_id)]);
  if (!t) throw bad('That festival has a fixed date; no need to enter one.');
  await mysql.query('INSERT INTO festival_dates(template_id,year,date) VALUES(?,?,?) ON DUPLICATE KEY UPDATE date=VALUES(date)', [Number(template_id), Number(year), date]);
  await mysql.query('DELETE FROM campaign_skips WHERE template_id=? AND year=?', [Number(template_id), Number(year)]);
  await F.generateCampaigns();
  await done(res)();
}));

/* ---------- shop-wide cap ---------- */
router.put('/festival-settings', wrap(async (req, res) => {
  const cap = Number((req.body || {}).max_discount_cap);
  if (!Number.isInteger(cap) || cap < 5 || cap > 90) throw bad('The shop-wide maximum discount must be a whole number from 5 to 90.');
  const [over] = await mysql.query('SELECT name FROM campaigns WHERE max_pct > ? AND ends_at >= UTC_TIMESTAMP() LIMIT 1', [cap]);
  if (over) throw bad(`"${over.name}" has a higher maximum. Lower its maximum first.`);
  await mysql.query("INSERT INTO festival_settings(k,v) VALUES('max_discount_cap',?) ON DUPLICATE KEY UPDATE v=VALUES(v)", [String(cap)]);
  await done(res)();
}));

/* ---------- coupons ---------- */
const readCoupon = (b, existing) => {
  const code = String(existing || b.code || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{3,20}$/.test(code)) throw bad('Codes are 3–20 letters or digits.');
  const type = ['percent', 'flat', 'ship'].includes(b.type) ? b.type : '', value = Number(b.value || 0), min = Number(b.min_order || 0);
  if (!type) throw bad('Choose a coupon type.');
  if (!Number.isInteger(value) || value < 0 || (type === 'percent' && (value < 1 || value > 90)) || (type === 'flat' && (value < 1 || value > 1000000))) throw bad(type === 'percent' ? 'Percent must be 1–90.' : 'Enter a whole rupee amount.');
  if (!Number.isInteger(min) || min < 0) throw bad('Minimum order must be a whole number of rupees.');
  const s = b.starts_at ? dt(b.starts_at) : null, e = b.ends_at ? dt(b.ends_at) : null;
  if ((s && Number.isNaN(P.toMs(s))) || (e && Number.isNaN(P.toMs(e)))) throw bad('Enter valid dates.');
  if (s && e && P.toMs(e) <= P.toMs(s)) throw bad('The end must be after the start.');
  const max = b.max_uses === '' || b.max_uses == null ? null : Number(b.max_uses);
  if (max !== null && (!Number.isInteger(max) || max < 1)) throw bad('Usage limit must be a positive whole number (or empty for unlimited).');
  return { code, label: String(b.label || '').trim().slice(0, 120) || code, type, value, min_order: min, starts_at: s, ends_at: e, active: b.active === undefined ? 1 : (Number(b.active) ? 1 : 0), max_uses: max };
};
router.get('/coupons', wrap(async (req, res) => res.json({ coupons: (await mysql.query('SELECT * FROM coupons ORDER BY code')).map(c => ({ ...c, live: !!(c.active && (!c.starts_at || Date.now() >= P.toMs(c.starts_at)) && (!c.ends_at || Date.now() <= P.toMs(c.ends_at)) && (c.max_uses == null || c.used_count < c.max_uses)) })) })));
router.post('/coupons', wrap(async (req, res) => {
  const c = readCoupon(req.body || {});
  if ((await mysql.query('SELECT 1 x FROM coupons WHERE code=?', [c.code])).length) throw bad('That code already exists.');
  await mysql.query('INSERT INTO coupons(code,label,type,value,min_order,starts_at,ends_at,active,max_uses) VALUES(?,?,?,?,?,?,?,?,?)', [c.code, c.label, c.type, c.value, c.min_order, c.starts_at, c.ends_at, c.active, c.max_uses]);
  res.status(201);
  await done(res)();
}));
router.patch('/coupons/:code', wrap(async (req, res) => {
  const code = String(req.params.code).toUpperCase(), [cur] = await mysql.query('SELECT * FROM coupons WHERE code=?', [code]);
  if (!cur) throw new ServiceError(404, 'Coupon not found.');
  const c = readCoupon({ ...cur, starts_at: cur.starts_at && String(cur.starts_at), ends_at: cur.ends_at && String(cur.ends_at), ...req.body }, code);
  await mysql.query('UPDATE coupons SET label=?,type=?,value=?,min_order=?,starts_at=?,ends_at=?,active=?,max_uses=? WHERE code=?', [c.label, c.type, c.value, c.min_order, c.starts_at, c.ends_at, c.active, c.max_uses, code]);
  await done(res)();
}));
router.delete('/coupons/:code', wrap(async (req, res) => { await mysql.query('DELETE FROM coupons WHERE code=?', [String(req.params.code).toUpperCase()]); await done(res)(); }));

module.exports = router;
