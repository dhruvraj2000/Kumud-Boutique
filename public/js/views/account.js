import { html, render, get, post, put, patch, del, $, $$, state, money, fmtDate, onSubmit, setUser, toast, formData } from '../core.js';
import { icon, actions, emptyState } from '../components.js';
import { go } from '../app.js';
import { measureFields, readMeasureForm, bindFigure } from '../measure.js';

export default async function account({ el, params, onLeave }) {
  if (!state.user) return go('/login?next=/account');
  const tab = params[0] || 'profile', u = state.user;
  const tabs = [['profile', 'Profile'], ['orders', 'Orders'], ['addresses', 'Addresses'], ['measurements', 'Measurements'], ['security', 'Password']];
  const shell = body => html`<section class="wrap page-head"><nav class="crumbs"><a href="#/">Home</a><span>/</span><span>Account</span></nav><h1>Hello, ${u.name.split(' ')[0]}</h1></section>
    <div class="wrap acct"><nav class="acct-nav" aria-label="Account">${tabs.map(([k, l]) => html`<a href="#/account/${k}" class="${tab === k ? 'on' : ''}">${l}</a>`)}<a href="#/wishlist">Wishlist <small>${state.wish.size}</small></a>${u.role === 'admin' ? html`<a href="#/admin" class="admin-link">Admin panel</a>` : ''}<button class="link-btn" data-action="logout">Sign out</button></nav><div class="acct-body">${body}</div></div>`;
  actions.logout = async () => { await post('/auth/logout'); setUser(null); state.wish = new Set(); toast('Signed out'); go('/'); };
  onLeave(() => delete actions.logout);

  if (tab === 'orders') {
    const { orders } = await get('/orders');
    render(el, shell(orders.length ? html`<div class="orders">${orders.map(o => html`<a class="o-card" href="#/orders/${o.number}"><div class="o-imgs">${o.items.slice(0, 3).map(i => html`<img src="${i.image.replace('.webp', '-sm.webp')}" alt="" width="56" height="70">`)}</div>
      <div><b>${o.number}</b><small>${fmtDate(o.createdAt)} · ${o.items.reduce((a, i) => a + i.qty, 0)} item(s)</small></div><span class="pill st-${o.status}">${o.status.replace(/_/g, ' ')}</span><b>${money(o.total)}</b>${icon('arrow')}</a>`)}</div>` : emptyState('No orders yet', 'When you place an order it will appear here.', '#/shop', 'Start shopping')));
  } else if (tab === 'addresses') {
    let list = (await get('/addresses')).addresses, editing = null;
    const form = a => html`<form id="adForm" class="card-form" novalidate><h3>${a ? 'Edit address' : 'Add a new address'}</h3>
      <div class="two"><div class="field"><label>Full name</label><input name="name" value="${a?.name || u.name}"></div><div class="field"><label>Mobile</label><input name="phone" inputmode="tel" value="${a?.phone || u.phone || ''}"></div></div>
      <div class="field"><label>Address</label><input name="line1" value="${a?.line1 || ''}"></div><div class="field"><label>Landmark <small>(optional)</small></label><input name="line2" value="${a?.line2 || ''}"></div>
      <div class="three"><div class="field"><label>City</label><input name="city" value="${a?.city || ''}"></div><div class="field"><label>State</label><input name="state" value="${a?.state || ''}"></div><div class="field"><label>PIN code</label><input name="pincode" inputmode="numeric" maxlength="6" value="${a?.pincode || ''}"></div></div>
      <div class="two"><div class="field"><label>Label</label><input name="label" placeholder="Home, Work…" value="${a?.label || 'Home'}"></div><label class="opt chk push"><input type="checkbox" name="isDefault" ${a?.is_default ? 'checked' : ''}><span>Make default</span></label></div>
      <div class="row-btns"><button class="btn btn-primary" type="submit">Save address</button>${a || list.length ? html`<button type="button" class="btn btn-ghost" data-action="addr-cancel">Cancel</button>` : ''}</div></form>`;
    const draw = () => {
      render(el, shell(html`<div class="addr-grid">${list.map(a => html`<div class="addr-card ${a.is_default ? 'def' : ''}"><p><b>${a.name}</b> <em>${a.label}</em> ${a.is_default ? html`<span class="pill sm">Default</span>` : ''}</p><p>${a.line1}${a.line2 ? ', ' + a.line2 : ''}<br>${a.city}, ${a.state} ${a.pincode}<br>${a.phone}</p>
        <div class="row-btns"><button class="link-btn" data-action="addr-edit" data-id="${a.id}">Edit</button><button class="link-btn" data-action="addr-del" data-id="${a.id}">Delete</button></div></div>`)}</div>
        <div id="adHost">${editing !== null || !list.length ? form(editing) : html`<button class="btn btn-ghost" data-action="addr-new">${icon('plus')} Add new address</button>`}</div>`));
      const f = $('#adForm', el);
      f && onSubmit(f, async d => {
        const body = { ...d, isDefault: !!d.isDefault };
        const r = editing ? await put('/addresses/' + editing.id, body) : await post('/addresses', body);
        list = r.addresses; editing = null; draw(); toast('Address saved');
      }, 'Saving…');
    };
    Object.assign(actions, {
      'addr-new': () => { editing = {}; editing = null; $('#adHost', el).innerHTML = form(null).s; const f = $('#adForm', el); onSubmit(f, async d => { list = (await post('/addresses', { ...d, isDefault: !!d.isDefault })).addresses; draw(); toast('Address saved'); }, 'Saving…'); },
      'addr-edit': b => { editing = list.find(a => a.id === +b.dataset.id); draw(); },
      'addr-cancel': () => { editing = null; draw(); },
      'addr-del': async b => { if (!confirm('Delete this address?')) return; list = (await del('/addresses/' + b.dataset.id)).addresses; draw(); toast('Address deleted'); }
    });
    onLeave(() => ['addr-new', 'addr-edit', 'addr-cancel', 'addr-del'].forEach(k => delete actions[k]));
    draw();
  } else if (tab === 'measurements') {
    const { measurements: m, updatedAt } = await get('/account/measurements');
    render(el, shell(html`<form id="mForm" class="card-form" novalidate><h3>Your measurements</h3>
      <p class="muted">Save these once and choose “Use my saved measurements” at checkout — our atelier tailors every piece to them.${updatedAt ? html` <span class="saved-at">Last updated ${fmtDate(updatedAt)}</span>` : ''}</p>
      ${measureFields(m || {})}
      <button class="btn btn-primary" type="submit">${m ? 'Update measurements' : 'Save measurements'}</button></form>`));
    bindFigure($('#mForm', el));
    onSubmit($('#mForm', el), async d => { await put('/account/measurements', readMeasureForm(d)); toast('Measurements saved ✦'); }, 'Saving…');
  } else if (tab === 'security') {
    render(el, shell(html`<form id="pwForm" class="card-form narrow" novalidate><h3>Change password</h3>
      <div class="field"><label for="cp">Current password</label><input id="cp" name="currentPassword" type="password" autocomplete="current-password"></div>
      <div class="field"><label for="np">New password</label><input id="np" name="newPassword" type="password" autocomplete="new-password"><small class="hint">8+ characters with a letter and a number</small></div>
      <button class="btn btn-primary" type="submit">Update password</button></form>`));
    onSubmit($('#pwForm', el), async (d, f) => { await post('/account/password', d); f.reset(); toast('Password updated'); }, 'Updating…');
  } else {
    render(el, shell(html`<form id="pfForm" class="card-form narrow" novalidate><h3>Your details</h3>
      <div class="field"><label for="pn">Full name</label><input id="pn" name="name" value="${u.name}" autocomplete="name"></div>
      <div class="field"><label for="pe">Email</label><input id="pe" value="${u.email}" disabled><small class="hint">Email can't be changed.</small></div>
      <div class="field"><label for="pp">Mobile</label><input id="pp" name="phone" inputmode="tel" value="${u.phone || ''}" autocomplete="tel"></div>
      <button class="btn btn-primary" type="submit">Save changes</button></form>`));
    onSubmit($('#pfForm', el), async d => { const r = await patch('/account', { name: d.name, phone: d.phone }); setUser(r.user); toast('Profile updated'); $('.page-head h1', el).textContent = 'Hello, ' + r.user.name.split(' ')[0]; }, 'Saving…');
  }
  return 'My account';
}
