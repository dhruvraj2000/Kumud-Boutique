import { html, render, get, $, $$, state, money, addToCart, toast } from '../core.js';
import { icon, actions, thumb, productCard } from '../components.js';
import { openCart } from '../app.js';

export default async function twinning({ el, onLeave }) {
  const { products } = await get('/products');
  const bySlug = new Map(products.map(p => [p.slug, p]));
  const pairs = products.filter(p => !p.kids && p.twinSlug && bySlug.has(p.twinSlug)).map(p => [p, bySlug.get(p.twinSlug)]);
  const kids = products.filter(p => p.kids);
  const pct = state.meta ? state.meta.twinningPercent : 0;
  const pick = {};   // pair index -> { a: size, b: size }

  const sizeChips = (p, name) => html`<div class="chips" role="radiogroup" aria-label="${p.name} size">${Object.entries(p.stock).map(([s, n]) => html`<label class="chip-opt"><input type="radio" name="${name}" value="${s}" ${n <= 0 ? 'disabled' : ''}><span>${s}</span></label>`)}</div>`;

  render(el, html`
  <section class="tw-hero">
    <div class="wrap tw-hero-grid">
      <div class="tw-copy">
        <p class="eyebrow reveal-line"><span>Mother &amp; Daughter ✦ Twinning</span></p>
        <h1><span class="ln"><i>Made to</i></span> <span class="ln"><i><em>match.</em></i></span></h1>
        <p class="lede">The same block prints, the same hand-finishing — cut in her size and yours. Pick both pieces together and ${pct ? html`<b>save ${pct}% on the pair</b>` : 'shop the matching set'}, with free made-to-measure for each of you.</p>
        <div class="hero-cta"><a class="btn btn-primary" href="#pairs" data-action="tw-jump">Shop the pairs ${icon('arrow')}</a><a class="btn btn-ghost" href="#/lookbook">See the lookbook</a></div>
        ${pct ? html`<span class="tw-seal" aria-hidden="true"><b>${pct}%</b><small>off the pair</small></span>` : ''}
      </div>
      <div class="tw-art"><div class="arch"><img src="/assets/lookbook/look-twinning.webp" alt="Mother and daughter in matching Safed Patchwork lehengas" width="1600" height="2000" fetchpriority="high"></div>
        <img class="tw-float" src="/assets/lookbook/look-patchwork-closeup.webp" alt="" width="1080" height="1700" loading="lazy"></div>
    </div>
  </section>

  <section class="section wrap" id="pairs">
    <header class="sec-head" data-reveal><p class="eyebrow">The pairs</p><h2>Choose two sizes, <em>one look</em></h2></header>
    ${pairs.length ? html`<div class="pairs">${pairs.map(([a, b], i) => html`<article class="pair" data-reveal data-i="${i}">
      <div class="pair-art"><a href="#/product/${a.slug}"><img src="${thumb(a.images[0])}" alt="${a.name}" width="600" height="750" loading="lazy"></a><span class="pair-plus">${icon('plus')}</span><a href="#/product/${b.slug}"><img src="${thumb(b.images[0])}" alt="${b.name}" width="600" height="750" loading="lazy"></a></div>
      <div class="pair-body">
        <div class="pair-row"><div><p class="eyebrow">For her</p><h3><a href="#/product/${a.slug}">${a.name}</a></h3><p class="price"><span class="now">${money(a.price)}</span></p></div>${sizeChips(a, 'pa' + i)}</div>
        <div class="pair-row"><div><p class="eyebrow">For the little one</p><h3><a href="#/product/${b.slug}">${b.name}</a></h3><p class="price"><span class="now">${money(b.price)}</span></p></div>${sizeChips(b, 'pb' + i)}</div>
        <div class="pair-total"><span>Pair price</span>${pct ? html`<s>${money(a.price + b.price)}</s>` : ''}<b>${money(Math.round((a.price + b.price) * (100 - pct) / 100))}</b></div>
        <button class="btn btn-primary btn-block" data-action="tw-add" data-i="${i}">Add the pair to bag ${icon('bag')}</button>
        <p class="size-msg" role="status"></p>
      </div></article>`)}</div>` : html`<p class="muted">New twinning pairs are on the way — <a class="link" href="#/contact">ask us about a custom match</a>.</p>`}
  </section>

  <section class="story tw-how">
    <div class="wrap">
      <header class="sec-head center" data-reveal><p class="eyebrow">How it works</p><h2>Twinning, <em>tailored</em></h2></header>
      <ol class="tw-steps">${[['sparkle', 'Pick a pair', 'Choose a size for each of you — the pair discount is applied automatically in your bag.'], ['scissors', 'Share measurements', 'Add both sets of measurements at checkout or save them to your account. Adjustments are free.'], ['box', 'Wrapped together', 'Both pieces are finished side by side, so prints and colours match, and arrive in one parcel.']].map(([ic, t, d], i) => html`<li data-reveal style="--i:${i}">${icon(ic)}<b>${t}</b><p>${d}</p></li>`)}</ol>
    </div>
  </section>

  ${kids.length ? html`<section class="section wrap"><header class="sec-head row" data-reveal><div><p class="eyebrow">Little ones</p><h2>Kids’ edit</h2></div><a class="link" href="#/shop?category=Kids">View all ${icon('arrow')}</a></header>
    <div class="grid">${kids.map((p, i) => productCard(p, i))}</div></section>` : ''}`);

  $$('.pair', el).forEach(card => card.addEventListener('change', e => {
    const i = card.dataset.i; pick[i] = pick[i] || {};
    if (e.target.name === 'pa' + i) pick[i].a = e.target.value;
    if (e.target.name === 'pb' + i) pick[i].b = e.target.value;
    const m = $('.size-msg', card); m.textContent = ''; m.className = 'size-msg';
  }));
  actions['tw-add'] = btn => {
    const i = btn.dataset.i, [a, b] = pairs[i], s = pick[i] || {}, card = btn.closest('.pair'), m = $('.size-msg', card);
    if (!s.a || !s.b) { m.textContent = !s.a && !s.b ? 'Choose a size for both pieces.' : `Choose a size for the ${(!s.a ? a : b).name}.`; m.className = 'size-msg err'; card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake'); return; }
    if (addToCart(a, s.a) && addToCart(b, s.b)) { toast(pct ? `Pair added — ${pct}% twinning offer applied ✦` : 'Pair added to your bag'); openCart(); }
  };
  actions['tw-jump'] = (a, e) => { e.preventDefault(); $('#pairs', el).scrollIntoView({ behavior: 'smooth' }); };
  onLeave(() => { delete actions['tw-add']; delete actions['tw-jump']; });
  return 'Mother & Daughter Twinning';
}
