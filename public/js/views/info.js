import { html, render, post, $, state, onSubmit, toast } from '../core.js';
import { icon } from '../components.js';

const head = (t, sub) => html`<section class="wrap page-head"><nav class="crumbs"><a href="#/">Home</a><span>/</span><span>${t}</span></nav><h1>${t}</h1>${sub ? html`<p class="sub">${sub}</p>` : ''}</section>`;

const PAGES = {
  about: () => html`${head('Our story')}
    <section class="wrap about"><div class="about-art" data-reveal><figure class="arch-frame a"><img src="/assets/atelier/atelier-wide.webp" alt="Inside the Kumud Boutique showroom" width="900" height="900"></figure></div>
    <div class="about-copy" data-reveal><p class="eyebrow">Kumud Fashion Design</p><h2>Tradition, <em>tailored</em> to you.</h2>
      <p>Kumud began with a simple idea: festive wear should feel as personal as it looks. We work with Ajrakh, indigo dabu and black-ground block prints — patterns that have travelled for generations — and finish each piece with mirror work, cowrie shells, lace and tassels.</p>
      <p>Every lehenga leaves our atelier fitted to the person who will wear it. Tell us your measurements and we adjust the choli, blouse length and waist at no extra charge.</p>
      <ul class="vals"><li>${icon('sparkle')}<div><b>Handblock prints</b><span>Classic Ajrakh, indigo and noir motifs.</span></div></li><li>${icon('scissors')}<div><b>Made to measure</b><span>Free fit adjustments on every piece.</span></div></li><li>${icon('box')}<div><b>Careful packing</b><span>Wrapped in muslin and tracked to your door.</span></div></li></ul>
      <a class="btn btn-primary" href="#/shop">Explore the collection ${icon('arrow')}</a></div></section>`,
  shipping: () => html`${head('Shipping & returns')}<section class="wrap prose">
    <h2>Shipping</h2><ul class="dots"><li>Free shipping on orders above ₹7,500; ₹199 flat below that.</li><li>Ready pieces ship in 2–3 working days; made-to-measure adjustments add 2–3 working days.</li><li>Most addresses in India receive their order within 4–8 working days.</li><li>You will see tracking updates on the <a href="#/track">Track order</a> page.</li></ul>
    <h2>Exchanges</h2><ul class="dots"><li>Unaltered pieces can be exchanged within 7 days of delivery for another size or piece.</li><li>Pieces altered to your measurements are final sale unless there is a defect.</li><li>Items must be unworn, with tags attached and in original packing.</li></ul>
    <h2>Cancellations</h2><ul class="dots"><li>Orders can be cancelled online until they move to preparation. After that, please <a href="#/contact">contact us</a>.</li><li>Prepaid orders cancelled in time are refunded to the original payment method.</li></ul></section>`,
  'size-guide': () => html`${head('Size guide', 'Body measurements in inches. Between sizes? Choose the larger one — we adjust the fit free of charge.')}<section class="wrap prose">
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Size</th><th>Bust</th><th>Waist</th><th>Hip</th></tr></thead><tbody>${[['XS', 32, 26, 35], ['S', 34, 28, 37], ['M', 36, 30, 39], ['L', 38, 32, 41], ['XL', 40, 34, 43]].map(r => html`<tr>${r.map(c => html`<td>${c}</td>`)}</tr>`)}</tbody></table></div>
    <h2>How to measure</h2><ul class="dots"><li><b>Bust</b> — around the fullest part of your chest, tape level under the arms.</li><li><b>Waist</b> — around the narrowest part of your natural waist.</li><li><b>Hip</b> — around the fullest part of your hips.</li></ul>
    <p>Add your exact measurements in the order notes at checkout and we will tailor to them.</p></section>`
};

async function contact(el) {
  render(el, html`${head('Contact & bespoke', 'Book a consultation, ask about a custom piece or tell us about your occasion.')}
  <section class="wrap contact"><div class="contact-info"><ul><li>${icon('mail')}<div><b>Email</b><span><a href="mailto:kumudgunjankumawat@gmail.com">kumudgunjankumawat@gmail.com</a></span></div></li><li>${icon('phone')}<div><b>Call or WhatsApp</b><span><a href="tel:+917742584375">+91 77425 84375</a></span></div></li><li>${icon('sparkle')}<div><b>Consultations</b><span>By appointment — request a slot with the form.</span></div></li><li>${icon('pin')}<div><b>Atelier</b><span>1715 Neemuch Mata Scheme, Dewali, Udaipur, Rajasthan<br>Visits by appointment · <a class="link" href="https://www.google.com/maps/search/?api=1&query=1715+Neemuch+Mata+Scheme+Dewali+Udaipur+Rajasthan" target="_blank" rel="noopener">Get directions</a></span></div></li></ul>
    <figure class="arch-frame"><img src="/assets/atelier/atelier-black.webp" alt="" loading="lazy" width="800" height="1067"></figure></div>
    <form id="inqForm" class="card-form" novalidate><h3>Request a consultation</h3>
      <div class="two"><div class="field"><label for="iq1">Your name</label><input id="iq1" name="name" autocomplete="name" value="${state.user ? state.user.name : ''}"></div><div class="field"><label for="iq2">Email</label><input id="iq2" name="email" type="email" autocomplete="email" value="${state.user ? state.user.email : ''}"></div></div>
      <div class="two"><div class="field"><label for="iq3">Mobile <small>(optional)</small></label><input id="iq3" name="phone" inputmode="tel" autocomplete="tel"></div><div class="field"><label for="iq4">Preferred date <small>(optional)</small></label><input id="iq4" name="preferredDate" type="date"></div></div>
      <div class="field"><label for="iq5">I'm interested in</label><select id="iq5" name="topic"><option>Bespoke lehenga</option><option>Wedding / sangeet outfit</option><option>Fit adjustment</option><option>Order help</option><option>Something else</option></select></div>
      <div class="field"><label for="iq6">Tell us more</label><textarea id="iq6" name="message" rows="5" maxlength="1500" placeholder="Occasion, colours, budget, timeline…"></textarea></div>
      <button class="btn btn-primary" type="submit">Send request</button></form></section>`);
  const form = $('#inqForm', el); form.elements.preferredDate.min = new Date().toISOString().slice(0, 10);
  onSubmit(form, async d => { await post('/inquiries', d); form.innerHTML = html`<div class="success sm"><svg viewBox="0 0 52 52" class="tick"><circle cx="26" cy="26" r="24"/><path d="M15 27l8 8 14-16"/></svg><h3>Request received</h3><p>Thank you — our team will reach out within one working day.</p></div>`.s; toast('Request sent ✦'); }, 'Sending…');
}

export default async function info({ el, params }) {
  const k = params[0];
  if (k === 'contact') await contact(el); else render(el, PAGES[k]());
  window.dispatchEvent(new CustomEvent('kb:render', { detail: el }));
  return { about: 'Our story', contact: 'Contact & bespoke', shipping: 'Shipping & returns', 'size-guide': 'Size guide' }[k];
}
