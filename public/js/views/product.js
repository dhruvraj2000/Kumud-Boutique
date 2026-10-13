import { html, raw, render, get, post, $, $$, state, money, stars, addToCart, toggleWish, toast, onSubmit, fmtDate } from '../core.js';
import { icon, productCard, priceBlock, discount, actions, thumb, waLink, pageUrl } from '../components.js';
import { openCart, go } from '../app.js';

const addBusinessDays = (d, n) => { const x = new Date(d); while (n > 0) { x.setDate(x.getDate() + 1); if (x.getDay() !== 0) n--; } return x; };
const dFmt = d => d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });

export default async function product({ el, params, onLeave }) {
  const data = await get('/products/' + encodeURIComponent(params[0])).catch(e => { if (e.status === 404) return null; throw e; });
  if (!data) { render(el, html`<section class="wrap page-narrow empty"><h1>This piece is no longer available</h1><p>It may have been moved or sold out for good.</p><a class="btn btn-primary" href="#/shop">Browse the collection</a></section>`); return 'Not found'; }
  const { product: p, related, twin } = data; let { reviews } = data;
  let twinSize = '';
  const twinPct = state.meta ? state.meta.twinningPercent : 0;
  let size = '', qty = 1, cur = 0;
  const sizes = Object.entries(p.stock);
  const sold = !p.inStock;

  const reviewList = () => reviews.length ? html`<ul class="rv-list">${reviews.map(r => html`<li><div class="rv-top">${stars(r.rating)}<b>${r.title || 'Lovely piece'}</b></div><p>${r.body}</p><small>${r.author} · ${fmtDate(r.created_at)}</small></li>`)}</ul>` : html`<p class="muted">No reviews yet — be the first to share how it fits and feels.</p>`;
  const avg = () => reviews.length ? (reviews.reduce((a, r) => a + r.rating, 0) / reviews.length).toFixed(1) : 0;

  render(el, html`
  <article class="wrap pdp">
    <nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Home</a><span>/</span><a href="#/shop">Shop</a><span>/</span><a href="#/shop?collection=${encodeURIComponent(p.collection)}">${p.collection}</a><span>/</span><span>${p.name}</span></nav>
    <div class="pdp-grid">
      <div class="gallery" id="gallery">
        <div class="g-thumbs" role="tablist" aria-label="Product images">${p.images.map((src, i) => html`<button role="tab" class="${i === 0 ? 'on' : ''}" data-action="g-go" data-i="${i}" aria-label="Image ${i + 1}" aria-selected="${i === 0}"><img src="${thumb(src)}" alt="" width="80" height="100"></button>`)}</div>
        <div class="g-main" id="gMain"><button class="g-zoom" data-action="lightbox" aria-label="Enlarge image"><img id="gImg" src="${p.images[0]}" alt="${p.name} — view 1" width="1200" height="1500" fetchpriority="high"></button>
          ${p.badge ? html`<span class="tag">${p.badge}</span>` : ''}${p.images.length > 1 ? html`<div class="g-nav"><button data-action="g-prev" aria-label="Previous image">${icon('arrow')}</button><button data-action="g-next" aria-label="Next image">${icon('arrow')}</button></div>` : ''}
          <span class="g-hint">${icon('zoom')} Hover to zoom</span></div>
        ${p.images.length > 1 ? html`<div class="g-dots">${p.images.map((_, i) => html`<i class="${i === 0 ? 'on' : ''}"></i>`)}</div>` : ''}
      </div>

      <div class="pdp-info">
        <p class="eyebrow">${p.collection}</p>
        <h1>${p.name}</h1>
        <a class="rate-link" href="#reviews" data-action="to-reviews">${p.reviews ? html`${stars(p.rating)} <span>${p.rating} · ${p.reviews} review${p.reviews > 1 ? 's' : ''}</span>` : 'Be the first to review'}</a>
        ${priceBlock(p)}<p class="tax-note">Inclusive of all taxes</p>
        <p class="tagline">${p.tagline}</p>

        <fieldset class="sizes" id="sizes"><legend>Size <button type="button" class="link-btn" data-action="size-guide">Size guide</button></legend>
          <div class="size-row">${sizes.map(([s, n]) => html`<label class="size ${n <= 0 ? 'out' : ''}"><input type="radio" name="size" value="${s}" ${n <= 0 ? 'disabled' : ''}><span>${s}</span>${n > 0 && n <= 2 ? html`<em>${n} left</em>` : ''}</label>`)}</div>
          <p class="size-msg" id="sizeMsg" role="status"></p>
        </fieldset>

        <div class="buy-row" id="buyRow">
          <div class="qty lg" role="group" aria-label="Quantity"><button type="button" data-action="q-dec" aria-label="Decrease quantity">${icon('minus')}</button><output id="qOut">1</output><button type="button" data-action="q-inc" aria-label="Increase quantity">${icon('plus')}</button></div>
          <button class="btn btn-primary btn-grow" id="addBtn" data-action="add" ${sold ? 'disabled' : ''}><span class="lbl">${sold ? 'Sold out' : 'Add to bag'}</span><span class="ok">${icon('check')} Added</span></button>
          <button class="wish-lg ${state.wish.has(p.id) ? 'on' : ''}" data-action="wish" data-id="${p.id}" aria-pressed="${state.wish.has(p.id)}" aria-label="Save to wishlist">${icon('heart')}</button>
        </div>
        ${sold ? '' : html`<button class="btn btn-ghost btn-block" data-action="buy-now">Buy it now</button>`}
        ${waLink('x') ? html`<a class="wa-ask" id="waAsk" href="${waLink(`Hi Kumud! I'd like to know more about the ${p.name}. ${pageUrl('#/product/' + p.slug)}`)}" target="_blank" rel="noopener">${icon('whatsapp')}<span><b>Ask about this piece on WhatsApp</b><small>Fit, fabric, custom colours — we usually reply within the hour</small></span></a>` : ''}
        ${twin && twin.inStock ? html`<section class="twin-box" aria-labelledby="twh">
          <div class="twin-art"><img src="${thumb(twin.images[0])}" alt="" width="600" height="750" loading="lazy"><span class="twin-badge">${icon('sparkle')} Twinning</span></div>
          <div class="twin-info"><p class="eyebrow">${p.kids ? 'Match with Mum' : 'Twin with your little one'}</p><h3 id="twh"><a href="#/product/${twin.slug}">${twin.name}</a></h3>
            <p class="twin-price">${money(twin.price)}${twinPct ? html` <em>Save ${twinPct}% on the pair</em>` : ''}</p>
            <div class="chips twin-sizes" role="radiogroup" aria-label="${twin.name} size">${Object.entries(twin.stock).map(([s, n]) => html`<label class="chip-opt"><input type="radio" name="twinSize" value="${s}" ${n <= 0 ? 'disabled' : ''}><span>${s}</span></label>`)}</div>
            <button class="btn btn-primary btn-block" data-action="add-pair">Add both to bag${twinPct ? html` · save ${money(Math.round((p.price + twin.price) * twinPct / 100))}` : ''}</button>
            <p class="size-msg" id="twinMsg" role="status"></p></div>
        </section>` : ''}

        <div class="deliver"><p class="d-title">${icon('pin')} Check delivery</p>
          <form id="pinForm" novalidate><div class="field"><label class="sr" for="pin">PIN code</label><input id="pin" name="pin" inputmode="numeric" maxlength="6" placeholder="Enter 6-digit PIN code" autocomplete="postal-code"></div><button class="btn btn-ghost" type="submit">Check</button></form>
          <p id="pinOut" class="pin-out" aria-live="polite"></p></div>

        <div class="accs">
          <details open><summary>Description ${icon('chevron')}</summary><div><p>${p.description}</p></div></details>
          <details><summary>Details &amp; fit ${icon('chevron')}</summary><div><ul class="dots">${p.details.map(d => html`<li>${d}</li>`)}</ul></div></details>
          <details><summary>What's included ${icon('chevron')}</summary><div><ul class="dots">${p.includes.map(d => html`<li>${d}</li>`)}</ul></div></details>
          <details><summary>Care ${icon('chevron')}</summary><div><p>${p.care}</p></div></details>
          <details><summary>Shipping &amp; exchange ${icon('chevron')}</summary><div><p>Free shipping above ₹7,500, otherwise ₹199. Made-to-measure alterations add 2–3 working days. Unaltered pieces can be exchanged within 7 days of delivery. <a href="#/shipping">Read the full policy</a>.</p></div></details>
        </div>
      </div>
    </div>

    <section class="reviews-sec" id="reviews" aria-labelledby="rvh">
      <header class="sec-head row"><div><p class="eyebrow">Reviews</p><h2 id="rvh">What customers say</h2></div><div class="rv-sum" id="rvSum">${reviews.length ? html`<b>${avg()}</b>${stars(avg())}<small>${reviews.length} review${reviews.length > 1 ? 's' : ''}</small>` : ''}</div></header>
      <div class="rv-grid"><div id="rvList">${reviewList()}</div>
        <div class="rv-form">${state.user ? html`<h3>Write a review</h3><form id="rvForm" novalidate>
            <div class="field"><label>Your rating</label><div class="star-input" role="radiogroup" aria-label="Rating">${[5, 4, 3, 2, 1].map(n => html`<input type="radio" id="st${n}" name="rating" value="${n}"><label for="st${n}" title="${n} star${n > 1 ? 's' : ''}"><span class="sr">${n} stars</span>${icon('sparkle')}</label>`)}</div></div>
            <div class="field"><label for="rvt">Title <small>(optional)</small></label><input id="rvt" name="title" maxlength="100"></div>
            <div class="field"><label for="rvb">Your review</label><textarea id="rvb" name="body" rows="4" maxlength="1000" placeholder="How was the fit, fabric and finish?"></textarea></div>
            <button class="btn btn-primary" type="submit">Submit review</button></form>` : html`<h3>Share your experience</h3><p class="muted">Sign in to review this piece.</p><a class="btn btn-ghost" href="#/login">Sign in</a>`}</div></div>
    </section>

    <section class="section-tight"><header class="sec-head row"><div><p class="eyebrow">Complete the look</p><h2>You may also love</h2></div><a class="link" href="#/shop">View all ${icon('arrow')}</a></header>
      <div class="grid">${related.map((r, i) => productCard(r, i))}</div></section>
  </article>

  <div class="sticky-buy" id="stickyBuy" aria-hidden="true"><div class="wrap"><div><b>${p.name}</b><span>${money(p.price)}</span></div><button class="btn btn-primary" data-action="sticky-add" ${sold ? 'disabled' : ''}>${sold ? 'Sold out' : 'Add to bag'}</button></div></div>
  <div class="lightbox" id="lightbox" role="dialog" aria-modal="true" aria-label="Image viewer" hidden><button class="icon-btn lb-close" data-action="lb-close" aria-label="Close">${icon('close')}</button><button class="lb-nav prev" data-action="lb-prev" aria-label="Previous">${icon('arrow')}</button><img alt=""><button class="lb-nav next" data-action="lb-next" aria-label="Next">${icon('arrow')}</button></div>
  <div class="modal" id="sgModal" role="dialog" aria-modal="true" aria-label="Size guide" hidden><div class="modal-card"><button class="icon-btn modal-x" data-action="modal-close" aria-label="Close">${icon('close')}</button><h3>Size guide</h3><p class="muted">Body measurements in inches. Not sure? Choose your usual size — we adjust the fit free of charge.</p>
    ${p.kids ? raw(`<div class="table-wrap"><table class="tbl"><thead><tr><th>Age</th><th>Height</th><th>Chest</th><th>Waist</th></tr></thead><tbody><tr><td>2Y</td><td>34–37</td><td>21</td><td>20</td></tr><tr><td>4Y</td><td>39–42</td><td>22.5</td><td>21</td></tr><tr><td>6Y</td><td>44–47</td><td>24</td><td>22</td></tr><tr><td>8Y</td><td>49–52</td><td>25.5</td><td>23</td></tr><tr><td>10Y</td><td>54–56</td><td>27</td><td>24</td></tr><tr><td>12Y</td><td>57–60</td><td>29</td><td>25</td></tr></tbody></table></div>`) : raw(`<div class="table-wrap"><table class="tbl"><thead><tr><th>Size</th><th>Bust</th><th>Waist</th><th>Hip</th></tr></thead><tbody><tr><td>XS</td><td>32</td><td>26</td><td>35</td></tr><tr><td>S</td><td>34</td><td>28</td><td>37</td></tr><tr><td>M</td><td>36</td><td>30</td><td>39</td></tr><tr><td>L</td><td>38</td><td>32</td><td>41</td></tr><tr><td>XL</td><td>40</td><td>34</td><td>43</td></tr></tbody></table></div>`)}<a class="link" href="#/size-guide" data-action="modal-close">How to measure ${icon('arrow')}</a></div></div>`);

  /* ---- gallery ---- */
  const img = $('#gImg', el), gMain = $('#gMain', el), lb = $('#lightbox', el);
  const showImg = i => {
    cur = (i + p.images.length) % p.images.length;
    img.classList.add('swap'); setTimeout(() => { img.src = p.images[cur]; img.alt = `${p.name} — view ${cur + 1}`; img.classList.remove('swap'); }, 120);
    $$('.g-thumbs button', el).forEach((b, k) => { b.classList.toggle('on', k === cur); b.setAttribute('aria-selected', k === cur); });
    $$('.g-dots i', el).forEach((d, k) => d.classList.toggle('on', k === cur));
  };
  if (matchMedia('(hover:hover) and (pointer:fine)').matches) {
    gMain.addEventListener('mousemove', e => { const r = gMain.getBoundingClientRect(); img.style.transformOrigin = `${(e.clientX - r.left) / r.width * 100}% ${(e.clientY - r.top) / r.height * 100}%`; });
  } else $('.g-hint', el).remove();
  let tx = 0; gMain.addEventListener('touchstart', e => { tx = e.touches[0].clientX; }, { passive: true });
  gMain.addEventListener('touchend', e => { const dx = e.changedTouches[0].clientX - tx; if (Math.abs(dx) > 40 && p.images.length > 1) showImg(cur + (dx < 0 ? 1 : -1)); }, { passive: true });
  const lbShow = () => { $('img', lb).src = p.images[cur]; $('img', lb).alt = img.alt; };
  const lbKey = e => { if (e.key === 'Escape') lbClose(); if (e.key === 'ArrowRight') { showImg(cur + 1); lbShow(); } if (e.key === 'ArrowLeft') { showImg(cur - 1); lbShow(); } };
  const lbClose = () => { lb.hidden = true; document.body.classList.remove('locked'); document.removeEventListener('keydown', lbKey); };

  /* ---- buying ---- */
  const sizeMsg = $('#sizeMsg', el), addBtn = $('#addBtn', el);
  const waAsk = $('#waAsk', el);
  $('#sizes', el).addEventListener('change', e => { size = e.target.value; if (waAsk) waAsk.href = waLink(`Hi Kumud! I'd like to order the ${p.name} in size ${size}. ${pageUrl('#/product/' + p.slug)}`); sizeMsg.textContent = p.stock[size] <= 3 ? `Hurry — only ${p.stock[size]} left in ${size}.` : ''; sizeMsg.className = 'size-msg'; $('#sizes', el).classList.remove('shake'); });
  const needSize = () => {
    if (size) return false;
    sizeMsg.textContent = 'Please select a size to continue.'; sizeMsg.className = 'size-msg err';
    const fs = $('#sizes', el); fs.classList.remove('shake'); void fs.offsetWidth; fs.classList.add('shake'); fs.scrollIntoView({ block: 'center', behavior: 'smooth' }); return true;
  };
  const add = () => { if (needSize()) return false; return addToCart(p, size, qty); };
  const flash = () => { addBtn.classList.add('added'); setTimeout(() => addBtn.classList.remove('added'), 1600); };
  const stepQty = d => { qty = Math.max(1, Math.min(10, qty + d)); $('#qOut', el).textContent = qty; };

  Object.assign(actions, {
    'g-go': b => showImg(+b.dataset.i), 'g-next': () => showImg(cur + 1), 'g-prev': () => showImg(cur - 1),
    'lightbox': () => { lbShow(); lb.hidden = false; document.body.classList.add('locked'); document.addEventListener('keydown', lbKey); $('.lb-close', lb).focus(); },
    'lb-close': lbClose, 'lb-next': () => { showImg(cur + 1); lbShow(); }, 'lb-prev': () => { showImg(cur - 1); lbShow(); },
    'q-inc': () => stepQty(1), 'q-dec': () => stepQty(-1),
    'add': () => { if (add()) { flash(); openCart(); } },
    'sticky-add': () => { if (add()) { flash(); openCart(); } },
    'buy-now': () => { if (add()) go('/checkout'); },
    'add-pair': () => {
      if (needSize()) return;
      const tm = $('#twinMsg', el);
      if (!twinSize) { tm.textContent = `Please choose a size for the ${twin.name}.`; tm.className = 'size-msg err'; return; }
      if (addToCart(p, size, 1) && addToCart(twin, twinSize, 1)) { toast(twinPct ? `Twinning pair added — ${twinPct}% off applied at checkout ✦` : 'Both pieces added to your bag'); openCart(); }
    },
    'size-guide': () => { $('#sgModal', el).hidden = false; document.body.classList.add('locked'); },
    'modal-close': () => { $('#sgModal', el).hidden = true; document.body.classList.remove('locked'); },
    'to-reviews': (a, e) => { e.preventDefault(); $('#reviews', el).scrollIntoView({ behavior: 'smooth' }); }
  });
  const ts = $('.twin-sizes', el); if (ts) ts.addEventListener('change', e => { twinSize = e.target.value; const tm = $('#twinMsg', el); tm.textContent = ''; tm.className = 'size-msg'; });
  $('#sgModal', el).addEventListener('click', e => { if (e.target.id === 'sgModal') actions['modal-close'](); });
  lb.addEventListener('click', e => { if (e.target === lb) lbClose(); });
  window.addEventListener('kb:wish', syncWish); function syncWish(e) { if (e.detail.id === p.id) { const b = $('.wish-lg', el); b.classList.toggle('on', e.detail.on); b.setAttribute('aria-pressed', e.detail.on); } }

  // sticky mobile bar when the main buy row leaves the viewport
  const sticky = $('#stickyBuy', el);
  const io = new IntersectionObserver(([en]) => { const hide = en.isIntersecting || en.boundingClientRect.top > 0; sticky.classList.toggle('show', !hide); sticky.setAttribute('aria-hidden', hide); }, { threshold: 0 });
  io.observe($('#buyRow', el));

  /* ---- delivery check ---- */
  $('#pinForm', el).addEventListener('submit', e => {
    e.preventDefault(); const v = $('#pin', el).value.trim(), out = $('#pinOut', el);
    if (!/^[1-9]\d{5}$/.test(v)) { out.className = 'pin-out err'; out.textContent = 'Please enter a valid 6-digit PIN code.'; return; }
    const from = addBusinessDays(new Date(), 4), to = addBusinessDays(new Date(), 8);
    out.className = 'pin-out ok'; out.textContent = `Delivery to ${v} by ${dFmt(from)} – ${dFmt(to)}, including made-to-measure adjustments.`;
  });

  /* ---- reviews ---- */
  const rvForm = $('#rvForm', el);
  if (rvForm) onSubmit(rvForm, async d => {
    if (!d.rating) { const e = new Error('Please choose a star rating.'); e.field = 'rating'; throw e; }
    await post(`/products/${p.slug}/reviews`, { rating: +d.rating, title: d.title, body: d.body });
    const fresh = await get('/products/' + p.slug); reviews = fresh.reviews;
    $('#rvList', el).innerHTML = reviewList().s;
    $('#rvSum', el).innerHTML = html`<b>${avg()}</b>${stars(avg())}<small>${reviews.length} review${reviews.length > 1 ? 's' : ''}</small>`.s;
    rvForm.innerHTML = '<p class="ok-msg">Thank you — your review is live.</p>'; toast('Thanks for your review ✦');
  }, 'Submitting…');

  // structured data for search engines
  const ld = document.createElement('script'); ld.type = 'application/ld+json';
  ld.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: p.name, image: p.images.map(i => location.origin + i), description: p.description, brand: { '@type': 'Brand', name: 'Kumud Boutique' }, offers: { '@type': 'Offer', priceCurrency: 'INR', price: p.price, availability: p.inStock ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' }, ...(p.reviews ? { aggregateRating: { '@type': 'AggregateRating', ratingValue: p.rating, reviewCount: p.reviews } } : {}) });
  document.head.appendChild(ld);
  onLeave(() => delete actions['add-pair']);
  onLeave(() => { ld.remove(); io.disconnect(); lbClose(); window.removeEventListener('kb:wish', syncWish); document.body.classList.remove('locked'); ['g-go', 'g-next', 'g-prev', 'lightbox', 'lb-close', 'lb-next', 'lb-prev', 'q-inc', 'q-dec', 'add', 'sticky-add', 'buy-now', 'size-guide', 'modal-close', 'to-reviews'].forEach(k => delete actions[k]); });
  return p.name;
}
