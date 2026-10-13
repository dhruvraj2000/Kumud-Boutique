import { html, render, get, post, $, $$, state, money, quote, applyQuoteToCart, clearCart, onSubmit, toast } from '../core.js';
import { icon, actions, thumb } from '../components.js';
import { go } from '../app.js';
import { getCoupon, setCoupon, summary, couponBox } from './cart.js';
import { measureFields, readMeasureForm, bindFigure } from '../measure.js';
import { measureList } from './order.js';

const STATES = ['Andhra Pradesh', 'Assam', 'Bihar', 'Chandigarh', 'Chhattisgarh', 'Delhi', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jammu & Kashmir', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Odisha', 'Punjab', 'Rajasthan', 'Tamil Nadu', 'Telangana', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Other'];

export default async function checkout({ el, onLeave }) {
  if (!state.cart.length) { render(el, html`<section class="wrap page-narrow empty"><h1>Your bag is empty</h1><p>Add a piece before checking out.</p><a class="btn btn-primary" href="#/shop">Shop now</a></section>`); return 'Checkout'; }
  let q = await quote(getCoupon());
  if (applyQuoteToCart(q)) { q.warnings.forEach(w => toast(w.message, 'warn')); if (!state.cart.length) return go('/cart'); q = await quote(getCoupon()); }
  let addresses = [], pay = 'cod', chosen = 'new', fit = 'standard', saved = null;
  if (state.user) {
    try { addresses = (await get('/addresses')).addresses; if (addresses.length) chosen = String(addresses[0].id); } catch { /* ignore */ }
    try { saved = (await get('/account/measurements')).measurements; if (saved) fit = 'saved'; } catch { /* ignore */ }
  }
  const u = state.user, def = addresses[0];

  const draw = () => render(el, html`
  <section class="wrap page-head"><nav class="crumbs"><a href="#/cart">Bag</a><span>/</span><span>Checkout</span></nav><h1>Checkout</h1>
    ${u ? '' : html`<p class="sub">Have an account? <a class="link" href="#/login?next=/checkout">Sign in</a> for faster checkout — or continue as a guest.</p>`}</section>
  <form class="wrap checkout" id="coForm" novalidate>
    <div class="co-main">
      <section class="co-card"><h2><i>1</i> Contact</h2>
        <div class="field"><label for="ce">Email</label><input id="ce" name="email" type="email" value="${u ? u.email : ''}" autocomplete="email" required><small class="hint">Order updates are sent here.</small></div></section>

      <section class="co-card"><h2><i>2</i> Delivery address</h2>
        ${addresses.length ? html`<div class="addr-pick">${addresses.map(a => html`<label class="addr-opt"><input type="radio" name="addrPick" value="${a.id}" ${chosen === String(a.id) ? 'checked' : ''}><span><b>${a.name}</b> <em>${a.label}</em><br>${a.line1}${a.line2 ? ', ' + a.line2 : ''}, ${a.city}, ${a.state} ${a.pincode}<br>${a.phone}</span></label>`)}
          <label class="addr-opt"><input type="radio" name="addrPick" value="new" ${chosen === 'new' ? 'checked' : ''}><span><b>Use a different address</b></span></label></div>` : ''}
        <div class="addr-fields" id="addrFields" ${chosen !== 'new' ? 'hidden' : ''}>
          <div class="two"><div class="field"><label for="an">Full name</label><input id="an" name="name" autocomplete="name" value="${u ? u.name : ''}"></div>
          <div class="field"><label for="ap">Mobile number</label><input id="ap" name="phone" inputmode="tel" autocomplete="tel" placeholder="10-digit mobile" value="${u ? u.phone : ''}"></div></div>
          <div class="field"><label for="a1">Address</label><input id="a1" name="line1" autocomplete="address-line1" placeholder="House no., street, area"></div>
          <div class="field"><label for="a2">Landmark / apartment <small>(optional)</small></label><input id="a2" name="line2" autocomplete="address-line2"></div>
          <div class="three"><div class="field"><label for="ac">City</label><input id="ac" name="city" autocomplete="address-level2"></div>
          <div class="field"><label for="as">State</label><select id="as" name="state" autocomplete="address-level1"><option value="">Select state</option>${STATES.map(s => html`<option>${s}</option>`)}</select></div>
          <div class="field"><label for="az">PIN code</label><input id="az" name="pincode" inputmode="numeric" maxlength="6" autocomplete="postal-code"></div></div>
        </div></section>

      <section class="co-card"><h2><i>3</i> Fit <small>made to measure, free</small></h2>
        <div class="fit-pick" role="radiogroup" aria-label="Fit">${[['standard', 'Standard size', 'Use the sizes in your bag'], ...(saved ? [['saved', 'My saved measurements', 'From your account']] : []), ['custom', 'Enter measurements', 'We tailor to you']].map(([k, l, sub]) => html`<label class="fit-opt"><input type="radio" name="fit" value="${k}" ${fit === k ? 'checked' : ''}><span><b>${l}</b><small>${sub}</small></span></label>`)}</div>
        <div class="fit-panel" data-f="saved" ${fit !== 'saved' ? 'hidden' : ''}>${saved ? measureList(saved) : ''}<a class="link" href="#/account/measurements">Edit in your account</a></div>
        <div class="fit-panel" data-f="custom" ${fit !== 'custom' ? 'hidden' : ''}>${measureFields({}, { forWhom: true })}
          ${state.user ? html`<label class="opt chk"><input type="checkbox" name="saveM" checked> Save these to my account for next time</label>` : ''}</div>
      </section>

      <section class="co-card"><h2><i>4</i> Payment</h2>
        <div class="pay-tabs" role="tablist">${[['cod', 'Cash on delivery'], ['upi', 'UPI'], ['card', 'Card']].map(([k, l]) => html`<button type="button" role="tab" class="${pay === k ? 'on' : ''}" data-action="pay-tab" data-k="${k}" aria-selected="${pay === k}">${l}</button>`)}</div>
        <div class="pay-panel" data-p="cod" ${pay !== 'cod' ? 'hidden' : ''}><p>Pay in cash or by UPI to the courier when your order arrives. ${icon('check')} No extra fee.</p></div>
        <div class="pay-panel" data-p="upi" ${pay !== 'upi' ? 'hidden' : ''}><div class="field"><label for="upi">UPI ID</label><input id="upi" name="upiId" placeholder="yourname@bank" autocomplete="off"></div></div>
        <div class="pay-panel" data-p="card" ${pay !== 'card' ? 'hidden' : ''}>
          <div class="field"><label for="cn">Card number</label><input id="cn" name="cardNumber" inputmode="numeric" autocomplete="cc-number" placeholder="1234 5678 9012 3456" maxlength="23"></div>
          <div class="field"><label for="cnm">Name on card</label><input id="cnm" name="cardName" autocomplete="cc-name"></div>
          <div class="two"><div class="field"><label for="cx">Expiry</label><input id="cx" name="expiry" inputmode="numeric" autocomplete="cc-exp" placeholder="MM/YY" maxlength="5"></div><div class="field"><label for="cv">CVV</label><input id="cv" name="cvv" inputmode="numeric" autocomplete="cc-csc" maxlength="4" type="password"></div></div>
        </div>
        <p class="demo-note">${icon('lock')} Demo store: online payments are simulated and no card is ever charged or stored.</p></section>

      <section class="co-card"><h2><i>5</i> Notes <small>(optional)</small></h2><div class="field"><label class="sr" for="nt">Order notes</label><textarea id="nt" name="notes" rows="2" maxlength="300" placeholder="Measurements, blouse length, delivery instructions…"></textarea></div></section>
    </div>

    <aside class="summary sticky"><h2>Your order</h2>
      <ul class="mini">${q.lines.map(l => html`<li><span class="mi"><img src="${thumb(l.image)}" alt="" width="64" height="80"><em>${l.qty}</em></span><div><b>${l.name}</b><small>Size ${l.size}</small></div><span>${money(l.lineTotal)}</span></li>`)}</ul>
      <div id="coCoupon">${couponBox(q, getCoupon())}</div>${summary(q, { editable: false })}
      <button class="btn btn-primary btn-block" type="submit" id="placeBtn">Place order · ${money(q.total)}</button>
      <p class="secure">${icon('lock')} Your details are sent over a secure connection.</p></aside>
  </form>`);

  const bind = () => {
    const form = $('#coForm', el);
    bindFigure(form);
    $$('input[name=fit]', form).forEach(r => r.addEventListener('change', () => { fit = r.value; $$('.fit-panel', form).forEach(p => { p.hidden = p.dataset.f !== fit; }); $$('.fit-panel[data-f=custom] input[required]', form).forEach(i => { i.required = fit === 'custom'; }); }));
    $$('input[name=addrPick]', form).forEach(r => r.addEventListener('change', () => { chosen = r.value; $('#addrFields', el).hidden = chosen !== 'new'; }));
    $('#cn', form).addEventListener('input', e => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 19).replace(/(.{4})/g, '$1 ').trim(); });
    $('#cx', form).addEventListener('input', e => { let v = e.target.value.replace(/\D/g, '').slice(0, 4); if (v.length > 2) v = v.slice(0, 2) + '/' + v.slice(2); e.target.value = v; });
    const inp = $('#cpn', el); inp && inp.addEventListener('keydown', ev => { if (ev.key === 'Enter') { ev.preventDefault(); actions['coupon-apply'](); } });
    onSubmit(form, async d => {
      let address;
      if (chosen !== 'new') { const a = addresses.find(x => String(x.id) === chosen); address = { name: a.name, phone: a.phone, line1: a.line1, line2: a.line2, city: a.city, state: a.state, pincode: a.pincode, label: a.label }; }
      else address = { name: d.name, phone: d.phone, line1: d.line1, line2: d.line2, city: d.city, state: d.state, pincode: d.pincode };
      const payment = { method: pay, upiId: d.upiId, cardNumber: d.cardNumber, cardName: d.cardName, expiry: d.expiry, cvv: d.cvv };
      try {
        const r = await post('/orders', { email: d.email, items: state.cart.map(({ id, size, qty }) => ({ id, size, qty })), coupon: getCoupon(), address, payment, notes: d.notes,
          fit, measurements: fit === 'custom' ? readMeasureForm(d) : undefined, saveMeasurements: d.saveM === 'on' });
        clearCart(); setCoupon(''); go(`/orders/${r.order.number}?new=1${state.user ? '' : '&email=' + encodeURIComponent(d.email)}`);
      } catch (err) {
        if (err.status === 409) { const t = await quote(getCoupon()); applyQuoteToCart(t); toast(err.message, 'warn'); if (!state.cart.length) return go('/cart'); await reload(); return; }
        if (err.field && err.field.startsWith('m_') && fit !== 'custom') { fit = 'custom'; await reload(); }
        if (['upiId', 'cardNumber', 'expiry', 'cvv', 'cardName'].includes(err.field)) { const tab = err.field === 'upiId' ? 'upi' : 'card'; if (pay !== tab) actions['pay-tab']({ dataset: { k: tab } }); }
        throw err;
      }
    }, 'Placing your order…');
  };
  const reload = async () => { const keep = $('#coForm', el) && Object.fromEntries(new FormData($('#coForm', el)).entries()); q = await quote(getCoupon()); draw(); bind(); if (keep) Object.entries(keep).forEach(([k, v]) => { const i = $('#coForm', el).elements[k]; if (i && i.type !== 'radio' && !(k === 'cardNumber' || k === 'cvv')) i.value = v; }); };
  actions['pay-tab'] = b => { pay = b.dataset.k; $$('.pay-tabs button', el).forEach(t => { t.classList.toggle('on', t.dataset.k === pay); t.setAttribute('aria-selected', t.dataset.k === pay); }); $$('.pay-panel', el).forEach(p => { p.hidden = p.dataset.p !== pay; }); };
  actions['coupon-apply'] = async () => {
    const code = ($('#cpn', el)?.value || '').trim().toUpperCase(); if (!code) return;
    const t = await quote(code), cf = $('#couponForm', el);
    if (!t.coupon) { cf.querySelector('.field-err')?.remove(); cf.appendChild(Object.assign(document.createElement('p'), { className: 'field-err', textContent: t.couponMessage })); return; }
    setCoupon(code); toast(t.couponMessage); await reload();
  };
  actions['coupon-remove'] = async () => { setCoupon(''); await reload(); };
  onLeave(() => { delete actions['pay-tab']; delete actions['coupon-remove']; delete actions['coupon-apply']; });
  draw(); bind();
  return 'Checkout';
}
