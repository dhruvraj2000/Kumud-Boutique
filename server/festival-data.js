'use strict';
// Festival campaigns + coupons: MySQL is the source of truth, a small in-memory snapshot (refreshed every minute and after every
// admin edit) is what the synchronous SQLite shop code reads at pricing time. Campaigns go live / end by comparing the clock to
// their dates on every read, so no scheduler is needed: sales start and stop on their own, even on serverless hosting.
const mysql = require('./mysql');
const P = require('./festival-pricing');

const DEFAULT_CAP = 70;   // shop-wide ceiling on any discount, editable in the admin portal
const HORIZON_YEARS = 3;  // campaigns are auto-scheduled this many years ahead; the window rolls forward every year
const REFRESH_MS = 60 * 1000;

/* ---------- festival calendar ---------- */
// Fixed-date festivals repeat on the same day every year, forever. Lunar festivals move, so their dates are listed per year;
// beyond the listed years the admin portal asks for the date (one field) instead of guessing.
const TEMPLATES = [
  { slug: 'new-year', name: 'New Year Sale', theme: 'midnight', kind: 'fixed', month: 1, day: 1, lead_days: 4, tail_days: 1, discount_pct: 50, min_pct: 10, max_pct: 50, tagline: 'Ring in the year in handcrafted style.' },
  { slug: 'valentines-day', name: "Valentine's Day Sale", theme: 'rose', kind: 'fixed', month: 2, day: 14, lead_days: 7, tail_days: 0, discount_pct: 20, min_pct: 5, max_pct: 20, tagline: 'Dress for the one who makes you glow.' },
  { slug: 'holi', name: 'Holi Special', theme: 'holi', kind: 'movable', lead_days: 5, tail_days: 1, discount_pct: 20, min_pct: 5, max_pct: 20, tagline: 'Colour, joy and festive whites.' },
  { slug: 'navratri', name: 'Navratri Special', theme: 'navratri', kind: 'movable', lead_days: 3, tail_days: 9, discount_pct: 25, min_pct: 5, max_pct: 25, tagline: 'Nine nights, nine looks, one garba.' },
  { slug: 'dhanteras', name: 'Dhanteras Sale', theme: 'gold', kind: 'movable', lead_days: 3, tail_days: 0, discount_pct: 30, min_pct: 5, max_pct: 30, tagline: 'An auspicious day to bring something beautiful home.' },
  { slug: 'diwali', name: 'Diwali Sale', theme: 'diwali', kind: 'movable', lead_days: 5, tail_days: 2, discount_pct: 50, min_pct: 10, max_pct: 50, tagline: 'The festival of lights, in our biggest sale of the year.' },
  { slug: 'christmas', name: 'Christmas Sale', theme: 'christmas', kind: 'fixed', month: 12, day: 25, lead_days: 10, tail_days: 1, discount_pct: 40, min_pct: 10, max_pct: 40, tagline: 'Festive finery for every celebration.' }
];
// Starting dates for the movable festivals. These follow the published calendar but panchang dates can differ by a day by region:
// review them in Admin > Festivals. (Dhanteras is two days before Diwali.)
const MOVABLE_DATES = {
  holi: { 2026: '2026-03-04', 2027: '2027-03-22', 2028: '2028-03-11', 2029: '2029-03-01', 2030: '2030-03-20' },
  navratri: { 2026: '2026-10-11', 2027: '2027-10-01', 2028: '2028-09-20', 2029: '2029-10-09', 2030: '2030-09-28' },
  diwali: { 2026: '2026-11-08', 2027: '2027-10-29', 2028: '2028-10-17', 2029: '2029-11-05', 2030: '2030-10-26' },
  dhanteras: { 2026: '2026-11-06', 2027: '2027-10-27', 2028: '2028-10-15', 2029: '2029-11-03', 2030: '2030-10-24' }
};
const SEED_COUPONS = [
  { code: 'KUMUD10', label: '10% off your order', type: 'percent', value: 10, min_order: 0 },
  { code: 'WELCOME500', label: '₹500 off orders above ₹5,000', type: 'flat', value: 500, min_order: 5000 },
  { code: 'FREESHIP', label: 'Free shipping', type: 'ship', value: 0, min_order: 0 }
];

const pad = n => String(n).padStart(2, '0');
const addDays = (dateStr, n) => { const d = new Date(dateStr + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const istToday = (now = Date.now()) => new Date(now + 5.5 * 3600e3).toISOString().slice(0, 10);

/** Sale window for a festival on `date`: starts lead_days before at 00:00, ends tail_days after at 23:59:59 (IST). */
function windowFor(tpl, date) {
  return { starts_at: `${addDays(date, -tpl.lead_days)} 00:00:00`, ends_at: `${addDays(date, tpl.tail_days)} 23:59:59` };
}
/** Date of a festival in a year, or '' when a lunar festival has no date entered yet. */
function festivalDate(tpl, year, dates = {}) {
  if (tpl.kind === 'fixed') return `${year}-${pad(tpl.month)}-${pad(tpl.day)}`;
  return dates[year] || '';
}

/* ---------- seeding + auto-scheduling ---------- */
async function ensureSeeded() {
  const [{ n }] = await mysql.query('SELECT COUNT(*) n FROM festival_templates');
  if (!Number(n)) {
    for (const t of TEMPLATES) {
      const r = await mysql.query('INSERT INTO festival_templates(slug,name,theme,kind,month,day,lead_days,tail_days,discount_pct,min_pct,max_pct,tagline) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)',
        [t.slug, t.name, t.theme, t.kind, t.month || null, t.day || null, t.lead_days, t.tail_days, t.discount_pct, t.min_pct, t.max_pct, t.tagline]);
      for (const [y, d] of Object.entries(MOVABLE_DATES[t.slug] || {})) await mysql.query('INSERT IGNORE INTO festival_dates(template_id,year,date) VALUES(?,?,?)', [r.insertId, Number(y), d]);
    }
  }
  const [{ c }] = await mysql.query('SELECT COUNT(*) c FROM coupons');
  if (!Number(c)) for (const k of SEED_COUPONS) await mysql.query('INSERT IGNORE INTO coupons(code,label,type,value,min_order) VALUES(?,?,?,?,?)', [k.code, k.label, k.type, k.value, k.min_order]);
  await mysql.query("INSERT IGNORE INTO festival_settings(k,v) VALUES('max_discount_cap',?)", [String(DEFAULT_CAP)]);
}

/** Creates any missing campaign for every active template, this year and the next HORIZON_YEARS. Never touches existing ones. */
async function generateCampaigns(now = Date.now()) {
  const y0 = Number(istToday(now).slice(0, 4)), created = [];
  const templates = await mysql.query('SELECT * FROM festival_templates WHERE active=1 AND auto_create=1');
  for (const t of templates) {
    const dates = Object.fromEntries((await mysql.query('SELECT year,date FROM festival_dates WHERE template_id=?', [t.id])).map(r => [r.year, String(r.date).slice(0, 10)]));
    for (let y = y0; y <= y0 + HORIZON_YEARS; y++) {
      const date = festivalDate(t, y, dates);
      if (!date) continue;
      const { starts_at, ends_at } = windowFor(t, date);
      if (P.toMs(ends_at) < now) continue;                                       // already over
      const [skip] = await mysql.query('SELECT 1 x FROM campaign_skips WHERE template_id=? AND year=?', [t.id, y]);
      if (skip) continue;
      const r = await mysql.query(`INSERT IGNORE INTO campaigns(template_id,year,name,slug,theme,tagline,festival_date,starts_at,ends_at,discount_pct,min_pct,max_pct)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`, [t.id, y, `${t.name} ${y}`, `${t.slug}-${y}`, t.theme, t.tagline, date, starts_at, ends_at, t.discount_pct, t.min_pct, t.max_pct]);
      if (r.affectedRows) created.push(`${t.slug}-${y}`);
    }
  }
  return created;
}

/* ---------- built-in calendar (no database) ---------- */
// Without MySQL (e.g. a fresh Vercel deploy) the shop still runs the automatic festival calendar from the defaults above, so sales
// appear on time. Editing campaigns, rules and coupons needs MySQL. Only used on Vercel, or when FESTIVAL_BUILTIN=1, so that local
// runs and the test-suite stay deterministic.
const builtinEnabled = () => !mysql.isConfigured() && (!!process.env.VERCEL || process.env.FESTIVAL_BUILTIN === '1');
function builtinCampaigns(at = Date.now()) {
  const y0 = Number(istToday(at).slice(0, 4)), out = [];
  TEMPLATES.forEach((t, i) => {
    for (let y = y0; y <= y0 + HORIZON_YEARS; y++) {
      const date = festivalDate(t, y, MOVABLE_DATES[t.slug] || {});
      if (!date) continue;
      const w = windowFor(t, date);
      if (P.toMs(w.ends_at) < at) continue;
      out.push({ id: -(i * 100 + y % 100), slug: `${t.slug}-${y}`, name: `${t.name} ${y}`, theme: t.theme, tagline: t.tagline, festival_date: date, ...w,
        discount_pct: t.discount_pct, min_pct: t.min_pct, max_pct: t.max_pct, active: 1, show_popup: 1, rules: [] });
    }
  });
  return out;
}

/* ---------- in-memory snapshot ---------- */
let snap = { campaigns: [], coupons: null, cap: DEFAULT_CAP, at: 0 };
let loading = null;

async function load() {
  await ensureSeeded();
  await generateCampaigns();
  const rows = await mysql.query('SELECT id,slug,name,theme,tagline,festival_date,starts_at,ends_at,discount_pct,min_pct,max_pct,active,show_popup FROM campaigns WHERE active=1 AND ends_at >= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 2 DAY)');
  const rules = rows.length ? await mysql.query('SELECT campaign_id,scope,target,discount_pct FROM campaign_rules WHERE campaign_id IN (?)', [rows.map(r => r.id)]) : [];
  const campaigns = rows.map(c => ({ ...c, rules: rules.filter(r => r.campaign_id === c.id) }));
  const coupons = {};
  for (const k of await mysql.query('SELECT * FROM coupons')) coupons[k.code] = k;
  const [cap] = await mysql.query("SELECT v FROM festival_settings WHERE k='max_discount_cap'");
  snap = { campaigns, coupons, cap: cap ? Number(cap.v) : DEFAULT_CAP, at: Date.now() };
}
/** Reload the snapshot (deduplicated). Never throws: on failure the previous snapshot stays in use. */
function refresh() {
  if (builtinEnabled()) { snap = { campaigns: builtinCampaigns(), coupons: null, cap: DEFAULT_CAP, at: Date.now() }; return Promise.resolve(); }
  if (!mysql.isConfigured()) return Promise.resolve();
  if (!loading) loading = load().catch(e => { console.warn('festival refresh failed:', e.message); snap.at = Date.now() - REFRESH_MS + 10000; }).finally(() => { loading = null; });
  return loading;
}
/** Express middleware: waits for a reload only when the snapshot is stale (cold start or > 1 minute old). */
const ensureFresh = (req, res, next) => (Date.now() - snap.at < REFRESH_MS ? next() : Promise.race([refresh(), new Promise(r => setTimeout(r, 2500))]).then(() => next()));

const current = () => snap;
/** Test hook: replace the snapshot without MySQL. */
const setSnapshot = o => { snap = { campaigns: [], coupons: null, cap: DEFAULT_CAP, ...o, at: Date.now() + 3600e3 }; };
const now = () => Date.now();

/** Everything the storefront needs to render banners, countdowns and pop-ups. */
function publicView(products = [], at = now()) {
  const live = P.liveCampaigns(snap.campaigns, at), nxt = P.nextCampaign(snap.campaigns, at);
  const shape = c => ({ slug: c.slug, name: c.name, theme: c.theme, tagline: c.tagline, upTo: P.upTo(c, products, snap.cap), startsAt: new Date(P.toMs(c.starts_at)).toISOString(), endsAt: new Date(P.toMs(c.ends_at)).toISOString(), popup: !!c.show_popup, categories: [...new Set((c.rules || []).filter(r => r.scope === 'category').map(r => r.target))] });
  return { now: new Date(at).toISOString(), live: live.map(shape), next: nxt ? shape(nxt) : null };
}

module.exports = { builtinCampaigns, TEMPLATES, MOVABLE_DATES, DEFAULT_CAP, HORIZON_YEARS, windowFor, festivalDate, addDays, istToday, ensureSeeded, generateCampaigns, refresh, ensureFresh, current, setSnapshot, publicView };
