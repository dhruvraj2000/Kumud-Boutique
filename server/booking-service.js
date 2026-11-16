'use strict';
// Booking domain logic on MySQL: items, quotes, availability, slots, booking creation, status changes.
const crypto = require('crypto');
const mysql = require('./mysql');
const { priceRange, eachDate } = require('./rates');

class ServiceError extends Error { constructor(status, message, field) { super(message); this.status = status; this.field = field; } }
const bad = (m, f) => new ServiceError(400, m, f);
const BLOCKING = "('pending','confirmed')";
const MAX_DAYS = 60;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;

const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const validDate = s => DATE_RE.test(s || '') && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const addDay = s => new Date(Date.parse(s + 'T00:00:00Z') + DAY).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
const defaultQ = { query: (sql, p) => mysql.query(sql, p) };

function normalizePhone(v) {
  let d = String(v || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return d;
}

async function getItems(kind) {
  const rows = await mysql.query('SELECT id,name,kind,base_price,deposit FROM items WHERE active=1' + (kind ? ' AND kind=?' : '') + ' ORDER BY id', kind ? [kind] : []);
  return rows;
}

async function loadItem(q, id, { lock = false } = {}) {
  const [item] = await q.query('SELECT id,name,kind,base_price,deposit,active FROM items WHERE id=?' + (lock ? ' FOR UPDATE' : ''), [id]);
  if (!item || !item.active) throw new ServiceError(404, 'That item is not available.', 'item');
  return item;
}

// Serialise competing bookings: rentals lock their item row; appointments lock ALL appointment items in id order
// (the atelier's slot capacity is shared). One fixed lock order per kind means no deadlock between concurrent bookings.
async function lockItem(conn, itemId) {
  const peek = await loadItem(conn, itemId);
  if (peek.kind === 'appointment') await conn.query("SELECT id FROM items WHERE kind='appointment' ORDER BY id FOR UPDATE");
  else await conn.query('SELECT id FROM items WHERE id=? FOR UPDATE', [itemId]);
  return loadItem(conn, itemId);
}

// Validates dates for an item kind and returns the effective [from, to) range.
function resolveRange(item, from, to) {
  if (!validDate(from)) throw bad('Please choose a valid start date.', 'from');
  if (from < todayIST()) throw bad('The date cannot be in the past.', 'from');
  if (item.kind === 'appointment') return [from, addDay(from)];
  if (!validDate(to)) throw bad('Please choose a valid end date.', 'to');
  if (to <= from) throw bad('The end date must be after the start date.', 'to');
  if (diffDays(from, to) > MAX_DAYS) throw bad(`Rentals can be at most ${MAX_DAYS} days.`, 'to');
  return [from, to];
}

async function quoteWith(q, item, from, to) {
  const [f, t] = resolveRange(item, from, to);
  const rules = await q.query('SELECT id,item_id,type,weekday,start_date,end_date,price,label,priority FROM rate_rules WHERE item_id IS NULL OR item_id=?', [item.id]);
  return { item, ...priceRange(item, rules, f, t), from: f, to: t };
}

async function quote(itemId, from, to) {
  const item = await loadItem(defaultQ, itemId);
  return quoteWith(defaultQ, item, from, to);
}

async function isRentalFree(conn, itemId, from, to, excludeId = 0) {
  const q = conn || defaultQ;
  const [r] = await q.query(`SELECT COUNT(*) c FROM bookings WHERE item_id=? AND kind='rental' AND status IN ${BLOCKING} AND start_date < ? AND end_date > ? AND id<>?`, [itemId, to, from, excludeId]);
  return Number(r.c) === 0;
}

async function slotsWith(q, date, excludeId = 0) {
  if (!validDate(date)) throw bad('Please choose a valid date.', 'date');
  if ((await q.query('SELECT 1 x FROM blocked_dates WHERE date=?', [date])).length) return [];
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  const slots = await q.query('SELECT start_time,capacity FROM appointment_slots WHERE weekday=? ORDER BY start_time', [weekday]);
  const booked = await q.query(`SELECT slot_time, COUNT(*) c FROM bookings WHERE kind='appointment' AND start_date=? AND status IN ${BLOCKING} AND id<>? GROUP BY slot_time`, [date, excludeId]);
  const used = Object.fromEntries(booked.map(b => [b.slot_time, Number(b.c)]));
  return slots.map(s => ({ time: s.start_time, left: Math.max(0, s.capacity - (used[s.start_time] || 0)) }));
}
async function slotsFor(itemId, date) {
  const item = await loadItem(defaultQ, itemId);
  if (item.kind !== 'appointment') throw bad('That item does not use time slots.', 'item');
  return slotsWith(defaultQ, date);
}

async function upsertCustomer(conn, { name, phone, email }) {
  const [hit] = await conn.query('SELECT id,email FROM customers WHERE phone=? ORDER BY id LIMIT 1', [phone]);
  if (hit) { if (email && !hit.email) await conn.query('UPDATE customers SET email=? WHERE id=?', [email, hit.id]); return hit.id; }
  if (email) { const [byMail] = await conn.query('SELECT id FROM customers WHERE email=? ORDER BY id LIMIT 1', [email]); if (byMail) return byMail.id; }
  return (await conn.query('INSERT INTO customers(name,phone,email) VALUES(?,?,?)', [name, phone, email || null])).insertId;
}

function cleanContact(input) {
  const name = String(input.name || '').trim().slice(0, 120);
  if (!name) throw bad('Please enter your name.', 'name');
  const phone = normalizePhone(input.phone);
  if (!/^[6-9]\d{9}$/.test(phone)) throw bad('Please enter a valid 10-digit mobile number.', 'phone');
  const email = String(input.email || '').trim().slice(0, 190);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw bad('Please enter a valid email address.', 'email');
  return { name, phone, email, notes: String(input.notes || '').trim().slice(0, 1000) };
}

const newRef = () => 'KB-' + crypto.randomBytes(5).toString('hex').toUpperCase().slice(0, 6);

async function assertFree(conn, item, from, to, slotTime, excludeId = 0) {
  if (item.kind === 'rental') {
    if (!(await isRentalFree(conn, item.id, from, to, excludeId))) throw new ServiceError(409, 'Those dates are already booked. Please choose different dates.', 'from');
  } else {
    const slot = (await slotsWith(conn, from, excludeId)).find(s => s.time === slotTime);
    if (!slot || slot.left < 1) throw new ServiceError(409, 'That time slot is no longer available. Please pick another.', 'slotTime');
  }
}

async function createBooking(input, opts = {}) {
  const contact = cleanContact(input);
  const itemId = Number(input.itemId);
  if (!Number.isInteger(itemId) || itemId < 1) throw bad('Please choose an item.', 'item');
  return mysql.tx(async conn => {
    const item = await lockItem(conn, itemId);
    const quoted = await quoteWith(conn, item, input.from, input.to);
    const slotTime = item.kind === 'appointment' ? String(input.slotTime || '') : null;
    if (item.kind === 'appointment' && !slotTime) throw bad('Please choose a time slot.', 'slotTime');
    await assertFree(conn, item, quoted.from, quoted.to, slotTime);
    const customerId = await upsertCustomer(conn, contact);
    let ref = newRef();
    while ((await conn.query('SELECT 1 x FROM bookings WHERE ref=?', [ref])).length) ref = newRef();
    const status = opts.status || 'pending';
    const res = await conn.query(
      'INSERT INTO bookings(ref,customer_id,item_id,kind,start_date,end_date,slot_time,status,total_price,price_breakdown,notes) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
      [ref, customerId, item.id, item.kind, quoted.from, quoted.to, slotTime, status, quoted.total, JSON.stringify(quoted.days), contact.notes || null]);
    await conn.query('INSERT INTO booking_events(booking_id,status,note,admin_id) VALUES(?,?,?,?)', [res.insertId, status, opts.adminId ? 'Created by admin' : 'Booking received', opts.adminId || null]);
    return { id: res.insertId, ref, total: quoted.total };
  });
}

const STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];
async function setStatus(bookingId, status, note, adminId) {
  if (!STATUSES.includes(status)) throw bad('Unknown status.', 'status');
  return mysql.tx(async conn => {
    const [b] = await conn.query('SELECT * FROM bookings WHERE id=? FOR UPDATE', [bookingId]);
    if (!b) throw new ServiceError(404, 'Booking not found.');
    const reopening = b.status === 'cancelled' && (status === 'pending' || status === 'confirmed');
    if (reopening) {
      const item = await lockItem(conn, b.item_id);
      await assertFree(conn, item, b.start_date, b.end_date, b.slot_time, b.id);
    }
    await conn.query('UPDATE bookings SET status=? WHERE id=?', [status, bookingId]);
    await conn.query('INSERT INTO booking_events(booking_id,status,note,admin_id) VALUES(?,?,?,?)', [bookingId, status, String(note || '').slice(0, 500) || null, adminId || null]);
  });
}

module.exports = { ServiceError, getItems, quote, isRentalFree, slotsFor, createBooking, setStatus, normalizePhone, upsertCustomer, todayIST, addDay, validDate, STATUSES, eachDate };
