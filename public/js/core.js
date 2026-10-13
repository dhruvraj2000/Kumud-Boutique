// Core utilities: safe HTML templating, API client, global state (cart / wishlist / user), toasts.
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);
class Raw { constructor(s) { this.s = s; } }
export const raw = s => new Raw(s);
const fmt = v => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(fmt).join('') : v == null || v === false ? '' : esc(v));
export const html = (strs, ...vals) => new Raw(strs.reduce((a, s, i) => a + s + (i < vals.length ? fmt(vals[i]) : ''), ''));
export const render = (el, tpl) => { el.innerHTML = tpl instanceof Raw ? tpl.s : esc(tpl); return el; };

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const money = n => '₹' + Number(n).toLocaleString('en-IN');
export const fmtDate = (d, withTime) => {
  const dt = new Date(String(d).includes('T') ? d : String(d).replace(' ', 'T') + 'Z');
  return dt.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}) });
};
export const stars = r => html`<span class="stars" role="img" aria-label="${r} out of 5 stars">${[1, 2, 3, 4, 5].map(i => html`<svg viewBox="0 0 20 20" class="${i <= Math.round(r) ? 'on' : ''}"><path d="M10 1.8l2.4 5.2 5.6.6-4.2 3.8 1.2 5.6L10 14.2 5 17l1.2-5.6L2 7.6l5.6-.6z"/></svg>`)}</span>`;

/* ---------- API ---------- */
export class ApiError extends Error { constructor(msg, status, field) { super(msg); this.status = status; this.field = field; } }
export async function api(method, url, body) {
  let res;
  try {
    res = await fetch('/api' + url, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
  } catch { throw new ApiError('You appear to be offline. Please check your connection and try again.', 0); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || 'Something went wrong.', res.status, data.field);
  return data;
}
export const get = u => api('GET', u), post = (u, b = {}) => api('POST', u, b), put = (u, b = {}) => api('PUT', u, b), patch = (u, b = {}) => api('PATCH', u, b), del = u => api('DELETE', u);

/* ---------- tiny store ---------- */
const listeners = new Set();
export const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = what => listeners.forEach(fn => fn(what));
const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

export const state = { user: null, cart: read('kb_cart', []), wish: new Set(read('kb_wish', [])), meta: null };
export const cartCount = () => state.cart.reduce((a, l) => a + l.qty, 0);
const saveCart = () => { write('kb_cart', state.cart); emit('cart'); };

export function addToCart(p, size, qty = 1) {
  const max = Math.min(10, p.stock[size] || 0);
  const ex = state.cart.find(l => l.id === p.id && l.size === size);
  const have = ex ? ex.qty : 0;
  if (have + qty > max) { toast(max === 0 ? 'Sorry, that size is sold out.' : `Only ${max} available in size ${size}.`, 'warn'); if (ex) { ex.qty = max; saveCart(); } return false; }
  if (ex) ex.qty += qty; else state.cart.push({ id: p.id, slug: p.slug, name: p.name, image: p.images[0], price: p.price, size, qty });
  saveCart(); return true;
}
export function setQty(id, size, qty) {
  const l = state.cart.find(x => x.id === id && x.size === size); if (!l) return;
  if (qty <= 0) state.cart = state.cart.filter(x => x !== l); else l.qty = Math.min(10, qty);
  saveCart();
}
export const removeLine = (id, size) => setQty(id, size, 0);
export const clearCart = () => { state.cart = []; saveCart(); };
export const applyQuoteToCart = q => {   // reconcile local cart with server truth
  let changed = false;
  for (const w of q.warnings) {
    if (w.remove) { state.cart = state.cart.filter(l => !(l.id === w.id && l.size === w.size)); changed = true; }
    else if (w.qty) { const l = state.cart.find(x => x.id === w.id && x.size === w.size); if (l) { l.qty = w.qty; changed = true; } }
  }
  q.lines.forEach(ql => { const l = state.cart.find(x => x.id === ql.id && x.size === ql.size); if (l && l.price !== ql.price) { l.price = ql.price; changed = true; } });
  if (changed) saveCart();
  return changed;
};
export const quote = (coupon) => post('/cart/quote', { items: state.cart.map(({ id, size, qty }) => ({ id, size, qty })), coupon });

const saveWish = () => { write('kb_wish', [...state.wish]); emit('wish'); };
export async function toggleWish(id) {
  const had = state.wish.has(id);
  if (had) state.wish.delete(id); else state.wish.add(id);
  saveWish();
  if (state.user) { try { const r = await (had ? del('/wishlist/' + id) : post('/wishlist/' + id)); state.wish = new Set(r.ids); saveWish(); } catch { /* keep optimistic state */ } }
  return !had;
}

export async function loadUser() {
  try { state.user = (await get('/auth/me')).user; } catch { state.user = null; }
  if (state.user) {
    try { const r = await put('/wishlist', { ids: [...state.wish] }); state.wish = new Set(r.ids); saveWish(); } catch { /* ignore */ }
  }
  emit('user');
}
export function setUser(u) { state.user = u; emit('user'); }

/* ---------- toasts ---------- */
export function toast(msg, kind = 'ok') {
  const host = $('#toasts'); if (!host) return;
  const t = document.createElement('div');
  t.className = 'toast ' + kind; t.setAttribute('role', kind === 'warn' || kind === 'err' ? 'alert' : 'status');
  t.textContent = msg; host.appendChild(t);
  requestAnimationFrame(() => t.classList.add('in'));
  setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 400); }, 3400);
}

/* ---------- form helpers ---------- */
export function formData(form) { return Object.fromEntries(new FormData(form).entries()); }
export function showFieldError(form, field, msg) {
  $$('.field-err', form).forEach(e => e.remove()); $$('.invalid', form).forEach(e => e.classList.remove('invalid'));
  const input = field && form.elements[field];
  if (input && input.closest) {
    const wrap = input.closest('.field') || input.parentElement; wrap.classList.add('invalid');
    const e = document.createElement('p'); e.className = 'field-err'; e.textContent = msg; wrap.appendChild(e);
    input.focus({ preventScroll: false });
  } else {
    let box = $('.form-err', form); if (!box) { box = document.createElement('p'); box.className = 'form-err'; box.setAttribute('role', 'alert'); form.prepend(box); }
    box.textContent = msg;
  }
}
export function clearErrors(form) { $$('.field-err,.form-err', form).forEach(e => e.remove()); $$('.invalid', form).forEach(e => e.classList.remove('invalid')); }
export function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.innerHTML; btn.disabled = true; btn.classList.add('is-busy'); if (label) btn.textContent = label; }
  else { btn.disabled = false; btn.classList.remove('is-busy'); if (btn.dataset.label) btn.innerHTML = btn.dataset.label; }
}
/** Submit helper: handles busy state + server field errors. */
export function onSubmit(form, handler, busyLabel) {
  form.addEventListener('submit', async e => {
    e.preventDefault(); clearErrors(form);
    const btn = form.querySelector('[type=submit]'); busy(btn, true, busyLabel);
    try { await handler(formData(form), form); }
    catch (err) { showFieldError(form, err.field, err.message || 'Something went wrong.'); }
    finally { busy(btn, false); }
  });
}
