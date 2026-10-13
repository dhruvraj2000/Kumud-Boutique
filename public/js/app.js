// App shell: router, page transitions, header/drawer/search behaviour, global click actions.
import { $, $$, html, render, money, state, subscribe, cartCount, loadUser, get, post, quote, applyQuoteToCart, setQty, removeLine, addToCart, toggleWish, toast, esc, onSubmit } from './core.js';
import { actions, icon, productIndex, thumb, waLink, pageUrl } from './components.js';

const app = $('#app'), main = $('#main');
const ROUTES = [
  [/^\/?$/, 'home'], [/^\/shop$/, 'shop'], [/^\/product\/([\w-]+)$/, 'product'], [/^\/cart$/, 'cart'], [/^\/checkout$/, 'checkout'],
  [/^\/wishlist$/, 'wishlist'], [/^\/(login|register)$/, 'auth'], [/^\/account(?:\/(\w+))?$/, 'account'], [/^\/orders\/([\w-]+)$/, 'order'],
  [/^\/track$/, 'track'], [/^\/lookbook$/, 'lookbook'], [/^\/twinning$/, 'twinning'], [/^\/(about|contact|shipping|size-guide)$/, 'info'], [/^\/admin(?:\/(\w+))?$/, 'admin']
];
let leaveFns = [], lastPath = null, navToken = 0;
const progress = $('#progress');

function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  return { path: path || '/', query: new URLSearchParams(qs) };
}
export const go = to => { if (location.hash === '#' + to) route(); else location.hash = to; };

async function route() {
  const token = ++navToken, { path, query } = parseHash();
  closeAll();
  leaveFns.forEach(f => { try { f(); } catch { /* ignore */ } }); leaveFns = [];
  const match = ROUTES.map(([re, name]) => [re.exec(path), name]).find(([m]) => m);
  progress.className = 'progress run';
  app.classList.add('leaving');
  await new Promise(r => setTimeout(r, lastPath === null ? 0 : 140));
  if (token !== navToken) return;
  const ctx = { el: app, params: match ? match[0].slice(1) : [], query, path, onLeave: f => leaveFns.push(f), go, keepScroll: lastPath === path && path === '/shop' };
  let title = 'Page not found';
  try {
    if (!match) { render(app, html`<section class="wrap page-narrow empty"><h1>Page not found</h1><p>The page you are looking for has moved or never existed.</p><a class="btn btn-primary" href="#/">Back to home</a></section>`); }
    else { const mod = await import(`./views/${match[1]}.js`); if (token !== navToken) return; title = (await mod.default(ctx)) || ''; }
  } catch (err) {
    console.error(err);
    render(app, html`<section class="wrap page-narrow empty"><h1>We hit a snag</h1><p>${err.message || 'Something went wrong.'}</p><button class="btn btn-primary" data-action="reload">Try again</button></section>`);
  }
  if (token !== navToken) return;
  document.title = title ? `${title} — Kumud Boutique` : 'Kumud Boutique — Handblock-Printed Lehengas & Festive Wear';
  setActiveNav(path, query);
  if (!ctx.keepScroll) window.scrollTo({ top: 0, behavior: 'instant' });
  lastPath = path;
  app.classList.remove('leaving'); app.classList.add('entering'); setTimeout(() => app.classList.remove('entering'), 600);
  observeReveal(app);
  progress.className = 'progress done';
  if (!ctx.keepScroll && lastPath !== null) main.focus({ preventScroll: true });
}

function setActiveNav(path, query) {
  const col = query.get('collection');
  $$('.nav a[data-nav], .nav-link').forEach(a => {
    const k = a.dataset.nav;
    const on = (k === 'shop' && path === '/shop') || (k === 'lookbook' && path === '/lookbook') || (k === 'twinning' && path === '/twinning') || (k === 'about' && path === '/about') || (k === 'contact' && path === '/contact');
    a.classList.toggle('active', on); if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
}

/* ---------- scroll reveal ---------- */
const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }) : null;
export function observeReveal(root = document) { $$('[data-reveal]:not(.in)', root).forEach(el => (io ? io.observe(el) : el.classList.add('in'))); }
window.addEventListener('kb:render', e => observeReveal(e.detail || document));

/* ---------- header, drawers, overlays ---------- */
const header = $('#header');
const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 24);
window.addEventListener('scroll', onScroll, { passive: true }); onScroll();

const inertTargets = () => [main, $('.site-footer')];
let openLayer = null, lastFocus = null;
function openLayerEl(el, scrim = true) {
  closeAll(true); lastFocus = document.activeElement; openLayer = el;
  el.classList.add('open'); el.setAttribute('aria-hidden', 'false');
  if (scrim) { $('#scrim').hidden = false; requestAnimationFrame(() => $('#scrim').classList.add('on')); }
  inertTargets().forEach(t => t && t.setAttribute('inert', '')); document.body.classList.add('locked');
  setTimeout(() => (el.querySelector('input,[data-autofocus],button,a') || el).focus({ preventScroll: true }), 60);
}
function closeAll(silent) {
  if (!openLayer) return;
  openLayer.classList.remove('open'); openLayer.setAttribute('aria-hidden', 'true'); openLayer = null;
  const sc = $('#scrim'); sc.classList.remove('on'); setTimeout(() => { if (!openLayer) sc.hidden = true; }, 300);
  inertTargets().forEach(t => t && t.removeAttribute('inert')); document.body.classList.remove('locked');
  $('[data-action="menu-open"]').setAttribute('aria-expanded', 'false');
  if (!silent && lastFocus && document.contains(lastFocus)) lastFocus.focus({ preventScroll: true });
}
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeAll(); });

/* ---------- cart drawer ---------- */
const drawer = $('#cartDrawer');
async function renderDrawer() {
  const empty = !state.cart.length;
  const local = state.cart.reduce((a, l) => a + l.price * l.qty, 0);
  const line = l => html`<li class="dline"><a href="#/product/${l.slug}"><img src="${thumb(l.image)}" alt="" width="84" height="105"></a>
    <div><a class="dname" href="#/product/${l.slug}">${l.name}</a><p class="dmeta">Size ${l.size}</p>
      <div class="dctl"><div class="qty" role="group" aria-label="Quantity for ${l.name}"><button data-action="cart-dec" data-id="${l.id}" data-size="${l.size}" aria-label="Decrease quantity">${icon('minus')}</button><output>${l.qty}</output><button data-action="cart-inc" data-id="${l.id}" data-size="${l.size}" aria-label="Increase quantity">${icon('plus')}</button></div>
      <b>${money(l.price * l.qty)}</b></div></div>
    <button class="rm" data-action="cart-remove" data-id="${l.id}" data-size="${l.size}" aria-label="Remove ${l.name}">${icon('close')}</button></li>`;
  const min = state.meta ? state.meta.freeShippingMin : 7500, left = Math.max(0, min - local);
  render(drawer, html`
    <header class="dhead"><h2>Your bag <small>${cartCount() ? `(${cartCount()})` : ''}</small></h2><button class="icon-btn" data-action="close-all" aria-label="Close bag">${icon('close')}</button></header>
    ${empty ? html`<div class="dempty"><div class="empty-art">${icon('bag')}</div><p>Your bag is empty.</p><a class="btn btn-primary" href="#/shop" data-action="close-all">Explore the collection</a></div>` : html`
      <div class="dship"><p>${left ? html`Add <b>${money(left)}</b> for free shipping` : html`<b>You've unlocked free shipping</b> ${icon('check')}`}</p><div class="bar"><span style="width:${Math.min(100, local / min * 100)}%"></span></div></div>
      <ul class="dlist">${state.cart.map(line)}</ul>
      <footer class="dfoot"><p class="drow"><span>Subtotal</span><b>${money(local)}</b></p><p class="dnote">Shipping and coupons are applied at checkout.</p>
        <a class="btn btn-primary btn-block" href="#/checkout" data-action="close-all">Checkout ${icon('arrow')}</a><a class="btn btn-ghost btn-block" href="#/cart" data-action="close-all">View full bag</a>
        ${waLink('x') ? html`<a class="wa-order" href="${waLink(['Hi Kumud! I would like to order:', ...state.cart.map(l => `• ${l.name} — size ${l.size} × ${l.qty}`), `Bag total: ${money(local)}`].join('\n'))}" target="_blank" rel="noopener">${icon('whatsapp')} Prefer to order on WhatsApp?</a>` : ''}</footer>`}`);
}
export async function openCart() {
  await renderDrawer(); openLayerEl(drawer);
  if (state.cart.length) { try { const q = await quote(); if (applyQuoteToCart(q)) { q.warnings.forEach(w => toast(w.message, 'warn')); } } catch { /* keep local view */ } }
}
subscribe(what => {
  if (what === 'cart') { updateBadges(); if (drawer.classList.contains('open')) renderDrawer(); }
  if (what === 'wish') { updateBadges(); $$('.wish[data-id]').forEach(b => { const on = state.wish.has(+b.dataset.id); b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }); }
  if (what === 'user') { $('#accountLink').setAttribute('aria-label', state.user ? 'My account' : 'Sign in'); $('#mobileAccount').textContent = state.user ? 'My account' : 'Sign in / Register'; }
});
function updateBadges() {
  const b = $('#bagCount'), w = $('#wishCount'), n = cartCount();
  b.hidden = !n; b.textContent = n; w.hidden = !state.wish.size; w.textContent = state.wish.size;
  b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
}

/* ---------- WhatsApp chat button ---------- */
const waFab = $('#waFab');
function syncWa() {
  const href = waLink('Hi Kumud! I have a question about ' + (location.hash.startsWith('#/product/') ? document.title.replace(' — Kumud Boutique', '') + ' ' + pageUrl(location.hash) : 'your collection.'));
  waFab.hidden = !href; if (href) waFab.href = href;
}
window.addEventListener('kb:meta', syncWa); window.addEventListener('hashchange', () => setTimeout(syncWa, 700));

/* ---------- search ---------- */
const pane = $('#searchPane'), sInput = $('#searchInput'), sOut = $('#searchResults');
let sTimer, sSeq = 0;
function searchIdle() {
  render(sOut, html`<p class="eyebrow">Popular right now</p><div class="s-tags">${['Ajrakh', 'Indigo', 'Block-print', 'Mirror work', 'Dupatta'].map(t => html`<a href="#/shop?q=${t}" data-action="close-all">${t}</a>`)}</div>`);
}
async function runSearch(q) {
  const seq = ++sSeq;
  if (q.length < 2) return searchIdle();
  try {
    const r = await get('/products?limit=6&q=' + encodeURIComponent(q)); if (seq !== sSeq) return;
    render(sOut, r.total ? html`<ul class="s-list">${r.products.map(p => html`<li><a href="#/product/${p.slug}" data-action="close-all"><img src="${thumb(p.images[0])}" alt="" width="56" height="70"><span><b>${p.name}</b><small>${p.collection}</small></span><em>${money(p.price)}</em></a></li>`)}</ul>
      <a class="s-all" href="#/shop?q=${q}" data-action="close-all">See all ${r.total} result${r.total > 1 ? 's' : ''} ${icon('arrow')}</a>` : html`<p class="s-none">No pieces match “${q}”. Try “indigo”, “Ajrakh” or “lehenga”.</p>`);
  } catch (e) { render(sOut, html`<p class="s-none">${e.message}</p>`); }
}
sInput.addEventListener('input', () => { clearTimeout(sTimer); sTimer = setTimeout(() => runSearch(sInput.value.trim()), 180); });
$('#searchForm').addEventListener('submit', e => { e.preventDefault(); const q = sInput.value.trim(); closeAll(true); inertTargets().forEach(t => t && t.removeAttribute('inert')); document.body.classList.remove('locked'); go('/shop' + (q ? '?q=' + encodeURIComponent(q) : '')); });

/* ---------- global click actions ---------- */
Object.assign(actions, {
  'menu-open': el => { openLayerEl($('#mobileNav')); el.setAttribute('aria-expanded', 'true'); },
  'search-open': () => { openLayerEl(pane, true); sInput.value = ''; searchIdle(); setTimeout(() => sInput.focus(), 80); },
  'cart-open': () => openCart(),
  'close-all': () => closeAll(),
  'reload': () => route(),
  'cart-inc': el => { const l = state.cart.find(x => x.id === +el.dataset.id && x.size === el.dataset.size); if (l) { const max = Math.min(10, (productIndex.get(l.id)?.stock[l.size]) ?? 10); if (l.qty >= max) toast(`Only ${max} available in this size.`, 'warn'); else setQty(l.id, l.size, l.qty + 1); } },
  'cart-dec': el => { const l = state.cart.find(x => x.id === +el.dataset.id && x.size === el.dataset.size); if (l) setQty(l.id, l.size, l.qty - 1); },
  'cart-remove': el => removeLine(+el.dataset.id, el.dataset.size),
  'wish': async el => {
    const id = +el.dataset.id, on = await toggleWish(id);
    el.classList.add('pop'); setTimeout(() => el.classList.remove('pop'), 500);
    toast(on ? 'Saved to your wishlist' : 'Removed from wishlist');
    window.dispatchEvent(new CustomEvent('kb:wish', { detail: { id, on } }));
  },
  'quick-open': el => { const q = el.closest('.quick'); $$('.quick.open').forEach(o => o !== q && o.classList.remove('open')); q.classList.toggle('open'); },
  'quick-size': el => {
    const p = productIndex.get(+el.dataset.id); if (!p) return;
    if (addToCart(p, el.dataset.size)) { el.closest('.quick').classList.remove('open'); toast(`${p.name} (${el.dataset.size}) added to your bag`); openCart(); }
  }
});
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (el && actions[el.dataset.action]) {
    if (el.tagName === 'BUTTON') e.preventDefault();
    actions[el.dataset.action](el, e);
  } else if (!e.target.closest('.quick')) $$('.quick.open').forEach(q => q.classList.remove('open'));
});

/* ---------- newsletter ---------- */
onSubmit($('#newsletterForm'), async (d, form) => {
  const r = await post('/newsletter', { email: d.email });
  toast(r.already ? 'You are already on the list — thank you!' : 'Welcome to the Kumud Letter ✦'); form.reset();
}, 'Subscribing…');
$('#year').textContent = new Date().getFullYear();
// footer link groups: open on desktop, collapsed accordions on phones
const footMq = matchMedia('(max-width: 720px)');
const syncFoot = () => $$('.foot-col').forEach(d => { d.open = !footMq.matches; });
syncFoot(); footMq.addEventListener('change', syncFoot);
$$('.foot-col summary').forEach(sm => sm.addEventListener('click', e => { if (!footMq.matches) e.preventDefault(); }));

/* ---------- boot ---------- */
window.addEventListener('hashchange', route);
(async () => {
  try { state.meta = await get('/meta'); } catch { /* handled by views */ }
  await loadUser(); updateBadges();
  if (state.cart.length && state.meta) { try { applyQuoteToCart(await quote()); } catch { /* ignore */ } }
  await route(); syncWa();
})();
