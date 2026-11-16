// Kumud Boutique admin portal. Every dynamic value goes through the escaping `html` tag from core.js.
import { html, render, money } from '/js/core.js';

const app = document.getElementById('app');
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUSES = ['pending', 'confirmed', 'completed', 'cancelled'];
let csrf = '', admin = null;

/* ---------- helpers ---------- */
const fd = d => (d ? new Date(String(d).slice(0, 10) + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : '');
const fdt = d => (d ? new Date(String(d).replace(' ', 'T') + 'Z').toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const badge = s => html`<span class="badge ${s}">${s}</span>`;
const when = b => (b.kind === 'appointment' ? html`${fd(b.start_date)} · ${b.slot_time}` : html`${fd(b.start_date)} → ${fd(b.end_date)}`);
function toast(msg, bad) {
  const t = document.createElement('div'); t.className = 'toast' + (bad ? ' bad' : ''); t.textContent = msg;
  document.getElementById('toasts').append(t); setTimeout(() => t.remove(), 3500);
}
class Unauth extends Error {}
async function api(method, url, body) {
  let res;
  try { res = await fetch('/api/portal' + url, { method, headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }, credentials: 'same-origin', body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error('You appear to be offline.'); }
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 && !url.startsWith('/auth/login')) { admin = null; location.hash = '#/login'; throw new Unauth(); }
  if (!res.ok) throw new Error(j.error || 'Something went wrong.');
  return j;
}
const form = f => Object.fromEntries(new FormData(f).entries());
const nums = (o, keys) => { for (const k of keys) if (o[k] !== undefined && o[k] !== '') o[k] = Number(o[k]); else if (o[k] === '') delete o[k]; return o; };
const qs = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v !== '' && v != null)).toString();
const optsOf = (list, sel) => list.map(i => html`<option value="${i.id}" ${String(i.id) === String(sel) ? 'selected' : ''}>${i.name}</option>`);

/* ---------- shell ---------- */
const NAV = [['#/', 'Dashboard'], ['#/bookings', 'Bookings'], ['#/customers', 'Customers'], ['#/rates', 'Rates'], ['#/items', 'Items'], ['#/slots', 'Slots & blocked dates']];
function shell(content, path) {
  render(app, html`<div class="shell"><nav class="side"><h1>Kumud Boutique</h1>
    ${NAV.map(([h, l]) => html`<a href="${h}" class="${path === h ? 'on' : ''}">${l}</a>`)}
    <div class="who">${admin.name}<br>${admin.email}</div><button class="ghost" data-act="logout">Sign out</button></nav>
    <main>${content}</main></div>`);
}

/* ---------- views ---------- */
function loginView(msg = '') {
  render(app, html`<div class="login card"><h2>Admin sign in</h2>
    <form data-form="login"><label>Email<input name="email" type="email" autocomplete="username" required></label><br>
    <label>Password<input name="password" type="password" autocomplete="current-password" required></label>
    <p class="err" id="lerr">${msg}</p><button>Sign in</button></form></div>`);
}

async function dashboardView() {
  const d = await api('GET', '/dashboard');
  const rows = list => (list.length ? html`<div class="tablewrap"><table><tr><th>Ref</th><th>Customer</th><th>What</th><th>When</th><th>Status</th></tr>
    ${list.map(b => html`<tr class="click" data-go="#/bookings/${b.id}"><td>${b.ref}</td><td>${b.customer_name}</td><td>${b.item_name}</td><td>${when(b)}</td><td>${badge(b.status)}</td></tr>`)}</table></div>` : html`<p class="muted">Nothing here.</p>`);
  shell(html`<h2>Dashboard</h2><div class="cards">
    <div class="card stat"><b>${d.pending}</b><span>Pending bookings</span></div>
    <div class="card stat"><b>${money(d.revenue.month)}</b><span>Booked value this month</span></div>
    <div class="card stat"><b>${money(d.revenue.total)}</b><span>Booked value, all time</span></div></div>
    <div class="card"><h3>Today</h3>${rows(d.today)}</div><div class="card"><h3>Upcoming</h3>${rows(d.upcoming)}</div>`, '#/');
}

async function bookingsView(hashQuery) {
  const p = Object.fromEntries(new URLSearchParams(hashQuery));
  const r = await api('GET', '/bookings?' + qs(p));
  const pg = Number(p.page || 1), pages = Math.max(1, Math.ceil(r.total / r.pageSize));
  const link = n => '#/bookings?' + qs({ ...p, page: n });
  shell(html`<h2>Bookings</h2>
    <form class="row" data-form="bookfilter">
      <label>Search<input name="q" value="${p.q || ''}" placeholder="Name, phone, ref"></label>
      <label>Status<select name="status"><option value="">All</option>${STATUSES.map(s => html`<option ${p.status === s ? 'selected' : ''}>${s}</option>`)}</select></label>
      <label>Type<select name="kind"><option value="">All</option><option ${p.kind === 'rental' ? 'selected' : ''}>rental</option><option ${p.kind === 'appointment' ? 'selected' : ''}>appointment</option></select></label>
      <label>From<input type="date" name="from" value="${p.from || ''}"></label><label>To<input type="date" name="to" value="${p.to || ''}"></label>
      <button>Filter</button><a class="btn ghost" href="#/bookings/new">+ New booking</a></form>
    <div class="card tablewrap"><table><tr><th>Ref</th><th>Customer</th><th>What</th><th>When</th><th>Total</th><th>Status</th></tr>
    ${r.bookings.map(b => html`<tr class="click" data-go="#/bookings/${b.id}"><td>${b.ref}</td><td>${b.customer_name}<br><span class="muted">${b.customer_phone}</span></td><td>${b.item_name}</td><td>${when(b)}</td><td>${money(b.total_price)}</td><td>${badge(b.status)}</td></tr>`)}
    </table>${r.bookings.length ? '' : html`<p class="muted">No bookings found.</p>`}
    <div class="pager">${pg > 1 ? html`<a href="${link(pg - 1)}">← Prev</a>` : ''}<span>Page ${pg} of ${pages} · ${r.total} total</span>${pg < pages ? html`<a href="${link(pg + 1)}">Next →</a>` : ''}</div></div>`, '#/bookings');
}

async function bookingDetailView(id) {
  const { booking: b, events } = await api('GET', '/bookings/' + id);
  shell(html`<p><a href="#/bookings">← All bookings</a></p><h2>${b.ref} ${badge(b.status)}</h2>
    <div class="card"><p><b>${b.item_name}</b> (${b.kind}) · ${when(b)} · <b>${money(b.total_price)}</b></p>
      <p>Customer: <a href="#/customers/${b.customer_id}">${b.customer_name}</a> · ${b.customer_phone} · ${b.customer_email || 'no email'}</p>
      <p class="muted">Received ${fdt(b.created_at)}</p>
      <h3>Price breakdown</h3><div class="tablewrap"><table>${b.price_breakdown.map(d => html`<tr><td>${fd(d.date)}</td><td>${d.source}${d.label ? ' · ' + d.label : ''}</td><td>${money(d.price)}</td></tr>`)}</table></div></div>
    <div class="card"><h3>Change status</h3><form class="row" data-form="status" data-id="${b.id}">
      <label>Status<select name="status">${STATUSES.map(s => html`<option ${s === b.status ? 'selected' : ''}>${s}</option>`)}</select></label>
      <label style="flex:1">Note (optional)<input name="note" maxlength="500"></label><button>Update</button></form>
      <h3>Notes</h3><form data-form="bnotes" data-id="${b.id}"><textarea name="notes">${b.notes || ''}</textarea><button class="ghost">Save notes</button></form></div>
    <div class="card"><h3>History</h3><ul class="hist">${events.map(e => html`<li>${badge(e.status)} ${fdt(e.at)} ${e.admin_name ? '· ' + e.admin_name : '· customer'}${e.note ? ' — ' + e.note : ''}</li>`)}</ul></div>`, '#/bookings');
}

async function newBookingView() {
  const { items } = await api('GET', '/items');
  const active = items.filter(i => i.active);
  shell(html`<p><a href="#/bookings">← All bookings</a></p><h2>New booking</h2><div class="card">
    <form data-form="newbooking"><div class="row">
      <label>Item<select name="itemId" id="nb-item">${active.map(i => html`<option value="${i.id}" data-kind="${i.kind}">${i.name} (${i.kind})</option>`)}</select></label>
      <label>Date / start<input type="date" name="from" id="nb-from" required></label>
      <label id="nb-to-l">End<input type="date" name="to" id="nb-to"></label>
      <label id="nb-slot-l" class="hidden">Time slot<select name="slotTime" id="nb-slot"></select></label></div>
      <div class="row"><label>Name<input name="name" required></label><label>Phone<input name="phone" required></label><label>Email<input name="email" type="email"></label>
      <label>Status<select name="status"><option>confirmed</option><option>pending</option></select></label></div>
      <label>Notes<textarea name="notes"></textarea></label><p class="muted" id="nb-quote"></p><p class="err" id="nb-err"></p><button>Create booking</button></form></div>`, '#/bookings');
  refreshNewBooking();
}
async function refreshNewBooking() {
  const sel = document.getElementById('nb-item'); if (!sel) return;
  const appt = sel.selectedOptions[0]?.dataset.kind === 'appointment';
  document.getElementById('nb-to-l').classList.toggle('hidden', appt);
  document.getElementById('nb-slot-l').classList.toggle('hidden', !appt);
  const from = document.getElementById('nb-from').value, to = document.getElementById('nb-to').value, q = document.getElementById('nb-quote');
  q.textContent = '';
  try {
    if (appt && from) {
      const r = await (await fetch(`/api/slots?item=${sel.value}&date=${from}`)).json();
      const slotSel = document.getElementById('nb-slot'); slotSel.replaceChildren();
      for (const s of r.slots || []) { const o = new Option(`${s.time} (${s.left} left)`, s.time); o.disabled = !s.left; slotSel.add(o); }
      if (!slotSel.options.length) slotSel.add(new Option('No slots', ''));
    }
    if (from && (appt || to)) {
      const r = await (await fetch(`/api/rates/quote?item=${sel.value}&from=${from}&to=${to}`)).json();
      q.textContent = r.total != null ? 'Price: ' + money(r.total) : r.error || '';
    }
  } catch { /* ignore preview errors */ }
}

async function customersView(hashQuery) {
  const p = Object.fromEntries(new URLSearchParams(hashQuery));
  const r = await api('GET', '/customers?' + qs(p));
  shell(html`<h2>Customers</h2><form class="row" data-form="custfilter"><label>Search<input name="q" value="${p.q || ''}" placeholder="Name, phone, email"></label><button>Search</button></form>
    <div class="card tablewrap"><table><tr><th>Name</th><th>Phone</th><th>Email</th><th>Bookings</th></tr>
    ${r.customers.map(c => html`<tr class="click" data-go="#/customers/${c.id}"><td>${c.name}</td><td>${c.phone}</td><td>${c.email || ''}</td><td>${c.bookings}</td></tr>`)}</table>
    ${r.customers.length ? '' : html`<p class="muted">No customers found.</p>`}<p class="muted">${r.total} total</p></div>`, '#/customers');
}
async function customerDetailView(id) {
  const { customer: c, bookings } = await api('GET', '/customers/' + id);
  shell(html`<p><a href="#/customers">← All customers</a></p><h2>${c.name}</h2><div class="card">
    <form data-form="customer" data-id="${c.id}"><div class="row"><label>Name<input name="name" value="${c.name}" required></label><label>Email<input name="email" value="${c.email || ''}"></label><label>Phone<input value="${c.phone}" disabled></label></div>
    <label>Notes<textarea name="notes">${c.notes || ''}</textarea></label><button>Save</button></form></div>
    <div class="card tablewrap"><h3>Bookings</h3><table><tr><th>Ref</th><th>What</th><th>When</th><th>Total</th><th>Status</th></tr>
    ${bookings.map(b => html`<tr class="click" data-go="#/bookings/${b.id}"><td>${b.ref}</td><td>${b.item_name}</td><td>${when(b)}</td><td>${money(b.total_price)}</td><td>${badge(b.status)}</td></tr>`)}</table></div>`, '#/customers');
}

let rateState = { item: '', month: new Date().toISOString().slice(0, 7) };
async function ratesView() {
  const { items } = await api('GET', '/items');
  if (!items.length) return shell(html`<h2>Rates</h2><div class="card"><p>Add an item first on the <a href="#/items">Items</a> page.</p></div>`, '#/rates');
  if (!items.some(i => String(i.id) === String(rateState.item))) rateState.item = items[0].id;
  const [cal, rl] = await Promise.all([api('GET', `/rates/calendar?item=${rateState.item}&month=${rateState.month}`), api('GET', '/rules?item=' + rateState.item)]);
  const [y, m] = rateState.month.split('-').map(Number), lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const ruleText = r => ({ weekday: `Every ${WD[r.weekday]}`, period: `${fd(r.start_date)} – ${fd(r.end_date)}`, date: fd(r.start_date) }[r.type]);
  const itemName = id => (id ? items.find(i => i.id === id)?.name || '#' + id : 'All items');
  shell(html`<h2>Rate calendar</h2>
    <div class="card"><div class="row"><label>Item<select id="rate-item">${optsOf(items, rateState.item)}</select></label>
      <button class="ghost" data-act="month" data-d="-1">←</button><b>${label}</b><button class="ghost" data-act="month" data-d="1">→</button>
      <span class="muted">Base price: ${money(cal.item.base_price)}</span></div>
      <div class="legend"><span class="weekday">Weekday rule</span><span class="period">Period rule</span><span class="date">Single-date rule</span></div><br>
      <div class="cal">${WD.map(w => html`<div class="h">${w}</div>`)}${Array.from({ length: lead }, () => html`<div></div>`)}
      ${cal.days.map(d => html`<div class="d ${d.source}" title="${d.label || d.source}">${Number(d.date.slice(8))}<b>${money(d.price)}</b>${d.label ? html`<span class="muted">${d.label}</span>` : ''}</div>`)}</div></div>
    <div class="card"><h3>Add a price rule</h3><p class="muted">Priority order: single date → period → weekday → base price. A higher priority number wins between rules of the same type.</p>
      <form class="row" data-form="rule"><label>Applies to<select name="item_id"><option value="">All items</option>${optsOf(items, rateState.item)}</select></label>
      <label>Type<select name="type" id="rule-type"><option value="weekday">Weekday</option><option value="period">Period</option><option value="date">Single date</option></select></label>
      <label data-for="weekday">Weekday<select name="weekday">${WD.map((w, i) => html`<option value="${i}">${w}</option>`)}</select></label>
      <label data-for="period date" class="hidden">Start / date<input type="date" name="start_date"></label><label data-for="period" class="hidden">End<input type="date" name="end_date"></label>
      <label>Price ₹<input type="number" name="price" min="0" step="1" required style="width:110px"></label><label>Label<input name="label" placeholder="e.g. Wedding season"></label>
      <label>Priority<input type="number" name="priority" value="0" style="width:80px"></label><button>Add rule</button></form></div>
    <div class="card tablewrap"><h3>Rules</h3><table><tr><th>Item</th><th>Type</th><th>When</th><th>Price</th><th>Label</th><th>Priority</th><th></th></tr>
      ${rl.rules.map(r => html`<tr><td>${itemName(r.item_id)}</td><td>${r.type}</td><td>${ruleText(r)}</td><td>${money(r.price)}</td><td>${r.label || ''}</td><td>${r.priority}</td><td><button class="danger" data-act="delrule" data-id="${r.id}">Delete</button></td></tr>`)}</table>
      ${rl.rules.length ? '' : html`<p class="muted">No rules yet — every day uses the base price.</p>`}</div>`, '#/rates');
  syncRuleType();
}
function syncRuleType() {
  const t = document.getElementById('rule-type'); if (!t) return;
  document.querySelectorAll('[data-for]').forEach(el => el.classList.toggle('hidden', !el.dataset.for.split(' ').includes(t.value)));
}

async function itemsView() {
  const { items } = await api('GET', '/items');
  shell(html`<h2>Items</h2><div class="card"><h3>Add item</h3><form class="row" data-form="item">
    <label>Name<input name="name" required></label><label>Type<select name="kind"><option>rental</option><option>appointment</option></select></label>
    <label>Base price ₹<input type="number" name="base_price" min="0" required style="width:110px"></label><label>Deposit ₹<input type="number" name="deposit" min="0" value="0" style="width:110px"></label><button>Add</button></form></div>
    <div class="card tablewrap"><table><tr><th>Name</th><th>Type</th><th>Base price</th><th>Deposit</th><th>Active</th><th></th></tr>
    ${items.map(i => html`<tr><td>${i.name}</td><td>${i.kind}</td><td>${money(i.base_price)}</td><td>${money(i.deposit)}</td><td>${i.active ? 'Yes' : 'No'}</td>
    <td><button class="ghost" data-act="edititem" data-id="${i.id}" data-name="${i.name}" data-price="${i.base_price}">Edit price</button>
    <button class="ghost" data-act="toggleitem" data-id="${i.id}" data-active="${i.active ? 0 : 1}">${i.active ? 'Deactivate' : 'Activate'}</button></td></tr>`)}</table></div>`, '#/items');
}

async function slotsView() {
  const [{ slots }, { dates }] = await Promise.all([api('GET', '/slots'), api('GET', '/blocked-dates')]);
  shell(html`<h2>Appointment slots</h2><div class="card"><form class="row" data-form="slot">
    <label>Weekday<select name="weekday">${WD.map((w, i) => html`<option value="${i}">${w}</option>`)}</select></label>
    <label>Start<input type="time" name="start_time" required></label><label>End<input type="time" name="end_time" required></label>
    <label>Capacity<input type="number" name="capacity" min="1" value="1" style="width:80px"></label><button>Add slot</button></form>
    <table>${slots.map(s => html`<tr><td>${WD[s.weekday]}</td><td>${s.start_time} – ${s.end_time}</td><td>capacity ${s.capacity}</td><td><button class="danger" data-act="delslot" data-id="${s.id}">Delete</button></td></tr>`)}</table></div>
    <h2>Blocked dates</h2><div class="card"><form class="row" data-form="blocked"><label>Date<input type="date" name="date" required></label><label>Reason<input name="reason"></label><button>Block date</button></form>
    <table>${dates.map(d => html`<tr><td>${fd(d.date)}</td><td>${d.reason || ''}</td><td><button class="danger" data-act="delblocked" data-date="${String(d.date).slice(0, 10)}">Unblock</button></td></tr>`)}</table></div>`, '#/slots');
}

/* ---------- router ---------- */
async function route() {
  if (!admin) {
    try { const me = await api('GET', '/auth/me'); admin = me.admin; csrf = me.csrf; } catch (e) { if (!(e instanceof Unauth)) { loginView(e.message); return; } }
    if (!admin) { if (location.hash !== '#/login') location.hash = '#/login'; return loginView(); }
  }
  const [path, query = ''] = (location.hash || '#/').split('?');
  try {
    if (path === '#/login') { location.hash = '#/'; return; }
    if (path === '#/' || path === '') return await dashboardView();
    if (path === '#/bookings') return await bookingsView(query);
    if (path === '#/bookings/new') return await newBookingView();
    let m;
    if ((m = /^#\/bookings\/(\d+)$/.exec(path))) return await bookingDetailView(m[1]);
    if (path === '#/customers') return await customersView(query);
    if ((m = /^#\/customers\/(\d+)$/.exec(path))) return await customerDetailView(m[1]);
    if (path === '#/rates') return await ratesView();
    if (path === '#/items') return await itemsView();
    if (path === '#/slots') return await slotsView();
    location.hash = '#/';
  } catch (e) { if (!(e instanceof Unauth)) { shell(html`<div class="card"><p class="err">${e.message}</p></div>`, ''); } }
}

/* ---------- events ---------- */
const act = async (fn, okMsg) => { try { await fn(); if (okMsg) toast(okMsg); await route(); } catch (e) { if (!(e instanceof Unauth)) toast(e.message, true); } };

document.addEventListener('submit', async ev => {
  const f = ev.target.closest('form[data-form]'); if (!f) return;
  ev.preventDefault();
  const name = f.dataset.form, v = form(f), id = f.dataset.id;
  if (name === 'login') {
    try { const r = await api('POST', '/auth/login', { email: v.email, password: v.password }); admin = r.admin; csrf = r.csrf; location.hash = '#/'; await route(); }
    catch (e) { const el = document.getElementById('lerr'); if (el) el.textContent = e.message; }
  } else if (name === 'bookfilter') location.hash = '#/bookings?' + qs(v);
  else if (name === 'custfilter') location.hash = '#/customers?' + qs(v);
  else if (name === 'status') act(() => api('PATCH', '/bookings/' + id, { status: v.status, note: v.note }), 'Status updated');
  else if (name === 'bnotes') act(() => api('PATCH', '/bookings/' + id, { notes: v.notes }), 'Notes saved');
  else if (name === 'customer') act(() => api('PATCH', '/customers/' + id, { name: v.name, email: v.email, notes: v.notes }), 'Customer saved');
  else if (name === 'newbooking') {
    try { const r = await api('POST', '/bookings', nums(v, ['itemId'])); toast('Booking ' + r.ref + ' created'); location.hash = '#/bookings/' + r.id; }
    catch (e) { const el = document.getElementById('nb-err'); if (el) el.textContent = e.message; }
  } else if (name === 'rule') {
    const body = nums(v, ['item_id', 'weekday', 'price', 'priority']);
    act(() => api('POST', '/rules', body), 'Rule added');
  } else if (name === 'item') act(() => api('POST', '/items', nums(v, ['base_price', 'deposit'])), 'Item added');
  else if (name === 'slot') act(() => api('POST', '/slots', nums(v, ['weekday', 'capacity'])), 'Slot added');
  else if (name === 'blocked') act(() => api('POST', '/blocked-dates', v), 'Date blocked');
});

document.addEventListener('click', async ev => {
  const go = ev.target.closest('[data-go]'); if (go && !ev.target.closest('a,button')) { location.hash = go.dataset.go; return; }
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, d = b.dataset;
  if (a === 'logout') { try { await api('POST', '/auth/logout'); } catch { /* ignore */ } admin = null; csrf = ''; location.hash = '#/login'; await route(); }
  else if (a === 'month') { const [y, m] = rateState.month.split('-').map(Number), n = new Date(Date.UTC(y, m - 1 + Number(d.d), 1)); rateState.month = n.toISOString().slice(0, 7); route(); }
  else if (a === 'delrule') { if (confirm('Delete this rule?')) act(() => api('DELETE', '/rules/' + d.id), 'Rule deleted'); }
  else if (a === 'delslot') act(() => api('DELETE', '/slots/' + d.id), 'Slot deleted');
  else if (a === 'delblocked') act(() => api('DELETE', '/blocked-dates/' + d.date), 'Date unblocked');
  else if (a === 'toggleitem') act(() => api('PATCH', '/items/' + d.id, { active: Number(d.active) }), 'Item updated');
  else if (a === 'edititem') { const p = prompt('New base price (₹) for ' + d.name, d.price); if (p !== null) act(() => api('PATCH', '/items/' + d.id, { base_price: Number(p) }), 'Price updated'); }
});

document.addEventListener('change', ev => {
  if (ev.target.id === 'rate-item') { rateState.item = ev.target.value; route(); }
  if (ev.target.id === 'rule-type') syncRuleType();
  if (['nb-item', 'nb-from', 'nb-to'].includes(ev.target.id)) refreshNewBooking();
});

window.addEventListener('hashchange', route);
route();
