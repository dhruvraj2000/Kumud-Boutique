import { html, render, get, patch, put, $, $$, state, money, fmtDate, toast, onSubmit } from '../core.js';
import { measureList } from './order.js';
import { actions } from '../components.js';
import { go } from '../app.js';

const FLOW = ['placed', 'confirmed', 'preparing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'];

export default async function admin({ el, params, onLeave }) {
  if (!state.user || state.user.role !== 'admin') { render(el, html`<section class="wrap page-narrow empty"><h1>Admins only</h1><p>Sign in with an admin account to manage the store.</p><a class="btn btn-primary" href="#/login?next=/admin">Sign in</a></section>`); return 'Admin'; }
  const tab = params[0] || 'overview';
  const tabs = [['overview', 'Overview'], ['orders', 'Orders'], ['products', 'Products'], ['inquiries', 'Enquiries'], ['settings', 'Settings']];
  const shell = body => html`<section class="wrap page-head"><p class="eyebrow">Admin</p><h1>Store manager</h1></section><div class="wrap admin"><nav class="acct-nav row">${tabs.map(([k, l]) => html`<a href="#/admin/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`)}</nav>${body}</div>`;

  if (tab === 'orders') {
    const { orders } = await get('/admin/orders');
    render(el, shell(html`<div class="table-wrap"><table class="tbl wide"><thead><tr><th>Order</th><th>Customer</th><th>Total</th><th>Payment</th><th>Status</th><th>Courier / tracking</th><th></th></tr></thead><tbody>${orders.map(o => html`<tr data-n="${o.number}">
      <td><a href="#/orders/${o.number}">${o.number}</a><small>${fmtDate(o.createdAt)}</small>${o.measurements ? html`<details class="mtm"><summary>Made to measure</summary>${measureList(o.measurements)}</details>` : ''}</td><td>${o.address.name}<small>${o.email}</small></td><td>${money(o.total)}</td><td>${o.paymentMethod}<small>${o.paymentStatus}</small></td>
      <td><select name="status" ${['delivered', 'cancelled'].includes(o.status) ? 'disabled' : ''}>${FLOW.map(s => html`<option value="${s}" ${s === o.status ? 'selected' : ''}>${s.replace(/_/g, ' ')}</option>`)}</select></td>
      <td><input name="carrier" placeholder="Courier" value="${o.carrier}"><input name="trackingNo" placeholder="Tracking no." value="${o.trackingNo}"></td>
      <td><button class="btn btn-ghost sm" data-action="adm-save" data-n="${o.number}" ${['delivered', 'cancelled'].includes(o.status) ? 'disabled' : ''}>Save</button></td></tr>`)}</tbody></table></div>${orders.length ? '' : html`<p class="muted">No orders yet.</p>`}`));
    actions['adm-save'] = async b => {
      const row = b.closest('tr'), g = n => row.querySelector(`[name=${n}]`).value;
      try { await patch('/admin/orders/' + b.dataset.n, { status: g('status'), carrier: g('carrier'), trackingNo: g('trackingNo') }); toast('Order updated'); window.dispatchEvent(new HashChangeEvent('hashchange')); } catch (e) { toast(e.message, 'warn'); }
    };
    onLeave(() => delete actions['adm-save']);
  } else if (tab === 'products') {
    const { products } = await get('/admin/products');
    render(el, shell(html`<div class="table-wrap"><table class="tbl wide"><thead><tr><th>Product</th><th>Price (₹)</th><th>Stock by size</th><th>Live</th><th></th></tr></thead><tbody>${products.map(p => html`<tr data-id="${p.id}"><td>${p.name}</td><td><input name="price" type="number" min="1" value="${p.price}"></td><td><div class="stock-cells">${Object.entries(p.stock).map(([k, n]) => html`<label><small>${k}</small><input class="n" name="s_${k}" data-size="${k}" type="number" min="0" value="${n}"></label>`)}</div></td><td><input type="checkbox" name="active" ${p.active ? 'checked' : ''} aria-label="Visible in store"></td><td><button class="btn btn-ghost sm" data-action="adm-prod" data-id="${p.id}">Save</button></td></tr>`)}</tbody></table></div>`));
    actions['adm-prod'] = async b => {
      const row = b.closest('tr'), v = n => row.querySelector(`[name=${n}]`), stock = {}; $$('[data-size]', row).forEach(i => { stock[i.dataset.size] = +i.value; });
      try { await patch('/admin/products/' + b.dataset.id, { price: +v('price').value, stock, active: v('active').checked }); toast('Product updated'); } catch (e) { toast(e.message, 'warn'); }
    };
    onLeave(() => delete actions['adm-prod']);
  } else if (tab === 'inquiries') {
    const { inquiries } = await get('/admin/inquiries');
    render(el, shell(inquiries.length ? html`<div class="inq-list">${inquiries.map(q => html`<article class="panel"><header class="p-head"><b>${q.name}</b><small>${fmtDate(q.created_at, true)}</small></header><p><a href="mailto:${q.email}">${q.email}</a> ${q.phone ? '· ' + q.phone : ''}</p><p><b>${q.topic}</b>${q.preferred_date ? ' · prefers ' + q.preferred_date : ''}</p><p>${q.message}</p></article>`)}</div>` : html`<p class="muted">No enquiries yet.</p>`));
  } else if (tab === 'settings') {
    const st = await get('/admin/settings');
    render(el, shell(html`<div class="panel settings"><h2>Store settings</h2>
      <form id="setForm" novalidate>
        <div class="field"><label for="wa">WhatsApp number</label><input id="wa" name="whatsapp" inputmode="tel" placeholder="10-digit mobile, e.g. 98765 43210" value="${st.whatsapp ? st.whatsapp.replace(/^91/, '') : ''}"><small class="hint">Shows the chat button and “Ask on WhatsApp” across the store. Leave empty to hide them.</small></div>
        <div class="field"><label for="tp">Twinning pair discount (%)</label><input id="tp" name="twinningPercent" type="number" min="0" max="50" value="${st.twinningPercent}"><small class="hint">Applied when a set and its matching kids’ set are bought together. 0 turns it off.</small></div>
        <button class="btn btn-primary" type="submit">Save settings</button>
      </form></div>`));
    onSubmit($('#setForm', el), async d => {
      const r = await put('/admin/settings', { whatsapp: d.whatsapp, twinningPercent: Number(d.twinningPercent) });
      if (state.meta) { state.meta.whatsapp = r.whatsapp; state.meta.twinningPercent = r.twinningPercent; }
      window.dispatchEvent(new Event('kb:meta')); toast('Settings saved');
    }, 'Saving…');
  } else {
    const s = await get('/admin/stats');
    render(el, shell(html`<div class="stats">${[['Revenue', money(s.revenue)], ['Orders', s.orders], ['Open orders', s.open], ['Customers', s.customers], ['Enquiries', s.inquiries]].map(([l, v]) => html`<div class="stat"><small>${l}</small><b>${v}</b></div>`)}</div>
      <div class="panel"><h2>Low or sold-out stock</h2>${s.lowStock.length ? html`<ul class="oitems">${s.lowStock.map(p => html`<li><div><b>${p.name}</b><small>${Object.entries(p.stock).map(([k, n]) => `${k}: ${n}`).join(' · ')}</small></div></li>`)}</ul>` : html`<p class="muted">Everything is well stocked.</p>`}</div>`));
  }
  return 'Admin';
}
