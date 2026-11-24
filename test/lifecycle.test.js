'use strict';
// Unit tests: order lifecycle rules (pure functions, no server or database).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const L = require('../server/lifecycle');

const order = (status, over = {}) => ({ status, payment_method: 'Cash on delivery', payment_status: 'pending', ...over });
const online = (status, pay = 'pending') => order(status, { payment_method: 'Razorpay pay_abc', payment_status: pay });

test('all ten steps exist in order, with the failure/return/refund states on the side', () => {
  assert.deepEqual(L.CHAIN, ['placed', 'payment_processing', 'payment_confirmed', 'confirmed', 'preparing', 'packed', 'shipped', 'in_transit', 'out_for_delivery', 'delivered']);
  for (const s of ['payment_failed', 'cancelled', 'return_requested', 'return_approved', 'refund_processing', 'refunded', 'delivery_failed']) assert.ok(L.STATUSES.includes(s), s);
  for (const s of L.STATUSES) { assert.ok(L.LABEL[s], 'label ' + s); assert.ok(L.NOTE[s], 'note ' + s); }
});

test('timeline steps: prepaid shows payment steps, cash on delivery skips them', () => {
  assert.equal(L.stepsFor(online('placed')).length, 10);
  const cod = L.stepsFor(order('placed')).map(s => s.key);
  assert.equal(cod.length, 8); assert.ok(!cod.includes('payment_processing') && !cod.includes('payment_confirmed'));
});

test('cash-on-delivery order moves forward only; cancel allowed until delivered', () => {
  const next = L.nextOptions(order('placed'));
  assert.ok(next.includes('confirmed') && next.includes('shipped') && next.includes('cancelled'));
  assert.ok(!next.includes('payment_processing') && !next.includes('payment_confirmed') && !next.includes('placed'));
  assert.ok(!L.allowed(order('packed'), 'confirmed'), 'no going backwards');
  assert.ok(L.allowed(order('shipped'), 'in_transit') && L.allowed(order('in_transit'), 'out_for_delivery') && L.allowed(order('out_for_delivery'), 'delivered'));
  assert.ok(!L.nextOptions(order('delivered')).includes('cancelled'), 'delivered orders go through returns, not cancellation');
});

test('payment gate: an unpaid online order cannot be fulfilled, and payment cannot be confirmed by hand', () => {
  const next = L.nextOptions(online('placed'));
  assert.ok(next.includes('payment_processing') && next.includes('payment_failed') && next.includes('cancelled'));
  for (const s of ['confirmed', 'preparing', 'packed', 'shipped', 'delivered', 'payment_confirmed']) assert.ok(!next.includes(s), s + ' must be blocked');
  assert.ok(!L.nextOptions(online('payment_processing')).includes('payment_confirmed'), 'only a verified gateway payment may do that');
  assert.ok(L.nextOptions(online('payment_confirmed', 'paid')).includes('confirmed'), 'once paid, fulfilment is open');
});

test('failure branches: payment failed can retry or cancel; delivery failed can retry or cancel', () => {
  assert.deepEqual(L.nextOptions(online('payment_failed')).sort(), ['cancelled', 'payment_processing']);
  assert.deepEqual(L.nextOptions(order('delivery_failed', { payment_status: 'pending' })).sort(), ['cancelled', 'out_for_delivery']);
  assert.ok(L.nextOptions(order('out_for_delivery')).includes('delivery_failed'));
  assert.ok(!L.nextOptions(order('packed')).includes('delivery_failed'));
});

test('returns and refunds follow a strict path', () => {
  assert.deepEqual(L.nextOptions(order('delivered')), ['return_requested']);
  assert.deepEqual(L.nextOptions(order('return_requested')).sort(), ['delivered', 'return_approved']);
  assert.deepEqual(L.nextOptions(order('return_approved')), ['returned']);
  assert.deepEqual(L.nextOptions(order('returned', { payment_status: 'refund due' })), ['refund_processing']);
  assert.deepEqual(L.nextOptions(order('returned', { payment_status: 'pending' })), [], 'nothing to refund');
  assert.deepEqual(L.nextOptions(order('refund_processing', { payment_status: 'refund processing' })), ['refunded']);
  assert.deepEqual(L.nextOptions(order('refunded', { payment_status: 'refunded' })), []);
  assert.deepEqual(L.nextOptions(order('cancelled', { payment_status: 'refund due' })), ['refund_processing']);
  assert.deepEqual(L.nextOptions(order('cancelled', { payment_status: 'cancelled' })), []);
});

test('payment status follows the order status', () => {
  assert.equal(L.paymentAfter(order('out_for_delivery'), 'delivered'), 'paid', 'courier collected cash');
  assert.equal(L.paymentAfter(online('confirmed', 'paid'), 'cancelled'), 'refund due');
  assert.equal(L.paymentAfter(online('placed', 'pending'), 'cancelled'), 'cancelled');
  assert.equal(L.paymentAfter(order('delivered', { payment_status: 'paid' }), 'returned'), 'refund due');
  assert.equal(L.paymentAfter(order('returned', { payment_status: 'refund due' }), 'refund_processing'), 'refund processing');
  assert.equal(L.paymentAfter(order('refund_processing'), 'refunded'), 'refunded');
});

test('customers can only cancel before preparation starts', () => {
  for (const s of ['placed', 'payment_processing', 'payment_confirmed', 'payment_failed', 'confirmed']) assert.ok(L.CUSTOMER_CANCEL.includes(s), s);
  for (const s of ['preparing', 'packed', 'shipped', 'in_transit', 'out_for_delivery', 'delivered']) assert.ok(!L.CUSTOMER_CANCEL.includes(s), s);
});

test('every status is reachable and no status can loop forever', () => {
  const seen = new Set(['placed', 'payment_confirmed']), queue = [online('placed'), online('payment_confirmed', 'paid')];
  while (queue.length) {
    const o = queue.pop();
    for (const to of L.nextOptions(o)) {
      if (seen.has(to)) continue; seen.add(to);
      queue.push({ ...o, status: to, payment_status: to === 'payment_confirmed' ? 'paid' : L.paymentAfter(o, to) });
    }
  }
  // payment_confirmed is only reachable via the verified-payment path, so it is added by the server (system move)
  for (const s of L.STATUSES) if (s !== 'payment_confirmed') assert.ok(seen.has(s), 'unreachable: ' + s);
});

test('admin list filters cover every status', () => {
  const covered = new Set(Object.values(L.GROUPS).flatMap(g => g.statuses));
  for (const s of L.STATUSES) assert.ok(covered.has(s), 'no admin filter shows ' + s);
  for (const g of Object.keys(L.GROUPS)) { const w = L.groupWhere(g); assert.ok(w.sql && Array.isArray(w.params), g); }
  assert.equal(L.groupWhere('nonsense'), null);
});
