'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { db, tx, hashPassword, COUPONS, LOOKS, getSetting, setSetting } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const FREE_SHIP_MIN = 7500, SHIP_FEE = 199, MAX_QTY = 10;
const STATUSES = ['placed', 'confirmed', 'preparing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'];
const STATUS_NOTE = {
  placed: 'Order received', confirmed: 'Order confirmed by the atelier', preparing: 'Being prepared & quality-checked',
  shipped: 'Handed to courier', out_for_delivery: 'Out for delivery', delivered: 'Delivered', cancelled: 'Order cancelled'
};

app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

/* ---------- helpers ---------- */
class HttpError extends Error { constructor(status, message, field) { super(message); this.status = status; this.field = field; } }
const bad = (msg, field) => new HttpError(400, msg, field);
const wrap = fn => (req, res, next) => { try { Promise.resolve(fn(req, res, next)).catch(next); } catch (e) { next(e); } };
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const cleanPhone = v => { const d = String(v || '').replace(/[^\d]/g, ''); return d.length === 12 && d.startsWith('91') ? d.slice(2) : d; };
const isPhone = v => /^[6-9]\d{9}$/.test(v);

const cookies = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(c => c[0]).map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const setSession = (res, token, maxAge) => res.setHeader('Set-Cookie', `kb_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`);

app.use((req, res, next) => {
  const t = cookies(req).kb_session;
  req.user = null;
  if (t) {
    const row = db.prepare('SELECT u.id,u.name,u.email,u.phone,u.role,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?').get(t);
    if (row && row.expires_at > Date.now()) req.user = row; else if (row) db.prepare('DELETE FROM sessions WHERE token=?').run(t);
  }
  next();
});
// state-changing requests must be JSON (blocks plain cross-site form posts)
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && Number(req.headers['content-length'] || 0) > 0 && !req.is('application/json')) return next(bad('JSON required'));
  next();
});
const needUser = (req, res, next) => (req.user ? next() : next(new HttpError(401, 'Please sign in to continue.')));
const needAdmin = (req, res, next) => (req.user && req.user.role === 'admin' ? next() : next(new HttpError(403, 'Admins only.')));

const hits = new Map();
const limit = (name, max, windowMs) => (req, res, next) => {
  const key = name + ':' + req.ip, now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) return next(new HttpError(429, 'Too many attempts. Please wait a minute and try again.'));
  arr.push(now); hits.set(key, arr); next();
};
setInterval(() => hits.clear(), 10 * 60 * 1000).unref();

const publicUser = u => u && ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role });

/* ---------- catalog ---------- */
const twinPct = () => Math.max(0, Math.min(50, Number(getSetting('twinningPercent')) || 0));
const ratingStmt = db.prepare('SELECT COALESCE(ROUND(AVG(rating),1),0) rating, COUNT(*) reviews FROM reviews WHERE product_id=?');
function shapeProduct(r) {
  if (!r) return null;
  const stock = JSON.parse(r.stock), rt = ratingStmt.get(r.id);
  const total = Object.values(stock).reduce((a, b) => a + b, 0);
  return {
    id: r.id, slug: r.slug, name: r.name, category: r.category, collection: r.collection, price: r.price, compareAt: r.compare_at,
    tagline: r.tagline, description: r.description, details: JSON.parse(r.details || '[]'), includes: JSON.parse(r.includes || '[]'),
    care: r.care, colors: JSON.parse(r.colors || '[]'), images: JSON.parse(r.images), badge: r.badge, featured: !!r.featured,
    stock, inStock: total > 0, lowStock: total > 0 && total <= 5, rating: rt.rating, reviews: rt.reviews, active: !!r.active,
    twinSlug: r.twin_slug || '', kids: r.category === 'Kids'
  };
}
const allProducts = () => db.prepare('SELECT * FROM products WHERE active=1 ORDER BY sort,id').all().map(shapeProduct);

app.get('/api/meta', (req, res) => {
  const ps = allProducts();
  res.json({
    categories: [...new Set(ps.map(p => p.category))],
    collections: [...new Set(ps.map(p => p.collection))],
    colors: [...new Set(ps.flatMap(p => p.colors))],
    sizes: ['XS', 'S', 'M', 'L', 'XL'], kidsSizes: ['2Y', '4Y', '6Y', '8Y', '10Y', '12Y'],
    whatsapp: getSetting('whatsapp'), twinningPercent: twinPct(),
    priceMin: Math.min(...ps.map(p => p.price)), priceMax: Math.max(...ps.map(p => p.price)),
    freeShippingMin: FREE_SHIP_MIN, shippingFee: SHIP_FEE, maxQty: MAX_QTY,
    coupons: Object.entries(COUPONS).map(([code, c]) => ({ code, label: c.label }))
  });
});

app.get('/api/products', (req, res) => {
  const q = str(req.query.q, 80).toLowerCase(), cat = str(req.query.category), col = str(req.query.collection);
  const min = Number(req.query.min) || 0, max = Number(req.query.max) || Infinity, size = str(req.query.size, 3), color = str(req.query.color);
  const sort = str(req.query.sort, 20);
  let ps = allProducts().filter(p =>
    (!cat || p.category === cat) && (!col || p.collection === col) && p.price >= min && p.price <= max &&
    (!size || (p.stock[size] || 0) > 0) && (!color || p.colors.includes(color)) &&
    (req.query.instock !== '1' || p.inStock) && (req.query.sale !== '1' || p.compareAt) &&
    (!q || [p.name, p.category, p.collection, p.tagline, p.description, p.colors.join(' ')].join(' ').toLowerCase().includes(q)));
  const by = { 'price-asc': (a, b) => a.price - b.price, 'price-desc': (a, b) => b.price - a.price, 'rating': (a, b) => b.rating - a.rating, 'new': (a, b) => b.id - a.id, 'name': (a, b) => a.name.localeCompare(b.name) }[sort];
  if (by) ps.sort(by);
  if (req.query.featured === '1') ps = ps.filter(p => p.featured);
  const lim = Number(req.query.limit);
  res.json({ total: ps.length, products: lim ? ps.slice(0, lim) : ps });
});

app.get('/api/products/:slug', (req, res, next) => {
  const row = db.prepare('SELECT * FROM products WHERE slug=? AND active=1').get(req.params.slug);
  if (!row) return next(new HttpError(404, 'Product not found'));
  const p = shapeProduct(row);
  const reviews = db.prepare('SELECT id,author,rating,title,body,created_at FROM reviews WHERE product_id=? ORDER BY id DESC').all(p.id);
  const related = allProducts().filter(x => x.id !== p.id).sort((a, b) => (b.collection === p.collection) - (a.collection === p.collection)).slice(0, 4);
  const twin = p.twinSlug ? shapeProduct(db.prepare('SELECT * FROM products WHERE slug=? AND active=1').get(p.twinSlug)) : null;
  res.json({ product: p, reviews, related, twin });
});

app.get('/api/lookbook', (req, res) => {
  const bySlug = new Map(allProducts().map(p => [p.slug, p]));
  const card = p => p && ({ id: p.id, slug: p.slug, name: p.name, price: p.price, compareAt: p.compareAt, image: p.images[0], images: p.images, stock: p.stock, inStock: p.inStock, collection: p.collection });
  res.json({ looks: LOOKS.map(l => ({ ...l, spots: l.spots.filter(s => bySlug.has(s.slug)).map(s => ({ ...s, product: card(bySlug.get(s.slug)) })) })) });
});

app.get('/api/reviews/featured', (req, res) => {
  res.json({ reviews: db.prepare('SELECT r.author,r.rating,r.title,r.body,p.name product,p.slug FROM reviews r JOIN products p ON p.id=r.product_id WHERE r.rating>=4 ORDER BY r.id DESC LIMIT 6').all() });
});

app.post('/api/products/:slug/reviews', needUser, (req, res, next) => {
  const row = db.prepare('SELECT id FROM products WHERE slug=?').get(req.params.slug);
  if (!row) return next(new HttpError(404, 'Product not found'));
  const rating = Number(req.body.rating), body = str(req.body.body, 1000), title = str(req.body.title, 100);
  if (!(rating >= 1 && rating <= 5)) return next(bad('Please choose a rating from 1 to 5.', 'rating'));
  if (body.length < 10) return next(bad('Please write at least 10 characters.', 'body'));
  if (db.prepare('SELECT 1 FROM reviews WHERE product_id=? AND user_id=?').get(row.id, req.user.id)) return next(bad('You have already reviewed this product.'));
  db.prepare('INSERT INTO reviews(product_id,user_id,author,rating,title,body) VALUES(?,?,?,?,?,?)').run(row.id, req.user.id, req.user.name.split(' ')[0] + ' ' + (req.user.name.split(' ')[1] || '').charAt(0), Math.round(rating), title, body);
  res.status(201).json({ ok: true });
});

/* ---------- auth & account ---------- */
function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex'), maxAge = 30 * 86400;
  db.prepare('INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)').run(token, userId, Date.now() + maxAge * 1000);
  setSession(res, token, maxAge);
}
app.post('/api/auth/register', limit('reg', 10, 60000), (req, res, next) => {
  const name = str(req.body.name, 80), email = str(req.body.email, 120).toLowerCase(), phone = cleanPhone(req.body.phone), pw = String(req.body.password || '');
  if (name.length < 2) return next(bad('Please enter your full name.', 'name'));
  if (!isEmail(email)) return next(bad('Please enter a valid email address.', 'email'));
  if (phone && !isPhone(phone)) return next(bad('Enter a valid 10-digit mobile number.', 'phone'));
  if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return next(bad('Password needs 8+ characters with a letter and a number.', 'password'));
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return next(new HttpError(409, 'An account with this email already exists. Try signing in.', 'email'));
  const { salt, hash } = hashPassword(pw);
  const id = db.prepare('INSERT INTO users(name,email,phone,salt,hash) VALUES(?,?,?,?,?)').run(name, email, phone, salt, hash).lastInsertRowid;
  // link earlier guest orders placed with this email
  db.prepare('UPDATE orders SET user_id=? WHERE user_id IS NULL AND lower(email)=?').run(id, email);
  startSession(res, id);
  res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id)) });
});
app.post('/api/auth/login', limit('login', 10, 60000), (req, res, next) => {
  const email = str(req.body.email, 120).toLowerCase(), pw = String(req.body.password || '');
  const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
  const ok = u && crypto.timingSafeEqual(Buffer.from(hashPassword(pw, u.salt).hash), Buffer.from(u.hash));
  if (!ok) return next(new HttpError(401, 'Incorrect email or password.'));
  startSession(res, u.id);
  res.json({ user: publicUser(u) });
});
app.post('/api/auth/logout', (req, res) => {
  const t = cookies(req).kb_session; if (t) db.prepare('DELETE FROM sessions WHERE token=?').run(t);
  setSession(res, '', 0); res.json({ ok: true });
});
app.get('/api/auth/me', (req, res) => res.json({ user: publicUser(req.user) }));

app.patch('/api/account', needUser, (req, res, next) => {
  const name = str(req.body.name, 80), phone = cleanPhone(req.body.phone);
  if (name.length < 2) return next(bad('Please enter your full name.', 'name'));
  if (phone && !isPhone(phone)) return next(bad('Enter a valid 10-digit mobile number.', 'phone'));
  db.prepare('UPDATE users SET name=?, phone=? WHERE id=?').run(name, phone, req.user.id);
  res.json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id)) });
});
app.post('/api/account/password', needUser, limit('pw', 10, 60000), (req, res, next) => {
  const u = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id), pw = String(req.body.newPassword || '');
  if (!crypto.timingSafeEqual(Buffer.from(hashPassword(String(req.body.currentPassword || ''), u.salt).hash), Buffer.from(u.hash))) return next(bad('Current password is incorrect.', 'currentPassword'));
  if (pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return next(bad('Password needs 8+ characters with a letter and a number.', 'newPassword'));
  const { salt, hash } = hashPassword(pw);
  db.prepare('UPDATE users SET salt=?, hash=? WHERE id=?').run(salt, hash, u.id);
  const keep = cookies(req).kb_session; db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(u.id, keep);
  res.json({ ok: true });
});

function readAddress(b) {
  const a = { name: str(b.name, 80), phone: cleanPhone(b.phone), line1: str(b.line1, 150), line2: str(b.line2, 150), city: str(b.city, 60), state: str(b.state, 60), pincode: str(b.pincode, 6), label: str(b.label, 20) || 'Home' };
  if (a.name.length < 2) throw bad('Enter the recipient name.', 'name');
  if (!isPhone(a.phone)) throw bad('Enter a valid 10-digit mobile number.', 'phone');
  if (a.line1.length < 5) throw bad('Enter the street address.', 'line1');
  if (a.city.length < 2) throw bad('Enter the city.', 'city');
  if (a.state.length < 2) throw bad('Enter the state.', 'state');
  if (!/^[1-9]\d{5}$/.test(a.pincode)) throw bad('Enter a valid 6-digit PIN code.', 'pincode');
  return a;
}
const addrCols = 'name,phone,line1,line2,city,state,pincode,label';
app.get('/api/addresses', needUser, (req, res) => res.json({ addresses: db.prepare('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC,id').all(req.user.id) }));
app.post('/api/addresses', needUser, (req, res) => {
  const a = readAddress(req.body), first = !db.prepare('SELECT 1 FROM addresses WHERE user_id=?').get(req.user.id);
  const def = first || req.body.isDefault ? 1 : 0;
  tx(() => {
    if (def) db.prepare('UPDATE addresses SET is_default=0 WHERE user_id=?').run(req.user.id);
    db.prepare(`INSERT INTO addresses(user_id,${addrCols},is_default) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(req.user.id, a.name, a.phone, a.line1, a.line2, a.city, a.state, a.pincode, a.label, def);
  });
  res.status(201).json({ addresses: db.prepare('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC,id').all(req.user.id) });
});
app.put('/api/addresses/:id', needUser, (req, res, next) => {
  const row = db.prepare('SELECT id FROM addresses WHERE id=? AND user_id=?').get(req.params.id, req.user.id);
  if (!row) return next(new HttpError(404, 'Address not found'));
  const a = readAddress(req.body);
  tx(() => {
    if (req.body.isDefault) { db.prepare('UPDATE addresses SET is_default=0 WHERE user_id=?').run(req.user.id); db.prepare('UPDATE addresses SET is_default=1 WHERE id=?').run(row.id); }
    db.prepare('UPDATE addresses SET name=?,phone=?,line1=?,line2=?,city=?,state=?,pincode=?,label=? WHERE id=?').run(a.name, a.phone, a.line1, a.line2, a.city, a.state, a.pincode, a.label, row.id);
  });
  res.json({ addresses: db.prepare('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC,id').all(req.user.id) });
});
app.delete('/api/addresses/:id', needUser, (req, res) => {
  db.prepare('DELETE FROM addresses WHERE id=? AND user_id=?').run(req.params.id, req.user.id);
  const left = db.prepare('SELECT id FROM addresses WHERE user_id=? ORDER BY id').all(req.user.id);
  if (left.length && !db.prepare('SELECT 1 FROM addresses WHERE user_id=? AND is_default=1').get(req.user.id)) db.prepare('UPDATE addresses SET is_default=1 WHERE id=?').run(left[0].id);
  res.json({ addresses: db.prepare('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC,id').all(req.user.id) });
});

/* ---------- made-to-measure ---------- */
// inches; ranges cover petite adults and kids
const MEASURE = { bust: [18, 60], waist: [16, 56], hip: [20, 64], shoulder: [9, 24], blouseLength: [8, 24], skirtLength: [18, 50], height: [30, 84] };
function readMeasurements(b, required) {
  if (!b || typeof b !== 'object') return null;
  const out = {};
  for (const [k, [lo, hi]] of Object.entries(MEASURE)) {
    if (b[k] === undefined || b[k] === '' || b[k] === null) continue;
    const v = Math.round(Number(b[k]) * 4) / 4;   // quarter-inch precision
    if (!(v >= lo && v <= hi)) throw bad(`Enter ${k.replace(/[A-Z]/g, c => ' ' + c.toLowerCase())} between ${lo} and ${hi} inches.`, 'm_' + k);
    out[k] = v;
  }
  for (const k of ['bust', 'waist', 'hip']) if (required && out[k] === undefined) throw bad(`Please enter your ${k} measurement.`, 'm_' + k);
  const notes = str(b.notes, 300); if (notes) out.notes = notes;
  const forWhom = str(b.forWhom, 40); if (forWhom) out.forWhom = forWhom;
  return Object.keys(out).length ? out : null;
}
app.get('/api/account/measurements', needUser, (req, res) => {
  const r = db.prepare('SELECT data,updated_at FROM measurements WHERE user_id=?').get(req.user.id);
  res.json({ measurements: r ? JSON.parse(r.data) : null, updatedAt: r ? r.updated_at : null });
});
app.put('/api/account/measurements', needUser, (req, res) => {
  const m = readMeasurements(req.body, true);
  db.prepare("INSERT INTO measurements(user_id,data,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at").run(req.user.id, JSON.stringify(m));
  res.json({ measurements: m });
});

/* ---------- wishlist ---------- */
const wishIds = uid => db.prepare('SELECT product_id FROM wishlist WHERE user_id=?').all(uid).map(r => r.product_id);
app.get('/api/wishlist', needUser, (req, res) => res.json({ ids: wishIds(req.user.id) }));
app.put('/api/wishlist', needUser, (req, res) => {   // bulk merge from guest list
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Number.isInteger).slice(0, 100);
  const ins = db.prepare('INSERT OR IGNORE INTO wishlist(user_id,product_id) SELECT ?,id FROM products WHERE id=?');
  tx(() => ids.forEach(i => ins.run(req.user.id, i)));
  res.json({ ids: wishIds(req.user.id) });
});
app.post('/api/wishlist/:id', needUser, (req, res, next) => {
  if (!db.prepare('SELECT 1 FROM products WHERE id=?').get(req.params.id)) return next(new HttpError(404, 'Product not found'));
  db.prepare('INSERT OR IGNORE INTO wishlist(user_id,product_id) VALUES(?,?)').run(req.user.id, req.params.id);
  res.json({ ids: wishIds(req.user.id) });
});
app.delete('/api/wishlist/:id', needUser, (req, res) => {
  db.prepare('DELETE FROM wishlist WHERE user_id=? AND product_id=?').run(req.user.id, req.params.id);
  res.json({ ids: wishIds(req.user.id) });
});

/* ---------- cart pricing ---------- */
function quote(rawItems, couponCode) {
  if (!Array.isArray(rawItems) || !rawItems.length) throw bad('Your bag is empty.');
  if (rawItems.length > 30) throw bad('Too many items.');
  const lines = [], warnings = [], merged = new Map();
  for (const it of rawItems) {
    const k = `${it.id}|${it.size}`, q = Math.floor(Number(it.qty));
    if (!(q >= 1)) continue;
    merged.set(k, { id: Number(it.id), size: str(it.size, 3), qty: Math.min(MAX_QTY, (merged.get(k)?.qty || 0) + q) });
  }
  for (const it of merged.values()) {
    const row = db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(it.id);
    if (!row) { warnings.push({ id: it.id, size: it.size, message: 'An item is no longer available and was removed.', remove: true }); continue; }
    const p = shapeProduct(row), avail = p.stock[it.size];
    if (avail === undefined) { warnings.push({ id: it.id, size: it.size, message: `Please choose a size for ${p.name}.`, remove: true }); continue; }
    let qty = it.qty;
    if (avail <= 0) { warnings.push({ id: it.id, size: it.size, message: `${p.name} (${it.size}) is sold out and was removed.`, remove: true }); continue; }
    if (qty > avail) { warnings.push({ id: it.id, size: it.size, message: `Only ${avail} of ${p.name} (${it.size}) left — quantity adjusted.`, qty: avail }); qty = avail; }
    lines.push({ id: p.id, slug: p.slug, name: p.name, image: p.images[0], size: it.size, qty, price: p.price, compareAt: p.compareAt, available: avail, lineTotal: p.price * qty });
  }
  const subtotal = lines.reduce((a, l) => a + l.lineTotal, 0);
  // twinning: a set and its matching twin bought together get a pair discount
  let twinning = 0, pairs = 0; const pct = twinPct(), seen = new Set();
  if (pct) for (const l of lines) {
    const row = db.prepare('SELECT twin_slug FROM products WHERE id=?').get(l.id);
    if (!row || !row.twin_slug || seen.has(l.slug)) continue;
    const mates = lines.filter(x => x.slug === row.twin_slug); if (!mates.length) continue;
    seen.add(l.slug); seen.add(row.twin_slug);
    const n = Math.min(lines.filter(x => x.slug === l.slug).reduce((a, x) => a + x.qty, 0), mates.reduce((a, x) => a + x.qty, 0));
    pairs += n; twinning += Math.round((l.price + mates[0].price) * n * pct / 100);
  }
  let shipping = subtotal >= FREE_SHIP_MIN || !lines.length ? 0 : SHIP_FEE, discount = 0, coupon = null, couponMessage = '';
  const code = str(couponCode, 20).toUpperCase();
  if (code) {
    const c = COUPONS[code];
    if (!c) couponMessage = 'That code is not valid.';
    else if (subtotal < c.min) couponMessage = `${code} needs a minimum order of ₹${c.min.toLocaleString('en-IN')}.`;
    else {
      coupon = code; couponMessage = c.label + ' applied';
      if (c.type === 'percent') discount = Math.round(subtotal * c.value / 100); else if (c.type === 'flat') discount = c.value; else shipping = 0;
    }
  }
  return { lines, warnings, subtotal, shipping, discount, coupon, couponMessage, twinning, twinPairs: pairs, twinPercent: pct,
    total: Math.max(0, subtotal - discount - twinning + shipping), freeShippingMin: FREE_SHIP_MIN };
}
app.post('/api/cart/quote', (req, res, next) => {
  try { res.json(req.body.items && req.body.items.length ? quote(req.body.items, req.body.coupon) : { lines: [], warnings: [], subtotal: 0, shipping: 0, discount: 0, coupon: null, couponMessage: '', twinning: 0, twinPairs: 0, total: 0, freeShippingMin: FREE_SHIP_MIN }); } catch (e) { next(e); }
});

/* ---------- orders ---------- */
const luhn = n => { let s = 0, alt = false; for (let i = n.length - 1; i >= 0; i--) { let d = +n[i]; if (alt) { d *= 2; if (d > 9) d -= 9; } s += d; alt = !alt; } return s % 10 === 0; };
function readPayment(b) {
  const method = str(b.method, 10);
  if (method === 'cod') return { method, status: 'pending', ref: 'Cash on delivery' };
  if (method === 'upi') {
    const id = str(b.upiId, 60);
    if (!/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(id)) throw bad('Enter a valid UPI ID (e.g. name@bank).', 'upiId');
    return { method, status: 'paid', ref: 'UPI ' + id.replace(/^(.{2}).*(@.*)$/, '$1•••$2') };
  }
  if (method === 'card') {
    const num = String(b.cardNumber || '').replace(/\s/g, ''), exp = String(b.expiry || ''), cvv = String(b.cvv || '');
    if (!/^\d{13,19}$/.test(num) || !luhn(num)) throw bad('That card number does not look right.', 'cardNumber');
    const m = exp.match(/^(0[1-9]|1[0-2])\s*\/\s*(\d{2})$/);
    if (!m || new Date(2000 + +m[2], +m[1], 0, 23, 59) < new Date()) throw bad('Enter a valid expiry (MM/YY).', 'expiry');
    if (!/^\d{3,4}$/.test(cvv)) throw bad('Enter the 3 or 4 digit CVV.', 'cvv');
    if (str(b.cardName, 60).length < 2) throw bad('Enter the name on the card.', 'cardName');
    return { method, status: 'paid', ref: 'Card •••• ' + num.slice(-4) };
  }
  throw bad('Please choose a payment method.', 'method');
}
function orderNumber() {
  const d = new Date(), ymd = String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  for (;;) { const n = `KB-${ymd}-${crypto.randomInt(1000, 9999)}`; if (!db.prepare('SELECT 1 FROM orders WHERE number=?').get(n)) return n; }
}
function loadOrder(number) {
  const o = db.prepare('SELECT * FROM orders WHERE number=?').get(number);
  if (!o) return null;
  return {
    number: o.number, status: o.status, paymentMethod: o.payment_method, paymentStatus: o.payment_status, subtotal: o.subtotal, shipping: o.shipping,
    discount: o.discount, total: o.total, coupon: o.coupon, address: JSON.parse(o.address), email: o.email, phone: o.phone, notes: o.notes,
    carrier: o.carrier, trackingNo: o.tracking_no, createdAt: o.created_at, userId: o.user_id,
    measurements: o.measurements ? JSON.parse(o.measurements) : null,
    items: db.prepare('SELECT product_id productId,name,image,size,qty,price FROM order_items WHERE order_id=?').all(o.id),
    events: db.prepare('SELECT status,note,created_at createdAt FROM order_events WHERE order_id=? ORDER BY id').all(o.id)
  };
}
const outOrder = o => { const { userId, ...rest } = o; return rest; };

app.post('/api/orders', limit('order', 20, 60000), (req, res, next) => {
  const email = str(req.body.email || (req.user && req.user.email), 120).toLowerCase();
  if (!isEmail(email)) return next(bad('Enter a valid email so we can send your confirmation.', 'email'));
  const address = readAddress(req.body.address || {}), payment = readPayment(req.body.payment || {}), notes = str(req.body.notes, 300);
  let measurements = null;
  if (req.body.fit === 'saved' && req.user) {
    const r = db.prepare('SELECT data FROM measurements WHERE user_id=?').get(req.user.id);
    if (!r) return next(bad('No saved measurements found. Enter them below or choose standard size.', 'fit'));
    measurements = JSON.parse(r.data);
  } else if (req.body.fit === 'custom') {
    measurements = readMeasurements(req.body.measurements, true);
    if (req.user && req.body.saveMeasurements) db.prepare("INSERT INTO measurements(user_id,data,updated_at) VALUES(?,?,datetime('now')) ON CONFLICT(user_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at").run(req.user.id, JSON.stringify(measurements));
  }
  let order;
  try {
    order = tx(() => {
      const q = quote(req.body.items, req.body.coupon);
      if (q.warnings.length) throw new HttpError(409, q.warnings.map(w => w.message).join(' ') + ' Please review your bag.');
      const number = orderNumber();
      const id = db.prepare(`INSERT INTO orders(number,user_id,email,phone,status,payment_method,payment_status,subtotal,shipping,discount,total,coupon,address,notes,measurements)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(number, req.user ? req.user.id : null, email, address.phone, 'placed', payment.ref, payment.status,
        q.subtotal, q.shipping, q.discount + q.twinning, q.total, q.coupon || (q.twinning ? 'TWINNING' : null), JSON.stringify(address), notes,
        measurements ? JSON.stringify(measurements) : '').lastInsertRowid;
      const insItem = db.prepare('INSERT INTO order_items(order_id,product_id,name,image,size,qty,price) VALUES(?,?,?,?,?,?,?)');
      for (const l of q.lines) {
        const row = db.prepare('SELECT stock FROM products WHERE id=?').get(l.id), st = JSON.parse(row.stock);
        if (st[l.size] < l.qty) throw new HttpError(409, `${l.name} (${l.size}) just sold out.`);
        st[l.size] -= l.qty; db.prepare('UPDATE products SET stock=? WHERE id=?').run(JSON.stringify(st), l.id);
        insItem.run(id, l.id, l.name, l.image, l.size, l.qty, l.price);
      }
      db.prepare('INSERT INTO order_events(order_id,status,note) VALUES(?,?,?)').run(id, 'placed', STATUS_NOTE.placed + (payment.status === 'paid' ? ' · payment received' : ' · pay on delivery'));
      if (req.user && !db.prepare('SELECT 1 FROM addresses WHERE user_id=?').get(req.user.id) && req.body.saveAddress !== false)
        db.prepare(`INSERT INTO addresses(user_id,${addrCols},is_default) VALUES(?,?,?,?,?,?,?,?,?,1)`).run(req.user.id, address.name, address.phone, address.line1, address.line2, address.city, address.state, address.pincode, address.label);
      return number;
    });
  } catch (e) { return next(e); }
  res.status(201).json({ order: outOrder(loadOrder(order)) });
});

app.get('/api/orders', needUser, (req, res) => {
  const nums = db.prepare('SELECT number FROM orders WHERE user_id=? ORDER BY id DESC').all(req.user.id);
  res.json({ orders: nums.map(n => outOrder(loadOrder(n.number))) });
});
function canView(req, o) {
  if (!o) return false;
  if (req.user && (req.user.role === 'admin' || o.userId === req.user.id)) return true;
  const e = str(req.query.email, 120).toLowerCase();
  return !!e && e === o.email.toLowerCase();
}
app.get('/api/orders/:number', (req, res, next) => {
  const o = loadOrder(str(req.params.number, 30).toUpperCase());
  if (!canView(req, o)) return next(new HttpError(404, 'We could not find that order. Check the order number and email.'));
  res.json({ order: outOrder(o) });
});
app.get('/api/track', limit('track', 20, 60000), (req, res, next) => {
  const o = loadOrder(str(req.query.number, 30).toUpperCase());
  if (!o || o.email.toLowerCase() !== str(req.query.email, 120).toLowerCase()) return next(new HttpError(404, 'We could not find that order. Check the order number and email.'));
  res.json({ order: outOrder(o) });
});
function restock(orderRow) {
  const items = db.prepare('SELECT product_id,size,qty FROM order_items WHERE order_id=?').all(orderRow.id);
  for (const it of items) {
    const row = db.prepare('SELECT stock FROM products WHERE id=?').get(it.product_id); if (!row) continue;
    const st = JSON.parse(row.stock); st[it.size] = (st[it.size] || 0) + it.qty;
    db.prepare('UPDATE products SET stock=? WHERE id=?').run(JSON.stringify(st), it.product_id);
  }
}
app.post('/api/orders/:number/cancel', (req, res, next) => {
  const o = loadOrder(str(req.params.number, 30).toUpperCase());
  if (!canView(req, o)) return next(new HttpError(404, 'Order not found.'));
  if (!['placed', 'confirmed'].includes(o.status)) return next(bad('This order has already moved to preparation and can no longer be cancelled online. Please contact us.'));
  tx(() => {
    const row = db.prepare('SELECT * FROM orders WHERE number=?').get(o.number);
    db.prepare("UPDATE orders SET status='cancelled', payment_status=CASE WHEN payment_status='paid' THEN 'refund due' ELSE 'cancelled' END WHERE id=?").run(row.id);
    db.prepare('INSERT INTO order_events(order_id,status,note) VALUES(?,?,?)').run(row.id, 'cancelled', 'Cancelled by customer');
    restock(row);
  });
  res.json({ order: outOrder(loadOrder(o.number)) });
});

/* ---------- forms ---------- */
app.post('/api/inquiries', limit('inq', 6, 60000), (req, res, next) => {
  const name = str(req.body.name, 80), email = str(req.body.email, 120), phone = cleanPhone(req.body.phone), message = str(req.body.message, 1500);
  if (name.length < 2) return next(bad('Please enter your name.', 'name'));
  if (!isEmail(email)) return next(bad('Please enter a valid email.', 'email'));
  if (phone && !isPhone(phone)) return next(bad('Enter a valid 10-digit mobile number.', 'phone'));
  if (message.length < 10) return next(bad('Tell us a little more (10+ characters).', 'message'));
  db.prepare('INSERT INTO inquiries(name,email,phone,topic,preferred_date,message) VALUES(?,?,?,?,?,?)').run(name, email.toLowerCase(), phone, str(req.body.topic, 60), str(req.body.preferredDate, 20), message);
  res.status(201).json({ ok: true });
});
app.post('/api/newsletter', limit('news', 6, 60000), (req, res, next) => {
  const email = str(req.body.email, 120).toLowerCase();
  if (!isEmail(email)) return next(bad('Please enter a valid email.', 'email'));
  const r = db.prepare('INSERT OR IGNORE INTO newsletter(email) VALUES(?)').run(email);
  res.status(201).json({ ok: true, already: r.changes === 0 });
});

/* ---------- admin ---------- */
app.get('/api/admin/stats', needAdmin, (req, res) => {
  const one = sql => db.prepare(sql).get();
  res.json({
    revenue: one("SELECT COALESCE(SUM(total),0) v FROM orders WHERE status<>'cancelled'").v,
    orders: one('SELECT COUNT(*) v FROM orders').v, open: one("SELECT COUNT(*) v FROM orders WHERE status NOT IN ('delivered','cancelled')").v,
    customers: one("SELECT COUNT(*) v FROM users WHERE role='customer'").v, inquiries: one('SELECT COUNT(*) v FROM inquiries').v,
    lowStock: allProducts().filter(p => p.lowStock || !p.inStock).map(p => ({ id: p.id, name: p.name, stock: p.stock }))
  });
});
app.get('/api/admin/orders', needAdmin, (req, res) => {
  res.json({ orders: db.prepare('SELECT number FROM orders ORDER BY id DESC LIMIT 200').all().map(n => outOrder(loadOrder(n.number))) });
});
app.patch('/api/admin/orders/:number', needAdmin, (req, res, next) => {
  const row = db.prepare('SELECT * FROM orders WHERE number=?').get(req.params.number);
  if (!row) return next(new HttpError(404, 'Order not found'));
  const status = str(req.body.status, 20);
  if (!STATUSES.includes(status)) return next(bad('Unknown status.'));
  if (row.status === 'cancelled' || row.status === 'delivered') return next(bad(`A ${row.status} order cannot be changed.`));
  const carrier = str(req.body.carrier, 40) || row.carrier, trackingNo = str(req.body.trackingNo, 40) || row.tracking_no;
  tx(() => {
    const paid = status === 'delivered' && row.payment_status === 'pending' ? 'paid' : row.payment_status;
    db.prepare('UPDATE orders SET status=?, carrier=?, tracking_no=?, payment_status=? WHERE id=?').run(status, carrier, trackingNo, status === 'cancelled' && paid === 'paid' ? 'refund due' : paid, row.id);
    db.prepare('INSERT INTO order_events(order_id,status,note) VALUES(?,?,?)').run(row.id, status, str(req.body.note, 200) || STATUS_NOTE[status]);
    if (status === 'cancelled') restock(row);
  });
  res.json({ order: outOrder(loadOrder(row.number)) });
});
app.get('/api/admin/products', needAdmin, (req, res) => res.json({ products: db.prepare('SELECT * FROM products ORDER BY sort,id').all().map(shapeProduct) }));
app.patch('/api/admin/products/:id', needAdmin, (req, res, next) => {
  const row = db.prepare('SELECT * FROM products WHERE id=?').get(req.params.id);
  if (!row) return next(new HttpError(404, 'Product not found'));
  const price = req.body.price === undefined ? row.price : Math.round(Number(req.body.price));
  if (!(price > 0)) return next(bad('Price must be positive.'));
  let stock = JSON.parse(row.stock);
  if (req.body.stock) for (const k of Object.keys(stock)) if (req.body.stock[k] !== undefined) stock[k] = Math.max(0, Math.floor(Number(req.body.stock[k]) || 0));
  db.prepare('UPDATE products SET price=?, stock=?, active=? WHERE id=?').run(price, JSON.stringify(stock), req.body.active === undefined ? row.active : (req.body.active ? 1 : 0), row.id);
  res.json({ product: shapeProduct(db.prepare('SELECT * FROM products WHERE id=?').get(row.id)) });
});
app.get('/api/admin/settings', needAdmin, (req, res) => res.json({ whatsapp: getSetting('whatsapp'), twinningPercent: twinPct() }));
app.put('/api/admin/settings', needAdmin, (req, res, next) => {
  const wa = String(req.body.whatsapp ?? '').replace(/\D/g, ''), pct = Number(req.body.twinningPercent);
  if (wa && !/^91[6-9]\d{9}$/.test(wa) && !/^[6-9]\d{9}$/.test(wa)) return next(bad('Enter a 10-digit Indian mobile number (with or without 91).', 'whatsapp'));
  if (!(pct >= 0 && pct <= 50)) return next(bad('Twinning discount must be between 0 and 50%.', 'twinningPercent'));
  setSetting('whatsapp', wa.length === 10 ? '91' + wa : wa); setSetting('twinningPercent', Math.round(pct));
  res.json({ whatsapp: getSetting('whatsapp'), twinningPercent: twinPct() });
});
app.get('/api/admin/inquiries', needAdmin, (req, res) => res.json({ inquiries: db.prepare('SELECT * FROM inquiries ORDER BY id DESC LIMIT 100').all() }));

/* ---------- static + errors ---------- */
const PUB = path.join(__dirname, '..', 'public');
app.use('/assets', express.static(path.join(PUB, 'assets'), { maxAge: '7d', immutable: true }));
app.use(express.static(PUB, { maxAge: 0, etag: true }));
app.use('/api', (req, res, next) => next(new HttpError(404, 'Not found')));
app.get('*', (req, res) => res.sendFile(path.join(PUB, 'index.html')));
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') err = bad('Invalid request.');
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 ? 'Something went wrong. Please try again.' : err.message, field: err.field });
});

if (require.main === module) app.listen(PORT, () => console.log(`Kumud Boutique running → http://localhost:${PORT}`));
module.exports = app;
