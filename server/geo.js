'use strict';
// Delivery geography: distance, zone-based delivery charge, serviceability and ETA.
// Works with no Google key (straight-line distance × road factor). With GOOGLE_MAPS_SERVER_KEY it asks the Distance Matrix
// API for the real road distance. The server key is never sent to the browser (that is the separate, referrer-restricted GOOGLE_MAPS_API_KEY).
const { getSetting } = require('./db');

const STORE = {
  name: 'Kumud Boutique, Dewali, Udaipur',
  lat: Number(process.env.STORE_LAT) || 24.5854, lng: Number(process.env.STORE_LNG) || 73.7125
};
const ROAD_FACTOR = 1.3;
// Delivery charge by distance; orders above the free-shipping threshold ship free whatever the zone.
const ZONES = [
  { key: 'local', label: 'Local (own rider)', maxKm: 30, fee: 79, days: 1 },
  { key: 'regional', label: 'Regional', maxKm: 400, fee: 149, days: 3 },
  { key: 'national', label: 'Pan-India', maxKm: Infinity, fee: 199, days: 6 }
];
const rad = d => d * Math.PI / 180;
function haversineKm(a, b) {
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}
// Rough bounding box of India (incl. islands) — a first-line sanity check, not a border.
const inIndia = (lat, lng) => lat >= 6 && lat <= 37.6 && lng >= 68 && lng <= 97.5;
const validPoint = p => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180;

async function roadDistanceKm(dest, origin = STORE) {
  const key = process.env.GOOGLE_MAPS_SERVER_KEY;
  const straight = haversineKm(origin, dest) * ROAD_FACTOR;
  if (!key) return { km: straight, source: 'estimate' };
  try {
    const u = new URL('https://maps.googleapis.com/maps/api/distancematrix/json');
    u.search = new URLSearchParams({ origins: `${origin.lat},${origin.lng}`, destinations: `${dest.lat},${dest.lng}`, mode: 'driving', key }).toString();
    const r = await fetch(u, { signal: AbortSignal.timeout(5000) }), j = await r.json(), el = j.rows && j.rows[0] && j.rows[0].elements[0];
    if (el && el.status === 'OK') return { km: el.distance.value / 1000, minutes: Math.round(el.duration.value / 60), source: 'google' };
  } catch { /* fall back to the estimate */ }
  return { km: straight, source: 'estimate' };
}
const zoneFor = km => ZONES.find(z => km <= z.maxKm);
const blockedPins = () => String(getSetting('blockedPincodes') || '').split(/[,\s]+/).filter(Boolean);
const blockedPin = pin => blockedPins().includes(String(pin));
const maxKm = () => Number(getSetting('maxDeliveryKm')) || 4500;

// Validates a delivery pin + pincode and prices it. `loc` = {lat,lng}; returns { ok, reason?, km, zone, fee, etaDays }.
async function assess(loc, pincode, subtotal = 0, freeMin = 7500) {
  if (!validPoint(loc)) return { ok: false, reason: 'Please pick your delivery location on the map.' };
  if (!inIndia(loc.lat, loc.lng)) return { ok: false, reason: 'We currently deliver within India only.' };
  if (pincode && blockedPins().includes(String(pincode))) return { ok: false, reason: `We cannot deliver to PIN ${pincode} right now.` };
  const d = await roadDistanceKm(loc);
  if (d.km > maxKm()) return { ok: false, reason: 'That location is outside our delivery area.', km: Math.round(d.km) };
  const zone = zoneFor(d.km);
  return { ok: true, km: Math.round(d.km * 10) / 10, source: d.source, zone: zone.key, zoneLabel: zone.label, fee: subtotal >= freeMin ? 0 : zone.fee, baseFee: zone.fee, etaDays: zone.days };
}
const addDays = (days, from = new Date()) => { const d = new Date(from); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); };
// Minutes for a courier at `from` to reach `to` at ~25 km/h average city speed.
const etaMinutes = (from, to) => Math.max(2, Math.round(haversineKm(from, to) * ROAD_FACTOR / 25 * 60));

module.exports = { blockedPin, STORE, ZONES, haversineKm, inIndia, validPoint, roadDistanceKm, assess, zoneFor, addDays, etaMinutes };
