'use strict';
// Diagnoses the Google Maps setup from the server side and explains, in plain words, what is missing.
// (The browser-side key is checked in the browser by public/js/maps.js → runMapsCheck.)
const geo = require('./geo');

const HINTS = [
  [/billing/i, 'Billing is not enabled on the Google Cloud project. Enable it (Google gives a monthly free credit): console.cloud.google.com/billing'],
  [/not activated|has not been used|is disabled|SERVICE_DISABLED|not enabled/i, 'This API is not enabled. Enable it in Google Cloud Console → APIs & Services → Library.'],
  [/referer|referrer/i, 'The key has an HTTP-referrer restriction that does not include this site. Add https://your-domain/* to the key.'],
  [/ip address|IP_ADDRESS|not authorized to use this API key/i, 'The server key is restricted to other IP addresses. Allow this server\'s outbound IP, or remove the IP restriction while testing.'],
  [/API key not valid|INVALID_KEY|keyInvalid/i, 'The key is not valid. Copy it again from Google Cloud Console → Credentials.'],
  [/OVER_QUERY_LIMIT|quota|RESOURCE_EXHAUSTED/i, 'The daily quota is used up. Raise the quota or wait for the reset.'],
  [/REQUEST_DENIED|PERMISSION_DENIED/i, 'Google refused the request. Check the key restrictions and that this API is enabled for the key.']
];
const hint = msg => (HINTS.find(([re]) => re.test(msg)) || [0, ''])[1];
const done = (name, ok, status, message = '') => ({ name, ok, status, message, hint: ok ? '' : hint(`${status} ${message}`) });

async function getJson(url, init) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(8000) });
  return { http: r.status, j: await r.json().catch(() => ({})) };
}

async function check() {
  const browserKey = process.env.GOOGLE_MAPS_API_KEY || '', serverKey = process.env.GOOGLE_MAPS_SERVER_KEY || '', out = [];
  out.push(browserKey
    ? done('Browser key (GOOGLE_MAPS_API_KEY)', true, 'set', 'Present. Whether it works on your domain is tested by "Test in this browser" below.')
    : done('Browser key (GOOGLE_MAPS_API_KEY)', false, 'missing', 'Not set — this is why no Google map is shown. Add it in your host\'s environment variables.'));
  if (!serverKey) {
    out.push(done('Server key (GOOGLE_MAPS_SERVER_KEY)', false, 'missing', 'Not set. Delivery distance falls back to a straight-line estimate (works, but less exact).'));
    return { configured: { browser: !!browserKey, server: false }, results: out, store: geo.STORE };
  }
  out.push(done('Server key (GOOGLE_MAPS_SERVER_KEY)', true, 'set'));
  try {
    const { j } = await getJson(`https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent('Udaipur, Rajasthan')}&key=${encodeURIComponent(serverKey)}`);
    out.push(done('Geocoding API', j.status === 'OK', j.status, j.error_message || (j.status === 'OK' ? 'Address lookup works.' : '')));
  } catch (e) { out.push(done('Geocoding API', false, 'network', e.message)); }
  try {
    const { j } = await getJson(`https://maps.googleapis.com/maps/api/distancematrix/json?origins=${geo.STORE.lat},${geo.STORE.lng}&destinations=24.6,73.7&key=${encodeURIComponent(serverKey)}`);
    const el = j.rows && j.rows[0] && j.rows[0].elements[0], ok = j.status === 'OK' && el && el.status === 'OK';
    out.push(done('Distance Matrix API (delivery distance)', !!ok, j.status === 'OK' && el ? el.status : j.status, j.error_message || (ok ? 'Road distance works.' : '')));
  } catch (e) { out.push(done('Distance Matrix API', false, 'network', e.message)); }
  try {
    const { http, j } = await getJson('https://places.googleapis.com/v1/places:autocomplete', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': serverKey }, body: JSON.stringify({ input: 'Udaipur', includedRegionCodes: ['in'] }) });
    const ok = http === 200 && Array.isArray(j.suggestions);
    out.push(done('Places API (New) — address search', ok, ok ? 'OK' : (j.error && j.error.status) || String(http), (j.error && j.error.message) || (ok ? 'Address search works.' : '')));
  } catch (e) { out.push(done('Places API (New)', false, 'network', e.message)); }
  return { configured: { browser: !!browserKey, server: true }, results: out, store: geo.STORE };
}

module.exports = { check, hint };
