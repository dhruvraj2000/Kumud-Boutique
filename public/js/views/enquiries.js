// Admin → Enquiries: contact-form submissions with status, search and a link to the sender's visit history.
import { html, render, get, patch, $, fmtDate, toast, onSubmit } from '../core.js';
import { actions } from '../components.js';

const LABEL = { new: 'New', read: 'Read', replied: 'Replied', closed: 'Closed' };

export default async function enquiriesTab(el, shell, onLeave, opt = {}) {
  const status = opt.status || '', q = opt.q || '';
  const { inquiries, counts, statuses } = await get(`/admin/inquiries?status=${status}&q=${encodeURIComponent(q)}`);
  const redo = o => enquiriesTab(el, shell, () => {}, { status, q, ...o }).catch(e => toast(e.message, 'warn'));
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  render(el, shell(html`
    <div class="ord-bar"><div class="chips"><button class="chip ${status === '' ? 'on' : ''}" data-action="enq-filter" data-s="">All (${total})</button>${statuses.map(s => html`<button class="chip ${status === s ? 'on' : ''}" data-action="enq-filter" data-s="${s}">${LABEL[s]} (${counts[s] || 0})</button>`)}</div>
      <form id="esearch" class="ord-bar"><input name="q" value="${q}" placeholder="Search enquiries…" aria-label="Search enquiries"><button class="btn btn-ghost sm">Search</button></form></div>
    ${inquiries.length ? html`<div class="inq-list">${inquiries.map(i => html`<article class="panel"><header class="p-head"><b>${i.name}</b> ${i.status === 'new' ? html`<span class="chip on">New</span>` : html`<small>${LABEL[i.status] || i.status}</small>`}<small>${fmtDate(i.created_at, true)}</small></header>
      <p><a href="mailto:${i.email}">${i.email}</a> ${i.phone ? html`· <a href="tel:${i.phone}">${i.phone}</a>` : ''}</p>
      <p><b>${i.topic}</b>${i.preferred_date ? ' · prefers ' + i.preferred_date : ''}</p><p>${i.message}</p>
      <div class="chips">${statuses.filter(s => s !== i.status).map(s => html`<button class="btn btn-ghost sm" data-action="enq-set" data-id="${i.id}" data-s="${s}">Mark ${LABEL[s].toLowerCase()}</button>`)}${i.visitor_id ? html`<a class="btn btn-ghost sm" href="#/admin/traffic">Visit history</a>` : ''}</div></article>`)}</div>` : html`<p class="muted">No enquiries${status || q ? ' match' : ' yet'}.</p>`}`));
  onSubmit($('#esearch', el), async d => { await redo({ q: (d.q || '').trim() }); }, 'Searching…');
  actions['enq-filter'] = b => redo({ status: b.dataset.s });
  actions['enq-set'] = async b => { try { await patch('/admin/inquiries/' + b.dataset.id, { status: b.dataset.s }); await redo({}); } catch (e) { toast(e.message, 'warn'); } };
  onLeave(() => { for (const k of ['enq-filter', 'enq-set']) delete actions[k]; });
}
