// Customer booking flows: outfit rental (date range) and atelier appointment (date + slot). Prices come from the server rate calendar.
import { html, render, get, post, $, onSubmit, money } from '../core.js';

const head = (t, sub) => html`<section class="wrap page-head"><nav class="crumbs"><a href="#/">Home</a><span>/</span><span>${t}</span></nav><h1>${t}</h1>${sub ? html`<p class="sub">${sub}</p>` : ''}</section>`;
const fd = d => new Date(d + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

export default async function booking({ el, params }) {
  const rent = params[0] === 'rent', kind = rent ? 'rental' : 'appointment';
  const title = rent ? 'Rent a piece' : 'Book an appointment';
  const sub = rent ? 'Choose your dates — the price for each day is shown before you book.' : 'Pick a day and time for a consultation or fitting at our Udaipur atelier.';
  let items = [];
  try { items = (await get('/items?kind=' + kind)).items; }
  catch {
    render(el, html`${head(title, sub)}<section class="wrap page-narrow empty"><p>Online booking is not available right now. Please <a href="#/contact">contact us</a> or message us on WhatsApp and we will book it for you.</p></section>`);
    return title;
  }
  if (!items.length) {
    render(el, html`${head(title, sub)}<section class="wrap page-narrow empty"><p>Nothing is open for booking yet. Please <a href="#/contact">contact us</a>.</p></section>`);
    return title;
  }
  render(el, html`${head(title, sub)}<section class="wrap contact"><form id="bkForm" class="card-form narrow" novalidate>
    <div class="field"><label for="bk1">${rent ? 'Outfit' : 'Service'}</label><select id="bk1" name="item">${items.map(i => html`<option value="${i.id}">${i.name}</option>`)}</select></div>
    <div class="two"><div class="field"><label for="bk2">${rent ? 'Start date' : 'Date'}</label><input id="bk2" name="from" type="date" min="${today()}"></div>
    ${rent ? html`<div class="field"><label for="bk3">End date</label><input id="bk3" name="to" type="date" min="${today()}"></div>` : html`<div class="field"><label for="bk4">Time</label><select id="bk4" name="slotTime"><option value="">Choose a date first</option></select></div>`}</div>
    <div id="bkQuote" class="quote-box" aria-live="polite"></div>
    <div class="two"><div class="field"><label for="bk5">Your name</label><input id="bk5" name="name" autocomplete="name"></div><div class="field"><label for="bk6">Mobile</label><input id="bk6" name="phone" inputmode="tel" autocomplete="tel"></div></div>
    <div class="field"><label for="bk7">Email <small>(optional)</small></label><input id="bk7" name="email" type="email" autocomplete="email"></div>
    <div class="field"><label for="bk8">Notes <small>(optional)</small></label><textarea id="bk8" name="notes" rows="3" maxlength="1000"></textarea></div>
    <button class="btn btn-primary" type="submit">${rent ? 'Request booking' : 'Book appointment'}</button></form></section>`);

  const form = $('#bkForm', el), box = $('#bkQuote', el);
  let seq = 0, timer = null;
  const refresh = () => { clearTimeout(timer); timer = setTimeout(update, 250); };
  async function update() {
    const my = ++seq, item = form.elements.item.value, from = form.elements.from.value, to = rent ? form.elements.to.value : '';
    box.textContent = '';
    if (!from || (rent && !to)) return;
    try {
      if (!rent) {
        const { slots } = await get(`/slots?item=${item}&date=${from}`);
        if (my !== seq) return;
        const sel = form.elements.slotTime, keep = sel.value; sel.replaceChildren();
        for (const s of slots) { const o = new Option(s.left ? s.time : s.time + ' (full)', s.time); o.disabled = !s.left; sel.add(o); }
        if (!slots.length) sel.add(new Option('No slots on this day', ''));
        else if (slots.some(s => s.time === keep && s.left)) sel.value = keep;
      }
      const q = await get(`/rates/quote?item=${item}&from=${from}&to=${to}`);
      if (my !== seq) return;
      const rows = rent ? q.days.map(d => html`<li><span>${fd(d.date)}${d.label ? ' · ' + d.label : ''}</span><b>${money(d.price)}</b></li>`) : '';
      render(box, html`<ul class="quote-days">${rows}</ul><p class="quote-total"><span>${rent ? `Total for ${q.days.length} day${q.days.length > 1 ? 's' : ''}` : 'Consultation fee'}</span> <b>${money(q.total)}</b></p>${rent && q.item.deposit ? html`<p class="muted">Refundable deposit of ${money(q.item.deposit)} is collected at pickup.</p>` : ''}`);
    } catch (e) { if (my === seq) box.textContent = e.message; }
  }
  form.addEventListener('change', refresh);

  onSubmit(form, async d => {
    const r = await post('/bookings', { itemId: Number(d.item), from: d.from, to: rent ? d.to : undefined, slotTime: rent ? undefined : d.slotTime, name: d.name, phone: d.phone, email: d.email, notes: d.notes });
    render(form, html`<div class="success sm"><h3>Thank you — request received</h3><p>Your reference is <b>${r.ref}</b> (${money(r.total)}). The atelier will confirm shortly on the number you gave us.</p><a class="btn btn-ghost" href="#/">Back to home</a></div>`);
  }, 'Booking…');
  return title;
}
