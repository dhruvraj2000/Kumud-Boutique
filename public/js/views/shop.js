import { html, render, get, $, $$, state, money } from '../core.js';
import { icon, productCard, skeletonCards, emptyState, actions } from '../components.js';

const PRICE_BUCKETS = [['', 'Any price', 0, 0], ['u', 'Under ₹7,500', 0, 7499], ['m', '₹7,500 – ₹10,000', 7500, 10000], ['o', 'Above ₹10,000', 10001, 0]];
const SORTS = [['', 'Featured'], ['new', 'Newest'], ['price-asc', 'Price: low to high'], ['price-desc', 'Price: high to low'], ['rating', 'Top rated'], ['name', 'Name A–Z']];

export default async function shop({ el, query, onLeave }) {
  const meta = state.meta || await get('/meta');
  const f = { q: query.get('q') || '', category: query.get('category') || '', collection: query.get('collection') || '', price: query.get('price') || '', size: query.get('size') || '', color: query.get('color') || '', instock: query.get('instock') === '1', sale: query.get('sale') === '1', sort: query.get('sort') || '' };
  let seq = 0;

  const toQS = () => {
    const p = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v && v !== true) p.set(k, v); else if (v === true) p.set(k, '1'); });
    return p.toString();
  };
  const apiQS = () => {
    const p = new URLSearchParams(), b = PRICE_BUCKETS.find(x => x[0] === f.price);
    ['q', 'category', 'collection', 'size', 'color', 'sort'].forEach(k => f[k] && p.set(k, f[k]));
    if (b && b[2]) p.set('min', b[2]); if (b && b[3]) p.set('max', b[3]);
    if (f.instock) p.set('instock', '1'); if (f.sale) p.set('sale', '1');
    return p.toString();
  };
  const activeChips = () => {
    const chips = [];
    if (f.q) chips.push(['q', `“${f.q}”`]);
    ['category', 'collection', 'size', 'color'].forEach(k => f[k] && chips.push([k, k === 'size' ? 'Size ' + f[k] : f[k]]));
    if (f.price) chips.push(['price', PRICE_BUCKETS.find(x => x[0] === f.price)?.[1]]);
    if (f.instock) chips.push(['instock', 'In stock']); if (f.sale) chips.push(['sale', 'On offer']);
    return chips;
  };
  const radio = (name, val, label) => html`<label class="opt"><input type="radio" name="${name}" value="${val}" ${f[name] === val ? 'checked' : ''}><span>${label}</span></label>`;
  const group = (title, body, open = true) => html`<details class="fgroup" ${open ? 'open' : ''}><summary>${title}${icon('chevron')}</summary><div class="fbody">${body}</div></details>`;

  const filtersHTML = () => html`
    ${group('Category', [radio('category', '', 'All'), meta.categories.map(c => radio('category', c, c))])}
    ${group('Collection', [radio('collection', '', 'All'), meta.collections.map(c => radio('collection', c, c))])}
    ${group('Price', PRICE_BUCKETS.map(b => radio('price', b[0], b[1])))}
    ${group('Size', html`<div class="chips">${(f.category === 'Kids' && meta.kidsSizes ? meta.kidsSizes : meta.sizes).map(s => html`<label class="chip-opt"><input type="radio" name="size" value="${s}" ${f.size === s ? 'checked' : ''}><span>${s}</span></label>`)}</div>`)}
    ${group('Colour', [radio('color', '', 'Any'), meta.colors.map(c => radio('color', c, c))], false)}
    ${group('Availability', html`<label class="opt chk"><input type="checkbox" name="instock" ${f.instock ? 'checked' : ''}><span>In stock only</span></label><label class="opt chk"><input type="checkbox" name="sale" ${f.sale ? 'checked' : ''}><span>On offer</span></label>`, false)}`;

  render(el, html`
  <section class="page-head wrap"><nav class="crumbs" aria-label="Breadcrumb"><a href="#/">Home</a><span>/</span><span>Shop</span></nav>
    <h1 id="shopTitle">${f.collection || f.category || 'All pieces'}</h1><p class="sub" id="shopSub"></p></section>
  <div class="wrap shop-layout">
    <form class="filters" id="filters" aria-label="Filters">
      <div class="filters-head"><h2>Filters</h2><button type="button" class="icon-btn" data-action="filters-close" aria-label="Close filters">${icon('close')}</button></div>
      <div class="filters-scroll" id="filtersBody">${filtersHTML()}</div>
      <div class="filters-foot"><button type="button" class="btn btn-ghost" data-action="filters-clear">Clear all</button><button type="button" class="btn btn-primary" data-action="filters-close" id="filtersApply">Show results</button></div>
    </form>
    <div class="shop-main">
      <div class="toolbar">
        <button class="btn btn-ghost filter-btn" data-action="filters-open">${icon('filter')} Filters <span class="count-pill" id="filterCount" hidden></span></button>
        <p class="result-count" id="resultCount" aria-live="polite">&nbsp;</p>
        <label class="sort"><span>Sort by</span><select id="sortSel">${SORTS.map(([v, l]) => html`<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`)}</select></label>
      </div>
      <div class="chips-active" id="activeChips"></div>
      <div class="grid" id="grid">${skeletonCards(4)}</div>
    </div>
  </div>
  <div class="filters-backdrop" id="fbd" data-action="filters-close"></div>`);

  const grid = $('#grid', el), form = $('#filters', el);
  async function load(push) {
    const mine = ++seq;
    if (push) history.pushState(null, '', '#/shop' + (toQS() ? '?' + toQS() : ''));
    const chips = activeChips();
    $('#activeChips', el).innerHTML = chips.length ? html`${chips.map(([k, l]) => html`<button class="chip-x" data-action="chip-remove" data-k="${k}">${l} ${icon('close')}</button>`)}<button class="chip-clear" data-action="filters-clear">Clear all</button>`.s : '';
    const fc = $('#filterCount', el); fc.hidden = !chips.length; fc.textContent = chips.length;
    $('#shopTitle', el).textContent = f.q ? `Results for “${f.q}”` : f.collection || f.category || 'All pieces';
    document.title = `${$('#shopTitle', el).textContent} — Kumud Boutique`;
    try {
      const r = await get('/products?' + apiQS()); if (mine !== seq) return;
      $('#resultCount', el).textContent = `${r.total} piece${r.total === 1 ? '' : 's'}`;
      $('#filtersApply', el).textContent = `Show ${r.total} result${r.total === 1 ? '' : 's'}`;
      render(grid, r.products.length ? html`${r.products.map((p, i) => productCard(p, i))}` : html`<div class="grid-empty">${emptyState('No pieces match your filters', 'Try removing a filter or two — or tell us what you are looking for and we will design it.', '#/contact', 'Ask the atelier')}</div>`);
      window.dispatchEvent(new CustomEvent('kb:render', { detail: grid }));
    } catch (e) { render(grid, html`<div class="grid-empty"><p class="form-err">${e.message}</p></div>`); }
  }

  const sync = () => {
    const d = new FormData(form);
    ['category', 'collection', 'price', 'size', 'color'].forEach(k => { f[k] = d.get(k) || ''; });
    f.instock = d.has('instock'); f.sale = d.has('sale');
    load(true);
  };
  form.addEventListener('change', sync);
  $('#sortSel', el).addEventListener('change', e => { f.sort = e.target.value; load(true); });

  const setLayer = on => { form.classList.toggle('open', on); $('#fbd', el).classList.toggle('on', on); document.body.classList.toggle('locked', on && matchMedia('(max-width: 960px)').matches); };
  const setFilterUI = () => { $('#filtersBody', el).innerHTML = filtersHTML().s; };
  Object.assign(actions, {
    'filters-open': () => setLayer(true),
    'filters-close': () => setLayer(false),
    'filters-clear': () => { Object.keys(f).forEach(k => { f[k] = typeof f[k] === 'boolean' ? false : ''; }); setFilterUI(); load(true); },
    'chip-remove': b => { const k = b.dataset.k; f[k] = typeof f[k] === 'boolean' ? false : ''; setFilterUI(); load(true); }
  });
  onLeave(() => { document.body.classList.remove('locked'); delete actions['filters-open']; delete actions['filters-close']; delete actions['filters-clear']; delete actions['chip-remove']; });
  await load(false);
  return f.q ? `Results for “${f.q}”` : f.collection || f.category || 'Shop all';
}
