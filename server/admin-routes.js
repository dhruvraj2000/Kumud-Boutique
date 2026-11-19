'use strict';
// Admin portal API (all behind requireAdmin): bookings, customers, dashboard, items, rate rules, calendar, slots, blocked dates.
const express = require('express');
const mysql = require('./mysql');
const svc = require('./booking-service');
const { priceRange } = require('./rates');

const { ServiceError, validDate, normalizePhone, STATUSES } = svc;
const router = express.Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const bad = (m, f) => new ServiceError(400, m, f);
const PAGE = 25;
const like = s => '%' + String(s).replace(/[\\%_]/g, c => '\\' + c) + '%';
const id = req => { const n = Number(req.params.id); if (!Number.isInteger(n) || n < 1) throw new ServiceError(404, 'Not found.'); return n; };
const money = (v, f) => { const n = Number(v); if (!Number.isInteger(n) || n < 0 || n > 10000000) throw bad('Enter a whole number of rupees (0 or more).', f); return n; };
const page = req => Math.max(1, parseInt(req.query.page, 10) || 1);

/* ---------- bookings ---------- */
const BOOKING_SELECT = `SELECT b.id,b.ref,b.kind,b.start_date,b.end_date,b.slot_time,b.status,b.total_price,b.notes,b.created_at,
  c.id customer_id,c.name customer_name,c.phone customer_phone,c.email customer_email,i.name item_name
  FROM bookings b JOIN customers c ON c.id=b.customer_id JOIN items i ON i.id=b.item_id`;

router.get('/bookings', wrap(async (req, res) => {
  const where = [], p = [];
  if (STATUSES.includes(req.query.status)) { where.push('b.status=?'); p.push(req.query.status); }
  if (['rental', 'appointment'].includes(req.query.kind)) { where.push('b.kind=?'); p.push(req.query.kind); }
  if (validDate(req.query.from)) { where.push('b.end_date > ?'); p.push(req.query.from); }
  if (validDate(req.query.to)) { where.push('b.start_date <= ?'); p.push(req.query.to); }
  const q = String(req.query.q || '').trim().slice(0, 80);
  if (q) {
    const digits = normalizePhone(q);
    where.push('(c.name LIKE ? OR c.email LIKE ? OR b.ref LIKE ? OR c.phone LIKE ?)');
    p.push(like(q), like(q), like(q), like(digits.length >= 3 ? digits : q));
  }
  const W = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const [{ n }] = await mysql.query('SELECT COUNT(*) n FROM bookings b JOIN customers c ON c.id=b.customer_id' + W, p);
  const rows = await mysql.query(`${BOOKING_SELECT}${W} ORDER BY b.id DESC LIMIT ${PAGE} OFFSET ${(page(req) - 1) * PAGE}`, p);
  res.json({ bookings: rows, total: Number(n), pageSize: PAGE });
}));

router.get('/bookings/:id', wrap(async (req, res) => {
  const [b] = await mysql.query(BOOKING_SELECT + ' WHERE b.id=?', [id(req)]);
  if (!b) throw new ServiceError(404, 'Booking not found.');
  const [full] = await mysql.query('SELECT price_breakdown FROM bookings WHERE id=?', [b.id]);
  const events = await mysql.query('SELECT e.status,e.note,e.at,a.name admin_name FROM booking_events e LEFT JOIN admins a ON a.id=e.admin_id WHERE e.booking_id=? ORDER BY e.id', [b.id]);
  res.json({ booking: { ...b, price_breakdown: typeof full.price_breakdown === 'string' ? JSON.parse(full.price_breakdown) : full.price_breakdown }, events });
}));

router.post('/bookings', wrap(async (req, res) => {
  const b = req.body || {};
  const status = ['pending', 'confirmed'].includes(b.status) ? b.status : 'confirmed';
  res.status(201).json(await svc.createBooking(b, { adminId: req.admin.id, status }));
}));

router.patch('/bookings/:id', wrap(async (req, res) => {
  const bid = id(req), b = req.body || {};
  if (b.notes !== undefined) await mysql.query('UPDATE bookings SET notes=? WHERE id=?', [String(b.notes).slice(0, 1000) || null, bid]);
  if (b.status !== undefined) await svc.setStatus(bid, b.status, b.note, req.admin.id);
  res.json({ ok: true });
}));

/* ---------- customers ---------- */
router.get('/customers', wrap(async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 80), p = [];
  let W = '';
  if (q) { const d = normalizePhone(q); W = ' WHERE c.name LIKE ? OR c.email LIKE ? OR c.phone LIKE ?'; p.push(like(q), like(q), like(d.length >= 3 ? d : q)); }
  const [{ n }] = await mysql.query('SELECT COUNT(*) n FROM customers c' + W, p);
  const rows = await mysql.query(`SELECT c.id,c.name,c.phone,c.email,c.created_at,(SELECT COUNT(*) FROM bookings b WHERE b.customer_id=c.id) bookings FROM customers c${W} ORDER BY c.id DESC LIMIT ${PAGE} OFFSET ${(page(req) - 1) * PAGE}`, p);
  res.json({ customers: rows, total: Number(n), pageSize: PAGE });
}));
router.get('/customers/:id', wrap(async (req, res) => {
  const [c] = await mysql.query('SELECT id,name,phone,email,notes,created_at FROM customers WHERE id=?', [id(req)]);
  if (!c) throw new ServiceError(404, 'Customer not found.');
  res.json({ customer: c, bookings: await mysql.query(BOOKING_SELECT + ' WHERE b.customer_id=? ORDER BY b.id DESC', [c.id]) });
}));
router.patch('/customers/:id', wrap(async (req, res) => {
  const b = req.body || {}, cid = id(req);
  if (b.name !== undefined) { if (!String(b.name).trim()) throw bad('Name cannot be empty.', 'name'); await mysql.query('UPDATE customers SET name=? WHERE id=?', [String(b.name).trim().slice(0, 120), cid]); }
  if (b.email !== undefined) {
    const e = String(b.email).trim();
    if (e && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)) throw bad('Invalid email.', 'email');
    await mysql.query('UPDATE customers SET email=? WHERE id=?', [e || null, cid]);
  }
  if (b.notes !== undefined) await mysql.query('UPDATE customers SET notes=? WHERE id=?', [String(b.notes).slice(0, 2000) || null, cid]);
  res.json({ ok: true });
}));

/* ---------- dashboard ---------- */
router.get('/dashboard', wrap(async (req, res) => {
  const today = svc.todayIST(), month = today.slice(0, 7);
  const live = "b.status IN ('pending','confirmed')";
  const todayRows = await mysql.query(`${BOOKING_SELECT} WHERE ${live} AND b.start_date <= ? AND b.end_date > ? ORDER BY b.slot_time, b.id`, [today, today]);
  const upcoming = await mysql.query(`${BOOKING_SELECT} WHERE ${live} AND b.start_date > ? ORDER BY b.start_date, b.id LIMIT 10`, [today]);
  const [{ pending }] = await mysql.query("SELECT COUNT(*) pending FROM bookings WHERE status='pending'");
  const rev = "SELECT COALESCE(SUM(total_price),0) v FROM bookings WHERE status IN ('confirmed','completed')";
  const [{ v: total }] = await mysql.query(rev);
  const [{ v: monthly }] = await mysql.query(rev + ' AND start_date LIKE ?', [month + '-%']);
  res.json({ today: todayRows, upcoming, pending: Number(pending), revenue: { month: Number(monthly), total: Number(total) } });
}));

/* ---------- items ---------- */
function cleanItem(b, cur = {}) {
  const m = { ...cur, ...b };
  const name = String(m.name || '').trim().slice(0, 160);
  if (!name) throw bad('Enter a name.', 'name');
  if (!['rental', 'appointment'].includes(m.kind)) throw bad('Choose rental or appointment.', 'kind');
  return { name, kind: m.kind, base_price: money(m.base_price, 'base_price'), deposit: money(m.deposit || 0, 'deposit'), active: m.active === 0 || m.active === false ? 0 : 1 };
}
router.get('/items', wrap(async (req, res) => res.json({ items: await mysql.query('SELECT id,name,kind,base_price,deposit,active FROM items ORDER BY id') })));
router.post('/items', wrap(async (req, res) => {
  const i = cleanItem(req.body || {});
  res.status(201).json({ id: (await mysql.query('INSERT INTO items(name,kind,base_price,deposit,active) VALUES(?,?,?,?,?)', [i.name, i.kind, i.base_price, i.deposit, i.active])).insertId });
}));
router.patch('/items/:id', wrap(async (req, res) => {
  const [cur] = await mysql.query('SELECT * FROM items WHERE id=?', [id(req)]);
  if (!cur) throw new ServiceError(404, 'Item not found.');
  const i = cleanItem(req.body || {}, cur);
  await mysql.query('UPDATE items SET name=?,kind=?,base_price=?,deposit=?,active=? WHERE id=?', [i.name, i.kind, i.base_price, i.deposit, i.active, cur.id]);
  res.json({ ok: true });
}));
router.delete('/items/:id', wrap(async (req, res) => {
  const iid = id(req);
  const [{ n }] = await mysql.query('SELECT COUNT(*) n FROM bookings WHERE item_id=?', [iid]);
  if (Number(n)) { await mysql.query('UPDATE items SET active=0 WHERE id=?', [iid]); return res.json({ deactivated: true }); }
  await mysql.query('DELETE FROM items WHERE id=?', [iid]);
  res.json({ deleted: true });
}));

/* ---------- rate rules ---------- */
async function cleanRule(b, cur = {}) {
  const m = { ...cur, ...b };
  if (!['weekday', 'period', 'date'].includes(m.type)) throw bad('Choose weekday, period or single date.', 'type');
  const itemId = m.item_id == null || m.item_id === '' ? null : Number(m.item_id);
  if (itemId !== null) { if (!Number.isInteger(itemId) || !(await mysql.query('SELECT 1 x FROM items WHERE id=?', [itemId])).length) throw bad('Unknown item.', 'item_id'); }
  const r = { item_id: itemId, type: m.type, weekday: null, start_date: null, end_date: null, price: money(m.price, 'price'), label: String(m.label || '').trim().slice(0, 120) || null, priority: Number.isInteger(Number(m.priority)) ? Number(m.priority) : 0 };
  if (m.type === 'weekday') { const w = Number(m.weekday); if (!Number.isInteger(w) || w < 0 || w > 6) throw bad('Weekday must be 0 (Sun) to 6 (Sat).', 'weekday'); r.weekday = w; }
  if (m.type === 'period') {
    if (!validDate(m.start_date) || !validDate(m.end_date)) throw bad('Enter a valid start and end date.', 'start_date');
    if (m.end_date < m.start_date) throw bad('End date cannot be before the start date.', 'end_date');
    r.start_date = m.start_date; r.end_date = m.end_date;
  }
  if (m.type === 'date') { if (!validDate(m.start_date)) throw bad('Enter a valid date.', 'start_date'); r.start_date = m.start_date; }
  return r;
}
const RULE_COLS = 'id,item_id,type,weekday,start_date,end_date,price,label,priority';
router.get('/rules', wrap(async (req, res) => {
  const item = req.query.item ? Number(req.query.item) : null;
  res.json({ rules: item ? await mysql.query(`SELECT ${RULE_COLS} FROM rate_rules WHERE item_id IS NULL OR item_id=? ORDER BY id DESC`, [item]) : await mysql.query(`SELECT ${RULE_COLS} FROM rate_rules ORDER BY id DESC`) });
}));
router.post('/rules', wrap(async (req, res) => {
  const r = await cleanRule(req.body || {});
  res.status(201).json({ id: (await mysql.query('INSERT INTO rate_rules(item_id,type,weekday,start_date,end_date,price,label,priority) VALUES(?,?,?,?,?,?,?,?)', [r.item_id, r.type, r.weekday, r.start_date, r.end_date, r.price, r.label, r.priority])).insertId });
}));
router.patch('/rules/:id', wrap(async (req, res) => {
  const [cur] = await mysql.query(`SELECT ${RULE_COLS} FROM rate_rules WHERE id=?`, [id(req)]);
  if (!cur) throw new ServiceError(404, 'Rule not found.');
  const r = await cleanRule(req.body || {}, cur);
  await mysql.query('UPDATE rate_rules SET item_id=?,type=?,weekday=?,start_date=?,end_date=?,price=?,label=?,priority=? WHERE id=?', [r.item_id, r.type, r.weekday, r.start_date, r.end_date, r.price, r.label, r.priority, cur.id]);
  res.json({ ok: true });
}));
router.delete('/rules/:id', wrap(async (req, res) => { await mysql.query('DELETE FROM rate_rules WHERE id=?', [id(req)]); res.json({ ok: true }); }));

router.get('/rates/calendar', wrap(async (req, res) => {
  const m = /^(\d{4})-(\d{2})$/.exec(String(req.query.month || ''));
  if (!m || +m[2] < 1 || +m[2] > 12) throw bad('Month must look like 2026-12.', 'month');
  const [item] = await mysql.query('SELECT id,name,kind,base_price FROM items WHERE id=?', [Number(req.query.item)]);
  if (!item) throw new ServiceError(404, 'Item not found.');
  const from = `${m[1]}-${m[2]}-01`;
  const next = +m[2] === 12 ? `${+m[1] + 1}-01-01` : `${m[1]}-${String(+m[2] + 1).padStart(2, '0')}-01`;
  const rules = await mysql.query(`SELECT ${RULE_COLS} FROM rate_rules WHERE item_id IS NULL OR item_id=?`, [item.id]);
  res.json({ item, days: priceRange(item, rules, from, next).days });
}));

/* ---------- slots & blocked dates ---------- */
const hhmm = (v, f) => { if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || ''))) throw bad('Use 24-hour time like 10:00.', f); return v; };
router.get('/slots', wrap(async (req, res) => res.json({ slots: await mysql.query('SELECT id,weekday,start_time,end_time,capacity FROM appointment_slots ORDER BY weekday,start_time') })));
router.post('/slots', wrap(async (req, res) => {
  const b = req.body || {}, w = Number(b.weekday), cap = Number(b.capacity === undefined ? 1 : b.capacity);
  if (!Number.isInteger(w) || w < 0 || w > 6) throw bad('Weekday must be 0 (Sun) to 6 (Sat).', 'weekday');
  if (!Number.isInteger(cap) || cap < 1 || cap > 50) throw bad('Capacity must be between 1 and 50.', 'capacity');
  const s = hhmm(b.start_time, 'start_time'), e = hhmm(b.end_time, 'end_time');
  if (e <= s) throw bad('End time must be after start time.', 'end_time');
  res.status(201).json({ id: (await mysql.query('INSERT INTO appointment_slots(weekday,start_time,end_time,capacity) VALUES(?,?,?,?)', [w, s, e, cap])).insertId });
}));
router.delete('/slots/:id', wrap(async (req, res) => { await mysql.query('DELETE FROM appointment_slots WHERE id=?', [id(req)]); res.json({ ok: true }); }));
router.get('/blocked-dates', wrap(async (req, res) => res.json({ dates: await mysql.query('SELECT date,reason FROM blocked_dates ORDER BY date') })));
router.post('/blocked-dates', wrap(async (req, res) => {
  const b = req.body || {};
  if (!validDate(b.date)) throw bad('Enter a valid date.', 'date');
  await mysql.query('INSERT INTO blocked_dates(date,reason) VALUES(?,?) ON DUPLICATE KEY UPDATE reason=VALUES(reason)', [b.date, String(b.reason || '').slice(0, 200) || null]);
  res.status(201).json({ ok: true });
}));
router.delete('/blocked-dates/:date', wrap(async (req, res) => {
  if (!validDate(req.params.date)) throw bad('Invalid date.', 'date');
  await mysql.query('DELETE FROM blocked_dates WHERE date=?', [req.params.date]); res.json({ ok: true });
}));

router.use(require('./festival-routes'));   // festival campaigns, rules, coupons

module.exports = router;
