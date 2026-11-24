'use strict';
// Order lifecycle: one place that says which statuses exist, which moves are legal, and what each move does to payment.
// Pure functions (no database) so every rule can be unit-tested.

// The happy path. Prepaid orders show all ten steps; cash-on-delivery orders skip the two payment steps.
const CHAIN = ['placed', 'payment_processing', 'payment_confirmed', 'confirmed', 'preparing', 'packed', 'shipped', 'in_transit', 'out_for_delivery', 'delivered'];
const SIDE = ['payment_failed', 'delivery_failed', 'cancelled', 'return_requested', 'return_approved', 'returned', 'refund_processing', 'refunded'];
const STATUSES = [...CHAIN, ...SIDE];

const LABEL = {
  placed: 'Order placed', payment_processing: 'Payment processing', payment_confirmed: 'Payment confirmed', confirmed: 'Order confirmed', preparing: 'Processing',
  packed: 'Packed', shipped: 'Shipped', in_transit: 'In transit', out_for_delivery: 'Out for delivery', delivered: 'Delivered',
  payment_failed: 'Payment failed', delivery_failed: 'Delivery attempt failed', cancelled: 'Cancelled', return_requested: 'Return requested', return_approved: 'Return approved',
  returned: 'Return received', refund_processing: 'Refund processing', refunded: 'Refunded'
};
const NOTE = {
  placed: 'Order received', payment_processing: 'Verifying your payment', payment_confirmed: 'Payment received and verified', confirmed: 'Order confirmed by the atelier',
  preparing: 'Being prepared & quality-checked', packed: 'Packed and ready for dispatch', shipped: 'Handed to the delivery partner', in_transit: 'Shipment is on its way to your city',
  out_for_delivery: 'Out for delivery', delivered: 'Delivered', payment_failed: 'Payment was not completed', delivery_failed: 'Delivery attempt failed — we will try again',
  cancelled: 'Order cancelled', return_requested: 'Return requested by customer', return_approved: 'Return approved — pickup will be arranged', returned: 'Returned item received',
  refund_processing: 'Refund is being processed', refunded: 'Refund completed'
};

const isCod = o => /^Cash/i.test(String(o.payment_method ?? o.paymentMethod ?? ''));
const paidOf = o => o.payment_status ?? o.paymentStatus;
const REFUND_STATES = ['refund_processing', 'refunded'];
const refundable = o => ['refund due', 'refund processing'].includes(paidOf(o));

const stepsFor = o => CHAIN.filter(k => !(isCod(o) && (k === 'payment_processing' || k === 'payment_confirmed'))).map(key => ({ key, label: LABEL[key] }));
// Customer may cancel on their own only before we start preparing the piece.
const CUSTOMER_CANCEL = ['placed', 'payment_processing', 'payment_confirmed', 'payment_failed', 'confirmed'];

// Statuses an admin may move this order to right now.
function nextOptions(o) {
  const s = o.status;
  if (s === 'refunded') return [];
  if (s === 'cancelled' || s === 'returned') return refundable(o) ? ['refund_processing'] : [];
  if (s === 'refund_processing') return ['refunded'];
  if (s === 'return_requested') return ['return_approved', 'delivered'];   // approve, or reject (back to delivered)
  if (s === 'return_approved') return ['returned'];
  if (s === 'delivered') return ['return_requested'];
  if (s === 'payment_failed') return ['payment_processing', 'cancelled'];
  if (s === 'delivery_failed') return ['out_for_delivery', 'cancelled'];
  const i = CHAIN.indexOf(s); if (i < 0) return [];
  const prepaidUnpaid = !isCod(o) && paidOf(o) !== 'paid';
  let out = CHAIN.slice(i + 1).filter(k => {
    if (isCod(o) && (k === 'payment_processing' || k === 'payment_confirmed')) return false;
    if (k === 'payment_confirmed') return false;                       // only a verified gateway payment can do this — never by hand
    if (prepaidUnpaid && CHAIN.indexOf(k) >= CHAIN.indexOf('confirmed')) return false;   // no fulfilment before money is confirmed
    return true;
  });
  if (s !== 'delivered') out.push('cancelled');
  if (prepaidUnpaid && (s === 'placed' || s === 'payment_processing')) out.push('payment_failed');
  if (s === 'in_transit' || s === 'out_for_delivery') out.push('delivery_failed');
  return out;
}
const allowed = (o, to) => nextOptions(o).includes(to);

// Payment bookkeeping that must accompany a status change.
function paymentAfter(o, to) {
  const pay = paidOf(o);
  if (to === 'delivered' && pay === 'pending') return 'paid';            // cash collected by the courier
  if (to === 'cancelled') return pay === 'paid' ? 'refund due' : pay === 'pending' || pay === 'failed' ? 'cancelled' : pay;
  if (to === 'returned') return pay === 'paid' ? 'refund due' : pay;
  if (to === 'refund_processing') return 'refund processing';
  if (to === 'refunded') return 'refunded';
  return pay;
}

// Admin list filters (also used for the counts on the chips).
const GROUPS = {
  new: { statuses: ['placed', 'payment_processing', 'payment_confirmed'] }, confirmed: { statuses: ['confirmed'] }, processing: { statuses: ['preparing'] }, packed: { statuses: ['packed'] },
  shipped: { statuses: ['shipped'] }, in_transit: { statuses: ['in_transit'] }, out_for_delivery: { statuses: ['out_for_delivery'] }, delivered: { statuses: ['delivered'] },
  failed: { statuses: ['payment_failed', 'delivery_failed'] },
  cancelled: { statuses: ['cancelled'], closed: 'cancelled' }, returned: { statuses: ['return_requested', 'return_approved', 'returned'], closed: 'returned' },
  refunds: { statuses: ['refund_processing', 'refunded'], payment: ['refund due', 'refund processing'] }
};
function groupWhere(g) {
  const d = GROUPS[g]; if (!d) return null;
  const marks = a => a.map(() => '?').join(',');
  let sql = `o.status IN (${marks(d.statuses)})`, p = [...d.statuses];
  if (d.closed) { sql += ` OR (o.status IN (${marks(REFUND_STATES)}) AND o.closed_as=?)`; p.push(...REFUND_STATES, d.closed); }
  if (d.payment) { sql += ` OR o.payment_status IN (${marks(d.payment)})`; p.push(...d.payment); }
  return { sql: `(${sql})`, params: p };
}

module.exports = { CHAIN, SIDE, STATUSES, LABEL, NOTE, GROUPS, CUSTOMER_CANCEL, isCod, stepsFor, nextOptions, allowed, paymentAfter, groupWhere, refundable, REFUND_STATES };
