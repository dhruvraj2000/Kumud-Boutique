// Shared UI pieces: icons, product card, price block, action registry.
import { html, raw, money, stars, state } from './core.js';

const ICONS = {
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  heart: '<path d="M12 20.5s-7.5-4.6-9.2-9.3C1.7 8 3.6 5 6.6 5c1.9 0 3.5 1 5.4 3 1.9-2 3.5-3 5.4-3 3 0 4.9 3 3.8 6.2-1.7 4.7-9.2 9.3-9.2 9.3z"/>',
  bag: '<path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6.5a3 3 0 016 0V8"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c.8-4 4-6 8-6s7.2 2 8 6"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  arrow: '<path d="M4 12h16M14 6l6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  chevron: '<path d="M6 9l6 6 6-6"/>',
  filter: '<path d="M4 6h16M7 12h10M10 18h4"/>',
  truck: '<path d="M2 6h11v10H2zM13 10h4l3 3v3h-7"/><circle cx="7" cy="17.5" r="1.7"/><circle cx="17" cy="17.5" r="1.7"/>',
  scissors: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><path d="M8 7.5L20 18M8 16.5L20 6"/>',
  swap: '<path d="M4 8h13l-3-3M20 16H7l3 3"/>',
  sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z"/>',
  pin: '<path d="M12 21s7-6.2 7-11.5A7 7 0 005 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2z"/>',
  box: '<path d="M3 7.5L12 3l9 4.5v9L12 21l-9-4.5z"/><path d="M3 7.5l9 4.5 9-4.5M12 12v9"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
  zoom: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5M11 8v6M8 11h6"/>',
  whatsapp: '<path d="M4.5 19.5l1.2-3.6A8 8 0 1112 20a8 8 0 01-3.9-1z"/><path d="M9 8.6c0 3 2.4 5.9 5.6 6.3.6 0 1.4-.6 1.4-1.3l-1.6-.8-.8.8c-1-.4-2-1.4-2.4-2.4l.8-.8-.7-1.6C10.6 8.8 9 8.9 9 8.6z"/>',
  look: '<rect x="4" y="3" width="16" height="18" rx="2"/><circle cx="12" cy="10" r="2.2"/><path d="M7.5 18c.8-2.4 2.5-3.6 4.5-3.6s3.7 1.2 4.5 3.6"/>',
  grid: '<rect x="4" y="4" width="7" height="7"/><rect x="13" y="4" width="7" height="7"/><rect x="4" y="13" width="7" height="7"/><rect x="13" y="13" width="7" height="7"/>'
};
export const icon = (name, cls = '') => html`<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${raw(ICONS[name] || '')}</svg>`;

export const thumb = src => (src.includes('/products/') ? src.replace('.webp', '-sm.webp') : src);

/** wa.me link with a pre-filled message, or '' when no WhatsApp number is configured. */
export const waLink = text => (state.meta && state.meta.whatsapp ? `https://wa.me/${state.meta.whatsapp}?text=${encodeURIComponent(text)}` : '');
export const pageUrl = hash => location.origin + '/' + hash;
export const discount = p => (p.compareAt ? Math.round((1 - p.price / p.compareAt) * 100) : 0);

export const priceBlock = p => html`<p class="price"><span class="now">${money(p.price)}</span>${p.compareAt ? html` <s>${money(p.compareAt)}</s> <span class="off">${discount(p)}% off</span>` : ''}</p>`;

export const productIndex = new Map();
export function productCard(p, i = 0) {
  productIndex.set(p.id, p);
  const wished = state.wish.has(p.id);
  const sizes = Object.entries(p.stock);
  return html`<article class="card" data-reveal style="--i:${i % 4}">
    <a class="card-media" href="#/product/${p.slug}" aria-label="${p.name}">
      <img class="img-a" src="${thumb(p.images[0])}" alt="${p.name}" width="600" height="750" loading="lazy" decoding="async">
      ${p.images[1] ? html`<img class="img-b" src="${thumb(p.images[1])}" alt="" width="600" height="750" loading="lazy" decoding="async">` : ''}
      ${!p.inStock ? html`<span class="tag tag-sold">Sold out</span>` : p.badge ? html`<span class="tag">${p.badge}</span>` : p.lowStock ? html`<span class="tag tag-low">Few left</span>` : ''}
    </a>
    <button class="wish ${wished ? 'on' : ''}" data-action="wish" data-id="${p.id}" aria-pressed="${wished}" aria-label="${wished ? 'Remove from' : 'Add to'} wishlist: ${p.name}">${icon('heart')}</button>
    ${p.inStock ? html`<div class="quick" data-quick="${p.id}">
      <button class="quick-btn" data-action="quick-open" data-id="${p.id}">Quick add ${icon('plus')}</button>
      <div class="quick-sizes" role="group" aria-label="Choose a size">${sizes.map(([s, n]) => html`<button class="chip" data-action="quick-size" data-id="${p.id}" data-size="${s}" ${n <= 0 ? 'disabled' : ''}>${s}</button>`)}</div>
    </div>` : ''}
    <div class="card-body">
      <p class="eyebrow">${p.collection}</p>
      <h3><a href="#/product/${p.slug}">${p.name}</a></h3>
      <div class="card-foot">${priceBlock(p)}${p.reviews ? html`<span class="rate">${stars(p.rating)}<small>${p.rating}</small></span>` : ''}</div>
    </div>
  </article>`;
}

/** Global click-action registry. Views add handlers with `actions.name = (el, event) => {}` */
export const actions = {};
export const skeletonCards = n => html`${Array.from({ length: n }, () => html`<div class="card skel"><div class="card-media"></div><div class="card-body"><i></i><i></i></div></div>`)}`;
export const emptyState = (title, text, ctaHref, ctaLabel) => html`<div class="empty"><div class="empty-art">${icon('sparkle')}</div><h2>${title}</h2><p>${text}</p>${ctaHref ? html`<a class="btn btn-primary" href="${ctaHref}">${ctaLabel}</a>` : ''}</div>`;
export const trustBar = () => html`<ul class="trust">
  <li>${icon('scissors')}<span><b>Made-to-measure</b> free fit adjustments</span></li>
  <li>${icon('truck')}<span><b>Free shipping</b> above ₹7,500</span></li>
  <li>${icon('swap')}<span><b>7-day exchange</b> on unaltered pieces</span></li>
  <li>${icon('lock')}<span><b>Secure checkout</b> UPI · Card · COD</span></li>
</ul>`;
