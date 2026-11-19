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
const NAV = [['#/', 'Dashboard'], ['#/bookings', 'Bookings'], ['#/customers', 'Customers'], ['#/rates', 'Rates'], ['#/items', 'Items'], ['#/slots', 'Slots & blocked dates'], ['#/festivals', 'Festival sales'], ['#/coupons', 'Coupons']];
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

/* ---------- festivals & coupons ---------- */
const fw = s => (s ? new Date(String(s).replace(' ', 'T').slice(0, 16) + 'Z').toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) : '');
const dtl = s => (s ? String(s).slice(0, 16).replace(' ', 'T') : '');
const ORDER = { live: 0, scheduled: 1, off: 2, ended: 3 };   // live first, then soonest-upcoming, then the rest
const THEMES = ['gold', 'diwali', 'holi', 'navratri', 'christmas', 'rose', 'midnight'];
const sbadge = s => html`<span class="badge st-${s}">${{ live: 'Live now', scheduled: 'Scheduled', ended: 'Ended', off: 'Off' }[s]}</span>`;
const themeOpts = sel => THEMES.map(t => html`<option ${t === sel ? 'selected' : ''}>${t}</option>`);
const campFields = (c = {}) => html`
  <label>Name<input name="name" required maxlength="120" value="${c.name || ''}" placeholder="e.g. Diwali Sale 2026"></label>
  <label>Starts (IST)<input type="datetime-local" name="starts_at" required value="${dtl(c.starts_at)}"></label>
  <label>Ends (IST)<input type="datetime-local" name="ends_at" required value="${dtl(c.ends_at)}"></label>
  <label>Default discount %<input type="number" name="discount_pct" min="0" max="100" required value="${c.discount_pct ?? 20}" style="width:90px"></label>
  <label>Minimum %<input type="number" name="min_pct" min="0" max="100" value="${c.min_pct ?? 0}" style="width:80px"></label>
  <label>Maximum % <span class="muted">(profit guard)</span><input type="number" name="max_pct" min="0" max="100" required value="${c.max_pct ?? 30}" style="width:90px"></label>
  <label>Theme<select name="theme">${themeOpts(c.theme)}</select></label>
  <label>Tagline<input name="tagline" maxlength="200" value="${c.tagline || ''}" style="min-width:240px"></label>
  <label>Festival date<input type="date" name="festival_date" value="${c.festival_date ? String(c.festival_date).slice(0, 10) : ''}"></label>
  <label>Pop-up<select name="show_popup"><option value="1" ${c.show_popup === 0 ? '' : 'selected'}>Show</option><option value="0" ${c.show_popup === 0 ? 'selected' : ''}>Hide</option></select></label>
  <label>Status<select name="active"><option value="1" ${c.active === 0 ? '' : 'selected'}>Active</option><option value="0" ${c.active === 0 ? 'selected' : ''}>Deactivated</option></select></label>`;

async function festivalsView() {
  const d = await api('GET', '/festivals');
  const live = d.campaigns.filter(c => c.status === 'live'), upcoming = d.campaigns.filter(c => c.status === 'scheduled').sort((a, b) => String(a.starts_at).localeCompare(String(b.starts_at)));
  shell(html`<h2>Festival sales</h2>
    <div class="cards">
      <div class="card stat"><b>${live.length}</b><span>Live now${live.length ? ': ' + live.map(c => c.name).join(', ') : ''}</span></div>
      <div class="card stat"><b>${upcoming.length}</b><span>Scheduled${upcoming[0] ? ' · next: ' + upcoming[0].name + ' (' + fw(upcoming[0].starts_at) + ')' : ''}</span></div>
      <div class="card stat"><b>${d.cap}%</b><span>Shop-wide maximum discount</span></div></div>
    ${d.missing.length ? html`<div class="card warnbox"><h3>Dates needed</h3><p class="muted">These festivals move every year, so I will not guess. Enter the date and the sale is scheduled automatically.</p>
      ${d.missing.map(m => html`<form class="row" data-form="fdate"><input type="hidden" name="template_id" value="${m.template_id}"><input type="hidden" name="year" value="${m.year}"><b style="min-width:190px">${m.name} ${m.year}</b><label>Festival date<input type="date" name="date" min="${m.year}-01-01" max="${m.year}-12-31" required></label><button>Save date</button></form>`)}</div>` : ''}
    <div class="card"><h3>Profit protection</h3><p class="muted">No campaign, rule or coupon combination can ever take more than a campaign's <b>maximum %</b> off a bag, and no campaign can exceed this shop-wide cap.</p>
      <form class="row" data-form="fcap"><label>Shop-wide maximum discount %<input type="number" name="max_discount_cap" min="5" max="90" required value="${d.cap}" style="width:110px"></label><button>Save cap</button></form></div>
    <div class="card"><details><summary><b>＋ New campaign</b></summary><br><form class="row" data-form="campaign">${campFields()}<button>Create campaign</button></form></details></div>
    <div class="card tablewrap"><div class="row" style="justify-content:space-between;margin:0"><h3 style="margin:0">Campaigns</h3><button class="ghost" data-act="fgenerate">Schedule upcoming years</button></div>
      <table><tr><th>Name</th><th>Runs</th><th>Status</th><th>Discount</th><th></th></tr>
      ${[...d.campaigns].sort((a, b) => ORDER[a.status] - ORDER[b.status] || (a.status === 'ended' ? String(b.starts_at).localeCompare(String(a.starts_at)) : String(a.starts_at).localeCompare(String(b.starts_at)))).map(c => html`<tr><td><b>${c.name}</b>${c.rules.length ? html`<br><span class="muted">${c.rules.length} custom rule${c.rules.length > 1 ? 's' : ''}</span>` : ''}</td><td>${fw(c.starts_at)}<br>→ ${fw(c.ends_at)}</td><td>${sbadge(c.status)}</td>
        <td>${c.discount_pct}% <span class="muted">(${c.min_pct}–${c.max_pct}%)</span></td>
        <td><a class="btn ghost" href="#/festivals/${c.id}">Edit</a> <button class="ghost" data-act="factive" data-id="${c.id}" data-active="${c.active ? 0 : 1}">${c.active ? 'Deactivate' : 'Activate'}</button> <button class="danger" data-act="fdel" data-id="${c.id}" data-name="${c.name}">Delete</button></td></tr>`)}</table></div>
    <div class="card tablewrap"><h3>Yearly festival calendar</h3><p class="muted">Campaigns are created automatically from these, three years ahead. Changing a row changes campaigns created from now on; existing campaigns keep their own settings.</p>
      <table><tr><th>Festival</th><th>Repeats</th><th>Starts days before</th><th>Ends days after</th><th>Default / Min / Max %</th><th>Auto</th><th></th></tr>
      ${d.templates.map(t => html`<tr><td><form data-form="template" data-id="${t.id}" id="t${t.id}"></form><b>${t.name}</b><br><span class="muted">${t.theme}</span></td>
        <td>${t.kind === 'fixed' ? html`${t.day}/${t.month} every year` : html`<span class="muted">${t.dates.map(x => x.year + ': ' + x.date.slice(5)).join(' · ') || 'no dates yet'}</span>`}</td>
        <td><input form="t${t.id}" name="lead_days" type="number" min="0" max="60" value="${t.lead_days}" style="width:70px"></td><td><input form="t${t.id}" name="tail_days" type="number" min="0" max="30" value="${t.tail_days}" style="width:70px"></td>
        <td style="white-space:nowrap"><input form="t${t.id}" name="discount_pct" type="number" min="0" max="100" value="${t.discount_pct}" style="width:62px"> <input form="t${t.id}" name="min_pct" type="number" min="0" max="100" value="${t.min_pct}" style="width:62px"> <input form="t${t.id}" name="max_pct" type="number" min="0" max="100" value="${t.max_pct}" style="width:62px"></td>
        <td><select form="t${t.id}" name="auto_create"><option value="1" ${t.auto_create ? 'selected' : ''}>On</option><option value="0" ${t.auto_create ? '' : 'selected'}>Off</option></select></td>
        <td><button form="t${t.id}">Save</button></td></tr>`)}</table></div>`, '#/festivals');
}

async function festivalDetailView(id) {
  const [d, cat] = await Promise.all([api('GET', '/festivals'), api('GET', '/festivals/catalog')]);
  const c = d.campaigns.find(x => String(x.id) === String(id));
  if (!c) return shell(html`<div class="card"><p>Campaign not found. <a href="#/festivals">Back</a></p></div>`, '#/festivals');
  const target = r => (r.scope === 'product' ? cat.products.find(p => String(p.id) === String(r.target))?.name || '#' + r.target : r.target);
  shell(html`<p><a href="#/festivals">← All campaigns</a></p><h2>${c.name} ${sbadge(c.status)}</h2>
    <div class="card"><form class="row" data-form="campedit" data-id="${c.id}">${campFields(c)}<button>Save changes</button></form>
      <p class="muted">Times are India time (IST). The sale starts and stops by itself at these times. The shop-wide cap is ${d.cap}%.</p></div>
    <div class="card"><h3>Different discounts for products or categories</h3><p class="muted">The default is ${c.discount_pct}% for everything. Add a rule to give a category or a single product a different discount, up to this campaign's maximum of ${c.max_pct}%. A product rule beats a category rule.</p>
      <form class="row" data-form="frule" data-id="${c.id}"><label>Applies to<select name="scope" id="rule-scope"><option value="category">Category</option><option value="product">Single product</option></select></label>
        <label data-sc="category">Category<select name="target">${cat.categories.map(x => html`<option>${x}</option>`)}</select></label>
        <label data-sc="product" class="hidden">Product<select name="target" disabled>${cat.products.map(p => html`<option value="${p.id}">${p.name} (${money(p.price)})</option>`)}</select></label>
        <label>Discount %<input type="number" name="discount_pct" min="0" max="${c.max_pct}" required style="width:90px"></label><button>Add rule</button></form>
      ${c.rules.length ? html`<table><tr><th>Applies to</th><th>Discount</th><th></th></tr>${c.rules.map(r => html`<tr><td>${r.scope === 'product' ? 'Product' : 'Category'}: <b>${target(r)}</b></td><td>${r.discount_pct}%</td><td><button class="danger" data-act="frdel" data-id="${r.id}">Remove</button></td></tr>`)}</table>` : html`<p class="muted">No custom rules.</p>`}</div>`, '#/festivals');
}

async function couponsView() {
  const { coupons } = await api('GET', '/coupons');
  shell(html`<h2>Coupon codes</h2>
    <div class="card"><h3>Add a code</h3><form class="row" data-form="coupon"><label>Code<input name="code" required maxlength="20" style="text-transform:uppercase;width:130px"></label><label>Label shown to customers<input name="label" placeholder="e.g. 15% off festive orders"></label>
      <label>Type<select name="type"><option value="percent">Percent off</option><option value="flat">Flat ₹ off</option><option value="ship">Free shipping</option></select></label>
      <label>Value<input type="number" name="value" min="0" value="10" style="width:90px"></label><label>Min order ₹<input type="number" name="min_order" min="0" value="0" style="width:100px"></label>
      <label>Valid from<input type="datetime-local" name="starts_at"></label><label>Valid until<input type="datetime-local" name="ends_at"></label><label>Max uses<input type="number" name="max_uses" min="1" placeholder="unlimited" style="width:100px"></label><button>Add code</button></form>
      <p class="muted">Coupons add to a festival sale only up to that campaign's maximum discount.</p></div>
    <div class="card tablewrap"><table><tr><th>Code</th><th>Offer</th><th>Min order</th><th>Valid</th><th>Used</th><th>Status</th><th></th></tr>
    ${coupons.map(c => html`<tr><td><b>${c.code}</b></td><td>${c.label}<br><span class="muted">${{ percent: c.value + '% off', flat: money(c.value) + ' off', ship: 'Free shipping' }[c.type]}</span></td><td>${money(c.min_order)}</td>
      <td>${c.starts_at ? fw(c.starts_at) : 'Any time'}<br>→ ${c.ends_at ? fw(c.ends_at) : 'No expiry'}</td><td>${c.used_count}${c.max_uses ? ' / ' + c.max_uses : ''}</td><td>${c.live ? html`<span class="badge st-live">Valid</span>` : html`<span class="badge st-off">${c.active ? 'Expired / used up' : 'Off'}</span>`}</td>
      <td><button class="ghost" data-act="cactive" data-code="${c.code}" data-active="${c.active ? 0 : 1}">${c.active ? 'Turn off' : 'Turn on'}</button> <button class="danger" data-act="cdel" data-code="${c.code}">Delete</button></td></tr>`)}</table></div>`, '#/coupons');
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
    if (path === '#/festivals') return await festivalsView();
    if ((m = /^#\/festivals\/(\d+)$/.exec(path))) return await festivalDetailView(m[1]);
    if (path === '#/coupons') return await couponsView();
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
  else if (name === 'campaign') act(() => api('POST', '/festivals', nums(v, ['discount_pct', 'min_pct', 'max_pct', 'show_popup', 'active'])), 'Campaign created');
  else if (name === 'campedit') act(() => api('PATCH', '/festivals/' + id, nums(v, ['discount_pct', 'min_pct', 'max_pct', 'show_popup', 'active'])), 'Campaign saved');
  else if (name === 'frule') act(() => api('POST', '/festivals/' + id + '/rules', nums(v, ['discount_pct'])), 'Rule saved');
  else if (name === 'fcap') act(() => api('PUT', '/festival-settings', nums(v, ['max_discount_cap'])), 'Shop-wide cap saved');
  else if (name === 'fdate') act(() => api('PUT', '/festival-dates', nums(v, ['template_id', 'year'])), 'Date saved, campaign scheduled');
  else if (name === 'template') act(() => api('PATCH', '/festival-templates/' + id, nums(v, ['lead_days', 'tail_days', 'discount_pct', 'min_pct', 'max_pct', 'auto_create'])), 'Festival defaults saved');
  else if (name === 'coupon') act(() => api('POST', '/coupons', nums(v, ['value', 'min_order', 'max_uses'])), 'Coupon added');
  else if (name === 'blocked') act(() => api('POST', '/blocked-dates', v), 'Date blocked');
});

document.addEventListener('click', async ev => {
  const go = ev.target.closest('[data-go]'); if (go && !ev.target.closest('a,button')) { location.hash = go.dataset.go; return; }
  const b = ev.target.closest('[data-act]'); if (!b) return;
  const a = b.dataset.act, d = b.dataset;
  if (a === 'logout') { try { await api('POST', '/auth/logout'); } catch { /* ignore */ } admin = null; csrf = ''; location.hash = '#/login'; await route(); }
  else if (a === 'month') { const [y, m] = rateState.month.split('-').map(Number), n = new Date(Date.UTC(y, m - 1 + Number(d.d), 1)); rateState.month = n.toISOString().slice(0, 7); route(); }
  else if (a === 'fgenerate') act(async () => { const g = await api('POST', '/festivals/generate'); toast(g.created.length ? g.created.length + ' campaign(s) scheduled' : 'Everything is already scheduled'); })
  else if (a === 'factive') act(() => api('PATCH', '/festivals/' + d.id, { active: Number(d.active) }), 'Campaign updated');
  else if (a === 'fdel') { if (confirm('Delete "' + d.name + '"? Automatic campaigns are not recreated unless you press Schedule upcoming years.')) act(() => api('DELETE', '/festivals/' + d.id), 'Campaign deleted'); }
  else if (a === 'frdel') act(() => api('DELETE', '/festival-rules/' + d.id), 'Rule removed');
  else if (a === 'cactive') act(() => api('PATCH', '/coupons/' + d.code, { active: Number(d.active) }), 'Coupon updated');
  else if (a === 'cdel') { if (confirm('Delete coupon ' + d.code + '?')) act(() => api('DELETE', '/coupons/' + d.code), 'Coupon deleted'); }
  else if (a === 'delrule') { if (confirm('Delete this rule?')) act(() => api('DELETE', '/rules/' + d.id), 'Rule deleted'); }
  else if (a === 'delslot') act(() => api('DELETE', '/slots/' + d.id), 'Slot deleted');
  else if (a === 'delblocked') act(() => api('DELETE', '/blocked-dates/' + d.date), 'Date unblocked');
  else if (a === 'toggleitem') act(() => api('PATCH', '/items/' + d.id, { active: Number(d.active) }), 'Item updated');
  else if (a === 'edititem') { const p = prompt('New base price (₹) for ' + d.name, d.price); if (p !== null) act(() => api('PATCH', '/items/' + d.id, { base_price: Number(p) }), 'Price updated'); }
});

document.addEventListener('change', ev => {
  if (ev.target.id === 'rate-item') { rateState.item = ev.target.value; route(); }
  if (ev.target.id === 'rule-type') syncRuleType();
  if (ev.target.id === 'rule-scope') document.querySelectorAll('[data-sc]').forEach(l => { const on = l.dataset.sc === ev.target.value; l.classList.toggle('hidden', !on); l.querySelector('select').disabled = !on; });
  if (['nb-item', 'nb-from', 'nb-to'].includes(ev.target.id)) refreshNewBooking();
});

window.addEventListener('hashchange', route);
route();
