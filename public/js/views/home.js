import { html, render, get, money, stars, state } from '../core.js';
import { icon, productCard, trustBar, thumb, waLink } from '../components.js';

// designer options: [label, hex]
const SKIRTS = [['Madder red', '#9c2a2f'], ['Indigo', '#27407d'], ['Noir', '#1d1a20'], ['Mint', '#4fc4a0'], ['Ivory', '#f1e8da'], ['Rani pink', '#cf2f6b']];
const CHOLIS = [['Gold', '#c9a04f'], ['Ivory', '#efe6d8'], ['Maroon', '#6e1a2c'], ['Peacock', '#1f7a7a'], ['Black', '#17151a']];
const PRINTS = [['ajrakh', 'Ajrakh'], ['bandhani', 'Bandhani'], ['mirror', 'Mirror work'], ['plain', 'Plain']];

// photos for the golden-hour viewer — add another entry here to extend it
const GOLDEN = [
  { src: '/assets/lookbook/golden-hour-twirl.webp', alt: 'Model twirling in a striped multicolour patchwork lehenga on a lakeside terrace at golden hour', title: 'The Twirl', text: 'Panels of colour that open like a fan the moment you spin.' },
  { src: '/assets/lookbook/golden-hour-portrait.webp', alt: 'Smiling model in a mirror-work choli and striped patchwork lehenga on a palace terrace at sunset', title: 'The Terrace', text: 'Mirror-work choli, black Kutch-embroidered panels and gold-striped hems.' }
];
const RED = [
  { src: '/assets/lookbook/red-edit-twirl.webp', alt: 'Model mid-twirl in a red and white lehenga with a red bandhani dupatta against a crimson backdrop', title: 'Mid-twirl', text: 'Red bandhani panels and a mirror-work hem that open as the skirt spins.' },
  { src: '/assets/lookbook/red-edit-full.webp', alt: 'Smiling model with arms out in a full-circle red and white lehenga with a cowrie-tassel choli', title: 'Full circle', text: 'A cowrie-tassel choli and gold-bordered dupatta over a skirt cut wide for dancing.' },
  { src: '/assets/lookbook/red-edit-detail.webp', alt: 'Close portrait of a model in a red bandhani dupatta with a gold border, silver jewellery and a cowrie-tassel choli', title: 'The details', text: 'Bandhani dots, gold borders, silver jewellery and cowrie tassels, up close.' },
  { src: '/assets/lookbook/ajrakh-patchwork.webp', alt: 'Model seated in an Ajrakh halter choli and tasselled dupatta over a white skirt with block-printed patches', title: 'The Ajrakh set', text: 'Ajrakh choli and dupatta over soft white cotton, patched with block-printed squares.' }
];

// reusable photo viewer (Three.js liquid transition, plain images as fallback)
const viewer = (cls, id, eyebrow, heading, items, cta) => html`
  <section class="golden ${cls}" id="${id}">
    <div class="wrap gal-grid">
      <div class="gal-stage" role="img" aria-label="${eyebrow} photos. Tap to change photo.">
        ${items.map((g, i) => html`<img class="${i ? '' : 'on'}" src="${g.src}" alt="${g.alt}" width="1080" height="1440" loading="${i ? 'lazy' : 'eager'}" decoding="async">`)}
        <span class="gal-hint" aria-hidden="true">Tap · Hover</span>
      </div>
      <div class="gal-copy" data-reveal>
        <p class="eyebrow">${eyebrow}</p>
        <h2>${heading}</h2>
        <div class="gal-caps">${items.map((g, i) => html`<p class="gal-cap ${i ? '' : 'on'}"><small>${String(i + 1).padStart(2, '0')} / ${String(items.length).padStart(2, '0')}</small><b>${g.title}</b><span>${g.text}</span></p>`)}</div>
        <div class="gal-dots" role="group" aria-label="Choose photo">${items.map((g, i) => html`<button type="button" data-gal="${i}" aria-label="Show photo ${i + 1}: ${g.title}" aria-current="${i === 0 ? 'true' : 'false'}"><i></i></button>`)}</div>
        <a class="btn btn-primary" href="${cta[0]}">${cta[1]} ${icon('arrow')}</a>
      </div>
    </div>
  </section>`;

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
    <div class="fx-silk" aria-hidden="true"></div>
    <div class="wrap hero-grid">
      <div class="hero-copy">
        <p class="eyebrow reveal-line"><span>Festive Edit ✦ Handblock printed</span></p>
        <h1><span class="ln"><i>Woven in</i></span> <span class="ln"><i><em>indigo,</em></i></span> <span class="ln"><i>rooted in Ajrakh.</i></span></h1>
        <p class="lede">Lehengas and festive sets, block-printed by hand and finished to your measurements in our atelier — made for the nights you want to be remembered.</p>
        <div class="hero-cta"><a class="btn btn-primary" href="#/shop">Shop the collection ${icon('arrow')}</a><a class="btn btn-ghost" href="#/contact">Book a fitting</a></div>
        <ul class="hero-points"><li>${icon('scissors')} Made to measure</li><li>${icon('truck')} Free shipping over ₹7,500</li><li>${icon('swap')} 7-day exchange</li></ul>
      </div>
      <div class="hero-art" aria-hidden="false">
        <div class="arch arch-main" data-parallax="0.06"><img src="${hero.images[0]}" srcset="${thumb(hero.images[0])} 600w, ${hero.images[0]} 1200w" sizes="(max-width:900px) 62vw, 34vw" alt="${hero.name}" width="1200" height="1500" fetchpriority="high"></div>
        <div class="arch arch-left tone-mauve" data-parallax="-0.04"><img src="${thumb(left.images[0])}" alt="" width="600" height="750" loading="lazy" decoding="async"></div>
        <div class="arch arch-right tone-gold" data-parallax="0.09"><img src="${thumb(right.images[0])}" alt="" width="600" height="750" loading="lazy" decoding="async"></div>
        <a class="hero-tag" href="#/product/${hero.slug}"><small>Just in</small><b>${hero.name}</b><span>${money(hero.price)} ${icon('arrow')}</span></a>
        <span class="spin-seal" aria-hidden="true"><svg viewBox="0 0 120 120"><defs><path id="c" d="M60 60m-44 0a44 44 0 1 1 88 0a44 44 0 1 1-88 0"/></defs><text><textPath href="#c">HANDBLOCK PRINTED ✦ MADE TO MEASURE ✦ </textPath></text></svg>${icon('sparkle')}</span>
      </div>
    </div>
  </section>

  <div class="marquee" aria-hidden="true"><div class="track">${Array.from({ length: 2 }, () => html`<span>Ajrakh</span><i>✦</i><span>Indigo dabu</span><i>✦</i><span>Mirror work</span><i>✦</i><span>Tassel dupattas</span><i>✦</i><span>Made to measure</span><i>✦</i><span>Cowrie trims</span><i>✦</i>`)}</div></div>

  <section class="section wrap">
    <header class="sec-head" data-reveal><p class="eyebrow">Shop by collection</p><h2>Three ways to wear <em>tradition</em></h2></header>
    <div class="coll-grid">${collections.map((c, i) => html`<a class="coll tone-${c.tone}" href="#/shop?collection=${encodeURIComponent(c.name)}" data-reveal style="--i:${i}">
      <div class="coll-art"><img src="${thumb(c.p.images[0])}" srcset="${thumb(c.p.images[0])} 600w, ${c.p.images[0]} 1200w" sizes="(max-width:700px) 92vw, (max-width:1100px) 33vw, 420px" alt="" width="1200" height="1500" loading="lazy" decoding="async"></div>
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
      <div class="lbt-strip">${[['look-gunnu-twirl', 'The Twirl'], ['garba-night', 'Garba Night']].map(([f, t], i) => html`<a class="lbt-card" href="#/lookbook" data-reveal style="--i:${i}"><img src="/assets/lookbook/${f}.webp" alt="${t}" loading="lazy" width="800" height="1000"><span>${String(i + 1).padStart(2, '0')} · ${t}</span></a>`)}</div>
    </div>
  </section>

  ${viewer('', 'golden', 'Golden Hour ✦ Udaipur', html`Made for the <em>last light</em> of the day.`, GOLDEN, ['#/lookbook', 'Open the lookbook'])}

  ${viewer('red', 'red-edit', 'The Red Edit', html`Bandhani, mirrors &amp; a <em>full-circle</em> twirl.`, RED, ['#/shop', 'Shop the collection'])}

  <section class="gunnu-edit">
    <div class="wrap">
      <header class="gunnu-head" data-reveal><div><p class="eyebrow">A little extra sparkle</p><h2>Gunnu’s <em>Festive Edit</em></h2></div><p>Two joyful takes on colour, craft and the magic of a good twirl.</p></header>
      <div class="gunnu-grid">
        <figure class="gunnu-card" data-reveal style="--i:0">
          <div class="gunnu-visual"><img src="/assets/lookbook/gunnu-festive-twirl.webp" alt="Model twirling in a bright emerald and fuchsia festive lehenga" width="1024" height="1536" loading="lazy" decoding="async"></div>
          <figcaption><small>01 · THE TWIRL</small><strong>Colour made to move.</strong></figcaption>
        </figure>
        <figure class="gunnu-card" data-reveal style="--i:1">
          <div class="gunnu-visual"><img src="/assets/lookbook/gunnu-indigo-atelier.webp" alt="Indigo and ivory printed lehenga displayed on an atelier mannequin" width="768" height="1365" loading="lazy" decoding="async"></div>
          <figcaption><small>02 · THE ATELIER</small><strong>Indigo, in every detail.</strong></figcaption>
        </figure>
      </div>
    </div>
  </section>

  <section class="wrap section">
    <a class="twin-band" href="#/twinning" data-reveal>
      <div class="tb-art"><img src="/assets/products/white-patchwork-lehenga.webp" alt="Safed Patchwork lehenga set, with a matching mini set for girls" loading="lazy" width="1200" height="1500"></div>
      <div class="tb-copy"><p class="eyebrow">New ✦ Mother &amp; Daughter</p><h2>Twinning, made to measure.</h2><p>Matching sets for you and your little one${state.meta && state.meta.twinningPercent ? html` — <b>${state.meta.twinningPercent}% off</b> when you buy the pair` : ''}.</p><span class="btn btn-gold">Shop twinning ${icon('arrow')}</span></div>
    </a>
  </section>

  <section class="wrap section">
    <div class="cta-band" data-reveal>
      <div><p class="eyebrow light">Meet the atelier</p><h2>Your design, our hands.</h2><p>Consult, co-design and get fitted by the studio that prints, cuts and finishes every piece.</p></div>
      <div class="hero-cta"><a class="btn btn-gold" href="#/designer">The designer ${icon('arrow')}</a><a class="btn btn-ghost" href="#/custom">Custom design</a></div>
    </div>
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

  <section class="designer" id="designer">
    <div class="wrap dz-grid">
      <div class="dz-head" data-reveal>
        <p class="eyebrow">Design studio ✦ 3D</p>
        <h2>Dress your own <em>twirl.</em></h2>
        <p>Pick a colour and a print, drag to turn her around, then slide to spin. Love it? Send it to us and we’ll make it to your measurements.</p>
      </div>
      <div class="dz-stage" tabindex="0" role="img" aria-label="Interactive 3D lehenga. Drag, or use the left and right arrow keys, to rotate it.">
        <span class="gal-hint" aria-hidden="true">Drag to turn</span>
      </div>
      <div class="dz-controls" data-reveal>
        <div class="dz-group"><span class="dz-label" id="dzSkirt">Skirt</span><div class="dz-sw" role="group" aria-labelledby="dzSkirt">${SKIRTS.map(([n, c], i) => html`<button type="button" class="sw" data-skirt="${c}" data-name="${n}" style="--c:${c}" aria-label="${n}" aria-pressed="${i === 0 ? 'true' : 'false'}"></button>`)}</div></div>
        <div class="dz-group"><span class="dz-label" id="dzCholi">Choli</span><div class="dz-sw" role="group" aria-labelledby="dzCholi">${CHOLIS.map(([n, c], i) => html`<button type="button" class="sw" data-choli="${c}" data-name="${n}" style="--c:${c}" aria-label="${n}" aria-pressed="${i === 0 ? 'true' : 'false'}"></button>`)}</div></div>
        <div class="dz-group"><span class="dz-label" id="dzPrint">Print</span><div class="dz-chips" role="group" aria-labelledby="dzPrint">${PRINTS.map(([k, n], i) => html`<button type="button" class="chip" data-print="${k}" data-name="${n}" aria-pressed="${i === 0 ? 'true' : 'false'}">${n}</button>`)}</div></div>
        <div class="dz-group dz-slide"><label class="dz-label" for="dzTwirl">Twirl</label><input id="dzTwirl" type="range" min="0" max="100" value="35" data-twirl><button type="button" class="chip" data-spin aria-pressed="true">Auto-spin</button></div>
        <p class="dz-summary" data-summary aria-live="polite"></p>
        <div class="hero-cta"><a class="btn btn-primary" href="#/custom">Book this design ${icon('arrow')}</a><a class="btn btn-ghost" data-wa target="_blank" rel="noopener" hidden>Send on WhatsApp</a></div>
      </div>
    </div>
  </section>

  <section class="mirror">
    <div class="wrap mirror-grid">
      <div class="mirror-copy" data-reveal>
        <p class="eyebrow light">Mirror work</p>
        <h2>Tiny mirrors, <em>big light.</em></h2>
        <p>Our Ajrakh and Kutch pieces are finished with mirror work that catches the light when you twirl. Move your cursor, or drag a finger, and watch them turn.</p>
        <a class="btn btn-gold" href="#/shop?q=Mirror%20work">Shop mirror work ${icon('arrow')}</a>
      </div>
      <div class="mirror-fx" aria-hidden="true"></div>
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

  // Three.js scenes load lazily; failures leave the plain CSS design in place
  import('../fx3d.js').then(fx => {
    fx.mountSilk(el.querySelector('.fx-silk'), el.querySelector('.hero'), onLeave);
    el.querySelectorAll('.golden').forEach(gal => {
      const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); fx.mountGallery(gal, onLeave); } }, { rootMargin: '400px' });
      io.observe(gal); onLeave(() => io.disconnect());
    });
    const dz = el.querySelector('.designer');
    if (dz) {
      dz.addEventListener('design', e => {
        const wa = dz.querySelector('[data-wa]'), href = waLink(`Hi Kumud! I designed this in your 3D studio: ${e.detail.summary}. Can you make it for me?`);
        wa.hidden = !href; if (href) wa.href = href;
      });
      const io = new IntersectionObserver(async ([e]) => {
        if (!e.isIntersecting) return; io.disconnect();
        const ok = await fx.mountDesigner(dz, onLeave).catch(err => { console.warn('designer unavailable', err); return false; });
        if (!ok) dz.hidden = true;
      }, { rootMargin: '400px' });
      io.observe(dz.querySelector('.dz-stage')); onLeave(() => io.disconnect());
    }
    const mirrors = el.querySelector('.mirror-fx');
    if (mirrors && 'IntersectionObserver' in window) {
      const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { io.disconnect(); fx.mountMirrors(mirrors, onLeave); } }, { rootMargin: '300px' });
      io.observe(mirrors); onLeave(() => io.disconnect());
    }
  }).catch(err => console.warn('3D visuals unavailable', err));

  // gentle parallax on the hero arches (skipped for reduced motion)
  if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const items = [...el.querySelectorAll('[data-parallax]')]; let raf = 0;
    const tick = () => { raf = 0; const y = window.scrollY; if (y < 900) items.forEach(a => { a.style.setProperty('--py', (y * +a.dataset.parallax).toFixed(1) + 'px'); }); };
    const onS = () => { if (!raf) raf = requestAnimationFrame(tick); };
    window.addEventListener('scroll', onS, { passive: true }); onLeave(() => window.removeEventListener('scroll', onS));
  }
  return '';
}
