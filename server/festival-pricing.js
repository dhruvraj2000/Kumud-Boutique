'use strict';
// Pure festival-sale logic (no database, no clock): campaign status, per-product discount, and the profit-margin cap.
// Campaign dates are wall-clock times in India (IST, UTC+05:30) because that is where the shop trades.
const IST = '+05:30';

/** 'YYYY-MM-DD' or 'YYYY-MM-DD HH:MM[:SS]' (IST) -> epoch ms, or NaN. */
const toMs = s => {
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::(\d{2}))?)?/.exec(String(s || ''));
  return m ? Date.parse(`${m[1]}T${m[2] || '00:00'}:${m[3] || '00'}${IST}`) : NaN;
};
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const pct = n => clamp(Math.round(Number(n) || 0), 0, 100);

/** off (deactivated) | scheduled (starts later) | live | ended */
function status(c, now) {
  if (!c.active) return 'off';
  const s = toMs(c.starts_at), e = toMs(c.ends_at);
  if (now < s) return 'scheduled';
  if (now > e) return 'ended';
  return 'live';
}
const liveCampaigns = (list, now) => list.filter(c => status(c, now) === 'live');
const nextCampaign = (list, now) => list.filter(c => status(c, now) === 'scheduled').sort((a, b) => toMs(a.starts_at) - toMs(b.starts_at))[0] || null;

/**
 * Discount % a campaign gives one product, always inside the campaign's own [min, max] and the shop-wide cap.
 * Specific beats general: product rule > category rule > campaign default.
 */
function campaignPct(c, product, globalCap = 100) {
  const rules = c.rules || [];
  const hit = rules.find(r => r.scope === 'product' && String(r.target) === String(product.id))
    || rules.find(r => r.scope === 'category' && r.target === product.category);
  const raw = hit ? hit.discount_pct : c.discount_pct;
  return Math.min(clamp(pct(raw), pct(c.min_pct), pct(c.max_pct)), pct(globalCap));
}

/** Best live offer for a product: { pct, campaign } (pct 0 when nothing applies). */
function bestOffer(live, product, globalCap = 100) {
  let best = { pct: 0, campaign: null };
  for (const c of live) { const p = campaignPct(c, product, globalCap); if (p > best.pct) best = { pct: p, campaign: c }; }
  return best;
}

const salePrice = (price, p) => Math.round(price * (100 - pct(p)) / 100);

/** Highest discount a campaign actually offers anywhere (for "Up to X% OFF" badges). */
function upTo(c, products = [], globalCap = 100) {
  if (!products.length) return Math.min(pct(c.discount_pct), pct(c.max_pct), pct(globalCap));
  return products.reduce((m, p) => Math.max(m, campaignPct(c, p, globalCap)), 0);
}

/**
 * Margin guard. originalSubtotal = what the bag costs at full price; festivalSavings = already given as sale prices;
 * cap = the live campaign's maximum total discount %. Coupon + twinning must fit in what is left.
 * Returns the (possibly reduced) { coupon, twinning, limited }.
 */
function capExtras(originalSubtotal, festivalSavings, capPct, coupon, twinning) {
  if (capPct == null) return { coupon, twinning, limited: false };
  const room = Math.max(0, Math.floor(originalSubtotal * pct(capPct) / 100) - festivalSavings);
  const c = Math.min(coupon, room), t = Math.min(twinning, room - c);
  return { coupon: c, twinning: t, limited: c < coupon || t < twinning };
}

/** Validates a campaign payload; returns an error string or ''. `cap` is the shop-wide maximum %. */
function validateCampaign(c, cap = 100) {
  const name = String(c.name || '').trim();
  if (!name || name.length > 120) return 'Give the campaign a name (up to 120 characters).';
  for (const k of ['discount_pct', 'min_pct', 'max_pct']) if (!Number.isInteger(Number(c[k])) || Number(c[k]) < 0 || Number(c[k]) > 100) return 'Discount percentages must be whole numbers from 0 to 100.';
  const d = Number(c.discount_pct), lo = Number(c.min_pct), hi = Number(c.max_pct);
  if (lo > hi) return 'The minimum discount cannot be higher than the maximum.';
  if (d < lo || d > hi) return 'The default discount must sit between the minimum and maximum.';
  if (hi > cap) return `The maximum discount cannot exceed the shop-wide cap of ${cap}%.`;
  const s = toMs(c.starts_at), e = toMs(c.ends_at);
  if (Number.isNaN(s) || Number.isNaN(e)) return 'Enter valid start and end dates.';
  if (e <= s) return 'The end must be after the start.';
  return '';
}

module.exports = { IST, toMs, status, liveCampaigns, nextCampaign, campaignPct, bestOffer, salePrice, upTo, capExtras, validateCampaign };
