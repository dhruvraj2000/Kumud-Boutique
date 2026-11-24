'use strict';
// Database verification: structural integrity + business invariants. Returns a list of problems (empty = healthy).
// Run from the shell with `npm run verify-db`, and used by the automated tests.
const lifecycle = require('./lifecycle');
const TRACKING_RE = /^KT-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

function verify(db) {
  const problems = [], all = (s, ...p) => db.prepare(s).all(...p), bad = (what, rows) => { if (rows.length) problems.push(`${what}: ${rows.map(r => r.k ?? r.number ?? JSON.stringify(r)).slice(0, 5).join(', ')}${rows.length > 5 ? ` … (+${rows.length - 5})` : ''}`); };

  const ic = all('PRAGMA integrity_check'); if (ic.length !== 1 || ic[0].integrity_check !== 'ok') problems.push('SQLite integrity_check failed: ' + JSON.stringify(ic).slice(0, 200));
  const fk = all('PRAGMA foreign_key_check'); bad('foreign-key violations', fk.map(r => ({ k: `${r.table}#${r.rowid}→${r.parent}` })));

  // orders
  bad('orders with no items', all('SELECT o.number k FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_items i WHERE i.order_id=o.id)'));
  bad('order subtotal does not equal the sum of its items', all('SELECT o.number k FROM orders o WHERE o.subtotal <> (SELECT COALESCE(SUM(i.price*i.qty),0) FROM order_items i WHERE i.order_id=o.id)'));
  bad('order total does not equal subtotal − discount + delivery', all('SELECT number k FROM orders WHERE total <> MAX(0, subtotal - discount + shipping)'));
  bad('missing or malformed tracking ID', all("SELECT number k, tracking_id FROM orders").filter(r => !TRACKING_RE.test(r.tracking_id || '')).map(r => ({ k: r.k })));
  bad('duplicate tracking IDs', all("SELECT tracking_id k FROM orders GROUP BY tracking_id HAVING COUNT(*)>1"));
  bad('duplicate order numbers', all('SELECT number k FROM orders GROUP BY number HAVING COUNT(*)>1'));
  bad('unknown order status', all('SELECT number k, status FROM orders').filter(r => !lifecycle.STATUSES.includes(r.status)).map(r => ({ k: r.k + ':' + r.status })));
  bad('order owner no longer exists', all('SELECT o.number k FROM orders o WHERE o.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id=o.user_id)'));
  bad('delivery partner is not a delivery user', all("SELECT o.number k FROM orders o WHERE o.delivery_user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id=o.delivery_user_id AND u.role='delivery')"));
  bad('delivery address missing coordinates but distance recorded', all('SELECT number k FROM orders WHERE distance_km IS NOT NULL AND (dest_lat IS NULL OR dest_lng IS NULL)'));
  bad('coordinates out of range', all('SELECT number k FROM orders WHERE dest_lat IS NOT NULL AND (ABS(dest_lat)>90 OR ABS(dest_lng)>180)'));

  // history
  bad('orders with no history', all('SELECT o.number k FROM orders o WHERE NOT EXISTS (SELECT 1 FROM order_events e WHERE e.order_id=o.id)'));
  bad("order history does not start at 'placed'", all("SELECT o.number k FROM orders o WHERE (SELECT status FROM order_events e WHERE e.order_id=o.id ORDER BY e.id LIMIT 1) <> 'placed'"));
  bad("order status differs from its latest history entry", all('SELECT o.number k FROM orders o WHERE o.status <> (SELECT status FROM order_events e WHERE e.order_id=o.id ORDER BY e.id DESC LIMIT 1)'));

  // money
  bad('prepaid order marked paid without a successful payment record', all("SELECT o.number k FROM orders o WHERE o.payment_status IN ('paid','refund due','refund processing','refunded') AND o.payment_method NOT LIKE 'Cash%' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.kind='charge' AND p.status='succeeded')"));
  bad('refunded order without a refund record', all("SELECT o.number k FROM orders o WHERE o.status='refunded' AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.order_id=o.id AND p.kind='refund' AND p.status='succeeded')"));
  bad('delivered order without a delivery timestamp', all("SELECT number k FROM orders WHERE status='delivered' AND delivered_at=''"));
  bad('payment amount is not positive', all('SELECT order_id k FROM payments WHERE amount<=0'));
  bad('same gateway payment recorded twice', all("SELECT provider_ref k FROM payments WHERE provider_ref IS NOT NULL AND kind='charge' GROUP BY provider, provider_ref HAVING COUNT(*)>1"));

  // catalogue + customers
  const stock = all('SELECT slug k, stock FROM products'); bad('negative stock', stock.filter(p => Object.values(JSON.parse(p.stock)).some(n => n < 0)).map(p => ({ k: p.k })));
  bad('duplicate customer emails', all('SELECT lower(email) k FROM users GROUP BY lower(email) HAVING COUNT(*)>1'));
  bad('users without a password hash', all("SELECT email k FROM users WHERE hash='' OR salt=''"));
  bad('addresses of deleted users', all('SELECT a.id k FROM addresses a WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id=a.user_id)'));
  return problems;
}

module.exports = { verify };
if (require.main === module) {
  const { db } = require('./db'), p = verify(db), n = db.prepare('SELECT COUNT(*) c FROM orders').get().c;
  if (p.length) { console.error(`✖ ${p.length} problem(s) in the database (${n} orders checked):\n - ` + p.join('\n - ')); process.exit(1); }
  console.log(`✔ database healthy (${n} orders, ${db.prepare('SELECT COUNT(*) c FROM users').get().c} users, ${db.prepare('SELECT COUNT(*) c FROM payments').get().c} payments checked)`);
}
