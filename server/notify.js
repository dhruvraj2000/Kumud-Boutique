'use strict';
// Outbound notifications. Every channel is optional and driven by environment variables (never by frontend code):
//   EMAIL: RESEND_API_KEY + MAIL_FROM          SMS: MSG91_AUTH_KEY + MSG91_SENDER (or TWILIO_* — see sendSms)
//   WHATSAPP: WHATSAPP_TOKEN + WHATSAPP_PHONE_ID (Meta Cloud API)     ADMIN: ALERT_EMAIL, ALERT_WEBHOOK_URL (Slack/Discord/n8n)
// Without keys a channel is skipped and the message is logged to `notification_log`, so nothing silently disappears.
const { db } = require('./db');

db.exec(`CREATE TABLE IF NOT EXISTS notification_log(
  id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, channel TEXT NOT NULL, to_addr TEXT DEFAULT '', subject TEXT DEFAULT '',
  status TEXT NOT NULL, order_number TEXT DEFAULT '', detail TEXT DEFAULT '');`);

const log = (channel, to, subject, status, order = '', detail = '') =>
  db.prepare('INSERT INTO notification_log(ts,channel,to_addr,subject,status,order_number,detail) VALUES(?,?,?,?,?,?,?)').run(Date.now(), channel, to, String(subject).slice(0, 200), status, order, String(detail).slice(0, 300));

const post = async (url, headers, body) => {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
};
const escHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const channels = {
  async email(to, subject, text, order) {
    if (!process.env.RESEND_API_KEY || !process.env.MAIL_FROM) return log('email', to, subject, 'skipped', order, 'email not configured');
    try { await post('https://api.resend.com/emails', { Authorization: 'Bearer ' + process.env.RESEND_API_KEY }, { from: process.env.MAIL_FROM, to: [to], subject, html: `<div style="font-family:sans-serif;white-space:pre-line">${escHtml(text)}</div>`, text }); log('email', to, subject, 'sent', order); }
    catch (e) { log('email', to, subject, 'failed', order, e.message); }
  },
  async sms(to, _s, text, order) {
    if (!process.env.MSG91_AUTH_KEY || !process.env.MSG91_TEMPLATE_ID) return log('sms', to, text, 'skipped', order, 'sms not configured');
    try { await post('https://control.msg91.com/api/v5/flow/', { authkey: process.env.MSG91_AUTH_KEY }, { template_id: process.env.MSG91_TEMPLATE_ID, short_url: '0', recipients: [{ mobiles: '91' + to, message: text.slice(0, 300) }] }); log('sms', to, text, 'sent', order); }
    catch (e) { log('sms', to, text, 'failed', order, e.message); }
  },
  async whatsapp(to, _s, text, order) {
    if (!process.env.WHATSAPP_TOKEN || !process.env.WHATSAPP_PHONE_ID) return log('whatsapp', to, text, 'skipped', order, 'whatsapp not configured');
    try { await post(`https://graph.facebook.com/v20.0/${encodeURIComponent(process.env.WHATSAPP_PHONE_ID)}/messages`, { Authorization: 'Bearer ' + process.env.WHATSAPP_TOKEN }, { messaging_product: 'whatsapp', to: '91' + to, type: 'text', text: { body: text } }); log('whatsapp', to, text, 'sent', order); }
    catch (e) { log('whatsapp', to, text, 'failed', order, e.message); }
  }
};

// Fire-and-forget: never lets a provider outage break an order update.
function send(channel, to, subject, text, order = '') { if (!to) return; channels[channel](to, subject, text, order).catch(() => {}); }

const lastAlert = new Map();
// In-app alert + optional email/webhook. Same title is throttled to once per 10 minutes.
function alertAdmin(severity, title, body = '') {
  const k = title, now = Date.now();
  if (lastAlert.get(k) > now - 600000) return;
  lastAlert.set(k, now);
  db.prepare('INSERT INTO admin_alerts(ts,severity,title,body) VALUES(?,?,?,?)').run(now, severity, title, body);
  if (process.env.ALERT_EMAIL) send('email', process.env.ALERT_EMAIL, `[Kumud Boutique ${severity}] ${title}`, body || title);
  if (process.env.ALERT_WEBHOOK_URL) post(process.env.ALERT_WEBHOOK_URL, {}, { text: `[${severity}] ${title}\n${body}` }).catch(() => {});
}

// Customer order updates on every channel we have an address for.
function orderUpdate(order, headline, detail = '') {
  const text = `Kumud Boutique — ${headline}\nOrder ${order.number}${order.trackingId ? ' · Tracking ' + order.trackingId : ''}${detail ? '\n' + detail : ''}`;
  send('email', order.email, `${headline} · ${order.number}`, text, order.number);
  send('sms', order.phone, headline, text, order.number);
  send('whatsapp', order.phone, headline, text, order.number);
}

module.exports = { send, alertAdmin, orderUpdate };
