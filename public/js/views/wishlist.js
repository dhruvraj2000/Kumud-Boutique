import { html, render, get, state } from '../core.js';
import { productCard, emptyState, actions } from '../components.js';

export default async function wishlist({ el, onLeave }) {
  const { products } = await get('/products');
  const draw = () => {
    const list = products.filter(p => state.wish.has(p.id));
    render(el, html`<section class="wrap page-head"><nav class="crumbs"><a href="#/">Home</a><span>/</span><span>Wishlist</span></nav><h1>Your wishlist <small>${list.length} saved</small></h1>
      ${state.user ? '' : html`<p class="sub">Sign in to keep your wishlist across devices. <a class="link" href="#/login">Sign in</a></p>`}</section>
      <section class="wrap">${list.length ? html`<div class="grid">${list.map((p, i) => productCard(p, i))}</div>` : emptyState('Nothing saved yet', 'Tap the heart on any piece to save it here.', '#/shop', 'Discover pieces')}</section>`);
    window.dispatchEvent(new CustomEvent('kb:render', { detail: el }));
  };
  const on = e => { if (!e.detail.on) setTimeout(draw, 350); };
  window.addEventListener('kb:wish', on); onLeave(() => window.removeEventListener('kb:wish', on));
  draw(); return 'Wishlist';
}
