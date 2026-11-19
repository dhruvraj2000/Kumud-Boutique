'use strict';
// Applies server/migrations/*.sql in name order; each file may hold several ;-separated statements.
const fs = require('fs');
const path = require('path');
const { query } = require('./mysql');
const DIR = path.join(__dirname, 'migrations');
async function run() {
  await query('CREATE TABLE IF NOT EXISTS schema_migrations(name VARCHAR(100) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
  const done = new Set((await query('SELECT name FROM schema_migrations')).map(r => r.name));
  const applied = [];
  for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()) {
    if (done.has(f)) continue;
    for (const stmt of fs.readFileSync(path.join(DIR, f), 'utf8').split(/;\s*(?:\r?\n|$)/).map(s => s.trim()).filter(Boolean)) await query(stmt);
    await query('INSERT INTO schema_migrations(name) VALUES(?)', [f]);
    applied.push(f);
  }
  return applied;
}
module.exports = { run };
