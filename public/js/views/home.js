import { html, render, get, money, stars, state } from '../core.js';
import { icon, productCard, trustBar, thumb } from '../components.js';

export default async function home({ el, onLeave }) {
  const [{ products }, { reviews }] = await Promise.all([get('/products'), get('/reviews/featured')]);
  const bySlug = Object.fromEntries(products.map(p => [p.slug, p]));
  const hero = bySlug['neel-indigo-tassel-lehenga'] || products[0], left = bySlug['noir-bagh-blockprint-lehenga'] || products[1], right = bySlug['hara-bandhani-satin-lehenga'] || bySlug['surkh-ajrakh-lehenga-set'] || products[2];
  const collections = [
    { name: 'Ajrakh Edit', tone: 'rose', blurb: 'Madder reds & mirror work', p: bySlug['safed-patchwork-lehenga-set'] },
    { name: 'Indigo Block-Print', tone: 'blue', blurb: 'Ombré blues & cowrie trims', p: bySlug['neel-indigo-tassel-lehenga'] },
    { name: 'Festive Brights', tone: 'mauve', blurb: 'Satin twirls & Kutch mirrors', p: bySlug['hara-bandhani-satin-lehenga'] }
  ].filter(c => c.p);
  const featured = products.filter(p => p.featured).slice(0, 4);

  render(el, html`
  <section class="hero">
    <div class="wrap hero-grid">
      <div class="hero-copy">
        <p class="eyebrow reveal-line"><span>Festive Edit ✦ Handblock printed</span></p>
        <h1><span class="ln"><i>Woven in</i></span> <span class="ln"><i><em>indigo,</em></i></span> <span class="ln"><i>rooted in Ajrakh.</i></span></h1>
        <p class="lede">Lehengas and festive sets, block-printed by hand and finished to your measurements in our atelier — made for the nights you want to be remembered.</p>
        <div class="hero-cta"><a class="btn btn-primary" href="#/shop">Shop the collection ${icon('arrow')}</a><a class="btn btn-ghost" href="#/contact">Book a fitting</a></div>
        <ul class="hero-points"><li>${icon('scissors')} Made to measure</li><li>${icon('truck')} Free shipping over ₹7,500</li><li>${icon('swap')} 7-day exchange</li></ul>
      </div>
      <div class="hero-art" aria-hidden="false">
        <div class="arch arch-main" data-parallax="0.06"><img src="${hero.images[0]}" alt="${hero.name}" width="1200" height="1500" fetchpriority="high"></div>
        <div class="arch arch-left tone-mauve" data-parallax="-0.04"><img src="${left.images[0]}" alt="" width="1200" height="1500" loading="lazy"></div>
        <div class="arch arch-right tone-gold" data-parallax="0.09"><img src="${right.images[0]}" alt="" width="1200" height="1500" loading="lazy"></div>
        <a class="hero-tag" href="#/product/${hero.slug}"><small>Just in</small><b>${hero.name}</b><span>${money(hero.price)} ${icon('arrow')}</span></a>
        <span class="spin-seal" aria-hidden="true"><svg viewBox="0 0 120 120"><defs><path id="c" d="M60 60m-44 0a44 44 0 1 1 88 0a44 44 0 1 1-88 0"/></defs><text><textPath href="#c">HANDBLOCK PRINTED ✦ MADE TO MEASURE ✦ </textPath></text></svg>${icon('sparkle')}</span>
      </div>
    </div>
  </section>

  <div class="marquee" aria-hidden="true"><div class="track">${Array.from({ length: 2 }, () => html`<span>Ajrakh</span><i>✦</i><span>Indigo dabu</span><i>✦</i><span>Mirror work</span><i>✦</i><span>Tassel dupattas</span><i>✦</i><span>Made to measure</span><i>✦</i><span>Cowrie trims</span><i>✦</i>`)}</div></div>

  <section class="section wrap">
    <header class="sec-head" data-reveal><p class="eyebrow">Shop by collection</p><h2>Three ways to wear <em>tradition</em></h2></header>
    <div class="coll-grid">${collections.map((c, i) => html`<a class="coll tone-${c.tone}" href="#/shop?collection=${encodeURIComponent(c.name)}" data-reveal style="--i:${i}">
      <div class="coll-art"><img src="${c.p.images[0]}" alt="" width="1200" height="1500" loading="lazy"></div>
      <div class="coll-info"><small>${String(i + 1).padStart(2, '0')}</small><h3>${c.name}</h3><p>${c.blurb}</p><span class="link">Explore ${icon('arrow')}</span></div></a>`)}</div>
  </section>

  <section class="section wrap">
    <header class="sec-head row" data-reveal><div><p class="eyebrow">The festive edit</p><h2>Signature pieces</h2></div><a class="link" href="#/shop">View all ${icon('arrow')}</a></header>
    <div class="grid">${featured.map((p, i) => productCard(p, i))}</div>
  </section>

  <section class="lb-teaser">
    <div class="wrap lbt-grid">
      <div class="lbt-copy" data-reveal><p class="eyebrow">The Lookbook</p><h2>Seen on <em>real</em> people.</h2>
        <p>Golden-hour twirls, garba nights and a little one in her mother’s print. Tap any look to shop exactly what she’s wearing.</p>
        <a class="btn btn-primary" href="#/lookbook">Open the lookbook ${icon('arrow')}</a></div>
      <div class="lbt-strip">${[['look-hara-twirl', 'The Twirl'], ['look-twinning', 'Twinning, Always'], ['look-duo', 'Garba Night']].map(([f, t], i) => html`<a class="lbt-card" href="#/lookbook" data-reveal style="--i:${i}"><img src="/assets/lookbook/${f}.webp" alt="${t}" loading="lazy" width="800" height="1000"><span>${String(i + 1).padStart(2, '0')} · ${t}</span></a>`)}</div>
    </div>
  </section>

  <section class="wrap section">
    <a class="twin-band" href="#/twinning" data-reveal>
      <div class="tb-art"><img src="/assets/lookbook/look-twinning.webp" alt="Mother and daughter in matching lehengas" loading="lazy" width="1600" height="2000"></div>
      <div class="tb-copy"><p class="eyebrow">New ✦ Mother &amp; Daughter</p><h2>Twinning, made to measure.</h2><p>Matching sets for you and your little one${state.meta && state.meta.twinningPercent ? html` — <b>${state.meta.twinningPercent}% off</b> when you buy the pair` : ''}.</p><span class="btn btn-gold">Shop twinning ${icon('arrow')}</span></div>
    </a>
  </section>

  <section class="story">
    <div class="wrap story-grid">
      <div class="story-media" data-reveal>
        <figure class="arch-frame a"><img src="/assets/atelier/atelier-black.webp" alt="A Kumud skirt and Ajrakh choli on a mannequin in the studio" loading="lazy" width="800" height="1067"></figure>
        <figure class="arch-frame b"><img src="/assets/atelier/atelier-white.webp" alt="White patchwork lehenga displayed in the Kumud boutique" loading="lazy" width="800" height="1067"></figure>
      </div>
      <div class="story-copy" data-reveal>
        <p class="eyebrow">From our atelier</p>
        <h2>Cut, printed and finished by <em>hand</em>.</h2>
        <p>Every Kumud piece begins with a block, a bolt of cloth and a pattern we have loved for years. Ajrakh reds, indigo dabu and fine black-ground prints are finished with mirror work, cowrie shells and hand-tied tassels.</p>
        <p>Tell us your measurements and we adjust the choli, blouse length and skirt to fit you — at no extra charge.</p>
        <ol class="steps"><li><b>Choose</b><span>Pick a piece and size</span></li><li><b>Fit</b><span>Share measurements</span></li><li><b>Finish</b><span>Tailored in our atelier</span></li><li><b>Deliver</b><span>Tracked to your door</span></li></ol>
        <a class="btn btn-primary" href="#/about">Our story ${icon('arrow')}</a>
      </div>
    </div>
  </section>

  <section class="section wrap">${trustBar()}</section>

  ${reviews.length ? html`<section class="section wrap">
    <header class="sec-head center" data-reveal><p class="eyebrow">Kind words</p><h2>Worn, twirled &amp; loved</h2></header>
    <div class="reviews">${reviews.slice(0, 3).map((r, i) => html`<blockquote class="rev" data-reveal style="--i:${i}">${stars(r.rating)}<p>“${r.body}”</p><footer><b>${r.author}</b><a href="#/product/${r.slug}">${r.product}</a></footer></blockquote>`)}</div>
  </section>` : ''}

  <section class="wrap section">
    <div class="cta-band" data-reveal>
      <div><p class="eyebrow light">Bespoke &amp; occasion wear</p><h2>Planning a wedding or sangeet?</h2><p>Book a one-to-one consultation and we'll design around your colours, fabric and fit.</p></div>
      <a class="btn btn-gold" href="#/contact">Book a consultation ${icon('arrow')}</a>
    </div>
  </section>`);

  // gentle parallax on the hero arches (skipped for reduced motion)
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const items = [...el.querySelectorAll('[data-parallax]')]; let raf = 0;
    const tick = () => { raf = 0; const y = window.scrollY; if (y < 900) items.forEach(a => { a.style.setProperty('--py', (y * +a.dataset.parallax).toFixed(1) + 'px'); }); };
    const onS = () => { if (!raf) raf = requestAnimationFrame(tick); };
    window.addEventListener('scroll', onS, { passive: true }); onLeave(() => window.removeEventListener('scroll', onS));
  }
  return '';
}
