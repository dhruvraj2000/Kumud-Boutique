# Booking System, Admin Portal & Rate Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store rental and appointment bookings in MySQL, quote prices from a date-based rate engine, and manage everything from a separate secure admin portal at `/admin`.

**Architecture:** New CommonJS modules under `server/` (a lazy `mysql2` pool, SQL migrations, a pure rate engine, a booking service, two Express routers) are mounted in the existing `server/server.js` before the static/catch-all handlers. The admin portal is a static vanilla-JS app in `public/admin/`. The existing SQLite shop and its `npm test` are untouched; the MySQL pool is created lazily so they never need MySQL.

**Tech Stack:** Node 22, Express 4, `mysql2` (new, only new dependency), `node:test`, `crypto.scrypt`, vanilla ES modules.

**Spec:** `docs/superpowers/specs/2026-11-16-booking-admin-rates-design.md`

## Global Constraints
- Node >=22.13; only new dependency is `mysql2`; no ORM; no bcrypt/native modules (use `crypto.scrypt`).
- MySQL 8, InnoDB, utf8mb4; connection from `MYSQL_URL` (tests: `MYSQL_TEST_URL`); `dateStrings: true` so DATE columns are `'YYYY-MM-DD'` strings. Prices are integer rupees.
- Rental `end_date` is exclusive (price per night/day from `start_date` up to but not including `end_date`).
- Rate precedence per day: single-date rule → period rule → weekday rule → item `base_price`; higher `priority` wins within a type; item-specific beats global (`item_id NULL`) at equal type.
- Server recomputes price at booking time; client-supplied price is ignored; `total_price` + `price_breakdown` are stored as a snapshot.
- Admin: scrypt hashing, httpOnly + SameSite=Strict (+Secure in production) cookie `kb_admin`, sessions in `admin_sessions`, CSRF header `X-CSRF-Token` on every admin write, lockout after 5 failed logins, no default password, no CORS on `/api/admin/*`.
- All SQL parameterised. All user-controlled text rendered in the portal goes through `esc()` from `public/js/core.js`.
- Booking statuses: `pending`, `confirmed`, `completed`, `cancelled`. Only `pending`/`confirmed` block dates/slots.
- Existing shop tests (`npm test`) must keep passing unchanged and must not require MySQL.
- No online payment; `deposit` is informational.

## Review Focus
1. Two customers submit the same rental dates simultaneously → exactly one 201, the other 409 (Task 4).
2. Range where `to <= from`, in the past, or longer than 60 days → 400 with a readable message (Tasks 3, 5).
3. Customer text containing `<script>` in name/notes → rendered inert in the admin portal (Task 8).
4. Cancelling a booking frees its dates/slot; a cancelled booking can't be re-confirmed into a conflict (Tasks 4, 6).
5. Phone typed as `+91 98765 43210` / `098765…` matches the existing customer rather than creating a duplicate (Task 4).

---

## File Structure
- `server/mysql.js` — lazy pool, `query()`, `tx()`, `close()`.
- `server/migrate.js` + `server/migrations/001_init.sql` — migration runner and schema.
- `server/rates.js` — pure `priceRange()` rate engine (no DB).
- `server/booking-service.js` — items/rules loaders, `quote`, `availability`, `slotsFor`, `createBooking`, status changes.
- `server/booking-routes.js` — public router (`/api/items`, `/api/rates/quote`, `/api/availability`, `/api/slots`, `/api/bookings`).
- `server/admin-auth.js` — scrypt, sessions, CSRF, lockout, `adminRouter` login/logout/me, `requireAdmin`.
- `server/admin-routes.js` — bookings/customers/items/rules/slots/dashboard admin API.
- `scripts/create-admin.js` — `npm run admin:create`.
- `public/admin/index.html`, `public/admin/admin.js`, `public/admin/admin.css` — portal.
- `public/js/views/booking.js` — customer rental + appointment forms (replaces the `book` branch of `info.js`).
- `test/*.test.js` — `node:test` suites; `test/helpers.js` creates/drops a throwaway schema.

---

### Task 1: MySQL pool, migrations and schema

**Files:**
- Create: `server/mysql.js`, `server/migrate.js`, `server/migrations/001_init.sql`, `test/helpers.js`, `test/migrate.test.js`, `.env.example`
- Modify: `package.json` (add `mysql2`; scripts `test:booking`, `migrate`), `.gitignore` (add `.env`)

**Interfaces:**
- Produces: `mysql.query(sql: string, params?: any[]): Promise<any[]>` (rows for SELECT, result header for writes), `mysql.tx<T>(fn: (conn: {query(sql, params?): Promise<any[]>}) => Promise<T>): Promise<T>` (commit/rollback), `mysql.close(): Promise<void>`, `migrate.run(): Promise<string[]>` (names applied), `helpers.freshDb(): Promise<void>` (creates a unique schema from `MYSQL_TEST_URL`, sets `process.env.MYSQL_URL` to it, runs migrations), `helpers.dropDb(): Promise<void>`.

- [ ] **Step 1: Write failing test** `test/migrate.test.js`: after `freshDb()`, `SHOW TABLES` contains `admins, admin_sessions, customers, items, bookings, booking_events, rate_rules, appointment_slots, blocked_dates, schema_migrations`; running `migrate.run()` a second time returns `[]`. The suite calls `t.skip('MYSQL_TEST_URL not set')` when the env var is missing.
- [ ] **Step 2: Run** `node --env-file-if-exists=.env --test test/migrate.test.js` → FAIL (modules missing).
- [ ] **Step 3: Implement** `mysql.js` (pool created on first use from `MYSQL_URL`, `dateStrings:true`, `multipleStatements:false`, `connectionLimit:10`), `migrate.js` (applies `migrations/*.sql` in name order, one statement per `;`-separated chunk inside a transaction-free loop, records in `schema_migrations(name PK, applied_at)`), and `001_init.sql` with every table/column from the spec's Schema section. Add indexes: `bookings(item_id,start_date,end_date)`, `bookings(status)`, `bookings(customer_id)`, `rate_rules(item_id,type)`, `customers(phone)`, `customers(email)`. Add FKs from bookings→customers/items and booking_events→bookings. `helpers.freshDb` creates `kb_test_<random>` via the admin connection in `MYSQL_TEST_URL`.
- [ ] **Step 4: Run** the same command → PASS (needs a reachable MySQL; if none, report the skip honestly).
- [ ] **Step 5: Commit** `feat: mysql pool, migrations and booking schema`.

---

### Task 2: Rate engine (pure)

**Files:** Create `server/rates.js`, `test/rates.test.js`

**Interfaces:**
- Produces: `priceRange(item: {id:number, base_price:number}, rules: Rule[], from: string, to: string): {days: {date:string, price:number, source:'date'|'period'|'weekday'|'base', label:string|null}[], total:number}` where `Rule = {id, item_id:number|null, type:'weekday'|'period'|'date', weekday:number|null, start_date:string|null, end_date:string|null, price:number, label:string|null, priority:number}`; `to` exclusive; weekday is 0=Sunday…6=Saturday; period rules inclusive of both `start_date` and `end_date`. `eachDate(from, to): string[]` helper exported. Uses UTC date math only (no local-time `Date`).

- [ ] **Step 1: Write failing tests** (`node:test`), item base 1000: (a) no rules → 3 days × 1000 = 3000, source `base`; (b) weekday rule Sat=0 → price 1500 on a Saturday only; (c) period rule 2026-12-10…2026-12-15 price 2500 beats the weekday rule on a Saturday inside it; (d) date rule 2026-12-12 price 4000 beats the period; (e) two period rules overlapping, priority 5 beats priority 1; (f) item-specific weekday rule beats global weekday rule; (g) range crossing a month/year boundary (2026-12-30→2027-01-02 = 3 days); (h) `to <= from` throws `RangeError('to must be after from')`.
- [ ] **Step 2: Run** `node --test test/rates.test.js` → FAIL.
- [ ] **Step 3: Implement** `priceRange` and `eachDate` per the Global Constraints precedence (sort candidates by type rank, then item-specific, then priority desc, then id desc).
- [ ] **Step 4: Run** → PASS (no database needed).
- [ ] **Step 5: Commit** `feat: date-based rate engine`.

---

### Task 3: Booking service — items, quote, availability, slots

**Files:** Create `server/booking-service.js`, `test/booking-service.test.js`

**Interfaces:**
- Consumes: `mysql.query`, `rates.priceRange`.
- Produces: `getItems(kind?: string): Promise<Item[]>` (active only), `quote(itemId:number, from:string, to:string): Promise<{item:Item, days, total:number}>` (throws `ServiceError(400|404, msg)` for unknown/inactive item, invalid dates, `to<=from`, `from` before today (Asia/Kolkata), range > 60 days), `isRentalFree(conn|null, itemId, from, to): Promise<boolean>`, `slotsFor(itemId:number, date:string): Promise<{time:string, left:number}[]>` (empty for blocked dates; capacity minus pending/confirmed bookings at that time). Export `class ServiceError extends Error {status, field}`.

- [ ] **Step 1: Write failing tests** (uses `freshDb`; seed items/rules via `mysql.query`): quote returns the breakdown total from seeded rules; quote with `to<=from` → status 400; past date → 400; 61-day range → 400; inactive item → 404; `isRentalFree` false for an overlapping pending booking, true for a cancelled one and for back-to-back ranges (`to` of one == `from` of the next); `slotsFor` decrements `left` as bookings are added and returns `[]` for a blocked date.
- [ ] **Step 2: Run** `node --env-file-if-exists=.env --test test/booking-service.test.js` → FAIL.
- [ ] **Step 3: Implement** the functions; rule loading selects rules with `item_id IS NULL OR item_id=?`; overlap test is `start_date < ? AND end_date > ?`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: quote, availability and slots service`.

---

### Task 4: createBooking transaction and status changes

**Files:** Modify `server/booking-service.js`; Test `test/booking-create.test.js`

**Interfaces:**
- Produces: `createBooking(input: {itemId:number, from:string, to?:string, slotTime?:string, name:string, phone:string, email?:string, notes?:string}, opts?: {adminId?:number, status?:'pending'|'confirmed'}): Promise<{ref:string, id:number, total:number}>`; `setStatus(bookingId:number, status:Status, note:string, adminId:number|null): Promise<void>` (writes `booking_events`; re-confirming a cancelled booking re-checks availability and throws `ServiceError(409)` on conflict); `normalizePhone(v:string): string` (digits only, strip leading `91` when 12 digits or leading `0` when 11 digits); `upsertCustomer(conn, {name, phone, email}): Promise<number>`. Refs look like `KB-` + 6 uppercase alphanumerics, unique.
- Appointments: `to` omitted → stored `end_date = start_date`, price = quote for one day; requires `slotTime` that is in `slotsFor()` with `left > 0`, else 409.

- [ ] **Step 1: Write failing tests:** (a) rental creation stores total equal to `quote()` total and a JSON breakdown, and a `pending` event row; (b) a client-supplied `total` field in the input is ignored; (c) `Promise.all` of two `createBooking` calls for the same item/dates → one resolves, one rejects with status 409; (d) appointment into a full slot → 409; (e) `+91 98765 43210` and `09876543210` map to the same customer id (one customers row); (f) invalid phone (`123`) → 400 field `phone`; missing name → 400 field `name`; (g) cancel then book the same dates succeeds; (h) `setStatus` confirm on a cancelled booking whose dates were since taken → 409.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** inside `mysql.tx`: `SELECT id FROM items WHERE id=? FOR UPDATE` to serialize per item, then availability check, customer upsert, insert booking + event. Reuse `quote()` logic for the price (shared internal function taking the connection).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: transactional booking creation and status history`.

---

### Task 5: Public booking API

**Files:** Create `server/booking-routes.js`, `test/booking-api.test.js`; Modify `server/server.js` (mount `app.use('/api', require('./booking-routes'))` immediately before the `/* ---------- static + errors ---------- */` block; map `ServiceError` in the existing error handler by its `status`/`field`, which already works via `err.status`/`err.field`).

**Interfaces:**
- Consumes: Task 3–4 service functions.
- Produces: `GET /api/items?kind=` → `{items}`; `GET /api/rates/quote?item&from&to` → `{item, days, total}`; `GET /api/availability?item&from&to` → `{available:boolean}`; `GET /api/slots?item&date` → `{slots}`; `POST /api/bookings` (JSON body as `createBooking` input) → `201 {ref,total}`. Rate-limit `POST /api/bookings` to 10/minute/IP using the existing `limit` helper pattern (copy into the router; don't export from server.js).

- [ ] **Step 1: Write failing tests** by starting the express app on port 0 (as `server/test.js` does) with `freshDb` seeded: quote 200 with total; quote bad range 400 + `error` text; POST booking 201 and the row exists in MySQL; second identical POST 409; POST with `<script>` name stored verbatim (escaping is a render concern); 11th POST in a minute → 429.
- [ ] **Step 2: Run** `node --env-file-if-exists=.env --test test/booking-api.test.js` → FAIL.
- [ ] **Step 3: Implement** the router; convert query params with strict validation (`/^\d{4}-\d{2}-\d{2}$/`, positive integer item ids); wrap async handlers so rejections reach the error handler.
- [ ] **Step 4: Run** the new test **and** `npm test` → both PASS (existing shop tests unaffected, no MySQL required).
- [ ] **Step 5: Commit** `feat: public booking and quote API`.

---

### Task 6: Admin authentication

**Files:** Create `server/admin-auth.js`, `scripts/create-admin.js`, `test/admin-auth.test.js`; Modify `server/server.js` (mount `/api/admin/auth` router *before* the existing `/api/admin/*` shop routes? No — mount at `/api/portal` instead to avoid collision), `package.json` (`"admin:create": "node --env-file-if-exists=.env scripts/create-admin.js"`).

Note: the shop already owns `/api/admin/*`. All new portal endpoints live under **`/api/portal/*`** (this replaces `/api/admin/*` wherever the spec says so).

**Interfaces:**
- Produces: `hashPassword(pw:string): Promise<string>` (`scrypt$<saltHex>$<hashHex>`), `verifyPassword(pw, stored): Promise<boolean>` (timing-safe), `requireAdmin(req,res,next)` (sets `req.admin={id,email,name}`; 401 without a valid session; 403 on missing/incorrect CSRF for non-GET), `authRouter` with `POST /api/portal/auth/login {email,password}` → `{admin, csrf}` + cookie, `POST /logout`, `GET /me` → `{admin, csrf}`. Session id: 32 random bytes; DB stores SHA-256 hash; 12h expiry. `create-admin.js <email> <name>` prompts for the password on stdin (min 12 chars) and inserts into `admins`.
- Lockout: 5 consecutive failures → `locked_until = now+15min`, responses 429; success resets counters. Identical error text for unknown email vs wrong password.

- [ ] **Step 1: Write failing tests:** login success sets cookie and returns csrf; wrong password 401 with the same message as unknown email; 5 failures then correct password → 429 (locked); a protected GET works with cookie; a POST without `X-CSRF-Token` → 403, with it → ok; logout invalidates the session (next `/me` 401); expired session (set `expires_at` in the past) → 401; cookie has `HttpOnly` and `SameSite=Strict`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the module and CLI; `Secure` flag added when `NODE_ENV==='production'`.
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: secure admin authentication`.

---

### Task 7: Portal API — bookings, customers, dashboard

**Files:** Create `server/admin-routes.js` (part 1), `test/portal-bookings.test.js`; Modify `server/server.js` (mount `/api/portal` router after `authRouter`, all behind `requireAdmin`).

**Interfaces:**
- Produces: `GET /api/portal/bookings?status&kind&from&to&q&page` → `{bookings, total}` (25/page; `q` matches name, phone digits, email, ref; each row includes customer name/phone and item name); `GET /api/portal/bookings/:id` → booking + customer + `events[]`; `POST /api/portal/bookings` (manual booking, same body as `createBooking`, `status` optional) → 201; `PATCH /api/portal/bookings/:id` `{status?, note?, notes?}` → uses `setStatus`; `GET /api/portal/customers?q&page`, `GET /api/portal/customers/:id` (with bookings), `PATCH /api/portal/customers/:id {name?,email?,notes?}`; `GET /api/portal/dashboard` → `{today:[], upcoming:[], pending:number, revenue:{month:number, total:number}}` (revenue = sum of `total_price` for `confirmed`+`completed`).

- [ ] **Step 1: Write failing tests** (logged-in agent helper): unauthenticated list → 401; list filters by status and by `q` (phone typed with spaces); detail includes ordered events; PATCH status writes an event with the admin id; invalid status → 400; manual booking creates a `confirmed` booking when asked; dashboard revenue excludes cancelled/pending.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** with parameterised dynamic WHERE building (whitelist columns/sorts).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat: portal API for bookings, customers and dashboard`.

---

### Task 8: Portal API — items, rates, slots, blocked dates

**Files:** Modify `server/admin-routes.js` (part 2); Test `test/portal-rates.test.js`

**Interfaces:**
- Produces: items CRUD `GET/POST /api/portal/items`, `PATCH/DELETE /api/portal/items/:id` (delete = set `active=0` when bookings exist, else hard delete); rules `GET /api/portal/rules?item`, `POST /api/portal/rules`, `PATCH/DELETE /api/portal/rules/:id` (validation: price integer ≥ 0; weekday rule needs `weekday` 0–6; period needs `start_date <= end_date`; date rule uses `start_date` only); `GET /api/portal/rates/calendar?item&month=YYYY-MM` → `{days:[{date,price,source,label}]}` using `priceRange` (one call per day range, `to` = first of next month); `GET/POST/DELETE /api/portal/slots` (weekday, start/end time, capacity ≥ 1); `GET/POST/DELETE /api/portal/blocked-dates`.

- [ ] **Step 1: Write failing tests:** creating a weekday rule changes the calendar price for that weekday only; a date rule overrides it for one day; deleting a rule restores the base price; invalid rule bodies (negative price, weekday 9, period end before start) → 400; creating a rule does **not** change `total_price` of an existing booking (snapshot test); deleting an item with bookings only deactivates it; blocked date empties `slotsFor`.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the endpoints.
- [ ] **Step 4: Run** → PASS; also run all `test/*.test.js` together.
- [ ] **Step 5: Commit** `feat: portal API for items, rate rules, slots and blocked dates`.

---

### Task 9: Admin portal UI — shell, login, bookings, customers, dashboard

**Files:** Create `public/admin/index.html`, `public/admin/admin.js`, `public/admin/admin.css`; Modify `server/server.js` (before the static block: `app.get('/admin', …)` sends `public/admin/index.html` with `Cache-Control: no-store`, `X-Robots-Tag: noindex`; static already serves `/admin/admin.js|css`); `public/robots.txt` (`Disallow: /admin`).

**Interfaces:**
- Consumes: Task 6–7 endpoints; `esc`, `html`, `render`, `money` from `/js/core.js` (import as an ES module).
- Produces: hash-routed views `#/login`, `#/`, `#/bookings`, `#/bookings/:id`, `#/customers`, `#/customers/:id`, with a `portalApi(method, url, body)` wrapper that attaches `X-CSRF-Token`, redirects to `#/login` on 401 and surfaces `error` text. No customer-supplied string is inserted without `esc()` (the `html` tag already escapes).

- [ ] **Step 1: Write failing test** `test/portal-ui.test.js`: `GET /admin` → 200 HTML containing `<script type="module" src="/admin/admin.js">` and header `x-robots-tag: noindex`; `GET /admin/admin.js` → 200.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the shell and views: login form, dashboard cards, bookings table with filters/search/pagination and status badge, booking detail with history and status-change form (status select + note), manual-booking form, customers list/detail with notes edit. Keep CSS in one file, usable at phone width.
- [ ] **Step 4: Run** the test → PASS, then start the server with a real MySQL and verify in a browser: log in, create a manual booking, change its status, and confirm the history updates. If no MySQL is available, state that the UI was not browser-verified.
- [ ] **Step 5: Commit** `feat: admin portal shell, bookings, customers, dashboard`.

---

### Task 10: Admin portal UI — rate management, items, slots

**Files:** Modify `public/admin/admin.js`, `public/admin/admin.css`

**Interfaces:**
- Consumes: Task 8 endpoints. Produces: views `#/rates`, `#/items`, `#/slots`.
- `#/rates`: item selector, month calendar showing the effective price and source colour per day, list of rules with add/edit/delete (type selector switches fields: weekday / period / single date; item or "All items"; price; label; priority), and a live preview that re-fetches the calendar after every change. `#/items`: add/edit/deactivate items with kind, base price, deposit. `#/slots`: weekly slot table and blocked dates list.

- [ ] **Step 1: Write failing test** extending `test/portal-ui.test.js`: `admin.js` source contains routes `#/rates`, `#/items`, `#/slots` (cheap smoke check; behaviour is covered by Task 8 API tests).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the three views.
- [ ] **Step 4: Run** tests → PASS; then verify in a browser against real MySQL: add a Saturday rule, see the calendar update, then confirm the public quote endpoint returns the same price. State plainly if this could not be run.
- [ ] **Step 5: Commit** `feat: admin rate calendar, items and slots management`.

---

### Task 11: Customer-facing booking flows

**Files:** Create `public/js/views/booking.js`; Modify `public/js/views/info.js` (route `book` to the new view; leave `custom`/`contact` on the inquiry form), `public/js/app.js` (register a `#/rent` route and header/footer link "Rent a piece"), `public/css/style.css` (form + price breakdown styles)

**Interfaces:**
- Consumes: Task 5 endpoints via `get`/`post` from `core.js`.
- Produces: `bookingView(el: HTMLElement, mode: 'rent'|'book'): Promise<string>` (returns page title like other views). Rent: pick outfit, start/end date → live per-day price breakdown and total, name/phone/email/notes, submit → confirmation screen with the reference. Appointment: pick service and date → available slots → same details → confirmation. Server errors (409/400) shown inline against the field.

- [ ] **Step 1: Write failing test** `test/booking-view.test.js`: `GET /` still 200 and `public/js/views/booking.js` exports `bookingView` (import via dynamic `import()` is not possible server-side; assert file text contains `export async function bookingView` and routes `rent`/`book` in `app.js`).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the view; debounce quote requests; disable submit while pending; prevent past dates with `min`.
- [ ] **Step 4: Run** tests, `npm test`; then browser-verify a real rental and appointment booking end to end and see both rows in the portal. State plainly if MySQL was unavailable.
- [ ] **Step 5: Commit** `feat: customer rental and appointment booking flows`.

---

### Task 12: Docs and deployment notes

**Files:** Modify `README.md`, `render.yaml`; Create `docs/booking-setup.md`

- [ ] **Step 1:** Document: `MYSQL_URL` / `MYSQL_TEST_URL` in `.env`, `npm run migrate`, `npm run admin:create`, portal URL `/admin`, the rate-rule precedence, and that production needs a hosted MySQL (add `MYSQL_URL` as `sync: false` in `render.yaml`).
- [ ] **Step 2: Run** the full suite once more: `npm test` and `node --env-file-if-exists=.env --test test/` → all PASS (or clearly list skipped MySQL suites).
- [ ] **Step 3: Commit** `docs: booking system setup`.

---

## Self-Review
- **Spec coverage:** schema/migrations T1; rate engine T2; quote/availability/slots T3; transactional booking + customers + history T4; public API T5; admin auth/security T6; bookings/customers/dashboard T7; items/rates/slots/blocked dates T8; portal UI T9–10; site forms T11; docs T12. Out-of-scope items (shop migration, payments) are not planned.
- **Deviation from spec, flagged:** portal API lives under `/api/portal/*` because `/api/admin/*` already belongs to the existing shop admin. Everything else follows the spec.
- **Verification caveat:** Tasks 1, 3–11 need a reachable MySQL. Without `MYSQL_URL`/`MYSQL_TEST_URL`, only Task 2 and the existing shop tests can be proven locally.
