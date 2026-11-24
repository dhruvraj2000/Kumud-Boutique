import { payOnline, html, render, get, post, money, fmtDate, toast, state, $ } from '../core.js';
import { actions } from '../components.js';
import { timeline, orderItems, liveTracker } from './track.js';

const M_LABELS = { forWhom: 'For', bust: 'Bust', waist: 'Waist', hip: 'Hip', shoulder: 'Shoulder', blouseLength: 'Blouse length', skirtLength: 'Skirt length', height: 'Height', notes: 'Notes' };
export const measureList = m => html`<dl class="mlist">${Object.entries(M_LABELS).filter(([k]) => m[k] !== undefined).map(([k, l]) => html`<div><dt>${l}</dt><dd>${typeof m[k] === 'number' ? m[k] + '″' : m[k]}</dd></div>`)}</dl>`;

export default async function order({ el, params, query, onLeave }) {
  const num = params[0], em = query.get('email') ? '?email=' + encodeURIComponent(query.get('email')) : '';
  let o;
  try { o = (await get('/orders/' + num + em)).order; } catch (e) {
    if (e.status === 404 || e.status === 401) {
      render(el, html`<section class="wrap page-narrow empty"><h1>Order not found</h1><p>${state.user ? 'We could not find that order on your account.' : 'Sign in, or use the tracking page with your email.'}</p><a class="btn btn-primary" href="#/track?n=${encodeURIComponent(num)}">Track an order</a></section>`);
      return 'Order';
    }
    throw e;
  }
  const isNew = query.get('new') === '1';
  const draw = () => render(el, html`<section class="wrap order">
    ${isNew ? html`<div class="success"><svg viewBox="0 0 52 52" class="tick"><circle cx="26" cy="26" r="24"/><path d="M15 27l8 8 14-16"/></svg><h1>Thank you, ${o.address.name.split(' ')[0]}!</h1><p>Your order <b>${o.number}</b> is confirmed. Keep this number to track it — we've noted <b>${o.email}</b> for updates.</p></div>` : html`<nav class="crumbs"><a href="#/account/orders">Orders</a><span>/</span><span>${o.number}</span></nav><h1>Order ${o.number}</h1>`}
    <div class="order-grid">
      <div class="panel"><header class="p-head"><h2>Status</h2><span class="pill st-${o.status}">${o.status.replace(/_/g, ' ')}</span></header>${o.trackingId ? html`<p class="tid">Tracking ID <b>${o.trackingId}</b> · <a href="#/track?t=${o.trackingId}">Open tracking page</a></p>` : ''}${timeline(o)}${o.status === 'out_for_delivery' ? html`<h3>Live location</h3><div id="liveHost"></div>` : ''}
        ${o.onlinePending ? html`<button class="btn btn-primary" data-action="pay-order">${o.status === 'payment_failed' ? 'Try payment again · ' : 'Pay '}${money(o.total)}${o.status === 'payment_failed' ? '' : ' now'}</button> ` : ''}${o.canCancel ? html`<button class="btn btn-ghost" data-action="cancel-order">Cancel order</button>` : ''}${o.canReturn ? html`<button class="btn btn-ghost" data-action="return-order">Request a return</button>` : ''} <a class="btn btn-ghost" href="/api/orders/${o.number}/invoice${em}" target="_blank" rel="noopener">Invoice</a></div>
      <div class="panel"><h2>Items</h2>${orderItems(o)}
        <div class="sum-rows"><p><span>Subtotal</span><b>${money(o.subtotal)}</b></p>${o.discount ? html`<p class="disc"><span>Discount ${o.coupon || ''}</span><b>− ${money(o.discount)}</b></p>` : ''}<p><span>Shipping</span><b>${o.shipping ? money(o.shipping) : 'Free'}</b></p><p class="total"><span>Total</span><b>${money(o.total)}</b></p>${o.taxIncluded ? html`<p class="muted"><span>Includes GST</span><b>${money(o.taxIncluded)}</b></p>` : ''}</div>
        <div class="meta2"><div><h3>Delivering to</h3><p>${o.address.name}<br>${o.address.line1}${o.address.line2 ? ', ' + o.address.line2 : ''}<br>${o.address.city}, ${o.address.state} ${o.address.pincode}<br>${o.address.phone}</p></div>
          <div><h3>Payment</h3><p>${o.paymentMethod}<br><span class="pill sm pay-${o.paymentStatus.replace(' ', '-')}">${o.paymentStatus}</span></p><h3>Placed</h3><p>${fmtDate(o.createdAt, true)}</p></div></div>${o.measurements ? html`<div class="mtm-box"><h3>Made to measure</h3>${measureList(o.measurements)}<p class="muted">Our atelier will tailor your piece to these measurements.</p></div>` : ''}</div>
    </div>
    <div class="order-cta"><a class="btn btn-primary" href="#/shop">Continue shopping</a>${state.user ? '' : html`<a class="btn btn-ghost" href="#/register">Create an account</a>`}</div></section>`);
  let stopLive = null;
  const start = () => { if (stopLive) stopLive(); stopLive = o.status === 'out_for_delivery' && o.trackingId && $('#liveHost', el) ? liveTracker($('#liveHost', el), o.trackingId) : null; };
  draw(); start();
  // near real-time: re-check every 20s while the page is open and redraw only when something changed
  const poll = setInterval(async () => {
    if (document.hidden) return;
    try { const n = (await get('/orders/' + num + em)).order; if (n.status !== o.status || n.events.length !== o.events.length || n.paymentStatus !== o.paymentStatus || n.eta !== o.eta) { o = n; draw(); start(); } } catch { /* offline: keep the last view */ }
  }, 20000);
  actions['return-order'] = async () => {
    const reason = (prompt('Why would you like to return this order? (a few words is fine)') || '').trim(); if (!reason) return;
    try { await post(`/orders/${o.number}/return${em}`, { reason }); o = (await get('/orders/' + num + em)).order; draw(); start(); toast('Return requested — we will be in touch.'); } catch (e) { toast(e.message, 'warn'); }
  };
  actions['cancel-order'] = async () => {
    if (!confirm('Cancel this order?')) return;
    try { o = (await post(`/orders/${o.number}/cancel${em}`)).order; draw(); toast('Order cancelled'); } catch (e) { toast(e.message, 'warn'); }
  };
  actions['pay-order'] = async () => {
    try { if (await payOnline(o.number, em)) { o = (await get('/orders/' + num + em)).order; draw(); toast('Payment received ✦'); } } catch (e) { toast(e.message, 'warn'); }
  };
  onLeave(() => { delete actions['cancel-order']; delete actions['pay-order']; delete actions['return-order']; clearInterval(poll); if (stopLive) stopLive(); });
  return 'Order ' + o.number;
}
