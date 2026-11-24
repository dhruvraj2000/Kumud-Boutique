# Security, tracking & maps — operations guide

## What is protected, and where

| Area | How | Where in the code |
|---|---|---|
| Passwords | scrypt with per-user salt; common passwords refused; staff need 12+ characters | `server/db.js`, `server/security-routes.js` |
| Sign-in | per-account lockout (5 failures → 15 min), per-IP rate limit, identical error for unknown accounts, constant-time compare | `security-routes.js`, `security.js` |
| Admin 2FA | TOTP (RFC 6238, any authenticator app), single-use codes, 8 single-use recovery codes, secret encrypted at rest (AES-256-GCM). **Mandatory for the admin in production** (`REQUIRE_ADMIN_MFA`) | `security.js`, `security-routes.js` |
| Sessions | random 256-bit token; only its SHA-256 is stored; HttpOnly, `Secure` in production, `SameSite=Strict` for staff; staff expire after 30 min idle / 8 h; customers 14 days idle; revocable from Admin → Security | `security.js` |
| RBAC | `admin` (everything), `manager` (orders, products, enquiries, reports), `delivery` (only their assigned deliveries). Checked on the server for every route | `PERMS` in `security.js` |
| CSRF | cross-site requests blocked by Origin / Sec-Fetch-Site; JSON-only bodies; staff writes also need a per-session `X-CSRF-Token` | `csrfGuard`, `needPerm` |
| XSS | all output escaped by the template engine; strict CSP (no inline script except two hashed ones); invoices HTML-escaped; CSV export neutralises formulas | `security.js`, `tracking.js` |
| SQL injection | every query is parameterised (`node:sqlite` prepared statements). There is no string-built SQL from user input | whole server |
| Rate limiting / abuse | 300 requests/min/IP globally, tighter limits on login, reset, tracking, orders; repeated abuse auto-blocks the IP for 30 min and alerts you | `guard`, `logEvent` |
| Headers | CSP, HSTS, nosniff, frame, referrer, permissions-policy, COOP. Mirrored into `vercel.json` for CDN-served files | `headers()`, `scripts/sync-vercel-headers.js` |
| HTTPS | HTTP→HTTPS redirect (via `X-Forwarded-Proto`) and HSTS in production | `headers()` |
| Uploads | the site has no upload endpoint, so there is no upload attack surface. If you add one: accept images only, check magic bytes, random file names, store outside `public/` | — |
| Audit & alerts | sign-ins, failures, lockouts, blocked requests, order changes, role changes, exports → Admin → Security. High-severity events create an alert and (if configured) an email / webhook | `security.js`, `notify.js` |
| Backups | automatic consistent SQLite snapshot every 24 h (14 kept), manual button, health shown | `server/backup.js` |
| Privacy | customers can export or delete their data; courier GPS trails deleted 7 days after delivery; PII-free tracking page | `security-routes.js`, `tracking.js` |

### Things that are *not* code (you must do these)

1. **DDoS / traffic floods.** An application cannot absorb a volumetric attack; that is the network's job. Put the site behind **Cloudflare** (free plan is enough): proxy the DNS record, turn on *Under Attack Mode* if you are hit, add a rate-limiting rule for `/api/auth/*`, and enable *Bot Fight Mode*. Vercel and Render also absorb basic L3/L4 floods. The in-app limits cover the rest (credential stuffing, scraping, tracking-ID guessing).
2. **Set the secrets** in your host's dashboard, never in code: `SESSION_SECRET`, `ADMIN_PASSWORD`, `GOOGLE_MAPS_*`, email/SMS keys (see `.env.example`).
3. **Turn on 2FA** the first time you sign in as admin (Admin → Security). In production the admin panel refuses writes until you do.
4. **Persistent disk.** Backups and the SQLite database need one. On Vercel the filesystem is ephemeral (`/tmp`), so use Render's disk (see `render.yaml`) or move to a hosted database before taking real orders.
5. **Off-site copy of backups.** A backup on the same disk does not survive losing the disk. Download one weekly (or sync the `backups/` folder to cloud storage).

## Google Maps

You need two keys (Google Cloud Console → Credentials). Billing must be enabled (Google gives a monthly free credit).

| | Browser key → `GOOGLE_MAPS_API_KEY` | Server key → `GOOGLE_MAPS_SERVER_KEY` |
|---|---|---|
| Sent to browsers? | Yes (it has to be) | **Never** |
| Restrict by | *HTTP referrers*: `https://your-domain/*` | *IP addresses*: your server's outbound IP |
| APIs | Maps JavaScript, Places (New), Geocoding, Directions | Distance Matrix |

Also set a daily quota cap on each API so a leaked key cannot run up a bill. Without the keys the site works exactly as before: checkout uses the standard delivery fee, the tracking page shows a text status, and admin screens show "Open in Google Maps" links.

Delivery pricing (editable in `server/geo.js`): ₹79 up to 30 km, ₹149 up to 400 km, ₹199 beyond; free above ₹7,500. The store location is `STORE_LAT`/`STORE_LNG`. To refuse certain PIN codes, set the `blockedPincodes` setting (comma-separated); `maxDeliveryKm` limits the radius.

## Order tracking

* Every order gets an **Order number** (`KB-261120-1913`) and an unguessable **Tracking ID** (`KT-XU45-TA86-MMRP`, 60 bits, no look-alike characters). Guessing is rate-limited and logged.
* The public tracking page (`#/track`) shows status, timestamps, ETA, address, items — **not** the email, full phone number or notes.
* Statuses: placed → confirmed → processing → packed → dispatched → out for delivery → delivered; plus cancelled, return requested, returned. Status can only move forward (or to cancelled / returns), so history cannot be rewritten.
* Every status change (and each placement) writes an in-app notification and sends email / SMS / WhatsApp for whichever channels have keys. Without keys the attempt is logged as "skipped" in `notification_log` (Admin → Security shows failures).
* **Live courier location:** the courier signs in (`#/courier`), taps *Start delivery* then *Share live location* — the browser asks for permission. The server stores positions only while the order is *out for delivery* **and** sharing is on **and** the order is assigned to that courier. Customers see the position only through their own Tracking ID, only while fresh (< 10 min). Sharing stops automatically on delivery.
* Returns: customers can request one within 7 days of delivery; you approve (→ stock returns, payment marked *refund due*) or reject.
* Invoices: `/api/orders/<number>/invoice` (owner or admin) — print or save as PDF from the browser. Set `sellerName`, `sellerAddress`, `gstin` in Settings to print them on invoices.

## Backup & recovery

* Automatic: every `BACKUP_EVERY_HOURS` (24) into `<db folder>/backups/` (or `BACKUP_DIR`), newest `BACKUP_KEEP` (14) retained.
* Manual: Admin → Security → *Back up now*.
* **Restore:** stop the server → copy a file from `backups/` over `data/kumud.db` (delete any `kumud.db-wal` / `-shm` next to it) → start the server → check Admin → Orders. Test this once before you need it.
* If `SESSION_SECRET` changes, 2FA secrets encrypted with the old one can no longer be read: staff must re-enrol 2FA. Keep the secret stable and backed up separately.

## If something looks wrong

1. Admin → Security → *Alerts* and *Suspicious IP addresses*.
2. Revoke sessions you do not recognise; block an address; remove a team member (signs them out immediately).
3. Change `ADMIN_PASSWORD` / rotate `SESSION_SECRET` (signs everyone out; staff re-enrol 2FA).
4. Rotate any API key you suspect, in the provider's dashboard, then update the host's environment variables.

## Tests

`npm test` (21 API checks), `node --test test/security.test.js test/tracking.test.js` (security mechanisms, order workflow, courier GPS, delivery pricing). The Google Maps browser widgets need a real key to exercise and are not covered by automated tests.
