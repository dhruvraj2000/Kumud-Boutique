// Admin → Security console: alerts, sessions, IPs, sign-in history, audit trail, team, backups, performance, 2FA.
import { html, render, raw, get, post, del, $, state, toast, onSubmit, setUser } from '../core.js';
import { actions } from '../components.js';
import { runMapsCheck } from '../maps.js';

const when = ts => new Date(ts).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const sevCls = s => (s === 'high' ? 'todo' : s === 'warn' ? 'warn' : 'ok');
const table = (head, rows) => (rows.length
  ? html`<div class="table-wrap"><table class="tbl wide"><thead><tr>${head.map(h => html`<th>${h}</th>`)}</tr></thead><tbody>${rows}</tbody></table></div>`
  : html`<p class="muted">Nothing to show — good.</p>`);
const ACTIONS = ['maps-check', 'mfa-start', 'mfa-done', 'alerts-read', 'sess-revoke', 'ip-block', 'ip-unblock', 'staff-del', 'backup-now'];

export default async function securityTab(el, shell, onLeave) {
  const [ov, ss] = await Promise.all([get('/admin/security/overview'), get('/admin/security/sessions')]);
  const c = ov.counts, cf = ov.config, me = ov.staff.find(s => s.id === state.user.id);
  const checks = [
    ['HTTPS enforced', cf.https, 'Active in production. Locally the site runs over plain HTTP.'],
    ['Your two-factor sign-in', !!(me && me.mfa), 'Required for administrators in production. Set it up below.'],
    ['Default admin password replaced', !cf.defaultAdminPassword, 'Set ADMIN_PASSWORD before first run, or change the password under Account.'],
    ['Session secret set', cf.sessionSecretSet, 'Set SESSION_SECRET so sessions and encrypted data survive a restart on any host.'],
    ['Alert delivery', cf.emailAlerts || cf.webhookAlerts, 'Set ALERT_EMAIL + RESEND_API_KEY (or ALERT_WEBHOOK_URL) to be told the moment something suspicious happens.'],
    ['Automatic backups', ov.backup.enabled && ov.backup.healthy, ov.backup.enabled ? 'No recent backup — check the host disk.' : 'Needs a persistent disk (not available on Vercel).']
  ];
  render(el, shell(html`
    <div class="stats">${[['Failed sign-ins (24h)', c.failedLogins24h], ['Blocked requests (24h)', c.unauthorized24h], ['Blocked IPs', c.blockedIps], ['Active sessions', c.activeSessions], ['Unread alerts', c.unreadAlerts]].map(([l, v]) => html`<div class="stat"><small>${l}</small><b>${v}</b></div>`)}</div>
    <div class="panel"><h2>Security checklist</h2><ul class="chk-list">${checks.map(([l, ok, h]) => html`<li><span class="st ${ok ? 'ok' : 'todo'}">${ok ? 'OK' : 'Action'}</span><div><b>${l}</b><small>${h}</small></div></li>`)}</ul></div>
    <div class="panel" id="mfaPanel"><h2>Two-factor authentication</h2>${me && me.mfa
      ? html`<p>On for <b>${state.user.email}</b>. You will be asked for a code from your authenticator app at every sign-in.</p>`
      : html`<p class="muted">Protects the admin panel even if your password leaks. Use Google Authenticator, Authy or 1Password.</p><button class="btn btn-primary" data-action="mfa-start">Set up two-factor</button><div id="mfaBox"></div>`}</div>
    <div class="panel"><h2>Alerts</h2>${ov.alerts.length ? html`<ul class="chk-list">${ov.alerts.map(a => html`<li><span class="st ${sevCls(a.severity)}">${a.severity}</span><div><b>${a.title}</b><small>${when(a.ts)} · ${a.body}</small></div></li>`)}</ul><button class="btn btn-ghost sm" data-action="alerts-read">Mark all read</button>` : html`<p class="muted">No alerts.</p>`}</div>
    <div class="panel"><h2>Active sessions &amp; devices</h2>${table(['User', 'Role', 'IP', 'Device', 'Last active', '2FA', ''], ss.sessions.map(s => html`<tr><td>${s.email}</td><td>${s.role}</td><td>${s.ip}</td><td><small>${s.ua.slice(0, 60)}</small></td><td>${when(s.lastSeen)}</td><td>${s.mfa ? 'Yes' : 'No'}</td><td>${s.current ? html`<small>this device</small>` : html`<button class="btn btn-ghost sm" data-action="sess-revoke" data-id="${s.id}">Revoke</button>`}</td></tr>`))}</div>
    <div class="panel"><h2>Suspicious IP addresses</h2>${table(['IP', 'Events (24h)', 'Failed sign-ins', 'Last seen', ''], ov.suspiciousIps.map(i => html`<tr><td>${i.ip}</td><td>${i.hits}</td><td>${i.logins}</td><td>${when(i.last)}</td><td><button class="btn btn-ghost sm" data-action="ip-block" data-ip="${i.ip}">Block 24h</button></td></tr>`))}
      ${ov.blocked.length ? html`<h3>Currently blocked</h3>${table(['IP', 'Until', 'Reason', ''], ov.blocked.map(b => html`<tr><td>${b.ip}</td><td>${when(b.until)}</td><td>${b.reason}</td><td><button class="btn btn-ghost sm" data-action="ip-unblock" data-ip="${b.ip}">Unblock</button></td></tr>`))}` : ''}</div>
    <div class="panel"><h2>Failed sign-in attempts</h2>${table(['When', 'Account', 'IP', 'What'], ov.failedLogins.map(e => html`<tr><td>${when(e.ts)}</td><td>${e.email}</td><td>${e.ip}</td><td>${e.type.replace(/_/g, ' ')}<small>${e.detail}</small></td></tr>`))}</div>
    <div class="panel"><h2>Unauthorized &amp; blocked requests</h2>${table(['When', 'Account', 'IP', 'What'], ov.unauthorized.map(e => html`<tr><td>${when(e.ts)}</td><td>${e.email || '—'}</td><td>${e.ip}</td><td>${e.type.replace(/_/g, ' ')}<small>${e.detail}</small></td></tr>`))}</div>
    <div class="panel"><h2>Recent sign-ins</h2>${table(['When', 'Account', 'IP', 'Method'], ov.recentLogins.map(e => html`<tr><td>${when(e.ts)}</td><td>${e.email}</td><td>${e.ip}</td><td>${e.detail}</td></tr>`))}</div>
    <div class="panel"><h2>Admin activity history</h2>${table(['When', 'Who', 'Action', 'Target', 'Detail'], ov.activity.map(a => html`<tr><td>${when(a.ts)}</td><td>${a.actor_email}</td><td>${a.action}</td><td>${a.target}</td><td>${a.detail}</td></tr>`))}</div>
    <div class="panel"><h2>Team &amp; permissions</h2><p class="muted">Managers handle orders, products and enquiries. Delivery staff only see deliveries assigned to them. Only you can open this page, settings and security.</p>
      ${table(['Name', 'Email', 'Role', '2FA', 'Last sign-in', ''], ov.staff.map(s => html`<tr><td>${s.name}</td><td>${s.email}</td><td>${s.role}</td><td>${s.mfa ? 'On' : 'Off'}</td><td>${s.lastLogin || '—'}</td><td>${s.role === 'admin' ? '' : html`<button class="btn btn-ghost sm" data-action="staff-del" data-id="${s.id}">Remove</button>`}</td></tr>`))}
      <form id="staffForm" class="card-form" novalidate><div class="field"><label for="sn">Name</label><input id="sn" name="name" required></div><div class="field"><label for="se">Email</label><input id="se" name="email" type="email" required></div>
        <div class="field"><label for="sr">Role</label><select id="sr" name="role"><option value="manager">Manager</option><option value="delivery">Delivery</option></select></div>
        <div class="field"><label for="sp">Temporary password</label><input id="sp" name="password" type="password" autocomplete="new-password" required><small class="hint">12+ characters with a letter and a number</small></div><button class="btn btn-primary" type="submit">Add team member</button></form></div>
    <div class="panel"><h2>Google Maps check</h2><p class="muted">Finds out exactly why a map is not showing: missing key, API not enabled, billing off or a wrong key restriction.</p><button class="btn btn-ghost" data-action="maps-check">Run Maps check</button><div id="mapsOut" aria-live="polite"></div></div>
    <div class="panel"><h2>Backups &amp; recovery</h2><p>${ov.backup.enabled ? html`${ov.backup.last ? html`Last: <b>${when(ov.backup.last.ts)}</b> (${ov.backup.last.ok ? Math.round(ov.backup.last.bytes / 1024) + ' KB' : 'FAILED: ' + ov.backup.last.note})` : 'No backup yet.'} · every ${ov.backup.everyHours}h · keeps ${ov.backup.keep}` : 'Automatic backups need a persistent disk; this host does not have one.'}</p>
      <button class="btn btn-ghost" data-action="backup-now" ${ov.backup.enabled ? '' : 'disabled'}>Back up now</button><p class="muted"><small>To restore: stop the server, replace data/kumud.db with a file from the backups folder, start again. See docs/SECURITY.md.</small></p></div>
    <div class="panel"><h2>Performance &amp; errors</h2><p>Last 15 min: <b>${ov.perf.requests15m}</b> requests · median <b>${ov.perf.p50} ms</b> · p95 <b>${ov.perf.p95} ms</b> · server errors <b>${ov.perf.errors15m}</b> · memory ${ov.perf.memoryMb} MB · up ${Math.round(ov.perf.uptimeSec / 3600)}h</p>${table(['When', 'Type', 'Route', 'Status', 'ms', 'Message'], ov.errors.map(e => html`<tr><td>${when(e.ts)}</td><td>${e.kind}</td><td>${e.route}</td><td>${e.status}</td><td>${e.ms}</td><td>${e.message}</td></tr>`))}</div>`));

  const reload = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
  const act = (k, fn) => { actions[k] = async b => { try { await fn(b); } catch (e) { toast(e.message, 'warn'); } }; };
  act('maps-check', async b => {
    const box = $('#mapsOut', el); b.disabled = true; box.textContent = 'Checking…';
    try {
      const [srv, browser] = await Promise.all([get('/admin/maps-check'), runMapsCheck()]);
      const row = (r, where) => html`<li><span class="st ${r.ok ? 'ok' : 'todo'}">${r.ok ? 'OK' : 'Fix'}</span><div><b>${r.name}</b> <small>(${where})</small><small>${r.message || r.status || ''}</small>${!r.ok && (r.hint || r.fix) ? html`<small><b>How to fix:</b> ${r.hint || r.fix}</small>` : ''}</div></li>`;
      render(box, html`<ul class="chk-list">${srv.results.map(r => row(r, 'server'))}${browser.map(r => row(r, 'this browser'))}</ul>`);
    } catch (e) { box.textContent = e.message; } finally { b.disabled = false; }
  });
  act('mfa-start', async b => {
    const r = await post('/account/mfa/setup'); b.hidden = true;
    render($('#mfaBox', el), html`<ol class="steps"><li>Scan this with your authenticator app, or type the key by hand: <div class="qr">${raw(r.qrSvg)}</div><code>${r.secret}</code></li>
      <li>Enter the 6-digit code it shows:<form id="mfaForm" class="card-form" novalidate><div class="field"><input name="code" inputmode="numeric" autocomplete="one-time-code" placeholder="123456" required></div><button class="btn btn-primary" type="submit">Turn on two-factor</button></form></li></ol>`);
    onSubmit($('#mfaForm', el), async d => {
      const e = await post('/account/mfa/enable', { code: d.code });
      render($('#mfaBox', el), html`<div class="panel"><h3>Save your recovery codes</h3><p>Each works once if you lose your phone. They will not be shown again.</p><pre class="codes">${e.recoveryCodes.join('\n')}</pre><button class="btn btn-primary" data-action="mfa-done">I have saved them</button></div>`);
    }, 'Checking…');
  });
  act('mfa-done', async () => { const r = await get('/auth/me'); setUser(r.user, r.csrf); reload(); });
  act('alerts-read', async () => { await post('/admin/security/alerts/read'); reload(); });
  act('sess-revoke', async b => { await del('/admin/security/sessions/' + b.dataset.id); toast('Session revoked'); reload(); });
  act('ip-block', async b => { await post('/admin/security/block', { ip: b.dataset.ip, minutes: 1440 }); toast('Blocked for 24 hours'); reload(); });
  act('ip-unblock', async b => { await del('/admin/security/blocked/' + encodeURIComponent(b.dataset.ip)); toast('Unblocked'); reload(); });
  act('staff-del', async b => { if (!confirm('Remove this team member and sign them out?')) return; await del('/admin/staff/' + b.dataset.id); reload(); });
  act('backup-now', async () => { const r = await post('/admin/security/backup'); toast(r.result.ok ? 'Backup created' : r.result.note, r.result.ok ? 'ok' : 'warn'); reload(); });
  onSubmit($('#staffForm', el), async d => { await post('/admin/staff', d); toast('Team member added'); reload(); }, 'Adding…');
  onLeave(() => ACTIONS.forEach(k => delete actions[k]));
}
