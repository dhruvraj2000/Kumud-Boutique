// Admin → Orders: live list with search/filters, per-order manager (status, courier, ETA, map), delivery map, analytics.
import { html, render, get, post, patch, $, $$, state, money, fmtDate, toast, onSubmit } from '../core.js';
import { actions } from '../components.js';
import { mapsOn, routeMap, makeMap, makeMarker, gmapsLink, gmapsDir, loadMaps, osmEmbed, reportClient } from '../maps.js';
import { STEPS } from './track.js';
import { measureList } from './order.js';

const LABEL = Object.fromEntries([...STEPS, ['payment_failed', 'Payment failed'], ['delivery_failed', 'Delivery failed'], ['cancelled', 'Cancelled'], ['return_requested', 'Return requested'], ['return_approved', 'Return approved'], ['returned', 'Return received'], ['refund_processing', 'Refund processing'], ['refunded', 'Refunded']]);
const FILTERS = [['', 'All'], ['new', 'New'], ['confirmed', 'Confirmed'], ['processing', 'Processing'], ['packed', 'Packed'], ['shipped', 'Shipped'], ['in_transit', 'In transit'], ['out_for_delivery', 'Out for delivery'], ['delivered', 'Delivered'], ['failed', 'Failed'], ['delayed', 'Delayed'], ['cancelled', 'Cancelled'], ['returned', 'Returns'], ['refunds', 'Refunds']];
const todayIso = () => new Date().toISOString().slice(0, 10);

export default async function ordersTab(el, shell, onLeave) {
  let q = '', group = '', page = 1, open = null, timer = null, liveTimer = null, data = null, staff = [];
  try { staff = (await get('/admin/delivery-staff')).staff; } catch { /* managers may not see staff: fine */ }
  const qs = () => `/admin/orders?page=${page}${q ? '&q=' + encodeURIComponent(q) : ''}${group ? '&group=' + group : ''}`;
  const stop = () => { clearTimeout(timer); clearTimeout(liveTimer); };

  const row = o => html`<tr class="${open === o.number ? 'sel' : ''}" data-n="${o.number}">
    <td><b>${o.number}</b><small>${o.trackingId}</small><small>${fmtDate(o.createdAt, true)}</small></td>
    <td>${o.address.name}<small>${o.phone} · ${o.address.city}</small></td>
    <td>${money(o.total)}<small>${o.paymentMethod} · ${o.paymentStatus}</small></td>
    <td><span class="pill st-${o.status}">${LABEL[o.status] || o.status}</span>${o.delayed ? html`<span class="pill late">Delayed</span>` : ''}${o.eta && !['delivered', 'cancelled', 'returned'].includes(o.status) ? html`<small>ETA ${fmtDate(o.eta)}</small>` : ''}</td>
    <td>${o.courierName || '—'}${o.sharing ? html`<small class="live-dot">● live</small>` : ''}</td>
    <td><button class="btn btn-ghost sm" data-action="ord-open" data-n="${o.number}">Manage</button></td></tr>`;

  const list = () => html`<div class="ord-bar"><div class="chips" role="tablist">${FILTERS.map(([k, l]) => html`<button class="chip ${group === k ? 'on' : ''}" data-action="ord-filter" data-g="${k}">${l}${data && data.counts[k || 'all'] !== undefined ? html` <em>${data.counts[k || 'all']}</em>` : ''}</button>`)}</div>
      <form id="ordSearch" class="ord-search" novalidate><input name="q" value="${q}" placeholder="Search order no., tracking ID, name, phone, email…" aria-label="Search orders"><button class="btn btn-primary sm" type="submit">Search</button></form>
      <span class="live-flag" title="Refreshes every 20 seconds">● Live</span></div>
    ${data.orders.length ? html`<div class="table-wrap"><table class="tbl wide ord-tbl"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Courier</th><th></th></tr></thead><tbody>${data.orders.map(row)}</tbody></table></div>` : html`<p class="muted">No orders match.</p>`}
    <div class="pager"><button class="btn btn-ghost sm" data-action="ord-page" data-d="-1" ${page <= 1 ? 'disabled' : ''}>← Newer</button><span>Page ${data.page} of ${data.pages} · ${data.total} orders</span><button class="btn btn-ghost sm" data-action="ord-page" data-d="1" ${page >= data.pages ? 'disabled' : ''}>Older →</button></div>`;

  const draw = () => {
    render(el, shell(html`<div class="ord-layout"><div id="ordList">${list()}</div><aside id="ordDetail" class="ord-detail" ${open ? '' : 'hidden'}></aside></div>
      <div class="panel"><h2>Delivery map</h2><p class="muted">Every order waiting to ship or on its way. Red = delayed, green = courier sharing live.</p><div id="delMap" class="map-host tall"></div></div>`));
    bindList();
  };
  const bindList = () => {
    onSubmit($('#ordSearch', el), async d => { q = d.q.trim(); page = 1; await load(true); }, 'Searching…');
  };
  const load = async (full = false) => {
    data = await get(qs());
    if (full || !$('#ordList', el)) { if (!$('#ordList', el)) draw(); else { render($('#ordList', el), list()); bindList(); } } else { const box = $('#ordList', el), scroll = box.scrollTop; render(box, list()); bindList(); box.scrollTop = scroll; }
    if (open) { const o = data.orders.find(x => x.number === open); if (o && $('#ordDetail', el) && !$('#ordDetail', el).dataset.editing) detail(o, true); }
  };
  const tickLoop = () => { clearTimeout(timer); timer = setTimeout(async () => { if (!document.hidden && $('#ordList', el)) { try { await load(); } catch { /* transient */ } } tickLoop(); }, 20000); };

  const detail = async (o, soft = false) => {
    const box = $('#ordDetail', el); box.hidden = false; open = o.number; clearTimeout(liveTimer);
    const loc = o.location, a = o.address, opts = o.nextStatuses.map(s => s.key), refundOpen = ['cancelled', 'returned', 'refund_processing'].includes(o.status) && ['refund due', 'refund processing'].includes(o.paymentStatus), rzpPay = (o.paymentMethod.match(/pay_[A-Za-z0-9]+/) || [])[0];
    render(box, html`<header class="p-head"><h2>${o.number}</h2><button class="link-btn" data-action="ord-close">Close ✕</button></header>
      <p><span class="pill st-${o.status}">${LABEL[o.status] || o.status}</span> ${o.delayed ? html`<span class="pill late">Delayed — ETA ${fmtDate(o.eta)}</span>` : ''}</p>
      <p class="tid">Tracking ID <b>${o.trackingId}</b> · <a href="/api/orders/${o.number}/invoice" target="_blank" rel="noopener">Invoice</a> · <a href="#/track?t=${o.trackingId}" target="_blank">Customer view</a></p>
      <h3>Customer</h3><p>${a.name}<br><a href="tel:${o.phone}">${o.phone}</a> · <a href="mailto:${o.email}">${o.email}</a><br>${a.line1}${a.line2 ? ', ' + a.line2 : ''}<br>${a.city}, ${a.state} ${a.pincode}</p>
      ${o.notes ? html`<p><b>Notes:</b> ${o.notes}</p>` : ''}${o.returnReason ? html`<p><b>Return reason:</b> ${o.returnReason}</p>` : ''}${o.measurements ? html`<details class="mtm"><summary>Made to measure</summary>${measureList(o.measurements)}</details>` : ''}
      <h3>Delivery location</h3>${loc ? html`<div id="ordMap" class="map-host"></div><p class="map-links"><a target="_blank" rel="noopener" href="${gmapsLink(loc.lat, loc.lng)}">Open in Google Maps</a> · <a target="_blank" rel="noopener" href="${gmapsDir(state.meta.store, loc)}">Route from the atelier</a> · ${loc.distanceKm ? loc.distanceKm + ' km' : ''}</p><p class="live-line" id="liveLine"></p>` : html`<p class="muted">The customer did not drop a map pin.</p><a target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([a.line1, a.city, a.state, a.pincode].join(', '))}">Search this address on Google Maps</a>`}
      ${refundOpen ? html`<h3>Refund</h3><div class="panel refund"><p>${money(o.total)} to return to the customer (${o.paymentMethod}).</p><div class="field"><label for="rf-r">Reference <small>(UPI / bank / receipt no., optional)</small></label><input id="rf-r" maxlength="80"></div><div class="row-btns">${rzpPay ? html`<button class="btn btn-primary sm" data-action="refund" data-m="razorpay">Refund via Razorpay</button>` : ''}<button class="btn btn-ghost sm" data-action="refund" data-m="manual">Mark refunded (paid manually)</button></div></div>` : ''}
      ${o.payments.length ? html`<h3>Payments</h3><ul class="tl-log">${o.payments.map(p => html`<li><b>${p.kind === 'refund' ? 'Refund' : 'Payment'} · ${p.status}</b> ${money(p.amount)} via ${p.provider}<small>${p.ref || ''} ${p.note || ''} · ${fmtDate(p.createdAt, true)}</small></li>`)}</ul>` : ''}
      <h3>Update</h3><form id="ordForm" class="card-form" novalidate>
        <div class="field"><label for="of-s">Status</label><select id="of-s" name="status"><option value="${o.status}">${LABEL[o.status] || o.status} (current)</option>${o.nextStatuses.map(s => html`<option value="${s.key}">${s.label}</option>`)}</select></div>
        <div class="field"><label for="of-n">Note for the customer <small>(optional)</small></label><input id="of-n" name="note" maxlength="200" placeholder="e.g. Left Udaipur hub"></div>
        <div class="two"><div class="field"><label for="of-d">Delivery person</label><select id="of-d" name="deliveryUserId"><option value="">Unassigned</option>${staff.map(s => html`<option value="${s.id}" ${o.deliveryUserId === s.id ? 'selected' : ''}>${s.name}</option>`)}</select></div>
          <div class="field"><label for="of-e">Estimated delivery</label><input id="of-e" name="eta" type="date" min="${todayIso()}" value="${o.eta || ''}"></div></div>
        <div class="two"><div class="field"><label for="of-c">Courier</label><input id="of-c" name="carrier" value="${o.carrier || ''}" placeholder="Delhivery…"></div><div class="field"><label for="of-t">Courier tracking no.</label><input id="of-t" name="trackingNo" value="${o.trackingNo || ''}"></div></div>
        <label class="opt chk"><input type="checkbox" name="notify" checked> Notify the customer (email, SMS, WhatsApp, in-app)</label>
        <button class="btn btn-primary" type="submit">Save changes</button></form>
      <h3>Items</h3><ul class="oitems">${o.items.map(i => html`<li><div><b>${i.name}</b><small>Size ${i.size} · Qty ${i.qty}</small></div><span>${money(i.price * i.qty)}</span></li>`)}</ul>
      <h3>History</h3><ul class="tl-log">${[...o.events].reverse().map(e => html`<li><b>${e.note}</b><small>${fmtDate(e.createdAt, true)}</small></li>`)}</ul>`);
    $('#ordDetail', el).dataset.editing = '';
    const form = $('#ordForm', el);
    form.addEventListener('input', () => { $('#ordDetail', el).dataset.editing = '1'; });   // don't overwrite what is being typed on refresh
    onSubmit(form, async d => {
      const body = { status: d.status, note: d.note, carrier: d.carrier, trackingNo: d.trackingNo, eta: d.eta, notify: d.notify === 'on', deliveryUserId: d.deliveryUserId === '' ? null : Number(d.deliveryUserId) };
      const r = await patch('/admin/orders/' + o.number, body); toast('Order updated'); $('#ordDetail', el).dataset.editing = ''; await load(true); detail(r.order);
    }, 'Saving…');
    const fallback = why => { const m = $('#ordMap', el); if (m && loc) osmEmbed(m, loc, why); };   // always a real map: OpenStreetMap when Google is off or failing
    if (loc && !mapsOn()) fallback('Showing OpenStreetMap — add a Google Maps key for routes and live courier tracking.');
    else if (loc) mapFor(o).catch(e => { reportClient('maps', 'admin order map failed: ' + (e.message || e)); fallback('Google Maps is unavailable (' + (e.message || 'error') + ') — showing OpenStreetMap.'); });
    if (o.status === 'out_for_delivery') pollLive(o);
  };
  let current = null;
  const mapFor = async o => {
    const host = $('#ordMap', el); if (!host) return;
    current = await routeMap(host, { dest: { lat: o.location.lat, lng: o.location.lng }, store: { lat: state.meta.store.lat, lng: state.meta.store.lng } });
  };
  const pollLive = async o => {
    try {
      const r = await get(`/admin/orders/${o.number}/live`), line = $('#liveLine', el);
      if (line) line.textContent = !r.courier ? 'No delivery person assigned yet.' : !r.sharing ? `${r.courier.name} is assigned — live location is off until they start sharing.` : !r.last ? `${r.courier.name} has started sharing; waiting for the first position…`
        : `${r.courier.name} · ${r.stale ? 'last seen ' : 'updated '}${new Date(r.last.ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}${r.etaMinutes ? ` · ~${r.etaMinutes} min away` : ''}${r.delayed ? ' · running late' : ''}`;
      if (r.last && current && mapsOn()) await current.setCourier({ lat: r.last.lat, lng: r.last.lng });
    } catch { /* ignore */ }
    if (open === o.number) liveTimer = setTimeout(() => pollLive(o), 10000);
  };

  const mapAll = async () => {
    const host = $('#delMap', el); if (!host) return;
    let pts; try { pts = await get('/admin/delivery-map'); } catch { return; }
    if (!mapsOn()) { render(host, html`<p class="muted">${pts.orders.length} active deliveries. Add GOOGLE_MAPS_API_KEY to see them on a map.</p>`); return; }
    try {
      await loadMaps(); const map = await makeMap(host, pts.store, 5), maps = window.google.maps, b = new maps.LatLngBounds();
      await makeMarker(map, pts.store, { title: 'Atelier', color: '#3a1030', glyph: 'K' }); b.extend(pts.store);
      for (const o of pts.orders) {
        const live = o.live && Date.now() - o.live.ts < 600000, pos = { lat: o.lat, lng: o.lng };
        await makeMarker(map, pos, { title: `${o.number} · ${o.city} · ${LABEL[o.status]}`, color: o.delayed ? '#b4261a' : live ? '#1d6b4f' : '#8a1f4f' }); b.extend(pos);
        if (live) { await makeMarker(map, { lat: o.live.lat, lng: o.live.lng }, { title: 'Courier for ' + o.number, color: '#1d6b4f', glyph: '🛵' }); b.extend({ lat: o.live.lat, lng: o.live.lng }); }
      }
      if (pts.orders.length) map.fitBounds(b, 50);
    } catch { render(host, html`<p class="muted">Map unavailable.</p>`); }
  };

  const act = (k, fn) => { actions[k] = async b => { try { await fn(b); } catch (e) { toast(e.message, 'warn'); } }; };
  act('ord-open', async b => { const o = data.orders.find(x => x.number === b.dataset.n) || (await get('/admin/orders/' + b.dataset.n)).order; await detail(o); $('#ordDetail', el).scrollIntoView({ behavior: 'smooth', block: 'start' }); $$('#ordList tr', el).forEach(r => r.classList.toggle('sel', r.dataset.n === o.number)); });
  act('refund', async b => {
    const m = b.dataset.m; if (!confirm(m === 'razorpay' ? 'Refund this order through Razorpay now?' : 'Confirm that you have already refunded this customer?')) return;
    const r = await post(`/admin/orders/${open}/refund`, { method: m, reference: ($('#rf-r', el) || {}).value || '' }); toast(r.order.status === 'refunded' ? 'Refund recorded' : 'Refund started — Razorpay is processing it'); await load(true); detail(r.order);
  });
  act('ord-close', () => { open = null; clearTimeout(liveTimer); $('#ordDetail', el).hidden = true; $$('#ordList tr.sel', el).forEach(r => r.classList.remove('sel')); });
  act('ord-filter', async b => { group = b.dataset.g; page = 1; await load(true); });
  act('ord-page', async b => { page = Math.max(1, page + Number(b.dataset.d)); await load(true); });
  onLeave(() => { stop(); ['ord-open', 'ord-close', 'ord-filter', 'ord-page', 'refund'].forEach(k => delete actions[k]); });

  data = await get(qs()); draw(); tickLoop(); mapAll();
}
