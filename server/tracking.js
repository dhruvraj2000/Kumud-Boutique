'use strict';
// Order tracking, delivery management, payments ledger, refunds, live courier location, returns, invoices, QR codes, analytics.
const crypto = require('crypto');
const express = require('express');
const QR = require('qrcode');
const { db, tx, getSetting } = require('./db');
const S = require('./security');
const N = require('./notify');
const geo = require('./geo');
const L = require('./lifecycle');

const { Denied, logEvent, audit, needUser, needPerm } = S;
const { STATUSES, LABEL, NOTE } = L;
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const bad = (m, field) => new Denied(400, m, { field });
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const DONE = ['delivered', 'cancelled', 'returned', 'return_requested', 'return_approved', 'refund_processing', 'refunded'];   // no longer "in delivery"
const IN_FLIGHT = ['preparing', 'packed', 'shipped', 'in_transit', 'out_for_delivery', 'delivery_failed'];
const RETURN_DAYS = 7;
const qmarks = a => a.map(() => '?').join(',');

/* ---------- tracking ids ---------- */
const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';   // no 0/O/1/I/L: easy to read out over the phone
function newTrackingId() {
  for (;;) {
    const raw = Array.from(crypto.randomBytes(12), b => ALPHA[b % ALPHA.length]).join(''), id = `KT-${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8, 12)}`;
    if (!db.prepare('SELECT 1 FROM orders WHERE tracking_id=?').get(id)) return id;
  }
}
const TRACKING_RE = /^KT-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
for (const r of db.prepare("SELECT id FROM orders WHERE tracking_id='' OR tracking_id IS NULL").all()) db.prepare('UPDATE orders SET tracking_id=? WHERE id=?').run(newTrackingId(), r.id);   // backfill older orders

/* ---------- shaping ---------- */
const today = () => new Date().toISOString().slice(0, 10);
const isDelayed = o => !!o.eta && o.eta < today() && IN_FLIGHT.includes(o.status);
const maskPhone = p => (p ? p.replace(/^(\d{2})\d+(\d{2})$/, '$1••••••$2') : '');
const baseUrl = req => (process.env.BASE_URL || `${req.protocol}://${req.headers.host}`).replace(/\/$/, '');
const trackingUrl = (o, base = process.env.BASE_URL || '') => `${String(base).replace(/\/$/, '')}/#/track?t=${o.tracking_id}`;

function row(number) { return db.prepare('SELECT o.*, u.name courier_name, u.phone courier_phone FROM orders o LEFT JOIN users u ON u.id=o.delivery_user_id WHERE o.number=?').get(number); }
function events(id) { return db.prepare('SELECT status,note,created_at createdAt FROM order_events WHERE order_id=? ORDER BY id').all(id); }
function items(id) { return db.prepare('SELECT product_id productId,name,image,size,qty,price FROM order_items WHERE order_id=?').all(id); }
const payments = id => db.prepare('SELECT provider,provider_ref ref,kind,amount,status,note,created_at createdAt FROM payments WHERE order_id=? ORDER BY id').all(id);
const canReturnNow = o => o.status === 'delivered' && !!o.delivered_at && (Date.now() - Date.parse(o.delivered_at.replace(' ', 'T') + 'Z')) < RETURN_DAYS * 86400000;
// What the holder of a tracking id may see: no email, masked phone, no internal ids.
function publicView(o) {
  const a = JSON.parse(o.address || '{}');
  return {
    trackingId: o.tracking_id, trackingUrl: trackingUrl(o), number: o.number, status: o.status, statusLabel: LABEL[o.status], steps: L.stepsFor(o), placedAt: o.created_at, eta: o.eta || '', delayed: isDelayed(o),
    paymentMethod: o.payment_method.replace(/(Razorpay|UPI|Card).*/, '$1'), paymentStatus: o.payment_status, subtotal: o.subtotal, shipping: o.shipping, discount: o.discount, total: o.total, taxIncluded: o.tax || 0,
    address: { name: a.name, line1: a.line1, line2: a.line2, city: a.city, state: a.state, pincode: a.pincode, phone: maskPhone(a.phone) },
    carrier: o.carrier, courierTracking: o.tracking_no, items: items(o.id), events: events(o.id), canCancel: L.CUSTOMER_CANCEL.includes(o.status), canReturn: canReturnNow(o),
    liveAvailable: o.status === 'out_for_delivery' && !!o.sharing, courierName: o.status === 'out_for_delivery' && o.courier_name ? o.courier_name.split(' ')[0] : ''
  };
}
function adminView(o) {
  return {
    ...publicView(o), email: o.email, phone: o.phone, address: JSON.parse(o.address), notes: o.notes, measurements: o.measurements ? JSON.parse(o.measurements) : null,
    paymentMethod: o.payment_method, userId: o.user_id, coupon: o.coupon, createdAt: o.created_at, deliveredAt: o.delivered_at, returnReason: o.return_reason, cancelReason: o.cancel_reason,
    deliveryUserId: o.delivery_user_id, courierName: o.courier_name || '', courierPhone: o.courier_phone || '', sharing: !!o.sharing, nextStatuses: L.nextOptions(o).map(k => ({ key: k, label: LABEL[k] })),
    payments: payments(o.id), refundedAt: o.refunded_at, closedAs: o.closed_as,
    location: o.dest_lat == null ? null : { lat: o.dest_lat, lng: o.dest_lng, placeId: o.place_id, distanceKm: o.distance_km }
  };
}
const lastPoint = id => db.prepare('SELECT lat,lng,accuracy,speed,ts FROM courier_locations WHERE order_id=? ORDER BY id DESC LIMIT 1').get(id);

/* ---------- payments ledger ---------- */
// One row per money movement. provider_ref is unique per (provider, kind): a gateway payment id can never settle two orders.
function recordPayment(orderId, { provider, ref = null, kind = 'charge', amount, status, note = '' }) {
  try { db.prepare('INSERT INTO payments(order_id,provider,provider_ref,kind,amount,status,note) VALUES(?,?,?,?,?,?,?)').run(orderId, provider, ref, kind, amount, status, note); return true; }
  catch (e) { if (/UNIQUE/i.test(e.message)) return false; throw e; }
}

/* ---------- status changes + notifications ---------- */
function notifyCustomer(o, status, note) {
  const head = status === 'placed' ? 'Order confirmed — thank you!' : LABEL[status], eta = o.eta && !DONE.includes(status) ? `Estimated delivery: ${o.eta}` : '';
  if (o.user_id) db.prepare('INSERT INTO customer_notifications(user_id,order_number,title,body,ts) VALUES(?,?,?,?,?)').run(o.user_id, o.number, `${LABEL[status]} · ${o.number}`, [note, eta].filter(Boolean).join(' · '), Date.now());
  N.orderUpdate({ number: o.number, trackingId: o.tracking_id, email: o.email, phone: o.phone }, head, [note, eta, trackingUrl(o)].filter(Boolean).join('\n'));
}
function restockOrder(id) {
  for (const it of db.prepare('SELECT product_id,size,qty FROM order_items WHERE order_id=?').all(id)) {
    const r = db.prepare('SELECT stock FROM products WHERE id=?').get(it.product_id); if (!r) continue;
    const st = JSON.parse(r.stock); st[it.size] = (st[it.size] || 0) + it.qty; db.prepare('UPDATE products SET stock=? WHERE id=?').run(JSON.stringify(st), it.product_id);
  }
}
// The only place an order changes status: validates the move, updates payment status, writes the history row, restocks, notifies.
// `system` is for server-verified events (gateway confirmation, auto-expiry) and skips the manual-move rules.
function setStatus(o, to, { note = '', by = '', notify = true, reason = '', system = false } = {}) {
  if (!STATUSES.includes(to)) throw bad('Unknown status.');
  if (!system && !L.allowed(o, to)) {
    if (['refunded'].includes(o.status)) throw bad('A refunded order cannot be changed.');
    if (!L.isCod(o) && o.payment_status !== 'paid' && L.CHAIN.indexOf(to) >= L.CHAIN.indexOf('confirmed') && o.status !== 'cancelled') throw bad('Payment has not been confirmed yet, so this order cannot be fulfilled.');
    throw bad(`An order that is "${LABEL[o.status]}" cannot move to "${LABEL[to]}".`);
  }
  tx(() => {
    const pay = system && to === 'payment_confirmed' ? 'paid' : L.paymentAfter(o, to);
    const eta = o.eta || (['shipped', 'in_transit', 'out_for_delivery'].includes(to) ? geo.addDays(Math.max(1, Math.ceil((o.distance_km || 800) / 400) + 1)) : '');
    const closed = to === 'cancelled' ? 'cancelled' : to === 'returned' ? 'returned' : o.closed_as || '';
    db.prepare(`UPDATE orders SET status=?, payment_status=?, eta=?, closed_as=?, sharing=CASE WHEN ? IN ('shipped','in_transit','out_for_delivery') THEN sharing ELSE 0 END,
      delivered_at=CASE WHEN ?='delivered' THEN datetime('now') ELSE delivered_at END, refunded_at=CASE WHEN ?='refunded' THEN datetime('now') ELSE refunded_at END,
      cancel_reason=CASE WHEN ?='cancelled' THEN ? ELSE cancel_reason END, return_reason=CASE WHEN ?='return_requested' THEN ? ELSE return_reason END WHERE id=?`)
      .run(to, pay, eta, closed, to, to, to, to, reason, to, reason, o.id);
    db.prepare('INSERT INTO order_events(order_id,status,note) VALUES(?,?,?)').run(o.id, to, (note || NOTE[to]) + (by ? ` · ${by}` : ''));
    if (to === 'cancelled' || to === 'returned') restockOrder(o.id);
  });
  const fresh = row(o.number);
  if (notify) notifyCustomer(fresh, to, note || NOTE[to]);
  return fresh;
}
function onPlaced(number) { const o = row(number); if (o) notifyCustomer(o, 'placed', 'We have received your order and will confirm it shortly.'); }

// Unpaid online orders must not hold stock forever: cancel and restock after an hour with no verified payment.
function expireUnpaid(minutes = 60) {
  const stale = db.prepare(`SELECT number FROM orders WHERE payment_method LIKE 'Razorpay%' AND payment_status='pending' AND status IN ('placed','payment_processing','payment_failed') AND created_at < datetime('now', ?)`).all(`-${minutes} minutes`);
  for (const r of stale) { try { setStatus(row(r.number), 'cancelled', { system: true, note: 'Payment was not completed in time', reason: 'payment timeout' }); } catch { /* already moved */ } }
  return stale.length;
}
setInterval(() => { try { expireUnpaid(); } catch { /* next tick */ } }, 10 * 60000).unref();

/* ---------- router ---------- */
const rl = new Map();
const limit = (name, max, ms) => (req, res, next) => {
  const k = name + ':' + req.ip, t = Date.now(), a = (rl.get(k) || []).filter(x => t - x < ms);
  if (a.length >= max) { logEvent('rate_limited', 'warn', req, { detail: name }); return next(new Denied(429, 'Too many requests. Please wait a minute.')); }
  a.push(t); rl.set(k, a); next();
};
setInterval(() => rl.clear(), 10 * 60000).unref();

function build({ canView }) {
  const router = express.Router();

  /* --- public: tracking by tracking id --- */
  const byTracking = (req, res, next) => {
    const id = str(req.params.trackingId, 20).toUpperCase(), o = TRACKING_RE.test(id) ? db.prepare('SELECT o.*, u.name courier_name, u.phone courier_phone FROM orders o LEFT JOIN users u ON u.id=o.delivery_user_id WHERE o.tracking_id=?').get(id) : null;
    if (!o) { logEvent('track_miss', 'info', req, { detail: id.slice(0, 20) }); return next(new Denied(404, 'We could not find that tracking ID. Check it and try again.')); }
    req.order = o; next();
  };
  router.get('/track/:trackingId', limit('track-id', 30, 60000), byTracking, (req, res) => res.json({ order: publicView(req.order) }));
  router.get('/track/:trackingId/qr.svg', limit('track-qr', 30, 60000), byTracking, async (req, res) => {
    res.type('image/svg+xml').setHeader('Cache-Control', 'private, max-age=3600');
    res.send(await QR.toString(trackingUrl(req.order, baseUrl(req)), { type: 'svg', margin: 1, width: 220 }));
  });
  // Live courier position: only while out for delivery, only if the courier has switched sharing on, and only fresh points.
  router.get('/track/:trackingId/live', limit('track-live', 60, 60000), byTracking, (req, res) => {
    const o = req.order, p = o.status === 'out_for_delivery' && o.sharing ? lastPoint(o.id) : null;
    if (!p || Date.now() - p.ts > 10 * 60000) return res.json({ live: false });
    const dest = o.dest_lat == null ? null : { lat: o.dest_lat, lng: o.dest_lng };
    res.json({ live: true, lat: p.lat, lng: p.lng, updatedAt: p.ts, dest, etaMinutes: dest ? geo.etaMinutes(p, dest) : null, courierName: o.courier_name ? o.courier_name.split(' ')[0] : '' });
  });

  /* --- customer --- */
  router.get('/notifications', needUser, (req, res) => res.json({
    notifications: db.prepare('SELECT id,order_number orderNumber,title,body,ts,read FROM customer_notifications WHERE user_id=? ORDER BY id DESC LIMIT 30').all(req.user.id),
    unread: db.prepare('SELECT COUNT(*) c FROM customer_notifications WHERE user_id=? AND read=0').get(req.user.id).c
  }));
  router.post('/notifications/read', needUser, (req, res) => { db.prepare('UPDATE customer_notifications SET read=1 WHERE user_id=?').run(req.user.id); res.json({ ok: true }); });

  const ownOrder = (req, res, next) => {
    const o = row(str(req.params.number, 30).toUpperCase()), view = o && canView(req, { number: o.number, userId: o.user_id, email: o.email });
    if (!o || !view) { logEvent('forbidden', 'info', req, { detail: `order access denied ${String(req.params.number).slice(0, 30)}` }); return next(new Denied(404, 'Order not found.')); }
    req.order = o; next();
  };
  router.post('/orders/:number/return', limit('return', 10, 60000), ownOrder, (req, res, next) => {
    const o = req.order, reason = str(req.body.reason, 300);
    if (reason.length < 5) return next(bad('Please tell us why you would like to return it.', 'reason'));
    if (o.status !== 'delivered') return next(bad('Only delivered orders can be returned.'));
    if (!canReturnNow(o)) return next(bad(`Returns must be requested within ${RETURN_DAYS} days of delivery. Please contact us.`));
    try { setStatus(o, 'return_requested', { note: `Return requested: ${reason}`, reason }); } catch (e) { return next(e); }
    S.logEvent('return_requested', 'info', req, { detail: o.number });
    N.alertAdmin('info', `Return requested for ${o.number}`, reason);
    res.json({ order: publicView(row(o.number)) });
  });

  // Printable tax-invoice (save as PDF from the browser). Authorised exactly like viewing the order.
  router.get('/orders/:number/invoice', ownOrder, (req, res) => {
    const o = req.order, a = JSON.parse(o.address), its = items(o.id), seller = { name: getSetting('sellerName') || 'Kumud Boutique Fashion Design', addr: getSetting('sellerAddress') || 'Dewali, Udaipur, Rajasthan, India', gstin: getSetting('gstin') };
    const inr = n => '₹' + Number(n).toLocaleString('en-IN'), tax = o.tax || 0;
    res.setHeader('Cache-Control', 'no-store'); res.type('html');
    if (req.query.download) res.setHeader('Content-Disposition', `attachment; filename="invoice-${o.number}.html"`);
    res.send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Invoice ${esc(o.number)}</title><meta name="robots" content="noindex">
<style>body{font:14px/1.5 system-ui,sans-serif;color:#222;max-width:760px;margin:32px auto;padding:0 20px}h1{font:600 24px Georgia,serif;margin:0}table{width:100%;border-collapse:collapse;margin:18px 0}th,td{padding:8px 6px;border-bottom:1px solid #ddd;text-align:left}th:last-child,td:last-child,td.r{text-align:right}.top{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}.muted{color:#666}.tot td{border:0;padding:3px 6px}.tot .g td{font-weight:700;border-top:2px solid #222;font-size:16px}.btn{margin:0 0 16px;padding:8px 14px;border:1px solid #444;background:#fff;cursor:pointer}@media print{.btn{display:none}}</style></head><body>
<button class="btn" onclick="window.print()">Print / Save as PDF</button>
<div class="top"><div><h1>${esc(seller.name)}</h1><div class="muted">${esc(seller.addr)}${seller.gstin ? '<br>GSTIN ' + esc(seller.gstin) : ''}</div></div><div style="text-align:right"><b>${seller.gstin ? 'TAX INVOICE' : 'INVOICE'}</b><br>No. ${esc(o.number)}<br>Date ${esc(String(o.created_at).slice(0, 10))}<br>Tracking ${esc(o.tracking_id)}</div></div>
<p><b>Billed &amp; shipped to</b><br>${esc(a.name)}<br>${esc(a.line1)}${a.line2 ? ', ' + esc(a.line2) : ''}<br>${esc(a.city)}, ${esc(a.state)} ${esc(a.pincode)}<br>${esc(a.phone)}</p>
<table><thead><tr><th>Item</th><th>Size</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead><tbody>${its.map(i => `<tr><td>${esc(i.name)}</td><td>${esc(i.size)}</td><td>${i.qty}</td><td class="r">${inr(i.price)}</td><td>${inr(i.price * i.qty)}</td></tr>`).join('')}</tbody></table>
<table class="tot"><tr><td></td><td class="r">Subtotal</td><td class="r">${inr(o.subtotal)}</td></tr>${o.discount ? `<tr><td></td><td class="r">Discount${o.coupon ? ' (' + esc(o.coupon) + ')' : ''}</td><td class="r">−${inr(o.discount)}</td></tr>` : ''}<tr><td></td><td class="r">Delivery</td><td class="r">${o.shipping ? inr(o.shipping) : 'Free'}</td></tr><tr class="g"><td></td><td class="r">Total</td><td class="r">${inr(o.total)}</td></tr>${tax ? `<tr><td></td><td class="r muted">Includes GST</td><td class="r muted">${inr(tax)}</td></tr>` : ''}</table>
<p class="muted">Payment: ${esc(o.payment_method)} (${esc(o.payment_status)}). Thank you for shopping with us.</p></body></html>`);
  });

  /* --- staff: order management --- */
  const O = needPerm('orders');
  const delayedSql = `o.eta<>'' AND o.eta<? AND o.status IN (${qmarks(IN_FLIGHT)})`;
  router.get('/admin/orders', O, (req, res) => {
    const q = str(req.query.q, 60), g = str(req.query.group, 20), page = Math.max(1, parseInt(req.query.page, 10) || 1), per = 25;
    const where = [], p = [];
    if (q) { where.push('(o.number LIKE ? OR o.tracking_id LIKE ? OR o.email LIKE ? OR o.phone LIKE ? OR o.address LIKE ? OR o.tracking_no LIKE ?)'); const like = `%${q.replace(/[%_]/g, '')}%`; p.push(like, like, like, like, like, like); }
    if (g === 'delayed') { where.push(delayedSql); p.push(today(), ...IN_FLIGHT); } else { const gw = L.groupWhere(g); if (gw) { where.push(gw.sql); p.push(...gw.params); } }
    const W = where.length ? 'WHERE ' + where.join(' AND ') : '';
    const total = db.prepare(`SELECT COUNT(*) c FROM orders o ${W}`).get(...p).c;
    const rows = db.prepare(`SELECT o.*, u.name courier_name, u.phone courier_phone FROM orders o LEFT JOIN users u ON u.id=o.delivery_user_id ${W} ORDER BY o.id DESC LIMIT ? OFFSET ?`).all(...p, per, (page - 1) * per);
    const counts = Object.fromEntries(Object.keys(L.GROUPS).map(k => { const gw = L.groupWhere(k); return [k, db.prepare(`SELECT COUNT(*) c FROM orders o WHERE ${gw.sql}`).get(...gw.params).c]; }));
    counts.delayed = db.prepare(`SELECT COUNT(*) c FROM orders o WHERE ${delayedSql}`).get(today(), ...IN_FLIGHT).c; counts.all = db.prepare('SELECT COUNT(*) c FROM orders').get().c;
    res.json({ orders: rows.map(adminView), total, page, pages: Math.max(1, Math.ceil(total / per)), counts });
  });
  router.get('/admin/orders/:number', O, (req, res, next) => { const o = row(str(req.params.number, 30).toUpperCase()); if (!o) return next(new Denied(404, 'Order not found')); res.json({ order: adminView(o) }); });
  router.get('/admin/delivery-staff', O, (req, res) => res.json({ staff: db.prepare("SELECT id,name,phone FROM users WHERE role='delivery' ORDER BY name").all() }));
  router.patch('/admin/orders/:number', O, (req, res, next) => {
    const o = row(str(req.params.number, 30).toUpperCase()); if (!o) return next(new Denied(404, 'Order not found'));
    try {
      const b = req.body, status = str(b.status, 30) || o.status, notify = b.notify !== false;
      if (!STATUSES.includes(status)) throw bad('Unknown status.');
      if (status !== o.status && !L.allowed(o, status)) setStatus(o, status);   // not a legal move: this throws the precise reason, before anything is changed
      if (b.deliveryUserId !== undefined && b.deliveryUserId !== null && b.deliveryUserId !== '') {
        const d = db.prepare("SELECT id,name FROM users WHERE id=? AND role='delivery'").get(Number(b.deliveryUserId));
        if (!d) throw bad('Choose a delivery person from your team.');
        if (d.id !== o.delivery_user_id) { db.prepare('UPDATE orders SET delivery_user_id=?, sharing=0 WHERE id=?').run(d.id, o.id); db.prepare('INSERT INTO order_events(order_id,status,note) VALUES(?,?,?)').run(o.id, o.status, `Assigned to ${d.name.split(' ')[0]} for delivery`); audit(req, 'order.assign', o.number, d.name); }
      } else if (b.deliveryUserId === null || b.deliveryUserId === '') { if (o.delivery_user_id) { db.prepare('UPDATE orders SET delivery_user_id=NULL, sharing=0 WHERE id=?').run(o.id); audit(req, 'order.unassign', o.number); } }
      const eta = b.eta === undefined ? o.eta : str(b.eta, 10);
      if (eta && !/^\d{4}-\d{2}-\d{2}$/.test(eta)) throw bad('Enter the delivery date as YYYY-MM-DD.', 'eta');
      const carrier = b.carrier === undefined ? o.carrier : str(b.carrier, 40), trackingNo = b.trackingNo === undefined ? o.tracking_no : str(b.trackingNo, 40);
      const shipChanged = carrier !== o.carrier || trackingNo !== o.tracking_no;
      db.prepare('UPDATE orders SET eta=?, carrier=?, tracking_no=? WHERE id=?').run(eta, carrier, trackingNo, o.id);
      if (shipChanged && (carrier || trackingNo)) db.prepare('INSERT INTO order_events(order_id,status,note) VALUES(?,?,?)').run(o.id, o.status, `Shipping details: ${carrier || 'courier'}${trackingNo ? ' · ' + trackingNo : ''}`);
      let fresh = row(o.number);
      if (status !== o.status) { fresh = setStatus(fresh, status, { note: str(b.note, 200), notify }); audit(req, 'order.status', o.number, `${o.status} → ${status}`); }
      else if (eta !== o.eta) audit(req, 'order.eta', o.number, eta);
      res.json({ order: adminView(fresh) });
    } catch (e) { next(e); }
  });

  // Refunds. "razorpay" asks the gateway to refund the captured payment; "manual" records a refund made another way (UPI/bank/cash).
  router.post('/admin/orders/:number/refund', O, limit('refund', 20, 60000), async (req, res, next) => {
    try {
      let o = row(str(req.params.number, 30).toUpperCase()); if (!o) throw new Denied(404, 'Order not found');
      const via = str(req.body.method, 10) === 'razorpay' ? 'razorpay' : 'manual';
      if (db.prepare("SELECT 1 FROM payments WHERE order_id=? AND kind='refund' AND status='succeeded'").get(o.id)) throw new Denied(409, 'This order has already been refunded.');
      if (o.status === 'cancelled' || o.status === 'returned') o = setStatus(o, 'refund_processing', { notify: false });
      if (o.status !== 'refund_processing') throw bad('Only cancelled or returned orders can be refunded.');
      let ref = str(req.body.reference, 80) || null, done = true;
      if (via === 'razorpay') {
        const pay = (o.payment_method.match(/pay_[A-Za-z0-9]+/) || [])[0], id = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
        if (!pay || !id || !secret) throw bad('This order has no Razorpay payment to refund, or Razorpay keys are not configured. Use manual refund.');
        const r = await fetch(`https://api.razorpay.com/v1/payments/${pay}/refund`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64') }, body: JSON.stringify({ amount: o.total * 100, receipt: o.number }), signal: AbortSignal.timeout(10000) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j.id) { logEvent('refund_failed', 'warn', req, { detail: `${o.number} ${(j.error && j.error.description) || r.status}` }); throw new Denied(502, 'Razorpay could not process the refund: ' + ((j.error && j.error.description) || 'please try again or refund manually.')); }
        ref = j.id; done = j.status === 'processed';
      }
      recordPayment(o.id, { provider: via, ref, kind: 'refund', amount: o.total, status: done ? 'succeeded' : 'processing', note: str(req.body.note, 120) });
      if (done) o = setStatus(o, 'refunded', { note: via === 'razorpay' ? `Refund ${ref} processed` : 'Refund sent' + (ref ? ` · ref ${ref}` : '') });
      audit(req, 'order.refund', o.number, `${via} ${ref || ''}`);
      res.json({ order: adminView(row(o.number)) });
    } catch (e) { next(e); }
  });
  // Where is the courier right now? Admins (and managers) see the trail.
  router.get('/admin/orders/:number/live', O, (req, res, next) => {
    const o = row(str(req.params.number, 30).toUpperCase()); if (!o) return next(new Denied(404, 'Order not found'));
    const p = lastPoint(o.id), dest = o.dest_lat == null ? null : { lat: o.dest_lat, lng: o.dest_lng };
    res.json({
      sharing: !!o.sharing, courier: o.courier_name ? { name: o.courier_name, phone: o.courier_phone } : null, dest, store: geo.STORE, last: p || null, stale: !!p && Date.now() - p.ts > 5 * 60000,
      etaMinutes: p && dest ? geo.etaMinutes(p, dest) : null, delayed: isDelayed(o),
      trail: db.prepare('SELECT lat,lng,ts FROM courier_locations WHERE order_id=? ORDER BY id DESC LIMIT 60').all(o.id).reverse()
    });
  });
  // Map of every order that is on its way or waiting to ship.
  router.get('/admin/delivery-map', O, (req, res) => res.json({
    store: geo.STORE,
    orders: db.prepare(`SELECT o.number,o.status,o.tracking_id trackingId,o.eta,o.dest_lat lat,o.dest_lng lng,o.address,o.sharing FROM orders o WHERE o.dest_lat IS NOT NULL AND o.status IN ('placed','payment_confirmed','confirmed','preparing','packed','shipped','in_transit','out_for_delivery','delivery_failed') ORDER BY o.id DESC LIMIT 200`).all()
      .map(r => ({ ...r, delayed: isDelayed({ eta: r.eta, status: r.status }), city: JSON.parse(r.address).city, live: r.sharing ? (lastPoint(db.prepare('SELECT id FROM orders WHERE number=?').get(r.number).id) || null) : null, address: undefined }))
  }));

  /* --- delivery staff (courier) --- */
  const C = needPerm('delivery');
  const mine = (req, res, next) => {
    const o = row(str(req.params.number, 30).toUpperCase());
    if (!o || o.delivery_user_id !== req.user.id) { logEvent('forbidden', 'warn', req, { detail: `courier access to unassigned order ${req.params.number}` }); return next(new Denied(404, 'Order not found.')); }
    req.order = o; next();
  };
  router.get('/courier/orders', C, (req, res) => res.json({
    orders: db.prepare("SELECT * FROM orders WHERE delivery_user_id=? AND status IN ('shipped','in_transit','out_for_delivery','delivery_failed') ORDER BY id DESC").all(req.user.id).map(o => {
      const a = JSON.parse(o.address); return { number: o.number, status: o.status, sharing: !!o.sharing, eta: o.eta, cod: o.payment_status === 'pending' ? o.total : 0, name: a.name, phone: a.phone, address: [a.line1, a.line2, a.city, a.state, a.pincode].filter(Boolean).join(', '), dest: o.dest_lat == null ? null : { lat: o.dest_lat, lng: o.dest_lng } };
    })
  }));
  router.post('/courier/orders/:number/share', C, mine, (req, res, next) => {
    const on = !!req.body.on, o = req.order;
    if (on && o.status !== 'out_for_delivery') return next(bad('Mark the order "Out for delivery" before sharing your location.'));
    db.prepare('UPDATE orders SET sharing=? WHERE id=?').run(on ? 1 : 0, o.id);
    db.prepare('INSERT INTO order_events(order_id,status,note) VALUES(?,?,?)').run(o.id, o.status, on ? 'Live tracking started' : 'Live tracking stopped');
    audit(req, on ? 'gps.start' : 'gps.stop', o.number); res.json({ ok: true, sharing: on });
  });
  router.post('/courier/orders/:number/out', C, mine, (req, res, next) => { try { setStatus(req.order, 'out_for_delivery', { by: req.user.name.split(' ')[0] }); res.json({ ok: true }); } catch (e) { next(e); } });
  router.post('/courier/orders/:number/delivered', C, mine, (req, res, next) => { try { setStatus(req.order, 'delivered', { by: req.user.name.split(' ')[0] }); audit(req, 'order.delivered', req.order.number); res.json({ ok: true }); } catch (e) { next(e); } });
  router.post('/courier/orders/:number/failed', C, mine, (req, res, next) => {
    try { const why = str(req.body.reason, 150) || 'Customer unavailable'; setStatus(req.order, 'delivery_failed', { by: req.user.name.split(' ')[0], note: `Delivery attempt failed: ${why}` }); N.alertAdmin('warn', `Delivery failed for ${req.order.number}`, why); audit(req, 'order.delivery_failed', req.order.number, why); res.json({ ok: true }); } catch (e) { next(e); }
  });
  router.post('/courier/orders/:number/location', C, mine, (req, res, next) => {
    const o = req.order, lat = Number(req.body.lat), lng = Number(req.body.lng), acc = Math.min(Number(req.body.accuracy) || 0, 5000);
    if (!o.sharing || o.status !== 'out_for_delivery') return next(bad('Location sharing is not active for this order.'));   // never store without consent + an active delivery
    if (!geo.validPoint({ lat, lng }) || !geo.inIndia(lat, lng)) return next(bad('Invalid location.'));
    const prev = lastPoint(o.id); if (prev && Date.now() - prev.ts < 3000) return res.json({ ok: true, skipped: true });
    db.prepare('INSERT INTO courier_locations(order_id,lat,lng,accuracy,speed,ts) VALUES(?,?,?,?,?,?)').run(o.id, lat, lng, acc, Math.max(0, Number(req.body.speed) || 0), Date.now());
    db.prepare('DELETE FROM courier_locations WHERE order_id=? AND id NOT IN (SELECT id FROM courier_locations WHERE order_id=? ORDER BY id DESC LIMIT 300)').run(o.id, o.id);
    res.json({ ok: true });
  });
  // Location trails are personal data: delete them a week after delivery.
  setInterval(() => db.prepare("DELETE FROM courier_locations WHERE order_id IN (SELECT id FROM orders WHERE status IN ('delivered','cancelled','returned','refunded') AND delivered_at<>'' AND delivered_at < datetime('now','-7 days'))").run(), 6 * 3600000).unref();

  /* --- analytics & reports --- */
  const A = needPerm('analytics');
  const NOT_REVENUE = ['cancelled', 'returned', 'refund_processing', 'refunded', 'payment_failed', 'return_approved'];
  router.get('/admin/analytics', A, (req, res) => {
    const days = Math.min(365, Math.max(7, parseInt(req.query.days, 10) || 30)), since = `-${days} days`, live = `status NOT IN (${qmarks(NOT_REVENUE)})`, one = (s, ...p) => db.prepare(s).get(...p), all = (s, ...p) => db.prepare(s).all(...p);
    const tot = one(`SELECT COUNT(*) n, COALESCE(SUM(total),0) rev FROM orders WHERE ${live} AND created_at >= datetime('now', ?)`, ...NOT_REVENUE, since);
    res.json({
      days, orders: tot.n, revenue: tot.rev, aov: tot.n ? Math.round(tot.rev / tot.n) : 0,
      daily: all(`SELECT date(created_at) d, COUNT(*) n, COALESCE(SUM(total),0) rev FROM orders WHERE ${live} AND created_at >= datetime('now', ?) GROUP BY d ORDER BY d`, ...NOT_REVENUE, since),
      byStatus: all('SELECT status, COUNT(*) n FROM orders GROUP BY status'),
      topProducts: all(`SELECT i.name, SUM(i.qty) qty, SUM(i.qty*i.price) rev FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.${live} AND o.created_at >= datetime('now', ?) GROUP BY i.name ORDER BY rev DESC LIMIT 8`, ...NOT_REVENUE, since),
      payments: all(`SELECT CASE WHEN payment_method LIKE 'Cash%' THEN 'Cash on delivery' WHEN payment_method LIKE 'UPI%' THEN 'UPI' WHEN payment_method LIKE 'Card%' THEN 'Card' ELSE 'Online' END method, COUNT(*) n, SUM(total) rev FROM orders WHERE ${live} AND created_at >= datetime('now', ?) GROUP BY method`, ...NOT_REVENUE, since),
      cancelled: one("SELECT COUNT(*) n FROM orders WHERE closed_as='cancelled' AND created_at >= datetime('now', ?)", since).n,
      returned: one("SELECT COUNT(*) n FROM orders WHERE (status IN ('return_requested','return_approved','returned') OR closed_as='returned') AND created_at >= datetime('now', ?)", since).n,
      refundsDue: one("SELECT COUNT(*) n, COALESCE(SUM(total),0) amt FROM orders WHERE payment_status IN ('refund due','refund processing')").n,
      avgDeliveryDays: Math.round((one("SELECT AVG(julianday(delivered_at)-julianday(created_at)) d FROM orders WHERE delivered_at<>'' AND created_at >= datetime('now', ?)", since).d || 0) * 10) / 10,
      delayed: one(`SELECT COUNT(*) n FROM orders o WHERE ${delayedSql}`, today(), ...IN_FLIGHT).n,
      newCustomers: one("SELECT COUNT(*) n FROM users WHERE role='customer' AND created_at >= datetime('now', ?)", since).n,
      repeatCustomers: one("SELECT COUNT(*) n FROM (SELECT lower(email) e FROM orders WHERE closed_as='' GROUP BY e HAVING COUNT(*)>1)").n
    });
  });
  const csvCell = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };   // stops spreadsheet formula injection
  router.get('/admin/reports/sales.csv', A, (req, res) => {
    const days = Math.min(730, Math.max(1, parseInt(req.query.days, 10) || 30));
    const rows = db.prepare("SELECT number,tracking_id,created_at,status,payment_method,payment_status,subtotal,discount,shipping,total,address FROM orders WHERE created_at >= datetime('now', ?) ORDER BY id DESC").all(`-${days} days`);
    res.setHeader('Content-Disposition', `attachment; filename="sales-${today()}.csv"`); res.type('text/csv');
    res.send(['Order,Tracking ID,Date,Status,Payment,Payment status,Subtotal,Discount,Delivery,Total,City,State'].concat(rows.map(r => { const a = JSON.parse(r.address); return [r.number, r.tracking_id, r.created_at, r.status, r.payment_method, r.payment_status, r.subtotal, r.discount, r.shipping, r.total, a.city, a.state].map(csvCell).join(','); })).join('\n'));
    audit(req, 'report.export', 'sales.csv', `${rows.length} rows`);
  });
  router.get('/admin/notifications-log', needPerm('*'), (req, res) => res.json({ log: db.prepare('SELECT ts,channel,to_addr,subject,status,order_number,detail FROM notification_log ORDER BY id DESC LIMIT 50').all() }));

  /* --- diagnostics & logging --- */
  router.get('/admin/maps-check', S.needAdminSetup, async (req, res, next) => { try { res.json(await require('./mapscheck').check()); } catch (e) { next(e); } });
  // Browser-side problems (Maps failing to load, payment window errors) are written to the error log so they can be diagnosed later.
  router.post('/client-log', limit('client-log', 20, 60000), (req, res) => {
    const kind = ['maps', 'payment', 'js'].includes(req.body.kind) ? req.body.kind : 'js', msg = str(req.body.message, 200).replace(/[\r\n]+/g, ' '), where = str(req.body.where, 100).replace(/[^\w/#?=&.:-]/g, '');
    db.prepare('INSERT INTO error_log(ts,kind,route,status,ms,message) VALUES(?,?,?,?,?,?)').run(Date.now(), 'client-' + kind, where, 0, 0, msg);
    res.json({ ok: true });
  });
  // Health check for uptime monitors: database round-trip + which integrations are configured (never the secrets themselves).
  router.get('/health', (req, res) => {
    let dbOk = false; try { dbOk = db.prepare('SELECT 1 v').get().v === 1; } catch { /* reported below */ }
    res.status(dbOk ? 200 : 503).json({ ok: dbOk, db: dbOk, uptimeSec: Math.round(process.uptime()), integrations: { googleMapsBrowser: !!process.env.GOOGLE_MAPS_API_KEY, googleMapsServer: !!process.env.GOOGLE_MAPS_SERVER_KEY, razorpay: !!(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET), email: !!process.env.RESEND_API_KEY, sms: !!process.env.MSG91_AUTH_KEY, whatsapp: !!process.env.WHATSAPP_TOKEN } });
  });

  return router;
}

module.exports = { build, newTrackingId, setStatus, onPlaced, recordPayment, expireUnpaid, publicView, trackingUrl, STATUSES, LABEL, NOTE, row };
