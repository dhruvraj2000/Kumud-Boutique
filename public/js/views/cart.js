import { html, render, $, state, money, quote, applyQuoteToCart, subscribe, toast, toggleWish } from '../core.js';
import { icon, emptyState, trustBar, actions, thumb } from '../components.js';

export const getCoupon = () => { try { return localStorage.getItem('kb_coupon') || ''; } catch { return ''; } };
export const setCoupon = c => { try { c ? localStorage.setItem('kb_coupon', c) : localStorage.removeItem('kb_coupon'); } catch { /* ignore */ } };

/** Order summary block shared by the cart page and checkout. */
export const summary = (q, { editable = true } = {}) => html`
  <div class="sum-rows">
    <p><span>Subtotal</span><b>${money(q.subtotal)}</b></p>
    ${q.discount ? html`<p class="disc"><span>Discount <small>${q.coupon}</small></span><b>− ${money(q.discount)}</b></p>` : ''}
    ${q.twinning ? html`<p class="disc twin"><span>Twinning offer <small>${q.twinPercent}% off ${q.twinPairs > 1 ? q.twinPairs + ' pairs' : 'the pair'}</small></span><b>− ${money(q.twinning)}</b></p>` : ''}
    <p><span>Shipping</span><b>${q.shipping ? money(q.shipping) : 'Free'}</b></p>
    <p class="total"><span>Total</span><b>${money(q.total)}</b></p>
  </div>
  ${editable && q.shipping > 0 ? html`<p class="ship-hint">Add ${money(q.freeShippingMin - q.subtotal)} more for free shipping.</p>` : ''}`;

export const couponBox = (q, coupon) => html`<div class="coupon" id="couponForm">
  <label class="sr" for="cpn">Coupon code</label>
  ${q.coupon ? html`<div class="coupon-on">${icon('check')}<span><b>${q.coupon}</b> applied</span><button type="button" class="link-btn" data-action="coupon-remove">Remove</button></div>` : html`<div class="coupon-row"><input id="cpn" name="code" placeholder="Coupon code" value="${coupon}" autocomplete="off" maxlength="20"><button class="btn btn-ghost" type="button" data-action="coupon-apply">Apply</button></div>`}
  ${q.couponMessage && !q.coupon ? html`<p class="field-err">${q.couponMessage}</p>` : ''}
</div>`;

export default async function cart({ el, onLeave }) {
  let busy = false;
  async function refresh(first) {
    if (busy) return; busy = true;
    try {
      if (!state.cart.length) { render(el, html`<section class="wrap page-narrow">${emptyState('Your bag is empty', 'Pieces you add will wait for you here.', '#/shop', 'Explore the collection')}</section>`); return; }
      let q = await quote(getCoupon());
      if (applyQuoteToCart(q)) { q.warnings.forEach(w => toast(w.message, 'warn')); if (!state.cart.length) { busy = false; return refresh(); } q = await quote(getCoupon()); }
      if (getCoupon() && !q.coupon) setCoupon('');
      const scrollY = window.scrollY;
      render(el, html`
      <section class="wrap page-head"><nav class="crumbs"><a href="#/">Home</a><span>/</span><span>Bag</span></nav><h1>Your bag <small>${state.cart.reduce((a, l) => a + l.qty, 0)} item${state.cart.length > 1 || state.cart[0].qty > 1 ? 's' : ''}</small></h1></section>
      <div class="wrap cart-layout">
        <div class="cart-main">
          <div class="ship-bar"><p>${q.shipping ? html`Add <b>${money(q.freeShippingMin - q.subtotal)}</b> more for <b>free shipping</b>` : html`${icon('check')} <b>Free shipping</b> unlocked`}</p><div class="bar"><span style="width:${Math.min(100, q.subtotal / q.freeShippingMin * 100)}%"></span></div></div>
          <ul class="cart-list">${q.lines.map(l => html`<li class="cline">
            <a class="cl-img" href="#/product/${l.slug}"><img src="${thumb(l.image)}" alt="${l.name}" width="120" height="150"></a>
            <div class="cl-info"><a class="cl-name" href="#/product/${l.slug}">${l.name}</a><p class="muted">Size ${l.size}</p><p class="muted">${money(l.price)} each</p>
              <div class="cl-actions"><button class="link-btn" data-action="cart-save" data-id="${l.id}" data-size="${l.size}">Move to wishlist</button><button class="link-btn" data-action="cart-remove" data-id="${l.id}" data-size="${l.size}">Remove</button></div></div>
            <div class="qty" role="group" aria-label="Quantity for ${l.name}"><button data-action="cart-dec" data-id="${l.id}" data-size="${l.size}" aria-label="Decrease quantity">${icon('minus')}</button><output>${l.qty}</output><button data-action="cart-inc" data-id="${l.id}" data-size="${l.size}" aria-label="Increase quantity" ${l.qty >= l.available || l.qty >= 10 ? 'disabled' : ''}>${icon('plus')}</button></div>
            <b class="cl-total">${money(l.lineTotal)}</b></li>`)}</ul>
          <a class="link" href="#/shop">${icon('arrow', 'flip')} Continue shopping</a>
        </div>
        <aside class="summary"><h2>Order summary</h2>${couponBox(q, getCoupon())}${summary(q)}
          <a class="btn btn-primary btn-block" href="#/checkout">Proceed to checkout ${icon('arrow')}</a>
          <p class="secure">${icon('lock')} Secure checkout · UPI, cards &amp; cash on delivery</p></aside>
      </div>
      <section class="wrap section-tight">${trustBar()}</section>`);
      if (!first) window.scrollTo({ top: scrollY, behavior: 'instant' });
      const inp = $('#cpn', el); inp && inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); actions['coupon-apply'](); } });
    } catch (e) { render(el, html`<section class="wrap page-narrow empty"><h1>Couldn't load your bag</h1><p>${e.message}</p><button class="btn btn-primary" data-action="reload">Try again</button></section>`); }
    finally { busy = false; }
  }
  actions['coupon-apply'] = async () => {
    const code = ($('#cpn', el)?.value || '').trim().toUpperCase(); if (!code) return;
    const t = await quote(code);
    if (!t.coupon) { const f = $('#couponForm', el); f.querySelector('.field-err')?.remove(); f.appendChild(Object.assign(document.createElement('p'), { className: 'field-err', textContent: t.couponMessage })); return; }
    setCoupon(code); toast(t.couponMessage); refresh();
  };
  actions['coupon-remove'] = () => { setCoupon(''); refresh(); };
  actions['cart-save'] = async b => { const id = +b.dataset.id; if (!state.wish.has(id)) await toggleWish(id); actions['cart-remove'](b); toast('Moved to your wishlist'); };
  const unsub = subscribe(w => { if (w === 'cart') refresh(); });
  onLeave(() => { unsub(); delete actions['coupon-remove']; delete actions['coupon-apply']; delete actions['cart-save']; });
  await refresh(true);
  return 'Your bag';
}
