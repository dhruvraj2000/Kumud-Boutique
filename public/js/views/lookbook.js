import { html, render, get, $, $$, money, addToCart, toast } from '../core.js';
import { icon, actions, thumb } from '../components.js';
import { openCart } from '../app.js';

export default async function lookbook({ el, onLeave }) {
  const { looks } = await get('/lookbook');
  const spotIndex = new Map();   // "lookId:i" -> spot (with product)
  looks.forEach(l => l.spots.forEach((s, i) => spotIndex.set(`${l.id}:${i}`, s)));
  const uniq = l => [...new Map(l.spots.map(s => [s.slug, s.product])).values()];

  render(el, html`
  <section class="lb-hero">
    <div class="wrap">
      <p class="eyebrow reveal-line"><span>Festive ’26 ✦ The Lookbook</span></p>
      <h1><span class="ln"><i>Stories in</i></span> <span class="ln"><i><em>colour</em> &amp; cloth.</i></span></h1>
      <p class="lede">Real pieces, worn by real people. Tap the <span class="dot-demo" aria-hidden="true"></span> markers on any look to shop what you see.</p>
    </div>
    <nav class="lb-index wrap" aria-label="Looks">${looks.map((l, i) => html`<a href="#look-${l.id}" data-action="lb-jump" data-id="${l.id}"><small>${String(i + 1).padStart(2, '0')}</small>${l.title}</a>`)}</nav>
  </section>

  <div class="lb-rail" aria-hidden="true">${looks.map(l => html`<i data-for="${l.id}"></i>`)}</div>

  ${looks.map((l, i) => html`<section class="look ${i % 2 ? 'flip' : ''}" id="look-${l.id}" data-look="${l.id}">
    <div class="wrap look-grid">
      <figure class="look-media" data-reveal>
        <div class="look-frame" style="aspect-ratio:${l.w}/${l.h}">
          <img src="${l.image}" alt="${l.title} — ${l.text}" width="${l.w}" height="${l.h}" loading="${i ? 'lazy' : 'eager'}" decoding="async">
          ${l.spots.map((s, k) => html`<button class="spot" style="left:${s.x}%;top:${s.y}%;--d:${k * 0.25}s" data-action="spot" data-key="${l.id}:${k}" aria-label="Shop ${s.label} — ${s.product.name}" aria-expanded="false"><span></span></button>`)}
        </div>
      </figure>
      <div class="look-copy" data-reveal>
        <p class="look-num">${String(i + 1).padStart(2, '0')}<small>/ ${String(looks.length).padStart(2, '0')}</small></p>
        <p class="eyebrow">${l.kicker}</p>
        <h2>${l.title}</h2>
        <p class="look-text">${l.text}</p>
        <h3 class="look-shop">Shop the look</h3>
        <ul class="look-items">${uniq(l).map(p => html`<li><a href="#/product/${p.slug}"><img src="${thumb(p.image)}" alt="" width="72" height="90" loading="lazy"><span><b>${p.name}</b><small>${p.collection}</small></span><em>${money(p.price)}</em>${icon('arrow')}</a></li>`)}</ul>
      </div>
    </div>
  </section>`)}

  <section class="wrap section">
    <div class="cta-band" data-reveal>
      <div><p class="eyebrow light">Bespoke &amp; occasion wear</p><h2>Love a look, want it your way?</h2><p>Change the colour, the neckline or the length — book a consultation and we’ll make it yours.</p></div>
      <a class="btn btn-gold" href="#/contact">Book a consultation ${icon('arrow')}</a>
    </div>
  </section>

  <div class="spot-pop" id="spotPop" role="dialog" aria-modal="false" aria-label="Shop this piece" hidden></div>`);

  /* ---- hotspot popover: anchored card on desktop, bottom sheet on small screens ---- */
  const pop = $('#spotPop', el); let openBtn = null, chosen = '';
  const closePop = () => { if (!openBtn) return; openBtn.setAttribute('aria-expanded', 'false'); openBtn.classList.remove('on'); openBtn = null; pop.classList.remove('in'); setTimeout(() => { if (!openBtn) pop.hidden = true; }, 220); };
  const place = btn => {
    if (matchMedia('(max-width: 720px)').matches) { pop.style.cssText = ''; pop.classList.add('sheet'); return; }
    pop.classList.remove('sheet');
    const r = btn.getBoundingClientRect(), w = 300, gap = 18;
    let left = r.right + gap; if (left + w > innerWidth - 16) left = r.left - w - gap; left = Math.max(16, left);
    const top = Math.min(Math.max(16, r.top + scrollY - 90), scrollY + innerHeight - pop.offsetHeight - 16);
    pop.style.cssText = `left:${left}px;top:${top}px`;
  };
  actions.spot = btn => {
    if (openBtn === btn) return closePop();
    closePop();
    const s = spotIndex.get(btn.dataset.key), p = s.product; chosen = '';
    render(pop, html`<button class="icon-btn pop-x" data-action="spot-close" aria-label="Close">${icon('close')}</button>
      <a class="pop-media" href="#/product/${p.slug}"><img src="${thumb(p.image)}" alt="" width="600" height="750"></a>
      <div class="pop-body"><p class="eyebrow">${s.label}</p><h3><a href="#/product/${p.slug}">${p.name}</a></h3><p class="price"><span class="now">${money(p.price)}</span>${p.compareAt ? html` <s>${money(p.compareAt)}</s>` : ''}</p>
        ${p.inStock ? html`<div class="chips pop-sizes" role="radiogroup" aria-label="Size">${Object.entries(p.stock).map(([z, n]) => html`<label class="chip-opt"><input type="radio" name="popSize" value="${z}" ${n <= 0 ? 'disabled' : ''}><span>${z}</span></label>`)}</div>
        <button class="btn btn-primary btn-block" data-action="spot-add" data-slug="${p.slug}">Add to bag</button>` : html`<p class="muted">Sold out — <a class="link" href="#/contact">ask about a remake</a></p>`}
        <a class="link pop-view" href="#/product/${p.slug}">View details ${icon('arrow')}</a></div>`);
    pop.hidden = false; openBtn = btn; btn.classList.add('on'); btn.setAttribute('aria-expanded', 'true');
    place(btn); requestAnimationFrame(() => pop.classList.add('in'));
    const sz = $('.pop-sizes', pop); if (sz) sz.addEventListener('change', e => { chosen = e.target.value; });
    $('.pop-x', pop).focus({ preventScroll: true });
  };
  actions['spot-close'] = () => { const b = openBtn; closePop(); if (b) b.focus({ preventScroll: true }); };
  actions['spot-add'] = b => {
    const s = [...spotIndex.values()].find(x => x.slug === b.dataset.slug), p = s.product;
    if (!chosen) { const sz = $('.pop-sizes', pop); sz.classList.remove('shake'); void sz.offsetWidth; sz.classList.add('shake'); toast('Choose a size first', 'warn'); return; }
    if (addToCart({ ...p, images: p.images }, chosen)) { toast(`${p.name} (${chosen}) added to your bag`); closePop(); openCart(); }
  };
  actions['lb-jump'] = (a, e) => { e.preventDefault(); $('#look-' + a.dataset.id, el).scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const onDoc = e => { if (openBtn && !pop.contains(e.target) && !e.target.closest('.spot')) closePop(); };
  const onKey = e => { if (e.key === 'Escape') actions['spot-close'](); };
  const onResize = () => { if (openBtn) place(openBtn); };
  document.addEventListener('click', onDoc); document.addEventListener('keydown', onKey); window.addEventListener('resize', onResize);

  /* ---- progress rail: highlights the look in view ---- */
  const rail = $$('.lb-rail i', el);
  const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) rail.forEach(r => r.classList.toggle('on', r.dataset.for === en.target.dataset.look)); }), { rootMargin: '-45% 0px -45% 0px' });
  $$('.look', el).forEach(s => io.observe(s));

  onLeave(() => {
    io.disconnect(); document.removeEventListener('click', onDoc); document.removeEventListener('keydown', onKey); window.removeEventListener('resize', onResize);
    ['spot', 'spot-close', 'spot-add', 'lb-jump'].forEach(k => delete actions[k]);
  });
  return 'Lookbook';
}
