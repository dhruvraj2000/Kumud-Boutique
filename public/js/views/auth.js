import { html, render, post, onSubmit, setUser, loadUser, toast, $ } from '../core.js';
import { icon } from '../components.js';
import { go } from '../app.js';

export default async function auth({ el, params, query }) {
  const reg = params[0] === 'register', next = query.get('next') || '/account';
  render(el, html`<section class="wrap auth">
    <div class="auth-art"><div class="arch"><img src="/assets/atelier/atelier-indigo.webp" alt="" width="700" height="1244"></div><p class="eyebrow">Kumud Boutique</p><h2>${reg ? 'Join the atelier' : 'Welcome back'}</h2><p>Track orders, save favourites and check out in a few taps.</p></div>
    <div class="auth-card"><div class="tabs" role="tablist"><a href="#/login?next=${encodeURIComponent(next)}" class="${reg ? '' : 'on'}" role="tab">Sign in</a><a href="#/register?next=${encodeURIComponent(next)}" class="${reg ? 'on' : ''}" role="tab">Create account</a></div>
    <form id="authForm" novalidate>
      ${reg ? html`<div class="field"><label for="n">Full name</label><input id="n" name="name" autocomplete="name" required></div>` : ''}
      <div class="field"><label for="e">Email</label><input id="e" name="email" type="email" autocomplete="email" required></div>
      ${reg ? html`<div class="field"><label for="p">Mobile <small>(optional)</small></label><input id="p" name="phone" inputmode="tel" autocomplete="tel" placeholder="10-digit number"></div>` : ''}
      <div class="field pw"><label for="pw">Password</label><input id="pw" name="password" type="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required>
        <button type="button" class="link-btn show-pw" data-show="pw">Show</button>${reg ? html`<small class="hint">8+ characters with a letter and a number</small>` : ''}</div>
      <button class="btn btn-primary btn-block" type="submit">${reg ? 'Create account' : 'Sign in'}</button>
    </form>
    <p class="switch">${reg ? html`Already have an account? <a href="#/login?next=${encodeURIComponent(next)}">Sign in</a>` : html`New to Kumud? <a href="#/register?next=${encodeURIComponent(next)}">Create an account</a>`}</p></div></section>`);
  $('.show-pw', el).addEventListener('click', e => { const i = $('#pw', el), s = i.type === 'password'; i.type = s ? 'text' : 'password'; e.target.textContent = s ? 'Hide' : 'Show'; });
  onSubmit($('#authForm', el), async d => {
    const r = await post(reg ? '/auth/register' : '/auth/login', d); setUser(r.user); await loadUser();
    toast(reg ? `Welcome to Kumud, ${r.user.name.split(' ')[0]} ✦` : `Welcome back, ${r.user.name.split(' ')[0]}`); go(next.startsWith('/') ? next : '/account');
  }, reg ? 'Creating…' : 'Signing in…');
  return reg ? 'Create account' : 'Sign in';
}
