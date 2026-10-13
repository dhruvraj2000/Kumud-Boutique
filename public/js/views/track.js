import { html, render, get, $, onSubmit, state, money, fmtDate } from '../core.js';
import { icon } from '../components.js';

const STEPS = [['placed', 'Order placed'], ['confirmed', 'Confirmed'], ['preparing', 'Preparing'], ['shipped', 'Shipped'], ['out_for_delivery', 'Out for delivery'], ['delivered', 'Delivered']];
export const timeline = o => {
  if (o.status === 'cancelled') return html`<div class="tl-cancel">${icon('close')} This order was cancelled.</div><ol class="tl vertical">${o.events.map(e => html`<li class="done"><b>${e.note}</b><small>${fmtDate(e.createdAt, true)}</small></li>`)}</ol>`;
  const idx = STEPS.findIndex(s => s[0] === o.status);
  return html`<ol class="tl">${STEPS.map(([k, l], i) => html`<li class="${i < idx ? 'done' : i === idx ? 'now' : ''}"><span class="dotm">${i <= idx ? icon('check') : ''}</span><b>${l}</b></li>`)}</ol>
    <ul class="tl-log">${[...o.events].reverse().map(e => html`<li><b>${e.note}</b><small>${fmtDate(e.createdAt, true)}</small></li>`)}</ul>
    ${o.carrier || o.trackingNo ? html`<p class="courier">${icon('truck')} ${o.carrier || 'Courier'} ${o.trackingNo ? html`· Tracking no. <b>${o.trackingNo}</b>` : ''}</p>` : ''}`;
};
export const orderItems = o => html`<ul class="oitems">${o.items.map(i => html`<li><img src="${i.image.replace('.webp', '-sm.webp')}" alt="" width="64" height="80"><div><b>${i.name}</b><small>Size ${i.size} · Qty ${i.qty}</small></div><span>${money(i.price * i.qty)}</span></li>`)}</ul>`;

export default async function track({ el, query }) {
  render(el, html`<section class="wrap page-narrow"><nav class="crumbs"><a href="#/">Home</a><span>/</span><span>Track order</span></nav><h1>Track your order</h1><p class="sub">Enter the order number from your confirmation and the email you used at checkout.</p>
    <form id="trackForm" class="card-form" novalidate><div class="field"><label for="tn">Order number</label><input id="tn" name="number" placeholder="KB-261013-1234" value="${query.get('n') || ''}" autocapitalize="characters" required></div>
    <div class="field"><label for="te">Email</label><input id="te" name="email" type="email" value="${state.user ? state.user.email : ''}" required></div><button class="btn btn-primary" type="submit">Track order</button></form>
    <div id="trackOut" aria-live="polite"></div></section>`);
  onSubmit($('#trackForm', el), async d => {
    const { order: o } = await get(`/track?number=${encodeURIComponent(d.number.trim())}&email=${encodeURIComponent(d.email.trim())}`);
    render($('#trackOut', el), html`<div class="track-card"><header><div><p class="eyebrow">Order</p><h2>${o.number}</h2></div><span class="pill st-${o.status}">${o.status.replace(/_/g, ' ')}</span></header>${timeline(o)}${orderItems(o)}<p class="tot">Total <b>${money(o.total)}</b></p></div>`);
    $('#trackOut', el).scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 'Searching…');
  return 'Track order';
}
