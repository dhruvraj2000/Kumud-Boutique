// Delivery partner screen (#/courier): my assigned deliveries, start/stop live location sharing (explicit opt-in), mark delivered.
import { html, render, get, post, $, state, money, toast } from '../core.js';
import { actions } from '../components.js';
import { gmapsDir } from '../maps.js';

export default async function courier({ el, onLeave }) {
  if (!state.user || !['delivery', 'admin'].includes(state.user.role)) {
    render(el, html`<section class="wrap page-narrow empty"><h1>Delivery partners only</h1><p>Sign in with your delivery account.</p><a class="btn btn-primary" href="#/login?next=/courier">Sign in</a></section>`); return 'Deliveries';
  }
  const watches = new Map();   // order number → geolocation watch id
  let lastSent = new Map(), orders = [];
  const stopWatch = n => { if (watches.has(n)) { navigator.geolocation.clearWatch(watches.get(n)); watches.delete(n); } };
  const startWatch = n => {
    if (!navigator.geolocation) { toast('This device cannot share its location.', 'warn'); return false; }
    watches.set(n, navigator.geolocation.watchPosition(async p => {
      const now = Date.now(); if (now - (lastSent.get(n) || 0) < 5000) return; lastSent.set(n, now);
      try { await post(`/courier/orders/${n}/location`, { lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, speed: p.coords.speed || 0 }); } catch (e) { if (e.status === 400) { stopWatch(n); toast(e.message, 'warn'); } }
    }, err => { toast(err.code === 1 ? 'Location permission was denied — customers will not see live tracking.' : 'Could not read your location.', 'warn'); stopWatch(n); sync(n, false); }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }));
    return true;
  };
  const sync = async (n, on) => { try { await post(`/courier/orders/${n}/share`, { on }); } catch { /* ignore */ } await draw(); };
  const draw = async () => {
    orders = (await get('/courier/orders')).orders;
    for (const o of orders) if (o.sharing && !watches.has(o.number)) startWatch(o.number);   // resume after a page reload
    render(el, html`<section class="wrap page-narrow"><h1>My deliveries</h1><p class="sub">Live location is shared only while you switch it on for a delivery, and stops when the order is delivered.</p>
      ${orders.length ? html`<ul class="courier-list">${orders.map(o => html`<li class="panel"><header class="p-head"><h2>${o.number}</h2><span class="pill st-${o.status}">${o.status.replace(/_/g, ' ')}</span></header>
        <p><b>${o.name}</b> · <a href="tel:${o.phone}">${o.phone}</a><br>${o.address}</p>${o.cod ? html`<p class="cod">Collect <b>${money(o.cod)}</b> (cash on delivery)</p>` : ''}${o.eta ? html`<small>Due ${o.eta}</small>` : ''}
        <div class="row-btns">${o.dest ? html`<a class="btn btn-ghost sm" target="_blank" rel="noopener" href="${gmapsDir(state.meta.store, o.dest)}">Navigate</a>` : ''}
          ${o.status !== 'out_for_delivery' ? html`<button class="btn btn-primary sm" data-action="c-out" data-n="${o.number}">${o.status === 'delivery_failed' ? 'Try again' : 'Start delivery'}</button>` : html`
            ${o.sharing ? html`<button class="btn btn-ghost sm" data-action="c-share" data-n="${o.number}" data-on="0">Stop sharing location</button>` : html`<button class="btn btn-primary sm" data-action="c-share" data-n="${o.number}" data-on="1">Share live location</button>`}
            <button class="btn btn-primary sm" data-action="c-done" data-n="${o.number}">Mark delivered</button><button class="btn btn-ghost sm" data-action="c-fail" data-n="${o.number}">Could not deliver</button>`}</div></li>`)}</ul>` : html`<p class="muted">Nothing assigned to you right now.</p>`}</section>`);
  };
  const act = (k, fn) => { actions[k] = async b => { try { await fn(b); } catch (e) { toast(e.message, 'warn'); } }; };
  act('c-out', async b => { await post(`/courier/orders/${b.dataset.n}/out`); toast('Customer notified: out for delivery'); await draw(); });
  act('c-share', async b => {
    const n = b.dataset.n, on = b.dataset.on === '1';
    if (on) { await post(`/courier/orders/${n}/share`, { on: true }); if (!startWatch(n)) await post(`/courier/orders/${n}/share`, { on: false }); toast('Sharing your location with this customer'); }
    else { stopWatch(n); await post(`/courier/orders/${n}/share`, { on: false }); toast('Location sharing stopped'); }
    await draw();
  });
  act('c-fail', async b => { const why = prompt('Why could the order not be delivered? (e.g. customer not available)'); if (why === null) return; stopWatch(b.dataset.n); await post(`/courier/orders/${b.dataset.n}/failed`, { reason: why }); toast('Reported. The customer and the atelier were notified.'); await draw(); });
  act('c-done', async b => { if (!confirm('Mark this order as delivered?')) return; stopWatch(b.dataset.n); await post(`/courier/orders/${b.dataset.n}/delivered`); toast('Delivered — thank you!'); await draw(); });
  onLeave(() => { for (const n of [...watches.keys()]) stopWatch(n); ['c-out', 'c-share', 'c-done', 'c-fail'].forEach(k => delete actions[k]); });
  await draw();
  return 'Deliveries';
}
