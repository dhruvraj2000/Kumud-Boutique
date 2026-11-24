// Admin → Reports: sales analytics + CSV export.
import { html, render, raw, get, $, money, toast, onSubmit } from '../core.js';
import { actions } from '../components.js';

const bars = daily => {
  if (!daily.length) return html`<p class="muted">No sales in this period yet.</p>`;
  const W = 640, H = 160, pad = 24, max = Math.max(...daily.map(d => d.rev), 1), bw = Math.max(4, (W - pad * 2) / daily.length - 3);
  const x = i => pad + i * ((W - pad * 2) / daily.length);
  return html`<svg class="chart" viewBox="0 0 ${W} ${H + 26}" role="img" aria-label="Revenue per day">${raw(daily.map((d, i) => {
    const h = Math.round((d.rev / max) * H);
    return `<rect x="${x(i).toFixed(1)}" y="${H - h}" width="${bw.toFixed(1)}" height="${h}" rx="2" fill="#8a1f4f"><title>${d.d}: ₹${d.rev.toLocaleString('en-IN')} (${d.n} orders)</title></rect>`;
  }).join(''))}<text x="${pad}" y="${H + 18}" font-size="11" fill="#777">${daily[0].d}</text><text x="${W - pad}" y="${H + 18}" font-size="11" fill="#777" text-anchor="end">${daily[daily.length - 1].d}</text></svg>`;
};
const table = (head, rows) => (rows.length ? html`<div class="table-wrap"><table class="tbl"><thead><tr>${head.map(h => html`<th>${h}</th>`)}</tr></thead><tbody>${rows}</tbody></table></div>` : html`<p class="muted">Nothing yet.</p>`);

export default async function analyticsTab(el, shell, onLeave, days = 30) {
  const a = await get('/admin/analytics?days=' + days);
  render(el, shell(html`<div class="ord-bar"><div class="chips">${[7, 30, 90, 365].map(d => html`<button class="chip ${d === days ? 'on' : ''}" data-action="an-days" data-d="${d}">${d === 365 ? '1 year' : d + ' days'}</button>`)}</div>
      <a class="btn btn-ghost sm" href="/api/admin/reports/sales.csv?days=${days}">Download sales CSV</a></div>
    <div class="stats">${[['Revenue', money(a.revenue)], ['Orders', a.orders], ['Avg order', money(a.aov)], ['Avg delivery', a.avgDeliveryDays ? a.avgDeliveryDays + ' days' : '—'], ['Delayed now', a.delayed], ['Cancelled', a.cancelled], ['Returns', a.returned], ['New customers', a.newCustomers], ['Repeat buyers', a.repeatCustomers]].map(([l, v]) => html`<div class="stat"><small>${l}</small><b>${v}</b></div>`)}</div>
    <div class="panel"><h2>Revenue by day</h2>${bars(a.daily)}</div>
    <div class="two-col"><div class="panel"><h2>Best sellers</h2>${table(['Piece', 'Sold', 'Revenue'], a.topProducts.map(p => html`<tr><td>${p.name}</td><td>${p.qty}</td><td>${money(p.rev)}</td></tr>`))}</div>
      <div class="panel"><h2>Payment methods</h2>${table(['Method', 'Orders', 'Revenue'], a.payments.map(p => html`<tr><td>${p.method}</td><td>${p.n}</td><td>${money(p.rev)}</td></tr>`))}<h2>Orders by status</h2>${table(['Status', 'Orders'], a.byStatus.map(s => html`<tr><td>${s.status.replace(/_/g, ' ')}</td><td>${s.n}</td></tr>`))}</div></div>`));
  actions['an-days'] = async b => { try { await analyticsTab(el, shell, () => {}, Number(b.dataset.d)); } catch (e) { toast(e.message, 'warn'); } };
  onLeave(() => delete actions['an-days']);
}
