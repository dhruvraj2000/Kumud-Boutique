'use strict';
// Public booking API: items, price quote, availability, slots, create booking.
const express = require('express');
const mysql = require('./mysql');
const svc = require('./booking-service');

const router = express.Router();
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const intParam = (v, name) => { const n = Number(v); if (!Number.isInteger(n) || n < 1) throw new svc.ServiceError(400, 'Please choose an item.', name); return n; };

const hits = new Map();
const limit = (name, max, windowMs) => (req, res, next) => {
  const key = name + ':' + req.ip, now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) return next(new svc.ServiceError(429, 'Too many attempts. Please wait a minute and try again.'));
  arr.push(now); hits.set(key, arr); next();
};

// Only the booking endpoints depend on MySQL; the rest of the shop keeps working without it.
const PATHS = /^\/(items|rates\/quote|availability|slots|bookings)$/;
router.use((req, res, next) => (PATHS.test(req.path) && !mysql.isConfigured() ? next(new svc.ServiceError(503, 'Bookings are temporarily unavailable.')) : next()));

router.get('/items', wrap(async (req, res) => {
  const kind = ['rental', 'appointment'].includes(req.query.kind) ? req.query.kind : undefined;
  res.json({ items: await svc.getItems(kind) });
}));

router.get('/rates/quote', wrap(async (req, res) => {
  const q = await svc.quote(intParam(req.query.item, 'item'), String(req.query.from || ''), String(req.query.to || ''));
  res.json({ item: q.item, from: q.from, to: q.to, days: q.days, total: q.total });
}));

router.get('/availability', wrap(async (req, res) => {
  const itemId = intParam(req.query.item, 'item');
  const q = await svc.quote(itemId, String(req.query.from || ''), String(req.query.to || '')); // validates item + range
  res.json({ available: await svc.isRentalFree(null, itemId, q.from, q.to) });
}));

router.get('/slots', wrap(async (req, res) => {
  res.json({ slots: await svc.slotsFor(intParam(req.query.item, 'item'), String(req.query.date || '')) });
}));

router.post('/bookings', limit('booking', 10, 60 * 1000), wrap(async (req, res) => {
  const b = req.body || {};
  const r = await svc.createBooking({ itemId: b.itemId, from: b.from, to: b.to, slotTime: b.slotTime, name: b.name, phone: b.phone, email: b.email, notes: b.notes });
  res.status(201).json({ ref: r.ref, total: r.total });
}));

module.exports = router;
