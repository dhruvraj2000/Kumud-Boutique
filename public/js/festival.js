// Festival sales on the storefront: top bar, themed home banner, countdowns, a gentle once-a-day pop-up.
// The server decides what is live (by date); this file only displays it and keeps countdowns ticking.
import { $, $$, html, render, get, state } from './core.js';
import { icon, productCard } from './components.js';

export const fest = { live: [], next: null, offset: 0, loaded: false };
const SOON_DAYS = 30;                       // show an "upcoming" countdown this far ahead
const seenKey = slug => 'kb_fest_seen_' + slug;
let tickTimer = null, popupTimer = null, reloading = false;

const now = () => Date.now() + fest.offset;
const main = () => fest.live[0] || null;
const upcoming = () => (fest.next && Date.parse(fest.next.startsAt) - now() < SOON_DAYS * 864e5 ? fest.next : null);
export const activeFestival = main;

export async function loadFestival() {
  try {
    const t0 = Date.now(), d = await get('/festivals/current'), t1 = Date.now();
    fest.live = d.live || []; fest.next = d.next || null; fest.offset = Date.parse(d.now) - (t0 + t1) / 2; fest.loaded = true;   // server time vs this device, corrected for network delay
  } catch { /* the shop works fine without sale info */ }
  applyTheme(); renderBar(); startTick();
  window.dispatchEvent(new CustomEvent('kb:festival'));
}

function applyTheme() {
  const t = (main() || upcoming() || {}).theme;
  if (t) document.documentElement.dataset.fest = t; else delete document.documentElement.dataset.fest;
  document.documentElement.classList.toggle('fest-live', !!main());
}

/* ---------- countdown ---------- */
export function fmtLeft(ms) {
  if (ms <= 0) return '00:00:00';
  const s = Math.floor(ms / 1000), d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), x = s % 60, p = n => String(n).padStart(2, '0');
  return d ? `${d}d ${p(h)}h ${p(m)}m ${p(x)}s` : `${p(h)}:${p(m)}:${p(x)}`;
}
/** 'Mon, 15 Dec, 12:00 am IST' - always India time, whatever the visitor's timezone, so the date a customer reads is the date the sale runs. */
export const istLabel = iso => new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) + ' IST';
const countdown = iso => html`<span class="fest-count" data-countdown="${iso}" aria-live="off">${fmtLeft(Date.parse(iso) - now())}</span>`;
const boxes = iso => {
  const ms = Math.max(0, Date.parse(iso) - now()), s = Math.floor(ms / 1000), v = [Math.floor(s / 86400), Math.floor(s % 86400 / 3600), Math.floor(s % 3600 / 60), s % 60];
  return html`<div class="fest-clock" data-clock="${iso}" role="timer" aria-label="Time remaining">${['Days', 'Hours', 'Mins', 'Secs'].map((l, i) => html`<div><b>${String(v[i]).padStart(2, '0')}</b><small>${l}</small></div>`)}</div>`;
};
function startTick() {
  clearInterval(tickTimer);
  if (!main() && !upcoming()) return;
  tickTimer = setInterval(() => {
    $$('[data-countdown]').forEach(el => { el.textContent = fmtLeft(Date.parse(el.dataset.countdown) - now()); });
    $$('[data-clock]').forEach(el => {
      const s = Math.max(0, Math.floor((Date.parse(el.dataset.clock) - now()) / 1000)), v = [Math.floor(s / 86400), Math.floor(s % 86400 / 3600), Math.floor(s % 3600 / 60), s % 60];
      [...el.querySelectorAll('b')].forEach((b, i) => { const t = String(v[i]).padStart(2, '0'); if (b.textContent !== t) b.textContent = t; });
    });
    // a sale just started or ended: ask the server what is live now (once)
    const edge = main() ? Date.parse(main().endsAt) : upcoming() ? Date.parse(upcoming().startsAt) : 0;
    if (edge && now() >= edge && !reloading) { reloading = true; setTimeout(async () => { await loadFestival(); reloading = false; window.dispatchEvent(new CustomEvent('kb:festival-changed')); }, 1500); }
  }, 1000);
}

/* ---------- top announcement bar ---------- */
function renderBar() {
  const bar = $('#announce'); if (!bar) return;
  const f = main(), u = upcoming();
  if (!f && !u) { bar.classList.remove('is-fest'); const orig = bar.querySelector('.an-a'); if (!orig && bar.dataset.orig) bar.innerHTML = bar.dataset.orig; return; }
  if (!bar.dataset.orig) bar.dataset.orig = bar.innerHTML;
  bar.classList.add('is-fest');
  render(bar, f
    ? html`<p class="an-fest"><span class="spark">✦</span> <b>${f.name}</b> — up to <b>${f.upTo}% OFF</b> <span class="dot">·</span> ends in ${countdown(f.endsAt)} <a href="#/shop?sale=1">Shop the sale →</a></p>`
    : html`<p class="an-fest"><span class="spark">✦</span> <b>${u.name}</b> — up to <b>${u.upTo}% OFF</b> <span class="dot">·</span> starts in ${countdown(u.startsAt)} <a href="#/shop">Preview →</a></p>`);
}

/* ---------- home page banner ---------- */
export function festivalSection() {
  const f = main(), u = f ? null : upcoming();
  if (!f && !u) return html`<span data-fest-section hidden></span>`;
  const x = f || u;
  return html`<section class="fest-hero" data-fest-section data-theme="${x.theme}" aria-label="${x.name}">
    <div class="fest-bg" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i></div>
    <div class="wrap fest-grid">
      <div class="fest-copy">
        <p class="eyebrow light">${f ? 'Limited-time festival offer' : 'Coming soon'}</p>
        <h2>${x.name}</h2>
        <p class="fest-tag">${x.tagline}</p>
        <p class="fest-when">${f ? 'Sale ends in' : 'Sale starts in'} <span class="fest-at">· ${f ? istLabel(f.endsAt) : istLabel(u.startsAt)}</span></p>
        ${boxes(f ? f.endsAt : u.startsAt)}
        <div class="hero-cta"><a class="btn btn-gold" href="${f ? '#/shop?sale=1' : '#/shop'}">${f ? 'Shop the sale' : 'Browse the collection'} ${icon('arrow')}</a>${f ? '' : ''}</div>
      </div>
      <div class="fest-badge-wrap" aria-hidden="true"><div class="fest-disc"><small>up to</small><b>${x.upTo}<sup>%</sup></b><span>OFF</span></div><div class="fest-ring"></div></div>
    </div>
    ${f ? html`<ul class="fest-points wrap"><li>${icon('sparkle')} Prices already reduced — no code needed</li><li>${icon('scissors')} Made-to-measure still included</li><li>${icon('swap')} 7-day exchange</li></ul>` : ''}
  </section>`;
}
/** "Limited-time picks": the deepest-discounted in-stock pieces, shown only while a sale is live. */
export function festivalPicks(products) {
  const f = main(); if (!f) return html``;
  const picks = products.filter(p => p.festivalPct && p.inStock).sort((a, b) => b.festivalPct - a.festivalPct).slice(0, 4);
  if (!picks.length) return html``;
  return html`<section class="wrap section fest-picks" data-theme="${f.theme}">
    <div class="sec-head row"><div><p class="eyebrow">Limited time</p><h2>${f.name} picks</h2></div><a class="link" href="#/shop?sale=1">See everything on offer ${icon('arrow')}</a></div>
    <div class="grid">${picks.map((p, i) => productCard(p, i))}</div></section>`;
}
/** Small line under a product's price while its sale is running. */
export function festivalNote(p) {
  const f = p.festivalPct && fest.live.find(c => c.name === p.festival); if (!f) return html``;
  return html`<p class="fest-note" data-theme="${f.theme}"><span class="spark">✦</span> <b>${f.name}</b> — ${p.festivalPct}% off <span class="dot">·</span> ends in ${countdown(f.endsAt)}</p>`;
}
/** Re-render the banner in place when a sale starts or ends while the page is open. */
window.addEventListener('kb:festival-changed', () => { const el = $('[data-fest-section]'); if (el) { const t = document.createElement('div'); render(t, festivalSection()); el.replaceWith(t.firstElementChild); startTick(); } });

/* ---------- once-a-day pop-up (a small corner card, never a blocking modal) ---------- */
export function maybePopup() {
  clearTimeout(popupTimer);
  const f = main(); if (!f || !f.popup) return;
  if (/^\/(checkout|cart|order|login|register)/.test(location.hash.replace(/^#/, ''))) return;
  try { if (Date.now() - Number(localStorage.getItem(seenKey(f.slug)) || 0) < 864e5) return; } catch { return; }
  popupTimer = setTimeout(() => {
    if ($('.fest-pop') || document.body.classList.contains('locked')) return;
    const el = document.createElement('aside'); el.className = 'fest-pop'; el.dataset.theme = f.theme; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', f.name);
    render(el, html`<button class="fest-pop-x" aria-label="Dismiss offer">${icon('close')}</button><small>${f.name}</small><b>Up to ${f.upTo}% OFF</b><p>Ends in ${countdown(f.endsAt)}</p><a class="btn btn-gold" href="#/shop?sale=1">Shop the sale</a>`);
    document.body.append(el); requestAnimationFrame(() => el.classList.add('in'));
    const close = () => { try { localStorage.setItem(seenKey(f.slug), String(Date.now())); } catch { /* ignore */ } el.classList.remove('in'); setTimeout(() => el.remove(), 400); };
    el.querySelector('.fest-pop-x').addEventListener('click', close); el.querySelector('a').addEventListener('click', close);
    el.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  }, 7000);
}
