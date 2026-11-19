'use strict';
// Pure rate engine. Per day: single-date rule > period rule > weekday rule > item base price.
// Within a type: item-specific beats global, then higher priority, then newer rule id. UTC date math only.
const RANK = { date: 3, period: 2, weekday: 1 };
const DAY = 86400000;
const parse = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fmt = ms => new Date(ms).toISOString().slice(0, 10);

function eachDate(from, to) {
  const out = [];
  for (let t = parse(from); t < parse(to); t += DAY) out.push(fmt(t));
  return out;
}

function matches(rule, date) {
  if (rule.type === 'date') return rule.start_date === date;
  if (rule.type === 'period') return rule.start_date <= date && date <= rule.end_date;
  return rule.weekday === new Date(parse(date)).getUTCDay();
}

function priceRange(item, rules, from, to) {
  if (!(parse(to) > parse(from))) throw new RangeError('to must be after from');
  const mine = rules.filter(r => r.item_id == null || r.item_id === item.id);
  const days = eachDate(from, to).map(date => {
    const hit = mine.filter(r => matches(r, date)).sort((a, b) =>
      RANK[b.type] - RANK[a.type] || (b.item_id != null) - (a.item_id != null) || b.priority - a.priority || b.id - a.id)[0];
    return hit ? { date, price: hit.price, source: hit.type, label: hit.label || null } : { date, price: item.base_price, source: 'base', label: null };
  });
  return { days, total: days.reduce((a, d) => a + d.price, 0) };
}

module.exports = { priceRange, eachDate };
