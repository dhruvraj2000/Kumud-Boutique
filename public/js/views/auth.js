import { html, render, post, onSubmit, setUser, loadUser, toast, $, showFieldError } from '../core.js';
import { go } from '../app.js';

const TITLES = { login: 'Welcome back', register: 'Join the atelier', forgot: 'Reset your password', reset: 'Choose a new password' };
export default async function auth({ el, params, query }) {
  const mode = params[0] || 'login', reg = mode === 'register', next = query.get('next') || '/account', nq = encodeURIComponent(next);
  const pwField = (label, name, auto, hint) => html`<div class="field pw"><label for="pw">${label}</label><input id="pw" name="${name}" type="password" autocomplete="${auto}" required>
        <button type="button" class="link-btn show-pw" data-show="pw">Show</button>${hint ? html`<small class="hint">${hint}</small>` : ''}</div>`;
  let form;
  if (mode === 'forgot') form = html`<p class="muted">Enter your email and we’ll send a link to set a new one. The link works once and expires in an hour.</p>
      <div class="field"><label for="e">Email</label><input id="e" name="email" type="email" autocomplete="email" required></div>
      <button class="btn btn-primary btn-block" type="submit">Send reset link</button>`;
  else if (mode === 'reset') form = html`<input type="hidden" name="token" value="${query.get('token') || ''}">${pwField('New password', 'password', 'new-password', '8+ characters with a letter and a number (12+ for staff)')}
      <button class="btn btn-primary btn-block" type="submit">Save new password</button>`;
  else form = html`${reg ? html`<div class="field"><label for="n">Full name</label><input id="n" name="name" autocomplete="name" required></div>` : ''}
      <div class="field"><label for="e">Email</label><input id="e" name="email" type="email" autocomplete="email" required></div>
      ${reg ? html`<div class="field"><label for="p">Mobile <small>(optional)</small></label><input id="p" name="phone" inputmode="tel" autocomplete="tel" placeholder="10-digit number"></div>` : ''}
      ${pwField('Password', 'password', reg ? 'new-password' : 'current-password', reg ? '8+ characters with a letter and a number' : '')}
      ${reg ? '' : html`<div class="field" id="mfaRow" hidden><label for="code">Authenticator code</label><input id="code" name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="6-digit code or recovery code"></div>
        <p class="switch left"><a href="#/forgot">Forgot your password?</a></p>`}
      <button class="btn btn-primary btn-block" type="submit">${reg ? 'Create account' : 'Sign in'}</button>`;
  const tabs = mode === 'forgot' || mode === 'reset' ? '' : html`<div class="tabs" role="tablist"><a href="#/login?next=${nq}" class="${reg ? '' : 'on'}" role="tab">Sign in</a><a href="#/register?next=${nq}" class="${reg ? 'on' : ''}" role="tab">Create account</a></div>`;
  render(el, html`<section class="wrap auth">
    <div class="auth-art"><div class="arch"><img src="/assets/atelier/atelier-indigo.webp" alt="" width="700" height="1244"></div><p class="eyebrow">Kumud Boutique</p><h2>${TITLES[mode]}</h2><p>Track orders, save favourites and check out in a few taps.</p></div>
    <div class="auth-card">${tabs}<form id="authForm" novalidate>${form}</form>
    <p class="switch">${reg ? html`Already have an account? <a href="#/login?next=${nq}">Sign in</a>` : mode === 'login' ? html`New to Kumud? <a href="#/register?next=${nq}">Create an account</a>` : html`<a href="#/login">Back to sign in</a>`}</p></div></section>`);
  const sp = $('.show-pw', el); if (sp) sp.addEventListener('click', e => { const i = $('#pw', el), s = i.type === 'password'; i.type = s ? 'text' : 'password'; e.target.textContent = s ? 'Hide' : 'Show'; });
  onSubmit($('#authForm', el), async (d, f) => {
    if (mode === 'forgot') { const r = await post('/auth/forgot', d); render($('.auth-card', el), html`<h3>Check your email</h3><p>${r.message}</p><p class="switch"><a href="#/login">Back to sign in</a></p>`); return; }
    if (mode === 'reset') { await post('/auth/reset', d); toast('Password updated — please sign in.'); go('/login'); return; }
    let r;
    try { r = await post(reg ? '/auth/register' : '/auth/login', d); }
    catch (e) { if (e.data && e.data.mfaRequired) { $('#mfaRow', f).hidden = false; showFieldError(f, 'code', e.message); return; } throw e; }
    setUser(r.user, r.csrf); await loadUser();
    toast(reg ? `Welcome to Kumud, ${r.user.name.split(' ')[0]} ✦` : `Welcome back, ${r.user.name.split(' ')[0]}`);
    go(r.mfaSetupRequired ? '/admin/security' : next.startsWith('/') ? next : '/account');
  }, mode === 'forgot' ? 'Sending…' : mode === 'reset' ? 'Saving…' : reg ? 'Creating…' : 'Signing in…');
  return TITLES[mode];
}
