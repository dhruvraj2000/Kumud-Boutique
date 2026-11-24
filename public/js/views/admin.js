import { html, render, get, patch, put, $, $$, state, money, fmtDate, toast, onSubmit } from '../core.js';
import securityTab from './security.js';
import ordersTab from './adminorders.js';
import analyticsTab from './analytics.js';
import trafficTab from './traffic.js';
import enquiriesTab from './enquiries.js';
import { measureList } from './order.js';
import { actions } from '../components.js';
import { go } from '../app.js';

const FLOW = ['placed', 'confirmed', 'preparing', 'shipped', 'out_for_delivery', 'delivered', 'cancelled'];

export default async function admin({ el, params, onLeave }) {
  if (!state.user || !state.user.staff) { render(el, html`<section class="wrap page-narrow empty"><h1>Admins only</h1><p>Sign in with an admin account to manage the store.</p><a class="btn btn-primary" href="#/login?next=/admin">Sign in</a></section>`); return 'Admin'; }
  const isAdmin = state.user.role === 'admin', tab = params[0] || (isAdmin ? 'overview' : 'orders');
  const tabs = isAdmin ? [['overview', 'Overview'], ['orders', 'Orders'], ['reports', 'Reports'], ['traffic', 'Visitors'], ['products', 'Products'], ['inquiries', 'Enquiries'], ['security', 'Security'], ['launch', 'Launch checklist'], ['settings', 'Settings']] : [['orders', 'Orders'], ['reports', 'Reports'], ['traffic', 'Visitors'], ['products', 'Products'], ['inquiries', 'Enquiries']];
  const shell = body => html`<section class="wrap page-head"><p class="eyebrow">Admin</p><h1>Store manager</h1></section><div class="wrap admin"><nav class="acct-nav row">${tabs.map(([k, l]) => html`<a href="#/admin/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`)}</nav>${body}</div>`;

  if (tab === 'security' && isAdmin) {
    await securityTab(el, shell, onLeave);
  } else if (tab === 'orders') {
    await ordersTab(el, shell, onLeave);
  } else if (tab === 'reports') {
    await analyticsTab(el, shell, onLeave);
  } else if (tab === 'traffic') {
    await trafficTab(el, shell, onLeave);
  } else if (tab === 'products') {
    const { products } = await get('/admin/products');
    render(el, shell(html`<div class="table-wrap"><table class="tbl wide"><thead><tr><th>Product</th><th>Price (₹)</th><th>Stock by size</th><th>Live</th><th></th></tr></thead><tbody>${products.map(p => html`<tr data-id="${p.id}"><td>${p.name}</td><td><input name="price" type="number" min="1" value="${p.price}"></td><td><div class="stock-cells">${Object.entries(p.stock).map(([k, n]) => html`<label><small>${k}</small><input class="n" name="s_${k}" data-size="${k}" type="number" min="0" value="${n}"></label>`)}</div></td><td><input type="checkbox" name="active" ${p.active ? 'checked' : ''} aria-label="Visible in store"></td><td><button class="btn btn-ghost sm" data-action="adm-prod" data-id="${p.id}">Save</button></td></tr>`)}</tbody></table></div>`));
    actions['adm-prod'] = async b => {
      const row = b.closest('tr'), v = n => row.querySelector(`[name=${n}]`), stock = {}; $$('[data-size]', row).forEach(i => { stock[i.dataset.size] = +i.value; });
      try { await patch('/admin/products/' + b.dataset.id, { price: +v('price').value, stock, active: v('active').checked }); toast('Product updated'); } catch (e) { toast(e.message, 'warn'); }
    };
    onLeave(() => delete actions['adm-prod']);
  } else if (tab === 'inquiries') {
    await enquiriesTab(el, shell, onLeave);
  } else if (tab === 'launch') {
    const { items } = await get('/admin/launch'), left = items.filter(i => !i.done).length;
    render(el, shell(html`<div class="panel"><h2>Launch checklist</h2><p class="muted">${left ? left + ' of ' + items.length + ' items still pending.' : 'Everything is ready to go live.'}</p>
      <ul class="chk-list">${items.map(i => html`<li><span class="st ${i.done ? 'ok' : 'todo'}">${i.done ? 'Done' : 'Pending'}</span><div><b>${i.label}</b><small>${i.hint}</small></div></li>`)}</ul></div>`));
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
