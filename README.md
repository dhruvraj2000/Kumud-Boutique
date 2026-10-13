# Kumud Boutique — storefront

Premium handblock-print fashion e-commerce site (Node.js + SQLite, vanilla JS front end).

## Run
```
npm install
npm start          # http://localhost:3000
npm test           # 20 API checks (in-memory database)
```
Requires Node 22.13+ (uses built-in `node:sqlite`). The database is created on first run in `data/kumud.db`.

## Accounts
- Admin: `admin@kumudboutique.com` / `Admin@12345` — change via `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars before first run.
- Admin panel: `#/admin` (orders + status/tracking, stock & prices, enquiries).

## Coupons
`KUMUD10` (10%), `WELCOME500` (₹500 off ₹5,000+), `FREESHIP`.

## Product photos
Originals are in `raw/`. From the project root, `python tools/cutout.py` (rembg) cuts the background into `cutouts/`, then `python tools/compose.py` places each piece on a pure-white 1200×1500 canvas (shared scale and floor line) into `public/assets/products/`.
`raw/` holds 5 outfits; two photos are duplicates (`11.23.08` = `11.23.08 (1)`, and `11.23.07` ≈ `11.23.07 (2)`), so they are not used. More angles or new outfits can be added to `MAP` in `tools/compose.py`.

## Notes
- Product names, descriptions, prices and stock are placeholders — edit in `server/db.js` (before first run) or via the admin panel.
- Online payments (UPI/card) are simulated; no card data is stored. Replace with a real gateway (e.g. Razorpay) before going live.
- `legacy/` holds the previous one-page site.
- Contact details (shown on the contact page, footer and mobile menu): kumudgunjankumawat@gmail.com · +91 77425 84375 · 1715 Neemuch Mata Scheme, Dewali, Udaipur. WhatsApp uses the same number (Admin → Settings).

## Features added in v2
- **Lookbook** (`#/lookbook`): editorial model shots with tappable hotspots that open a mini product card (bottom sheet on phones). Stories and hotspot positions live in `LOOKS` in `server/db.js`.
- **Mother & daughter twinning** (`#/twinning`): kids sizes 2Y–12Y, pair builder, and an automatic pair discount (default 10%) when a set and its linked twin (`twin` in the seed data) are in the bag.
- **WhatsApp**: floating chat button, "Ask about this piece" on product pages (includes the chosen size) and "Order on WhatsApp" in the bag. Set the number in **Admin → Settings** (or the `WHATSAPP_NUMBER` env var before first run). Hidden until a number is set.
- **Made-to-measure**: customers save bust/waist/hip etc. under **Account → Measurements**, then pick saved / new measurements / standard size at checkout. Measurements are stored on the order and shown to the atelier in **Admin → Orders**.
- Existing databases are upgraded automatically on start (new tables/columns, new products; stock and prices you edited are kept).

## Model photos
Originals in `raw/lifestyle/`. `python tools/cutout_people.py` and `python tools/cutout_people.py u2net_human_seg` make person cutouts; `python tools/lifestyle.py` combines both masks, removes leftovers (statue, bench, sky), and places each look on a studio backdrop (`public/assets/products/`) plus graded lookbook versions (`public/assets/lookbook/`). Everything runs locally; no photo is uploaded.
