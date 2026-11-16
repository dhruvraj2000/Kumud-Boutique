# Booking system & admin portal — setup

## 1. Get a MySQL 8 database
Local install, or a hosted one (Aiven, Railway, PlanetScale-compatible MySQL, etc.). Create an empty database, e.g. `kumud`.

## 2. Configure
Copy `.env.example` to `.env` (git-ignored) and set:
- `MYSQL_URL=mysql://user:password@host:3306/kumud`
- `MYSQL_TEST_URL=mysql://root:password@127.0.0.1:3306` — only for tests; the user must be allowed to create/drop databases. Never point it at production.

## 3. Create tables and your admin login
```
npm install
npm run migrate                              # creates/updates tables (also runs automatically on admin:create)
npm run admin:create -- you@example.com "Your Name"   # prompts for a password (min 12 chars)
npm start
```
Open `http://localhost:3000/admin` and sign in. There is no default password.

## 4. First-time data (in the portal)
1. **Items** → add what customers can book: rentals (outfits, with a base price per day and optional deposit) and appointment services (price per visit).
2. **Slots & blocked dates** → add weekly appointment slots (weekday, start/end, capacity) and block holidays.
3. **Rates** → add rules so you never edit prices day by day.

## Rate rules
For each day, the first match wins in this order: **single date → period → weekday → item base price**.
Between rules of the same type: an item-specific rule beats an "All items" rule, then the higher *priority* number wins.
Rentals are priced per day from the start date up to (not including) the end date. Prices are fixed on a booking when it is made; later rate changes do not alter existing bookings.

## Public pages
`#/rent` (outfit rental) and `#/book` (appointment) use the live rate calendar. If MySQL is not configured the rest of the shop keeps working and those pages show a friendly "not available" message.

## Tests
`npm test` — shop tests (SQLite, no MySQL needed).
`npm run test:booking` — rate engine and UI wiring always run; the MySQL suites run only when `MYSQL_TEST_URL` is set, otherwise they are reported as skipped.

## Production
Run on a host with a Node server and network access to a hosted MySQL (e.g. Render). Set `MYSQL_URL`, `NODE_ENV=production` (adds the `Secure` cookie flag) and serve over HTTPS. The existing shop still uses SQLite until the shop migration (Spec B).
