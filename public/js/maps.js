// Google Maps helpers. Everything degrades gracefully when no browser key is configured (state.meta.mapsKey):
// callers get `mapsOn() === false` and show a plain "open in Google Maps" link instead.
import { html, $, state, toast } from './core.js';

export const mapsOn = () => !!(state.meta && state.meta.mapsKey);
export const gmapsLink = (lat, lng) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lat + ',' + lng)}`;
export const gmapsDir = (from, to) => `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(from.lat + ',' + from.lng)}&destination=${encodeURIComponent(to.lat + ',' + to.lng)}&travelmode=driving`;

// Browser-side problems go to the server's error log so a broken map can be diagnosed later (Admin → Security → errors).
export function reportClient(kind, message) {
  try { fetch('/api/client-log', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, message: String(message).slice(0, 200), where: location.hash }), keepalive: true }); } catch { /* never block the page on logging */ }
}
export let mapsAuthError = '';
// Google calls this when the key is rejected (wrong referrer, API not enabled, billing off). The map area then shows an explanation instead of a grey box.
window.gm_authFailure = () => { mapsAuthError = 'Google rejected the Maps key (check the key restrictions, that Maps JavaScript API is enabled, and that billing is on).'; reportClient('maps', mapsAuthError); window.dispatchEvent(new Event('kb:mapsfail')); };

let loading;
export function loadMaps() {
  if (!mapsOn()) return Promise.reject(new Error('Maps are not configured.'));
  if (window.google && window.google.maps && window.google.maps.importLibrary) return Promise.resolve(window.google.maps);
  loading = loading || new Promise((resolve, reject) => {
    window.__kbMapsReady = () => resolve(window.google.maps);
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(state.meta.mapsKey)}&loading=async&v=weekly&libraries=places,marker&callback=__kbMapsReady&region=IN`;
    s.async = true; s.onerror = () => { loading = null; reportClient('maps', 'script failed to load (blocked, offline or bad key)'); reject(new Error('Google Maps could not be loaded.')); };
    setTimeout(() => { if (!(window.google && window.google.maps)) { loading = null; reportClient('maps', 'timeout loading Maps JavaScript API'); reject(new Error('Google Maps took too long to load.')); } }, 15000);
    document.head.appendChild(s);
  });
  return loading;
}

const MAP_ID = 'DEMO_MAP_ID';
export async function makeMap(el, center, zoom = 14) {
  const maps = await loadMaps(); await maps.importLibrary('maps');
  return new maps.Map(el, { center, zoom, mapId: MAP_ID, disableDefaultUI: true, zoomControl: true, fullscreenControl: true, gestureHandling: 'cooperative' });
}
export async function makeMarker(map, position, { title = '', color = '#8a1f4f', draggable = false, glyph = '' } = {}) {
  const maps = await loadMaps(), { AdvancedMarkerElement, PinElement } = await maps.importLibrary('marker');
  const pin = new PinElement({ background: color, borderColor: '#fff', glyphColor: '#fff', glyph });
  return new AdvancedMarkerElement({ map, position, title, gmpDraggable: draggable, content: pin.element });
}
const posOf = m => { const p = m.position; return { lat: typeof p.lat === 'function' ? p.lat() : p.lat, lng: typeof p.lng === 'function' ? p.lng() : p.lng }; };

// Pull street / city / state / PIN out of Google's address_components (works for Places and Geocoder results).
export function parseComponents(comps = []) {
  const get = (...types) => { const c = comps.find(x => types.some(t => (x.types || []).includes(t))); return c ? (c.longText || c.long_name || '') : ''; };
  return {
    line1: [get('premise'), get('street_number'), get('route'), get('sublocality_level_2', 'sublocality_level_1', 'sublocality', 'neighborhood')].filter(Boolean).join(', '),
    city: get('locality', 'administrative_area_level_3', 'administrative_area_level_2'), state: get('administrative_area_level_1'), pincode: get('postal_code')
  };
}

/**
 * Checkout address picker: Places Autocomplete + draggable pin + "use my location".
 * onPick({lat,lng,placeId,address:{line1,city,state,pincode}}) fires whenever the pin is confirmed.
 */
export async function pinPicker(host, { initial, onPick }) {
  const maps = await loadMaps(), start = initial || { lat: state.meta.store.lat, lng: state.meta.store.lng };
  host.innerHTML = '';
  const search = document.createElement('div'); search.className = 'map-search';
  const box = document.createElement('div'); box.className = 'map-box'; box.setAttribute('role', 'application'); box.setAttribute('aria-label', 'Delivery location map');
  const bar = document.createElement('div'); bar.className = 'map-bar';
  host.append(search, box, bar);
  bar.innerHTML = '<button type="button" class="btn btn-ghost sm" data-me>Use my current location</button><span class="map-hint" aria-live="polite">Search your address, or drag the pin to your doorstep.</span>';
  const hint = $('.map-hint', bar);
  const map = await makeMap(box, start, initial ? 16 : 5), marker = await makeMarker(map, start, { title: 'Delivery location', draggable: true });
  if (!initial) marker.map = null;
  let geocoder;
  const emit = async (pos, placeId = '', address = null) => {
    marker.map = map; marker.position = pos; map.panTo(pos); map.setZoom(Math.max(map.getZoom() || 0, 16));
    if (!address) {
      try { geocoder = geocoder || new (await maps.importLibrary('geocoding')).Geocoder(); const r = await geocoder.geocode({ location: pos }); const g = r.results && r.results[0]; if (g) { address = parseComponents(g.address_components); placeId = placeId || g.place_id; hint.textContent = g.formatted_address; } } catch { /* geocoding not enabled: the pin still works */ }
    } else hint.textContent = 'Location set. Drag the pin if it is not exactly at your door.';
    onPick({ ...pos, placeId, address });
  };
  marker.addListener('dragend', () => emit(posOf(marker)));
  map.addListener('click', e => emit({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
  try {
    const { PlaceAutocompleteElement } = await maps.importLibrary('places');
    const ac = new PlaceAutocompleteElement({ componentRestrictions: { country: 'in' } });
    ac.setAttribute('aria-label', 'Search your delivery address'); search.appendChild(ac);
    const chosen = async ev => {
      const place = ev.placePrediction ? ev.placePrediction.toPlace() : ev.place; if (!place) return;
      await place.fetchFields({ fields: ['location', 'addressComponents', 'formattedAddress', 'id'] });
      emit({ lat: place.location.lat(), lng: place.location.lng() }, place.id, parseComponents(place.addressComponents));
      hint.textContent = place.formattedAddress || hint.textContent;
    };
    ac.addEventListener('gmp-select', chosen); ac.addEventListener('gmp-placeselect', chosen);
  } catch { search.innerHTML = '<p class="muted">Address search is unavailable — tap the map to drop a pin.</p>'; }
  $('[data-me]', bar).addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Your browser cannot share its location.', 'warn');
    navigator.geolocation.getCurrentPosition(p => emit({ lat: p.coords.latitude, lng: p.coords.longitude }), () => toast('We could not get your location. Please search for your address instead.', 'warn'), { enableHighAccuracy: true, timeout: 10000 });
  });
  if (initial) hint.textContent = 'Saved pin loaded. Drag it to adjust.';
}

/** Read-only map with a destination pin, optional store pin, courier pin and route. Returns { setCourier(pos) }. */
export async function routeMap(host, { dest, store, courier, route = true }) {
  const maps = await loadMaps(), map = await makeMap(host, dest || store || { lat: 22, lng: 79 }, dest ? 13 : 5), bounds = new maps.LatLngBounds();
  if (dest) { await makeMarker(map, dest, { title: 'Delivery address', glyph: '⌂' }); bounds.extend(dest); }
  if (store) { await makeMarker(map, store, { title: 'Kumud Boutique', color: '#3a1030', glyph: 'K' }); bounds.extend(store); }
  let cm = null, renderer = null, directions = null;
  const draw = async (from, to) => {
    if (!route || !from || !to) return;
    try {
      const { DirectionsService, DirectionsRenderer } = await maps.importLibrary('routes');
      directions = directions || new DirectionsService(); renderer = renderer || new DirectionsRenderer({ map, suppressMarkers: true, polylineOptions: { strokeColor: '#8a1f4f', strokeWeight: 4 } });
      const r = await directions.route({ origin: from, destination: to, travelMode: 'DRIVING' }); renderer.setDirections(r);
      const leg = r.routes[0] && r.routes[0].legs[0]; return leg ? { km: leg.distance.value / 1000, minutes: Math.round(leg.duration.value / 60) } : null;
    } catch { return null; }
  };
  const setCourier = async pos => {
    if (!pos) { if (cm) cm.map = null; return null; }
    if (!cm) cm = await makeMarker(map, pos, { title: 'Courier', color: '#1d6b4f', glyph: '🛵' }); else { cm.map = map; cm.position = pos; }
    bounds.extend(pos); map.fitBounds(bounds, 60);
    return draw(pos, dest);
  };
  if (courier) await setCourier(courier); else { await draw(store, dest); if (!bounds.isEmpty()) map.fitBounds(bounds, 60); }
  return { setCourier, map };
}

// Always-works fallback: a real OpenStreetMap view (no key needed). Used when Google is not configured or fails, so there is never a blank or broken map.
export function osmEmbed(host, pt, note = '') {
  const d = 0.006, bbox = [pt.lng - d, pt.lat - d, pt.lng + d, pt.lat + d].map(n => n.toFixed(5)).join('%2C');
  host.innerHTML = '';
  const f = document.createElement('iframe'); f.title = 'Map'; f.loading = 'lazy'; f.referrerPolicy = 'no-referrer'; f.className = 'osm-frame';
  f.src = 'https://www.openstreetmap.org/export/embed.html?bbox=' + bbox + '&layer=mapnik&marker=' + encodeURIComponent(pt.lat.toFixed(5) + ',' + pt.lng.toFixed(5));
  host.appendChild(f);
  if (note) { const p = document.createElement('p'); p.className = 'map-hint'; p.textContent = note; host.appendChild(p); }
}

// Checkout fallback when Google Maps is unavailable: the customer can still pin their location with the device GPS.
export function fallbackPicker(host, { onPick, why = '' }) {
  host.innerHTML = '<div class="map-box" data-osm></div><div class="map-bar"><button type="button" class="btn btn-ghost sm" data-me>Use my current location</button><span class="map-hint" aria-live="polite"></span></div>';
  const hint = $('.map-hint', host), box = $('[data-osm]', host);
  hint.textContent = why || 'Map search is not available right now — type your address above, or use your current location.';
  $('[data-me]', host).addEventListener('click', () => {
    if (!navigator.geolocation) return toast('Your browser cannot share its location.', 'warn');
    navigator.geolocation.getCurrentPosition(p => { const pt = { lat: p.coords.latitude, lng: p.coords.longitude }; osmEmbed(box, pt); hint.textContent = 'Location saved from your device.'; onPick({ ...pt, placeId: '', address: null }); },
      () => toast('We could not get your location. Please type your address instead.', 'warn'), { enableHighAccuracy: true, timeout: 10000 });
  });
}

// Browser-side Maps self-test used by Admin → Security. Reports each Google service separately with a plain-words fix.
export async function runMapsCheck() {
  const out = [], add = (name, ok, message, fix = '') => out.push({ name, ok, message, fix });
  if (!mapsOn()) { add('Browser key', false, 'GOOGLE_MAPS_API_KEY is not set on this site, so no Google map can load.', 'Add the key in your host\'s environment variables and redeploy (see docs/SECURITY.md).'); return out; }
  mapsAuthError = '';
  let maps;
  try { maps = await loadMaps(); add('Maps JavaScript API', true, 'Loaded.'); } catch (e) { add('Maps JavaScript API', false, e.message, 'Check the key, that "Maps JavaScript API" is enabled, billing is on, and the key allows this site as an HTTP referrer.'); return out; }
  await new Promise(r => setTimeout(r, 1500));
  if (mapsAuthError) { add('Key accepted by Google', false, mapsAuthError, 'Open the browser console (F12) for the exact Google error code, e.g. RefererNotAllowedMapError, ApiNotActivatedMapError or BillingNotEnabledMapError.'); return out; }
  add('Key accepted by Google', true, 'No authentication error.');
  try { const { PlaceAutocompleteElement } = await maps.importLibrary('places'); add('Places (address search)', !!PlaceAutocompleteElement, PlaceAutocompleteElement ? 'Library loaded. Enable "Places API (New)" in Google Cloud if searching returns nothing.' : 'Not available.', 'Enable "Places API (New)".'); } catch (e) { add('Places (address search)', false, e.message, 'Enable "Places API (New)" for this key.'); }
  try { const { Geocoder } = await maps.importLibrary('geocoding'), r = await new Geocoder().geocode({ address: 'Udaipur, Rajasthan' }); add('Geocoding (address from pin)', !!(r.results && r.results.length), 'Lookup works.'); } catch (e) { add('Geocoding (address from pin)', false, e.message || String(e), 'Enable "Geocoding API" for this key.'); }
  try { const { DirectionsService } = await maps.importLibrary('routes'), r = await new DirectionsService().route({ origin: state.meta.store, destination: { lat: state.meta.store.lat + 0.02, lng: state.meta.store.lng + 0.02 }, travelMode: 'DRIVING' }); add('Directions (delivery routes)', !!(r.routes && r.routes.length), 'Routing works.'); } catch (e) { add('Directions (delivery routes)', false, e.message || String(e), 'Enable "Directions API" for this key.'); }
  return out;
}

export const mapFallback = (dest, label = 'Open in Google Maps') => html`<a class="btn btn-ghost sm" target="_blank" rel="noopener" href="${gmapsLink(dest.lat, dest.lng)}">${label}</a>`;
