// Admin → Visitors: daily traffic, who visited, and each visitor's page trail.
import { html, render, raw, get, $, toast, onSubmit } from '../core.js';
import { actions } from '../components.js';

const when = ms => new Date(ms).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const table = (head, rows) => (rows.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr>${head.map(h => html`<th>${h}</th>`)}</tr></thead><tbody>${rows}</tbody></table></div>` : html`<p class="muted">Nothing yet.</p>`);

const chart = daily => {
  const W = 640, H = 160, pad = 24, max = Math.max(...daily.map(d => d.views), 1), step = (W - pad * 2) / daily.length, bw = Math.max(2, step - 3);
  return html`<svg class="chart" viewBox="0 0 ${W} ${H + 26}" role="img" aria-label="Visitors and page views per day">${raw(daily.map((d, i) => {
    const x = (pad + i * step).toFixed(1), hv = Math.round((d.views / max) * H), hu = Math.round((d.visitors / max) * H);
    return `<rect x="${x}" y="${H - hv}" width="${bw.toFixed(1)}" height="${hv}" rx="2" fill="#d9b3c6"><title>${d.d}: ${d.views} page views, ${d.visitors} visitors</title></rect><rect x="${x}" y="${H - hu}" width="${bw.toFixed(1)}" height="${hu}" rx="2" fill="#8a1f4f"><title>${d.d}: ${d.visitors} visitors</title></rect>`;
  }).join(''))}<text x="${pad}" y="${H + 18}" font-size="11" fill="#777">${daily[0].d}</text><text x="${W - pad}" y="${H + 18}" font-size="11" fill="#777" text-anchor="end">${daily[daily.length - 1].d}</text></svg>
    <p class="muted"><span style="color:#8a1f4f">■</span> Unique visitors &nbsp; <span style="color:#d9b3c6">■</span> Page views</p>`;
};

export default async function trafficTab(el, shell, onLeave, opt = {}) {
  const days = opt.days || 30, q = opt.q || '', only = opt.only || '';
  const qs = `days=${days}&q=${encodeURIComponent(q)}&only=${only}`;
  const [t, { visitors }] = await Promise.all([get('/admin/traffic?days=' + days), get('/admin/visitors?' + qs)]);
  const redo = o => trafficTab(el, shell, () => {}, { days, q, only, ...o }).catch(e => toast(e.message, 'warn'));
  render(el, shell(html`
    <div class="ord-bar"><div class="chips">${[1, 7, 30, 90, 365].map(d => html`<button class="chip ${d === days ? 'on' : ''}" data-action="tr-days" data-d="${d}">${d === 1 ? 'Today' : d === 365 ? '1 year' : d + ' days'}</button>`)}</div>
      <small class="muted">${t.online} visitor${t.online === 1 ? '' : 's'} on the site in the last 5 minutes</small></div>
    <div class="stats">${[['Visitors today', t.today.visitors], ['Page views today', t.today.views], ['Visitors', t.visitors], ['Page views', t.views], ['New visitors', t.newVisitors], ['Returning', t.returning], ['Enquiries', t.enquiries]].map(([l, v]) => html`<div class="stat"><small>${l}</small><b>${v}</b></div>`)}</div>
    <div class="panel"><h2>Daily traffic</h2>${chart(t.daily)}</div>
    <div class="two-col"><div class="panel"><h2>Top pages</h2>${table(['Page', 'Views', 'Visitors'], t.pages.map(p => html`<tr><td>${p.k}</td><td>${p.n}</td><td>${p.u}</td></tr>`))}</div>
      <div class="panel"><h2>Where visitors come from</h2>${table(['Source', 'Visitors'], t.sources.map(p => html`<tr><td>${p.k}</td><td>${p.u}</td></tr>`))}</div></div>
    <div class="two-col"><div class="panel"><h2>Devices &amp; browsers</h2>${table(['', 'Visitors'], [...t.devices, ...t.browsers].map(p => html`<tr><td>${p.k}</td><td>${p.u}</td></tr>`))}</div>
      <div class="panel"><h2>Countries</h2>${table(['Country', 'Visitors'], t.countries.map(p => html`<tr><td>${p.k}</td><td>${p.u}</td></tr>`))}</div></div>
    <div class="panel"><h2>Who visited</h2>
      <form class="ord-bar" id="vsearch"><input name="q" value="${q}" placeholder="Search name, email, country, source…" aria-label="Search visitors">
        <select name="only" aria-label="Filter"><option value="" ${only === '' ? 'selected' : ''}>All visitors</option><option value="identified" ${only === 'identified' ? 'selected' : ''}>Named (signed in / enquired)</option><option value="returning" ${only === 'returning' ? 'selected' : ''}>Returning</option></select>
        <button class="btn btn-ghost sm">Search</button></form>
      <p class="muted">Visitors are anonymous until they sign in or send an enquiry. IP addresses are never stored.</p>
      ${table(['Visitor', 'Last seen', 'Pages', 'Visits', 'Device', 'Country', 'Source', ''], visitors.map(v => html`<tr><td>${v.name ? html`<b>${v.name}</b><br><small>${v.email}</small>` : html`<small>Anonymous · ${v.id.slice(0, 8)}</small>`}${v.inquiries ? html` <small>✉ enquired</small>` : ''}</td><td>${when(v.lastSeen)}</td><td>${v.views}</td><td>${v.days}${v.returning ? ' (returning)' : ''}</td><td>${v.device} · ${v.browser}</td><td>${v.country || '—'}</td><td>${v.source}</td><td><button class="btn btn-ghost sm" data-action="tr-trail" data-id="${v.id}">Trail</button></td></tr>`))}
      <div id="trail"></div></div>`));
  onSubmit($('#vsearch', el), async d => { await redo({ q: (d.q || '').trim(), only: d.only || '' }); }, 'Searching…');
  actions['tr-days'] = b => redo({ days: Number(b.dataset.d) });
  actions['tr-trail'] = async b => {
    try {
      const r = await get('/admin/visitors/' + b.dataset.id), box = $('#trail', el), v = r.visitor;
      render(box, html`<h3>${v.name || 'Anonymous visitor'} ${v.email ? html`<small>· ${v.email}</small>` : ''}</h3><p class="muted">First seen ${when(v.firstSeen)} · ${v.views} page views over ${v.days} day${v.days === 1 ? '' : 's'}${r.inquiries.length ? ' · enquiries: ' + r.inquiries.map(i => '#' + i.id + ' (' + i.status + ')').join(', ') : ''}</p>
        ${table(['Time', 'Page', 'Came from'], r.trail.map(x => html`<tr><td>${when(x.ts)}</td><td>${x.page}</td><td>${x.ref || '—'}</td></tr>`))}`);
      box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } catch (e) { toast(e.message, 'warn'); }
  };
  onLeave(() => { delete actions['tr-days']; delete actions['tr-trail']; });
}
