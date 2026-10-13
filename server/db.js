'use strict';
// SQLite persistence (node:sqlite, built in to Node 22) + first-run seed data.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
process.removeAllListeners('warning');
const { DatabaseSync } = require('node:sqlite');

const DB_FILE = process.env.KUMUD_DB || path.join(__dirname, '..', 'data', 'kumud.db');
if (DB_FILE !== ':memory:') fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS users(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  phone TEXT DEFAULT '', salt TEXT NOT NULL, hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'customer',
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions(
  token TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS addresses(
  id INTEGER PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT DEFAULT 'Home', name TEXT NOT NULL, phone TEXT NOT NULL, line1 TEXT NOT NULL, line2 TEXT DEFAULT '',
  city TEXT NOT NULL, state TEXT NOT NULL, pincode TEXT NOT NULL, is_default INTEGER DEFAULT 0);
CREATE TABLE IF NOT EXISTS products(
  id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL, category TEXT NOT NULL, collection TEXT NOT NULL,
  price INTEGER NOT NULL, compare_at INTEGER, tagline TEXT, description TEXT, details TEXT, includes TEXT, care TEXT,
  colors TEXT, stock TEXT NOT NULL, images TEXT NOT NULL, badge TEXT, featured INTEGER DEFAULT 0, sort INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1);
CREATE TABLE IF NOT EXISTS wishlist(
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  PRIMARY KEY(user_id, product_id));
CREATE TABLE IF NOT EXISTS reviews(
  id INTEGER PRIMARY KEY, product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, author TEXT NOT NULL, rating INTEGER NOT NULL,
  title TEXT DEFAULT '', body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS orders(
  id INTEGER PRIMARY KEY, number TEXT NOT NULL UNIQUE, user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  email TEXT NOT NULL, phone TEXT NOT NULL, status TEXT NOT NULL, payment_method TEXT NOT NULL, payment_status TEXT NOT NULL,
  subtotal INTEGER NOT NULL, shipping INTEGER NOT NULL, discount INTEGER NOT NULL, total INTEGER NOT NULL, coupon TEXT,
  address TEXT NOT NULL, notes TEXT DEFAULT '', carrier TEXT DEFAULT '', tracking_no TEXT DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS order_items(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id INTEGER NOT NULL,
  name TEXT NOT NULL, image TEXT, size TEXT NOT NULL, qty INTEGER NOT NULL, price INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS order_events(
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE, status TEXT NOT NULL,
  note TEXT DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS inquiries(
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL, phone TEXT DEFAULT '', topic TEXT DEFAULT '',
  preferred_date TEXT DEFAULT '', message TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS newsletter(email TEXT PRIMARY KEY COLLATE NOCASE, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews(product_id);
CREATE TABLE IF NOT EXISTS measurements(
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, data TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
`);
// additive migrations for databases created by earlier versions
const hasCol = (t, c) => db.prepare(`PRAGMA table_info(${t})`).all().some(r => r.name === c);
if (!hasCol('products', 'twin_slug')) db.exec("ALTER TABLE products ADD COLUMN twin_slug TEXT DEFAULT ''");
if (!hasCol('orders', 'measurements')) db.exec("ALTER TABLE orders ADD COLUMN measurements TEXT DEFAULT ''");

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

const IMG = (...names) => names.map(n => `/assets/products/${n}`);
const SIZES = (a, b, c, d, e) => ({ XS: a, S: b, M: c, L: d, XL: e });
const KIDS = (a, b, c, d, e, f) => ({ '2Y': a, '4Y': b, '6Y': c, '8Y': d, '10Y': e, '12Y': f });

const PRODUCTS = [
  {
    slug: 'surkh-ajrakh-lehenga-set', name: 'Surkh Ajrakh Lehenga Set', category: 'Lehenga Sets', collection: 'Ajrakh Edit',
    price: 11990, compare_at: 13990, badge: 'Bestseller', featured: 1, sort: 1,
    tagline: 'Madder-red Ajrakh, finished with a silver-edged drape.',
    description: 'A fully block-printed lehenga in deep madder red and indigo-black, in the geometric Ajrakh tradition. The tiered skirt carries a hand-finished printed border, paired with a fitted three-quarter-sleeve choli and a printed dupatta edged in a silver zari ribbon.',
    details: ['Traditional Ajrakh-style block print', 'Flared panelled skirt with printed border', 'Three-quarter-sleeve choli with round neck', 'Dupatta with silver zari edge', 'Made-to-measure alterations available'],
    includes: ['Lehenga skirt', 'Choli', 'Dupatta'], care: 'Dry clean recommended. First wash separately; colours are natural-dye inspired and may bleed.',
    colors: ['Madder Red'], images: IMG('maroon-ajrakh-lehenga.webp'), stock: SIZES(3, 6, 8, 6, 3)
  },
  {
    slug: 'neel-indigo-tassel-lehenga', name: 'Neel Indigo Tassel Lehenga', category: 'Lehenga Sets', collection: 'Indigo Block-Print',
    price: 10490, compare_at: null, badge: 'New', featured: 1, sort: 2,
    tagline: 'Powder-blue ombré, indigo dabu border and cowrie-shell trim.',
    description: 'A softly dyed powder-blue lehenga that fades into a rich indigo block-printed tier, trimmed with cowrie shells and cotton tassels. The matching choli is printed in a fine floral stripe, and the dupatta falls in a bold botanical border with a silver lurex edge.',
    details: ['Ombré-dyed skirt with indigo block-print tier', 'Cowrie-shell and lace trim at the tier', 'Printed choli with back button closure', 'Dupatta with tassels and silver lurex border', 'Made-to-measure alterations available'],
    includes: ['Lehenga skirt', 'Choli', 'Dupatta'], care: 'Dry clean only. Store folded in muslin away from direct sunlight.',
    colors: ['Powder Blue'], images: IMG('indigo-1.webp', 'indigo-2.webp', 'indigo-3.webp'), stock: SIZES(2, 5, 7, 5, 2)
  },
  {
    slug: 'noir-bagh-blockprint-lehenga', name: 'Noir Bagh Block-Print Lehenga', category: 'Lehenga Sets', collection: 'Noir Edit',
    price: 9990, compare_at: 11490, badge: '', featured: 1, sort: 3,
    tagline: 'Midnight black, tiny motifs, a flash of mirror.',
    description: 'A twirl-ready black lehenga scattered with small block-printed motifs and bordered in Ajrakh-inspired bands of rust and indigo. The puff-sleeve choli, mirror-work waistband and sequin-flecked dupatta make it an easy choice for evening celebrations.',
    details: ['All-over small block-print motifs', 'Mirror-work waistband', 'Puff-sleeve choli', 'Sequin-flecked printed dupatta', 'Made-to-measure alterations available'],
    includes: ['Lehenga skirt', 'Choli', 'Dupatta'], care: 'Dry clean only. Do not iron directly on mirror work.',
    colors: ['Midnight Black'], images: IMG('noir-blockprint-lehenga.webp'), stock: SIZES(2, 5, 6, 5, 2)
  },
  {
    slug: 'safed-patchwork-lehenga-set', name: 'Safed Patchwork Lehenga Set', category: 'Lehenga Sets', collection: 'Ajrakh Edit',
    price: 8990, compare_at: null, badge: 'Festive Pick', featured: 1, sort: 4,
    tagline: 'Crisp white, scattered with Ajrakh and mirror-work patches.',
    description: 'A fluid white lehenga scattered with diamond appliqué patches of Ajrakh print and mirror work, worn with a halter-neck Ajrakh choli and a red printed dupatta finished with a lace edge and tassels. Made for Navratri nights and day-time festivities alike.',
    details: ['Flowing white skirt with Ajrakh appliqué patches', 'Halter-neck printed choli', 'Printed dupatta with lace edge and tassels', 'Mirror-work accents', 'Made-to-measure alterations available'],
    includes: ['Lehenga skirt', 'Choli', 'Dupatta'], care: 'Gentle hand wash or dry clean. Wash the dupatta separately.',
    colors: ['Ivory White'], twin: 'safed-patchwork-mini-set', images: IMG('white-patchwork-lehenga.webp', 'twinning-patchwork-1.webp', 'white-patchwork-detail.webp'), stock: SIZES(2, 5, 7, 5, 2)
  },
  {
    slug: 'midnight-ajrakh-halter-set', name: 'Midnight Ajrakh Halter Set', category: 'Skirt & Choli Sets', collection: 'Noir Edit',
    price: 6490, compare_at: null, badge: '', featured: 0, sort: 5,
    tagline: 'A black maxi skirt with a striped Ajrakh hem and mirror-work belt.',
    description: 'A voluminous black skirt banded with cream stripes and an Ajrakh-print hem, topped with a high-neck red Ajrakh halter choli and a diamond mirror-work waistband. Easy to wear, hard to ignore.',
    details: ['Full-flare black skirt with striped Ajrakh hem', 'High-neck halter choli', 'Diamond mirror-work waistband', 'Gold-ribbon waist trim', 'Made-to-measure alterations available'],
    includes: ['Skirt', 'Choli'], care: 'Dry clean recommended.',
    colors: ['Black & Madder'], images: IMG('black-ajrakh-set.webp'), stock: SIZES(3, 6, 8, 6, 3)
  },
  {
    slug: 'hara-bandhani-satin-lehenga', name: 'Hara Bandhani Satin Lehenga', category: 'Lehenga Sets', collection: 'Festive Brights',
    price: 7490, compare_at: 8490, badge: 'New', featured: 1, sort: 6,
    tagline: 'Mint satin that twirls, a rani-pink band and a bandhani dupatta.',
    description: 'A full-flare mint-green satin lehenga cut on a wide circle, so it opens beautifully when you spin. A rani-pink satin band edged in silver sequin lace runs through the skirt, matched with a pink pin-tuck halter choli and a hand-tied bandhani dupatta with a woven gold pallu and lace trim.',
    details: ['Full-circle satin skirt with rani-pink band', 'Silver sequin lace borders', 'Pin-tuck halter choli with lace yoke', 'Bandhani dupatta with zari pallu', 'Made-to-measure alterations available'],
    includes: ['Lehenga skirt', 'Choli', 'Dupatta'], care: 'Dry clean only. Steam on low; do not iron directly on lace.',
    colors: ['Mint & Rani Pink'], images: IMG('hara-satin-1.webp', 'hara-satin-2.webp'), stock: SIZES(2, 4, 6, 4, 2)
  },
  {
    slug: 'rangrez-kutch-striped-lehenga', name: 'Rangrez Kutch Striped Lehenga', category: 'Lehenga Sets', collection: 'Festive Brights',
    price: 6990, compare_at: null, badge: 'Garba Pick', featured: 0, sort: 7,
    tagline: 'Rainbow panels and a hand-embroidered Kutch mirror choli.',
    description: 'Made for garba nights: a swirling lehenga of saffron, lime, crimson and black panels finished with gota stripes at the hem. The sleeveless choli is covered in Kutch-style thread embroidery and tiny mirrors that catch the light as you dance.',
    details: ['Multi-panel striped skirt with gota hem', 'Kutch thread embroidery and mirror work', 'Sleeveless choli with tie-back', 'Lightweight for dancing', 'Made-to-measure alterations available'],
    includes: ['Lehenga skirt', 'Choli'], care: 'Dry clean recommended. Store flat to protect the mirrors.',
    colors: ['Multicolour'], images: IMG('kutch-rang-1.webp'), stock: SIZES(2, 4, 5, 4, 2)
  },
  {
    slug: 'safed-patchwork-mini-set', name: 'Safed Patchwork Mini Set', category: 'Kids', collection: 'Twinning',
    price: 3490, compare_at: null, badge: 'Twinning', featured: 0, sort: 8, twin: 'safed-patchwork-lehenga-set',
    tagline: 'The little one\u2019s match to our Safed Patchwork set.',
    description: 'A mini version of our Safed Patchwork lehenga for girls: a soft white cotton skirt with Ajrakh patches, a printed Ajrakh choli and a light tasselled dupatta. Pair it with the Safed Patchwork Lehenga Set and save on both.',
    details: ['Soft cotton skirt with elastic-back waist', 'Ajrakh-print sleeveless choli', 'Light dupatta with tassels', 'Comfortable lining for little ones', 'Free length adjustment'],
    includes: ['Lehenga skirt', 'Choli', 'Dupatta'], care: 'Gentle hand wash in cold water. Wash the dupatta separately.',
    colors: ['Ivory White'], images: IMG('twinning-patchwork-1.webp'), stock: KIDS(3, 4, 4, 4, 3, 2)
  }
];

const COUPONS = {
  KUMUD10: { type: 'percent', value: 10, min: 0, label: '10% off your order' },
  WELCOME500: { type: 'flat', value: 500, min: 5000, label: '₹500 off orders above ₹5,000' },
  FREESHIP: { type: 'ship', value: 0, min: 0, label: 'Free shipping' }
};

function insertProduct(p) {
  db.prepare(`INSERT INTO products(slug,name,category,collection,price,compare_at,tagline,description,details,includes,care,colors,stock,images,badge,featured,sort,twin_slug)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(p.slug, p.name, p.category, p.collection, p.price, p.compare_at, p.tagline, p.description,
    JSON.stringify(p.details), JSON.stringify(p.includes), p.care, JSON.stringify(p.colors), JSON.stringify(p.stock), JSON.stringify(p.images),
    p.badge, p.featured, p.sort, p.twin || '');
}

// Lookbook stories: hotspot x/y are percentages of the image; slug links to a product.
const LOOKS = [
  { id: 'twirl', title: 'The Twirl', kicker: 'Festive Brights', image: '/assets/lookbook/look-hara-twirl.webp', w: 1600, h: 2000,
    text: 'Mint satin cut on a full circle \u2014 one spin and the whole skirt opens like a flower.',
    spots: [{ x: 52, y: 26, slug: 'hara-bandhani-satin-lehenga', label: 'Pin-tuck halter choli' }, { x: 44, y: 62, slug: 'hara-bandhani-satin-lehenga', label: 'Full-circle satin skirt' }] },
  { id: 'twinning', title: 'Twinning, Always', kicker: 'Mother & Daughter', image: '/assets/lookbook/look-twinning.webp', w: 1600, h: 2000,
    text: 'The Safed Patchwork set, in her size and yours. Buy both and save on the pair.',
    spots: [{ x: 40, y: 30, slug: 'safed-patchwork-lehenga-set', label: 'Safed Patchwork Lehenga Set' }, { x: 74, y: 52, slug: 'safed-patchwork-mini-set', label: 'Safed Patchwork Mini Set' }] },
  { id: 'garden', title: 'Golden Hour', kicker: 'Festive Brights', image: '/assets/lookbook/look-hara-garden.webp', w: 738, h: 1340,
    text: 'Bandhani pink and silver lace, made for afternoon haldis and evening garba.',
    spots: [{ x: 62, y: 42, slug: 'hara-bandhani-satin-lehenga', label: 'Bandhani dupatta' }] },
  { id: 'closeup', title: 'In the Details', kicker: 'Ajrakh Edit', image: '/assets/lookbook/look-patchwork-closeup.webp', w: 1080, h: 1700,
    text: 'Zig-zag Ajrakh, a sweetheart halter and silver jhumkas \u2014 the choli that started it all.',
    spots: [{ x: 58, y: 70, slug: 'safed-patchwork-lehenga-set', label: 'Ajrakh halter choli' }] },
  { id: 'duo', title: 'Garba Night', kicker: 'Festive Brights', image: '/assets/lookbook/look-duo.webp', w: 738, h: 1220,
    text: 'Rainbow panels and Kutch mirrors beside mint satin \u2014 two ways to own the dance floor.',
    spots: [{ x: 26, y: 26, slug: 'rangrez-kutch-striped-lehenga', label: 'Kutch mirror choli' }, { x: 22, y: 66, slug: 'rangrez-kutch-striped-lehenga', label: 'Striped panel skirt' }, { x: 64, y: 58, slug: 'hara-bandhani-satin-lehenga', label: 'Hara satin lehenga' }] }
];

const SETTING_DEFAULTS = { whatsapp: process.env.WHATSAPP_NUMBER || '', twinningPercent: '10' };
for (const [k, v] of Object.entries(SETTING_DEFAULTS)) db.prepare('INSERT OR IGNORE INTO settings(key,value) VALUES(?,?)').run(k, v);
const getSetting = k => db.prepare('SELECT value FROM settings WHERE key=?').get(k)?.value ?? SETTING_DEFAULTS[k] ?? '';
const setSetting = (k, v) => db.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(k, String(v));

function seed() {
  const hasProducts = db.prepare('SELECT COUNT(*) c FROM products').get().c;
  if (!hasProducts) {
    for (const p of PRODUCTS) insertProduct(p);
    const rv = db.prepare('INSERT INTO reviews(product_id,author,rating,title,body) VALUES((SELECT id FROM products WHERE slug=?),?,?,?,?)');
    rv.run('neel-indigo-tassel-lehenga', 'Ananya R.', 5, 'Looks like a dream in person', 'The ombré is even prettier than the photos and the tassels move beautifully when you twirl. The fit adjustment was done in two days.');
    rv.run('neel-indigo-tassel-lehenga', 'Meera S.', 5, 'Wore it to a sangeet', 'So many compliments. The dupatta drapes really well and is light enough to dance in.');
    rv.run('surkh-ajrakh-lehenga-set', 'Pooja K.', 5, 'Rich colours', 'Deep, earthy red with great print detail. Very comfortable for a full evening.');
    rv.run('surkh-ajrakh-lehenga-set', 'Divya M.', 4, 'Lovely, size up if in between', 'Beautiful print and finishing. I would size up in the choli if you are between sizes.');
    rv.run('safed-patchwork-lehenga-set', 'Riya T.', 5, 'Perfect for Navratri', 'Light, flowy and the patches are such a fun detail. Got so many questions about where it is from.');
    rv.run('noir-bagh-blockprint-lehenga', 'Sana H.', 5, 'Elegant evening wear', 'The mirror waistband and sequin dupatta make it feel special without being heavy.');
  }
  const adminEmail = (process.env.ADMIN_EMAIL || 'admin@kumudboutique.com').toLowerCase();
  if (!db.prepare('SELECT 1 FROM users WHERE email=?').get(adminEmail)) {
    const { salt, hash } = hashPassword(process.env.ADMIN_PASSWORD || 'Admin@12345');
    db.prepare("INSERT INTO users(name,email,salt,hash,role) VALUES('Kumud Admin',?,?,?, 'admin')").run(adminEmail, salt, hash);
  }
}
seed();
// catalogue upgrades for existing databases: add new pieces, link twins, append new photos (stock and prices are left alone)
for (const p of PRODUCTS) {
  const row = db.prepare('SELECT id,images,twin_slug FROM products WHERE slug=?').get(p.slug);
  if (!row) { insertProduct(p); continue; }
  if (p.twin && !row.twin_slug) db.prepare('UPDATE products SET twin_slug=? WHERE id=?').run(p.twin, row.id);
  const have = JSON.parse(row.images), add = p.images.filter(i => !have.includes(i));
  if (add.length && have.every(i => p.images.includes(i))) db.prepare('UPDATE products SET images=? WHERE id=?').run(JSON.stringify(p.images), row.id);
}

function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
}

module.exports = { db, tx, hashPassword, COUPONS, LOOKS, getSetting, setSetting };
