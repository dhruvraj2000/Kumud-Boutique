'use strict';
// Automated, consistent SQLite backups (VACUUM INTO) with retention. Restore procedure: docs/SECURITY.md.
const fs = require('fs');
const path = require('path');
const { db, DB_FILE } = require('./db');
const { alertAdmin } = require('./notify');

const DIR = process.env.BACKUP_DIR || (DB_FILE === ':memory:' ? '' : path.join(path.dirname(DB_FILE), 'backups'));
const KEEP = Number(process.env.BACKUP_KEEP || 14), EVERY = Number(process.env.BACKUP_EVERY_HOURS || 24) * 3600000;
const enabled = () => !!DIR && !process.env.VERCEL;

function run(reason = 'scheduled') {
  if (!enabled()) return { ok: false, note: 'Backups need a persistent disk (not available on this host).' };
  try {
    fs.mkdirSync(DIR, { recursive: true, mode: 0o700 });
    const file = path.join(DIR, `kumud-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    try { fs.chmodSync(file, 0o600); } catch { /* windows */ }
    const bytes = fs.statSync(file).size;
    db.prepare('INSERT INTO backups(ts,file,bytes,ok,note) VALUES(?,?,?,1,?)').run(Date.now(), path.basename(file), bytes, reason);
    for (const old of db.prepare('SELECT id,file FROM backups ORDER BY id DESC LIMIT -1 OFFSET ?').all(KEEP)) {
      try { fs.unlinkSync(path.join(DIR, old.file)); } catch { /* already gone */ }
      db.prepare('DELETE FROM backups WHERE id=?').run(old.id);
    }
    return { ok: true, file: path.basename(file), bytes };
  } catch (e) {
    db.prepare('INSERT INTO backups(ts,file,bytes,ok,note) VALUES(?,?,0,0,?)').run(Date.now(), '', String(e.message).slice(0, 200));
    alertAdmin('high', 'Database backup failed', e.message);
    return { ok: false, note: e.message };
  }
}
function status() {
  const last = db.prepare('SELECT ts,file,bytes,ok,note FROM backups ORDER BY id DESC LIMIT 1').get(), lastOk = db.prepare('SELECT ts FROM backups WHERE ok=1 ORDER BY id DESC LIMIT 1').get();
  return {
    enabled: enabled(), directory: enabled() ? DIR : '', keep: KEEP, everyHours: EVERY / 3600000, last: last || null,
    healthy: !!lastOk && Date.now() - lastOk.ts < EVERY * 2, count: db.prepare('SELECT COUNT(*) c FROM backups WHERE ok=1').get().c,
    nextDue: lastOk ? lastOk.ts + EVERY : Date.now()
  };
}
function start() {
  if (!enabled()) return;
  const due = () => { const s = status(); if (!s.last || Date.now() >= s.nextDue) run(); };
  setTimeout(due, 30000).unref(); setInterval(due, 3600000).unref();
}
module.exports = { run, status, start };
