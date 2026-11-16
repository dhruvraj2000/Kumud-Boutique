# Booking system, Admin Portal & Rate Management — Design (Spec A)

Date: 2026-11-16 · Status: awaiting user review

## Goal
Customers book **outfit rentals** (date range) and **atelier appointments** (date + time slot). Every booking, customer and price lives in **MySQL**. A separate, secure **Admin Portal** (`/admin`) manages bookings, customers and a **rate calendar**, so prices never need manual daily edits. The website quotes prices from the same database.

## Scope
In: MySQL data layer, migrations runner, bookings, customers, items, rate engine, availability, public booking API + front-end forms, admin portal, admin auth/security, tests.
Out (Spec B, next): migrating existing shop tables (users, products, orders, inquiries, measurements) from SQLite to MySQL, and porting `server/test.js`. Until then the shop keeps running on SQLite; the new code uses a shared `server/mysql.js` pool that Spec B will extend.
Out entirely: online payment/deposit collection (bookings are recorded only; deposit amount is stored for reference).

## Assumptions
- Stack stays Node 22 + Express + vanilla JS; new dep: `mysql2` only (passwords use `crypto.scrypt`).
- MySQL 8, connection from `MYSQL_URL` in `.env` (git-ignored). No MySQL or Docker is installed on the dev machine; the user must supply a reachable MySQL (local install, or hosted e.g. Aiven/Railway/PlanetScale). Tests run against a throwaway schema on that server.
- Production host must run Node with network access to MySQL (Render, not Vercel's static/serverless filesystem story).
- Prices are integer rupees.

## Schema (InnoDB, utf8mb4; versioned `.sql` in `server/migrations/`, applied on start, tracked in `schema_migrations`)
- `admins(id, email UNIQUE, password_hash, name, failed_attempts, locked_until, last_login_at)`
- `admin_sessions(id_hash PK, admin_id, csrf_token, expires_at)`
- `customers(id, name, phone, email, notes, created_at)` — matched on normalized phone, else email
- `items(id, name, kind ENUM('rental','appointment'), base_price, deposit, active)`
- `bookings(id, ref UNIQUE, customer_id, item_id, kind, start_date, end_date, slot_time NULL, status ENUM('pending','confirmed','completed','cancelled'), total_price, price_breakdown JSON, notes, created_at, updated_at)`
- `booking_events(id, booking_id, status, note, admin_id NULL, at)`
- `rate_rules(id, item_id NULL=all, type ENUM('weekday','period','date'), weekday, start_date, end_date, price, label, priority)`
- `appointment_slots(id, weekday, start_time, end_time, capacity)`; `blocked_dates(date PK, reason)`

## Rate engine (`server/rates.js`, pure function + DB loader)
Per day in range, price = first match of: single-date rule → period rule → weekday rule → item `base_price`; higher `priority` wins within a type; item-specific beats global at equal type. Rental end date is exclusive (nights) — a 1-day rental uses start=end-1 day; the UI shows "days". Returns `{days:[{date,price,source}], total}`. The server recomputes at booking time and stores `total_price` + `price_breakdown` as a snapshot; later rate changes never alter existing bookings.

## Public API
- `GET /api/items`
- `GET /api/rates/quote?item&from&to` → breakdown + total
- `GET /api/availability?item&from&to` (rentals: no overlap with pending/confirmed bookings) and `GET /api/slots?date&item` (capacity minus booked, honoring blocked dates)
- `POST /api/bookings` → validates, then in one transaction (`SELECT … FOR UPDATE` on the item row) checks availability, upserts customer, inserts booking + first event; returns `ref`. Conflict → 409, bad input → 400. Client-supplied price is ignored.
- Front end: new "Rent" flow and the existing `#/book` form switched from the generic inquiry post to these endpoints, showing the live per-day price.

## Admin portal (`/admin`, static vanilla-JS app; API under `/api/admin/*`)
Pages: Dashboard (today/upcoming, pending count, revenue), Bookings (filter status/kind/date, search name/phone/ref, detail + history, change status with note, edit, cancel, create manual booking), Customers (list, history, notes), Rates (calendar of effective daily price, add/edit/delete weekday/period/date rules with live preview), Items, Slots & blocked dates.

## Security
scrypt password hashing; first admin created via `npm run admin:create` (no default password); httpOnly + SameSite=Strict + Secure session cookie backed by `admin_sessions`; CSRF token on all admin writes; login throttling + lockout after 5 failures; parameterized queries only; server-side validation; no CORS on admin API; the existing shop admin (`#/admin`) is untouched in this spec.

## Errors & testing
Readable error messages in portal and forms. Tests (Node test runner, throwaway MySQL schema): rate precedence, quote == stored price, concurrent double-booking race, slot capacity, admin auth/lockout/CSRF, status history.

## Open risk
No MySQL instance is available yet; implementation can be written but not verified end-to-end until the user provides `MYSQL_URL`.
