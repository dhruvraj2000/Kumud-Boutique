'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const h = require('./helpers');
before(async () => { if (h.have()) await h.freshDb(); });
after(async () => { await h.dropDb(); });
test('migrations create every table and are idempotent', { skip: h.SKIP }, async () => {
  const { query } = require('../server/mysql');
  const names = (await query('SHOW TABLES')).map(r => Object.values(r)[0]);
  for (const t of ['admins', 'admin_sessions', 'customers', 'items', 'bookings', 'booking_events', 'rate_rules', 'appointment_slots', 'blocked_dates', 'schema_migrations']) assert(names.includes(t), t);
  assert.deepStrictEqual(await require('../server/migrate').run(), []);
});
