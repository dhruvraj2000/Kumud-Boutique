'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const { db, tx, hashPassword, COUPONS, LOOKS, getSetting, setSetting } = require('./db');
const fest = require('./festival-data');
const FP = require('./festival-pricing');
const mysqlDb = require('./mysql');
const SEC = require('./security');
const secRoutes = require('./security-routes');
const backup = require('./backup');
const T = require('./tracking');
const L = require('./lifecycle');
const geo = require('./geo');
const V = require('./visitors');

const app = express();
const PORT = process.env.PORT || 3000;
const FREE_SHIP_MIN = 7500, SHIP_FEE = 199, MAX_QTY = 10;
const STATUS_NOTE = T.NOTE;

app.disable('x-powered-by');
if (process.env.TRUST_PROXY || process.env.RENDER || process.env.VERCEL) app.set('trust proxy', process.env.TRUST_PROXY === undefined ? 1 : (/^\d+$/.test(process.env.TRUST_PROXY) ? Number(process.env.TRUST_PROXY) : process.env.TRUST_PROXY));
app.use(SEC.headers());
app.use(SEC.monitor);
app.use('/api', SEC.guard);
app.use(express.json({ limit: '100kb' }));
app.use('/api', SEC.csrfGuard);

/* ---------- helpers ---------- */
class HttpError extends Error { constructor(status, message, field) { super(message); this.status = status; this.field = field; } }
const bad = (msg, field) => new HttpError(400, msg, field);
const wrap = fn => (req, res, next) => { try { Promise.resolve(fn(req, res, next)).catch(next); } catch (e) { next(e); } };
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const isEmail = v => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
const cleanPhone = v => { const d = String(v || '').replace(/[^\d]/g, ''); return d.length === 12 && d.startsWith('91') ? d.slice(2) : d; };
const isPhone = v => /^[6-9]\d{9}$/.test(v);

app.use(SEC.loadSession);
// state-changing requests must be JSON (blocks plain cross-site form posts)
app.use('/api', (req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && Number(req.headers['content-length'] || 0) > 0 && !req.is('application/json')) return next(bad('JSON required'));
  next();
});
app.use('/api', fest.ensureFresh);
const { needUser, needAdmin, needPerm } = SEC;
app.use('/api', secRoutes.router);

const hits = new Map();
const limit = (name, max, windowMs) => (req, res, next) => {
  const key = name + ':' + req.ip, now = Date.now();
  const arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= max) return next(new HttpError(429, 'Too many attempts. Please wait a minute and try again.'));
  arr.push(now); hits.set(key, arr); next();
};
setInterval(() => hits.clear(), 10 * 60 * 1000).unref();

const publicUser = secRoutes.publicUser;

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
/* ---------- festival sales ---------- */
// Applies the best live campaign to a shaped product: price becomes the sale price, the old price moves to compareAt.
function withSale(p, at = Date.now()) {
  if (!p) return p;
  const snap = fest.current(), live = FP.liveCampaigns(snap.campaigns, at);
  const o = FP.bestOffer(live, p, snap.cap);
  if (!o.pct) return p;
  return { ...p, price: FP.salePrice(p.price, o.pct), compareAt: Math.max(p.compareAt || 0, p.price), festivalPct: o.pct, festival: o.campaign.name, festivalMax: o.campaign.max_pct };
}
const allProducts = () => db.prepare('SELECT * FROM products WHERE active=1 ORDER BY sort,id').all().map(shapeProduct).map(p => withSale(p));
// coupons: MySQL (with dates, usage limits, on/off) when configured, else the built-in list
function couponList(at = Date.now()) {
  const m = fest.current().coupons;
  if (!m) return Object.entries(COUPONS).map(([code, c]) => ({ code, ...c, min_order: c.min }));
  return Object.values(m).filter(c => c.active && (!c.starts_at || at >= FP.toMs(c.starts_at)) && (!c.ends_at || at <= FP.toMs(c.ends_at)) && (c.max_uses == null || c.used_count < c.max_uses));
}
const findCoupon = code => couponList().find(c => c.code === code);

app.get('/api/meta', (req, res) => {
  const ps = allProducts();
  res.json({
    categories: [...new Set(ps.map(p => p.category))],
    collections: [...new Set(ps.map(p => p.collection))],
    colors: [...new Set(ps.flatMap(p => p.colors))],
    sizes: ['XS', 'S', 'M', 'L', 'XL'], kidsSizes: ['2Y', '4Y', '6Y', '8Y', '10Y', '12Y'],
    mapsKey: process.env.GOOGLE_MAPS_API_KEY || '',   // browser key: restrict it by HTTP referrer in Google Cloud (see docs/SECURITY.md)
    store: { name: geo.STORE.name, lat: geo.STORE.lat, lng: geo.STORE.lng }, zones: geo.ZONES.map(z => ({ key: z.key, label: z.label, maxKm: z.maxKm === Infinity ? null : z.maxKm, fee: z.fee })), returnDays: 7,
    whatsapp: getSetting('whatsapp'), twinningPercent: twinPct(), razorpayKeyId: rzpOn() ? rzp().id : '',
    priceMin: Math.min(...ps.map(p => p.price)), priceMax: Math.max(...ps.map(p => p.price)),
    freeShippingMin: FREE_SHIP_MIN, shippingFee: SHIP_FEE, maxQty: MAX_QTY,
    coupons: couponList().map(c => ({ code: c.code, label: c.label }))
  });
});

app.get('/api/festivals/current', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache');   // the response carries the server clock; a cached copy would make countdowns drift
  res.json(fest.publicView(allProducts().map(p => ({ id: p.id, category: p.category }))));
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
  const p = withSale(shapeProduct(row));
  const reviews = db.prepare('SELECT id,author,rating,title,body,created_at FROM reviews WHERE product_id=? ORDER BY id DESC').all(p.id);
  const related = allProducts().filter(x => x.id !== p.id).sort((a, b) => (b.collection === p.collection) - (a.collection === p.collection)).slice(0, 4);
  const twin = p.twinSlug ? withSale(shapeProduct(db.prepare('SELECT * FROM products WHERE slug=? AND active=1').get(p.twinSlug))) : null;
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
app.post('/api/auth/register', limit('reg', 10, 60000), (req, res, next) => {
  const name = str(req.body.name, 80), email = str(req.body.email, 120).toLowerCase(), phone = cleanPhone(req.body.phone), pw = String(req.body.password || '');
  if (name.length < 2) return next(bad('Please enter your full name.', 'name'));
  if (!isEmail(email)) return next(bad('Please enter a valid email address.', 'email'));
  if (phone && !isPhone(phone)) return next(bad('Enter a valid 10-digit mobile number.', 'phone'));
  { const pr = secRoutes.pwProblem(pw); if (pr) return next(bad(pr, 'password')); }
  if (db.prepare('SELECT 1 FROM users WHERE email=?').get(email)) return next(new HttpError(409, 'An account with this email already exists. Try signing in.', 'email'));
  const { salt, hash } = hashPassword(pw);
  const id = db.prepare('INSERT INTO users(name,email,phone,salt,hash) VALUES(?,?,?,?,?)').run(name, email, phone, salt, hash).lastInsertRowid;
  // guest orders are NOT auto-linked by email: the address is unverified, so that would expose someone else's orders.
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  SEC.logEvent('register', 'info', req, { userId: id, email });
  const { csrf } = SEC.createSession(req, res, row, false);
  res.status(201).json({ user: publicUser(row), csrf });
});
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
  { const pr = secRoutes.pwProblem(pw, u.role); if (pr) return next(bad(pr, 'newPassword')); }
  const { salt, hash } = hashPassword(pw);
  db.prepare('UPDATE users SET salt=?, hash=? WHERE id=?').run(salt, hash, u.id);
  db.prepare('DELETE FROM sessions WHERE user_id=? AND token<>?').run(u.id, req.user.sid); SEC.logEvent('password_changed', 'info', req);
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
// optional map pin saved with an address (validated: real coordinates inside India)
const pinOf = b => { const l = readLoc(b, ''); return l && geo.validPoint(l) && geo.inIndia(l.lat, l.lng) ? l : null; };
const savePin = (id, b) => { const l = pinOf(b); db.prepare('UPDATE addresses SET lat=?, lng=?, place_id=? WHERE id=?').run(l ? l.lat : null, l ? l.lng : null, l ? l.placeId : '', id); };
app.get('/api/addresses', needUser, (req, res) => res.json({ addresses: db.prepare('SELECT * FROM addresses WHERE user_id=? ORDER BY is_default DESC,id').all(req.user.id) }));
app.post('/api/addresses', needUser, (req, res) => {
  const a = readAddress(req.body), first = !db.prepare('SELECT 1 FROM addresses WHERE user_id=?').get(req.user.id);
  const def = first || req.body.isDefault ? 1 : 0;
  tx(() => {
    if (def) db.prepare('UPDATE addresses SET is_default=0 WHERE user_id=?').run(req.user.id);
    const nid = db.prepare(`INSERT INTO addresses(user_id,${addrCols},is_default) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(req.user.id, a.name, a.phone, a.line1, a.line2, a.city, a.state, a.pincode, a.label, def).lastInsertRowid;
    savePin(nid, req.body);
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
    if (req.body.location !== undefined) savePin(row.id, req.body);
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
    const p = withSale(shapeProduct(row)), avail = p.stock[it.size];
    if (avail === undefined) { warnings.push({ id: it.id, size: it.size, message: `Please choose a size for ${p.name}.`, remove: true }); continue; }
    let qty = it.qty;
    if (avail <= 0) { warnings.push({ id: it.id, size: it.size, message: `${p.name} (${it.size}) is sold out and was removed.`, remove: true }); continue; }
    if (qty > avail) { warnings.push({ id: it.id, size: it.size, message: `Only ${avail} of ${p.name} (${it.size}) left — quantity adjusted.`, qty: avail }); qty = avail; }
    lines.push({ id: p.id, slug: p.slug, name: p.name, image: p.images[0], size: it.size, qty, price: p.price, compareAt: p.compareAt, festivalPct: p.festivalPct || 0, festivalMax: p.festivalMax || null, original: p.compareAt && p.festivalPct ? p.compareAt : p.price, available: avail, lineTotal: p.price * qty });
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
    const c = findCoupon(code);
    if (!c) couponMessage = 'That code is not valid or has expired.';
    else if (subtotal < c.min_order) couponMessage = `${code} needs a minimum order of ₹${c.min_order.toLocaleString('en-IN')}.`;
    else {
      coupon = code; couponMessage = c.label + ' applied';
      if (c.type === 'percent') discount = Math.round(subtotal * c.value / 100); else if (c.type === 'flat') discount = Math.min(c.value, subtotal); else shipping = 0;
    }
  }
  // festival sale + coupon + twinning may stack, but never past the live campaign's maximum discount (margin guard)
  const original = lines.reduce((a, l) => a + l.original * l.qty, 0), festivalSavings = original - subtotal;
  const caps = lines.filter(l => l.festivalMax != null).map(l => l.festivalMax);
  const g = FP.capExtras(original, festivalSavings, caps.length ? Math.max(...caps) : null, discount, twinning);
  if (g.limited) { discount = g.coupon; twinning = g.twinning; couponMessage = (couponMessage ? couponMessage + ' — ' : '') + "reduced to stay within this sale's maximum discount"; }
  return { lines, warnings, subtotal, shipping, discount, coupon, couponMessage, twinning, twinPairs: pairs, twinPercent: pct, festivalSavings, originalSubtotal: original, discountLimited: g.limited,
    total: Math.max(0, subtotal - discount - twinning + shipping), freeShippingMin: FREE_SHIP_MIN };
}
// GST already inside the prices: per item 5% up to the threshold, 18% above it (settings); delivery at 18%. Shown on the bill and invoice, never added on top.
function taxIncluded(lines, subtotal, off, shipping) {
  const lo = Number(getSetting('gstLowPercent')) || 0, hi = Number(getSetting('gstHighPercent')) || 0, cut = Number(getSetting('gstThreshold')) || 0;
  const keep = subtotal > 0 ? Math.max(0, subtotal - off) / subtotal : 1;
  let tax = 0;
  for (const l of lines) { const r = l.price <= cut ? lo : hi; tax += l.lineTotal * keep * r / (100 + r); }
  return Math.round(tax + (shipping ? shipping * hi / (100 + hi) : 0));
}
// Replaces the flat delivery fee with the zone fee for a confirmed map pin (free-shipping rules still win).
function applyDelivery(q, a) {
  if (!a || !a.ok) return q;
  if (q.shipping > 0) q.shipping = a.baseFee;
  q.total = Math.max(0, q.subtotal - q.discount - q.twinning + q.shipping); q.taxIncluded = taxIncluded(q.lines, q.subtotal, q.discount + q.twinning, q.shipping);
  q.delivery = { km: a.km, zone: a.zone, zoneLabel: a.zoneLabel, fee: q.shipping, etaDays: a.etaDays, source: a.source };
  return q;
}
const readLoc = (b, pin) => { const l = b && b.location; return l && typeof l === 'object' ? { lat: Number(l.lat), lng: Number(l.lng), placeId: str(l.placeId, 200), pincode: pin } : null; };
app.post('/api/cart/quote', limit('quote', 120, 60000), async (req, res, next) => {
  try {
    if (!(req.body.items && req.body.items.length)) return res.json({ lines: [], warnings: [], subtotal: 0, shipping: 0, discount: 0, coupon: null, couponMessage: '', twinning: 0, twinPairs: 0, total: 0, freeShippingMin: FREE_SHIP_MIN });
    const q = quote(req.body.items, req.body.coupon), loc = readLoc(req.body, str(req.body.pincode, 6));
    q.taxIncluded = taxIncluded(q.lines, q.subtotal, q.discount + q.twinning, q.shipping);
    if (loc) { const a = await geo.assess(loc, loc.pincode, q.subtotal, FREE_SHIP_MIN); if (!a.ok) q.deliveryError = a.reason; applyDelivery(q, a); }
    res.json(q);
  } catch (e) { next(e); }
});

/* ---------- orders ---------- */
const luhn = n => { let s = 0, alt = false; for (let i = n.length - 1; i >= 0; i--) { let d = +n[i]; if (alt) { d *= 2; if (d > 9) d -= 9; } s += d; alt = !alt; } return s % 10 === 0; };
const rzp = () => ({ id: process.env.RAZORPAY_KEY_ID || '', secret: process.env.RAZORPAY_KEY_SECRET || '' });
const rzpOn = () => { const k = rzp(); return !!(k.id && k.secret); };
function readPayment(b) {
  const method = str(b.method, 10);
  if (method === 'razorpay') {
    if (!rzpOn()) throw bad('Online payment is not available right now.', 'method');
    return { method, status: 'pending', ref: 'Razorpay (awaiting payment)' };
  }
  if (rzpOn() && (method === 'upi' || method === 'card')) throw bad('Please choose Pay online or Cash on delivery.', 'method');
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
    number: o.number, status: o.status, paymentMethod: o.payment_method, paymentStatus: o.payment_status, onlinePending: o.payment_method.startsWith('Razorpay') && o.payment_status === 'pending' && ['placed', 'payment_processing', 'payment_failed'].includes(o.status), subtotal: o.subtotal, shipping: o.shipping,
    steps: L.stepsFor(o), trackingUrl: T.trackingUrl(o), canCancel: L.CUSTOMER_CANCEL.includes(o.status), taxIncluded: o.tax || 0,
    discount: o.discount, total: o.total, coupon: o.coupon, address: JSON.parse(o.address), email: o.email, phone: o.phone, notes: o.notes,
    carrier: o.carrier, trackingNo: o.tracking_no, createdAt: o.created_at, userId: o.user_id, trackingId: o.tracking_id, eta: o.eta, deliveredAt: o.delivered_at, statusLabel: T.LABEL[o.status],
    canReturn: o.status === 'delivered' && !!o.delivered_at && (Date.now() - Date.parse(o.delivered_at.replace(' ', 'T') + 'Z')) < 7 * 86400000, distanceKm: o.distance_km,
    measurements: o.measurements ? JSON.parse(o.measurements) : null,
    items: db.prepare('SELECT product_id productId,name,image,size,qty,price FROM order_items WHERE order_id=?').all(o.id),
    events: db.prepare('SELECT status,note,created_at createdAt FROM order_events WHERE order_id=? ORDER BY id').all(o.id)
  };
}
const outOrder = o => { const { userId, ...rest } = o; return rest; };

app.post('/api/orders', limit('order', Number(process.env.ORDER_RATE_PER_MIN || 20), 60000), wrap(async (req, res, next) => {
  const email = str(req.body.email || (req.user && req.user.email), 120).toLowerCase();
  if (!isEmail(email)) return next(bad('Enter a valid email so we can send your confirmation.', 'email'));
  const address = readAddress(req.body.address || {}), payment = readPayment(req.body.payment || {}), notes = str(req.body.notes, 300);
  // idempotency: the browser sends one key per checkout attempt; a double-click, retry or refresh returns the SAME order instead of creating another
  const idem = str(req.body.idempotencyKey, 64).replace(/[^\w-]/g, ''), existing = idem && db.prepare('SELECT number,user_id,email FROM orders WHERE idempotency_key=?').get(idem);
  if (existing) { if (!canView(req, { userId: existing.user_id, email: existing.email }) && existing.email !== email) return next(new HttpError(409, 'That request was already used.')); return res.status(200).json({ order: outOrder(loadOrder(existing.number)), duplicate: true }); }
  const loc = readLoc(req.body, address.pincode); let assess = null;
  if (loc) { try { assess = await geo.assess(loc, address.pincode, 0, FREE_SHIP_MIN); } catch (e) { return next(e); } if (!assess.ok) return next(bad(assess.reason, 'location')); }
  else if (getSetting('requirePin') === '1') return next(bad('Please confirm your delivery location on the map.', 'location'));
  else if (geo.blockedPin(address.pincode)) return next(bad(`We cannot deliver to PIN ${address.pincode} right now.`, 'pincode'));
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
      if (assess) applyDelivery(q, { ...assess, fee: q.subtotal >= FREE_SHIP_MIN ? 0 : assess.baseFee });
      const number = orderNumber();
      const eta = geo.addDays(assess ? assess.etaDays + 2 : 7), tax = taxIncluded(q.lines, q.subtotal, q.discount + q.twinning, q.shipping), paidNow = payment.status === 'paid';
      const id = db.prepare(`INSERT INTO orders(number,user_id,email,phone,status,payment_method,payment_status,subtotal,shipping,discount,total,coupon,address,notes,measurements,tracking_id,eta,dest_lat,dest_lng,place_id,distance_km,tax,idempotency_key)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(number, req.user ? req.user.id : null, email, address.phone, paidNow ? 'payment_confirmed' : 'placed', payment.ref, payment.status,
        q.subtotal, q.shipping, q.discount + q.twinning, q.total, q.coupon || (q.twinning ? 'TWINNING' : null), JSON.stringify(address), notes,
        measurements ? JSON.stringify(measurements) : '', T.newTrackingId(), eta, loc ? loc.lat : null, loc ? loc.lng : null, loc ? loc.placeId : '', assess ? assess.km : null, tax, idem || '').lastInsertRowid;
      const insItem = db.prepare('INSERT INTO order_items(order_id,product_id,name,image,size,qty,price) VALUES(?,?,?,?,?,?,?)');
      for (const l of q.lines) {
        const row = db.prepare('SELECT stock FROM products WHERE id=?').get(l.id), st = JSON.parse(row.stock);
        if (st[l.size] < l.qty) throw new HttpError(409, `${l.name} (${l.size}) just sold out.`);
        st[l.size] -= l.qty; db.prepare('UPDATE products SET stock=? WHERE id=?').run(JSON.stringify(st), l.id);
        insItem.run(id, l.id, l.name, l.image, l.size, l.qty, l.price);
      }
      const ev = db.prepare('INSERT INTO order_events(order_id,status,note) VALUES(?,?,?)');
      ev.run(id, 'placed', STATUS_NOTE.placed + (payment.method === 'cod' ? ' · pay on delivery' : payment.method === 'razorpay' ? ' · awaiting online payment' : ''));
      if (paidNow) { ev.run(id, 'payment_processing', STATUS_NOTE.payment_processing); ev.run(id, 'payment_confirmed', STATUS_NOTE.payment_confirmed); T.recordPayment(id, { provider: payment.method, ref: 'SIM-' + crypto.randomBytes(6).toString('hex'), amount: q.total, status: 'succeeded', note: 'simulated (demo) payment' }); }
      if (req.user && !db.prepare('SELECT 1 FROM addresses WHERE user_id=?').get(req.user.id) && req.body.saveAddress !== false)
        savePin(db.prepare(`INSERT INTO addresses(user_id,${addrCols},is_default) VALUES(?,?,?,?,?,?,?,?,?,1)`).run(req.user.id, address.name, address.phone, address.line1, address.line2, address.city, address.state, address.pincode, address.label).lastInsertRowid, req.body);
      return number;
    });
  } catch (e) {
    if (/UNIQUE.*idempotency|idx_orders_idem/i.test(String(e.message)) && idem) { const x = db.prepare('SELECT number FROM orders WHERE idempotency_key=?').get(idem); if (x) return res.status(200).json({ order: outOrder(loadOrder(x.number)), duplicate: true }); }
    return next(e);
  }
  T.onPlaced(order);
  if (req.body.coupon && fest.current().coupons) { const used = str(req.body.coupon, 20).toUpperCase(); if (findCoupon(used) || fest.current().coupons[used]) mysqlDb.query('UPDATE coupons SET used_count=used_count+1 WHERE code=?', [used]).catch(() => {}); }
  res.status(201).json({ order: outOrder(loadOrder(order)) });
}));

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
app.post('/api/orders/:number/pay', limit('pay', 20, 60000), async (req, res, next) => {
  try {
    const row = db.prepare('SELECT * FROM orders WHERE number=?').get(str(req.params.number, 30).toUpperCase());
    if (!row || !canView(req, loadOrder(row.number))) return next(new HttpError(404, 'Order not found.'));
    if (!rzpOn()) return next(bad('Online payment is not available right now.'));
    if (row.payment_status !== 'pending' || !['placed', 'payment_processing', 'payment_failed'].includes(row.status) || !row.payment_method.startsWith('Razorpay')) return next(bad('This order does not need payment.'));
    const k = rzp();
    if (!row.rzp_order_id) {
      const r = await fetch('https://api.razorpay.com/v1/orders', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from(k.id + ':' + k.secret).toString('base64') },
        body: JSON.stringify({ amount: row.total * 100, currency: 'INR', receipt: row.number })
      });
      const j = await r.json();
      if (!r.ok || !j.id) return next(new HttpError(502, 'Could not start the payment. Please try again.'));
      db.prepare('UPDATE orders SET rzp_order_id=? WHERE id=?').run(j.id, row.id); row.rzp_order_id = j.id;
      T.recordPayment(row.id, { provider: 'razorpay', ref: j.id, amount: row.total, status: 'created', note: 'gateway order created' });
    }
    if (row.status !== 'payment_processing') T.setStatus(T.row(row.number), 'payment_processing', { system: true, notify: false, note: 'Waiting for your payment' });
    res.json({ keyId: k.id, orderId: row.rzp_order_id, amount: row.total * 100, number: row.number, email: row.email, phone: row.phone });
  } catch (e) { next(e); }
});
app.post('/api/orders/:number/verify', limit('verify', 20, 60000), (req, res, next) => {
  const row = db.prepare('SELECT * FROM orders WHERE number=?').get(str(req.params.number, 30).toUpperCase());
  if (!row || !canView(req, loadOrder(row.number))) return next(new HttpError(404, 'Order not found.'));
  const payId = str(req.body.razorpay_payment_id, 60), sig = str(req.body.razorpay_signature, 128);
  if (!rzpOn() || !row.rzp_order_id || str(req.body.razorpay_order_id, 60) !== row.rzp_order_id) return next(bad('Payment details do not match this order.'));
  const want = crypto.createHmac('sha256', rzp().secret).update(row.rzp_order_id + '|' + payId).digest('hex');
  const ok = sig.length === want.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want));
  if (!ok) return next(bad('We could not verify that payment.'));
  if (!/^pay_[A-Za-z0-9]+$/.test(payId)) return next(bad('We could not verify that payment.'));
  // 'cancelled' payment_status = an unpaid order we gave up on (timeout). A valid payment can still arrive for it: record it, never ignore it.
  if (row.payment_status === 'pending' || (row.status === 'cancelled' && row.payment_status === 'cancelled')) {
    try {
      tx(() => {
        if (!T.recordPayment(row.id, { provider: 'razorpay', ref: payId, amount: row.total, status: 'succeeded', note: 'signature verified' })) throw new HttpError(409, 'This payment has already been used.');   // one gateway payment can never settle two orders
        db.prepare('UPDATE orders SET payment_method=? WHERE id=?').run('Razorpay ' + payId, row.id);
      });
    } catch (e) { return next(e); }
    const fresh = T.row(row.number);
    if (fresh.status === 'cancelled') {   // paid after we gave up on it: keep the money visible and flag the refund
      db.prepare("UPDATE orders SET payment_status='refund due' WHERE id=?").run(row.id);
      db.prepare('INSERT INTO order_events(order_id,status,note) VALUES(?,?,?)').run(row.id, 'cancelled', 'Payment arrived after the order was cancelled — refund due');
      require('./notify').alertAdmin('high', 'Payment received for a cancelled order ' + row.number, 'Refund it from Admin → Orders → Refunds.');
    } else T.setStatus(fresh, 'payment_confirmed', { system: true, note: 'Payment received · ' + payId });
  }
  res.json({ order: outOrder(loadOrder(row.number)) });
});
// The gateway window reported a failed/closed payment. Safe to accept from the customer: it can only move their own unpaid order to "payment failed" (retry stays possible).
app.post('/api/orders/:number/payment-failed', limit('payfail', 20, 60000), (req, res, next) => {
  const row = db.prepare('SELECT * FROM orders WHERE number=?').get(str(req.params.number, 30).toUpperCase());
  if (!row || !canView(req, loadOrder(row.number))) return next(new HttpError(404, 'Order not found.'));
  if (row.payment_status !== 'pending' || !row.payment_method.startsWith('Razorpay') || !['placed', 'payment_processing'].includes(row.status)) return next(bad('This order is not waiting for a payment.'));
  const why = str(req.body.reason, 100) || 'Payment was not completed';
  T.recordPayment(row.id, { provider: 'razorpay', ref: null, amount: row.total, status: 'failed', note: why });
  T.setStatus(T.row(row.number), 'payment_failed', { system: true, note: 'Payment failed: ' + why });
  SEC.logEvent('payment_failed', 'info', req, { detail: row.number + ' ' + why });
  res.json({ order: outOrder(loadOrder(row.number)) });
});
app.get('/api/track', limit('track', 20, 60000), (req, res, next) => {
  const o = loadOrder(str(req.query.number, 30).toUpperCase());
  if (!o || o.email.toLowerCase() !== str(req.query.email, 120).toLowerCase()) return next(new HttpError(404, 'We could not find that order. Check the order number and email.'));
  res.json({ order: outOrder(o) });
});
app.post('/api/orders/:number/cancel', (req, res, next) => {
  const o = loadOrder(str(req.params.number, 30).toUpperCase());
  if (!canView(req, o)) return next(new HttpError(404, 'Order not found.'));
  if (!L.CUSTOMER_CANCEL.includes(o.status)) return next(bad('This order has already moved to preparation and can no longer be cancelled online. Please contact us.'));
  try { T.setStatus(T.row(o.number), 'cancelled', { note: 'Cancelled by customer', reason: str(req.body.reason, 200) }); } catch (e) { return next(e); }
  res.json({ order: outOrder(loadOrder(o.number)) });
});

/* ---------- forms ---------- */
app.post('/api/inquiries', limit('inq', 6, 60000), (req, res, next) => {
  const name = str(req.body.name, 80), email = str(req.body.email, 120), phone = cleanPhone(req.body.phone), message = str(req.body.message, 1500);
  if (name.length < 2) return next(bad('Please enter your name.', 'name'));
  if (!isEmail(email)) return next(bad('Please enter a valid email.', 'email'));
  if (phone && !isPhone(phone)) return next(bad('Enter a valid 10-digit mobile number.', 'phone'));
  if (message.length < 10) return next(bad('Tell us a little more (10+ characters).', 'message'));
  const vid = String(req.headers['x-visitor-id'] || ''), topic = str(req.body.topic, 60);
  const r = db.prepare('INSERT INTO inquiries(name,email,phone,topic,preferred_date,message,visitor_id) VALUES(?,?,?,?,?,?,?)').run(name, email.toLowerCase(), phone, topic, str(req.body.preferredDate, 20), message, V.VID.test(vid) ? vid : '');
  try { V.notifyEnquiry({ id: Number(r.lastInsertRowid), name, email, phone, topic, message }); } catch (e) { console.error('enquiry notify', e.message); }
  res.status(201).json({ ok: true });
});
app.post('/api/newsletter', limit('news', 6, 60000), (req, res, next) => {
  const email = str(req.body.email, 120).toLowerCase();
  if (!isEmail(email)) return next(bad('Please enter a valid email.', 'email'));
  const r = db.prepare('INSERT OR IGNORE INTO newsletter(email) VALUES(?)').run(email);
  res.status(201).json({ ok: true, already: r.changes === 0 });
});

/* ---------- admin ---------- */
app.get('/api/admin/stats', needPerm('analytics'), (req, res) => {
  const one = sql => db.prepare(sql).get();
  res.json({
    revenue: one("SELECT COALESCE(SUM(total),0) v FROM orders WHERE status NOT IN ('cancelled','returned','refund_processing','refunded','payment_failed','return_approved')").v,
    orders: one('SELECT COUNT(*) v FROM orders').v, open: one("SELECT COUNT(*) v FROM orders WHERE status NOT IN ('delivered','cancelled','returned','return_requested','return_approved','refund_processing','refunded','payment_failed')").v,
    customers: one("SELECT COUNT(*) v FROM users WHERE role='customer'").v, inquiries: one('SELECT COUNT(*) v FROM inquiries').v, newInquiries: one("SELECT COUNT(*) v FROM inquiries WHERE status='new'").v,
    lowStock: allProducts().filter(p => p.lowStock || !p.inStock).map(p => ({ id: p.id, name: p.name, stock: p.stock }))
  });
});
// order management, tracking, courier GPS, returns, invoices, analytics: see tracking.js
app.use('/api', T.build({ canView }));
app.get('/api/admin/products', needPerm('products'), (req, res) => res.json({ products: db.prepare('SELECT * FROM products ORDER BY sort,id').all().map(shapeProduct) }));
app.patch('/api/admin/products/:id', needPerm('products'), (req, res, next) => {
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
app.get('/api/admin/launch', needAdmin, (req, res) => {
  const onVercel = !!process.env.VERCEL && !process.env.KUMUD_DB;
  const items = [
    ['WhatsApp number set', !!getSetting('whatsapp'), 'Admin → Settings. The chat button stays hidden until set.'],
    ['Persistent database', !onVercel, 'On Vercel the SQLite file lives in /tmp and resets. Move to Turso/Neon or host on a server with a disk.'],
    ['Real payment gateway', rzpOn(), 'Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET to switch checkout from simulated payments to Razorpay.'],
    ['Admin password changed', process.env.ADMIN_PASSWORD ? true : false, 'Set the ADMIN_PASSWORD environment variable; the default is public in the README.'],
    ['Real product details & stock', false, 'Names, prices and descriptions are placeholders until you edit them in Admin → Products.'],
    ['Designer bio & portrait', false, 'The Designer page uses general copy. Send the designer’s real bio and photo to publish it.'],
    ['Custom domain', false, 'Connect your own domain in Vercel project settings.']
  ].map(([label, done, hint]) => ({ label, done, hint }));
  res.json({ items });
});
app.use('/api', V.router);   // visitor beacon, traffic + visitors + enquiries admin API

/* ---------- bookings (MySQL) + admin portal ---------- */
app.use('/api', require('./booking-routes'));
const { authRouter, requireAdmin } = require('./admin-auth');
app.use('/api/portal/auth', authRouter);
app.use('/api/portal', requireAdmin, require('./admin-routes'));
app.get('/admin', (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex');
  res.sendFile(path.join(__dirname, '..', 'public', 'admin', 'index.html'));
});

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
  res.locals.errMsg = status >= 500 ? String(err.message || err).slice(0, 200) : '';
  res.status(status).json({ error: status >= 500 && status !== 503 ? 'Something went wrong. Please try again.' : err.message, field: err.field, code: err.code });
});

if (require.main === module) { fest.refresh(); backup.start(); }
if (require.main === module) app.listen(PORT, () => console.log(`Kumud Boutique running → http://localhost:${PORT}`));
module.exports = app;
