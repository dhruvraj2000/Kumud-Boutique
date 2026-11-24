import { html, render, get, $, onSubmit, state, money, fmtDate } from '../core.js';
import { icon } from '../components.js';
import { mapsOn, routeMap, gmapsLink } from '../maps.js';

export const STEPS = [['placed', 'Order placed'], ['payment_processing', 'Payment processing'], ['payment_confirmed', 'Payment confirmed'], ['confirmed', 'Order confirmed'], ['preparing', 'Processing'], ['packed', 'Packed'], ['shipped', 'Shipped'], ['in_transit', 'In transit'], ['out_for_delivery', 'Out for delivery'], ['delivered', 'Delivered']];
const stamp = (o, k) => { const e = (o.events || []).find(x => x.status === k); return e ? fmtDate(e.createdAt, true) : ''; };
// Where an order sits on the happy path. Side states (failed, return, refund) pin it to the last step it truly reached.
const PINNED = { payment_failed: 'placed', delivery_failed: 'out_for_delivery', return_requested: 'delivered', return_approved: 'delivered', returned: 'delivered', refund_processing: 'delivered', refunded: 'delivered' };
const BANNERS = {
  payment_failed: ['warn', 'Your payment did not go through. No money was taken for this order — you can try paying again from your order page.'],
  delivery_failed: ['warn', 'We could not deliver on the last attempt. Our delivery partner will try again — you can also contact us to change the time.'],
  return_requested: ['info', 'Return requested — we will confirm the pickup shortly.'], return_approved: ['info', 'Return approved — pickup will be arranged by our team.'],
  returned: ['info', 'We have received the returned piece. Your refund will start shortly.'], refund_processing: ['info', 'Your refund is being processed. It usually reaches you in 5–7 working days.'], refunded: ['ok', 'Your refund has been completed.']
};
const stepList = o => (o.steps && o.steps.length ? o.steps.map(s => [s.key, s.label]) : STEPS.filter(s => !/^payment_/.test(s[0])));

// Progress timeline with a timestamp on every completed step, plus the full event log.
export const timeline = o => {
  const log = html`<ul class="tl-log">${[...o.events].reverse().map(e => html`<li><b>${e.note}</b><small>${fmtDate(e.createdAt, true)}</small></li>`)}</ul>`;
  if (o.status === 'cancelled' || (o.status === 'refund_processing' || o.status === 'refunded') && o.events.some(e => e.status === 'cancelled')) {
    const refund = BANNERS[o.status];
    return html`<div class="tl-cancel">${icon('close')} This order was cancelled.</div>${refund ? html`<div class="tl-cancel ${refund[0]}">${refund[1]}</div>` : ''}<ol class="tl vertical">${o.events.map(e => html`<li class="done"><b>${e.note}</b><small>${fmtDate(e.createdAt, true)}</small></li>`)}</ol>`;
  }
  const steps = stepList(o), pin = PINNED[o.status] || o.status, idx = Math.max(0, steps.findIndex(s => s[0] === pin)), banner = BANNERS[o.status];
  return html`${banner ? html`<div class="tl-cancel ${banner[0]}">${banner[1]}</div>` : ''}
    <ol class="tl steps7" style="--n:${steps.length}">${steps.map(([k, l], i) => html`<li class="${i < idx ? 'done' : i === idx ? (banner && banner[0] === 'warn' ? 'warn' : 'now') : ''}"><span class="dotm">${i <= idx ? icon('check') : ''}</span><b>${l}</b><small>${i <= idx ? stamp(o, k) : ''}</small></li>`)}</ol>
    ${o.eta && ['placed', 'payment_processing', 'payment_confirmed', 'confirmed', 'preparing', 'packed', 'shipped', 'in_transit', 'out_for_delivery', 'delivery_failed'].includes(o.status) ? html`<p class="eta ${o.delayed ? 'late' : ''}">${icon('truck')} ${o.delayed ? 'Running late — new estimate pending. Originally due ' : 'Estimated delivery '}<b>${fmtDate(o.eta)}</b></p>` : ''}
    ${o.deliveredAt || o.status === 'delivered' ? html`<p class="eta ok">${icon('check')} Delivered${o.deliveredAt ? ' on ' + fmtDate(o.deliveredAt, true) : ''}</p>` : ''}
    ${log}${o.carrier || o.trackingNo ? html`<p class="courier">${icon('truck')} ${o.carrier || 'Courier'} ${o.trackingNo || o.courierTracking ? html`· Courier tracking no. <b>${o.trackingNo || o.courierTracking}</b>` : ''}</p>` : ''}`;
};
export const orderItems = o => html`<ul class="oitems">${o.items.map(i => html`<li><img src="${i.image.replace('.webp', '-sm.webp')}" alt="" width="64" height="80"><div><b>${i.name}</b><small>Size ${i.size} · Qty ${i.qty}</small></div><span>${money(i.price * i.qty)}</span></li>`)}</ul>`;

// Live courier position. Polls only while the page is open; shows nothing unless the courier is sharing during an active delivery.
export function liveTracker(host, trackingId, onLeave) {
  let timer = null, map = null, stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const r = await get(`/track/${trackingId}/live`);
      if (!r.live) { render(host, html`<p class="muted">Live location appears here once your courier starts sharing during delivery.</p>`); map = null; }
      else if (mapsOn()) {
        if (!map) { render(host, html`<div class="map-host live" id="liveMap"></div><p class="live-eta"></p>`); map = await routeMap($('#liveMap', host), { dest: r.dest, courier: { lat: r.lat, lng: r.lng } }); }
        else await map.setCourier({ lat: r.lat, lng: r.lng });
        $('.live-eta', host).textContent = `${r.courierName || 'Your courier'} is on the way${r.etaMinutes ? ` · about ${r.etaMinutes} min away` : ''} · updated ${new Date(r.updatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}`;
      } else render(host, html`<p class="live-eta">${r.courierName || 'Your courier'} is on the way${r.etaMinutes ? ` · about ${r.etaMinutes} min away` : ''}. <a target="_blank" rel="noopener" href="${gmapsLink(r.lat, r.lng)}">See on Google Maps</a></p>`);
    } catch { /* keep the last picture; try again */ }
    if (!stopped) timer = setTimeout(tick, 15000);
  };
  tick();
  const stop = () => { stopped = true; clearTimeout(timer); };
  if (onLeave) onLeave(stop);
  return stop;
}

export default async function track({ el, query, onLeave }) {
  const tid = (query.get('t') || '').toUpperCase(), byOrder = !tid && query.has('n');
  render(el, html`<section class="wrap page-narrow"><nav class="crumbs"><a href="#/">Home</a><span>/</span><span>Track order</span></nav><h1>Track your order</h1>
    <p class="sub">Enter the Tracking ID from your confirmation email, SMS or order page.</p>
    <form id="trackForm" class="card-form" novalidate ${byOrder ? 'hidden' : ''}><div class="field"><label for="tt">Tracking ID</label><input id="tt" name="tid" placeholder="KT-AB12-CD34-EF56" value="${tid}" autocapitalize="characters" autocomplete="off" required></div><button class="btn btn-primary" type="submit">Track order</button>
      <p class="switch"><a href="#/track?n=">Use order number and email instead</a></p></form>
    <form id="orderForm" class="card-form" novalidate ${byOrder ? '' : 'hidden'}><div class="field"><label for="tn">Order number</label><input id="tn" name="number" placeholder="KB-261013-1234" value="${query.get('n') || ''}" autocapitalize="characters" required></div>
      <div class="field"><label for="te">Email</label><input id="te" name="email" type="email" value="${state.user ? state.user.email : ''}" required></div><button class="btn btn-primary" type="submit">Track order</button>
      <p class="switch"><a href="#/track">Use Tracking ID instead</a></p></form>
    <div id="trackOut" aria-live="polite"></div></section>`);
  let stopLive = null;
  onLeave(() => stopLive && stopLive());
  const show = async o => {
    if (stopLive) stopLive();
    const qr = o.trackingId ? html`<figure class="qr-card"><img src="/api/track/${o.trackingId}/qr.svg" alt="QR code for tracking ${o.trackingId}" width="140" height="140"><figcaption>Scan to open this page on your phone</figcaption></figure>` : '';
    render($('#trackOut', el), html`<div class="track-card"><header><div><p class="eyebrow">Tracking ID</p><h2>${o.trackingId || o.number}</h2><small>Order ${o.number}</small></div><span class="pill st-${o.status}">${o.statusLabel || o.status.replace(/_/g, ' ')}</span></header>
      ${timeline(o)}
      ${o.status === 'out_for_delivery' || o.liveAvailable ? html`<h3>Live location</h3><div id="liveHost"></div>` : ''}
      <div class="track-cols"><div><h3>Delivering to</h3><p>${o.address ? html`${o.address.name}<br>${o.address.line1}${o.address.line2 ? ', ' + o.address.line2 : ''}<br>${o.address.city}, ${o.address.state} ${o.address.pincode}` : 'Address on file'}</p></div>${qr}</div>
      <h3>Items</h3>${orderItems(o)}<p class="tot">Total <b>${money(o.total)}</b> <small>${o.paymentMethod}${o.paymentStatus ? ' · ' + o.paymentStatus : ''}</small></p></div>`);
    if ($('#liveHost', el) && o.trackingId) stopLive = liveTracker($('#liveHost', el), o.trackingId);
    $('#trackOut', el).scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  onSubmit($('#trackForm', el), async d => { const { order } = await get('/track/' + encodeURIComponent(d.tid.trim())); await show(order); }, 'Searching…');
  onSubmit($('#orderForm', el), async d => { const { order } = await get(`/track?number=${encodeURIComponent(d.number.trim())}&email=${encodeURIComponent(d.email.trim())}`); await show(order); }, 'Searching…');
  if (tid) $('#trackForm', el).requestSubmit();
  return 'Track order';
}
