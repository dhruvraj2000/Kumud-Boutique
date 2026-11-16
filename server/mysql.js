'use strict';
// Lazy MySQL pool: nothing connects until the first query, so the SQLite shop and its tests never need MySQL.
const mysql = require('mysql2/promise');
let pool = null;
const getPool = () => {
  if (!pool) {
    if (!process.env.MYSQL_URL) throw new Error('MYSQL_URL is not set. Copy .env.example to .env and fill it in.');
    pool = mysql.createPool({ uri: process.env.MYSQL_URL, dateStrings: true, connectionLimit: 10, charset: 'utf8mb4', timezone: 'Z' });
  }
  return pool;
};
const query = async (sql, params = []) => { const [rows] = await getPool().query(sql, params); return rows; };
async function tx(fn) {
  const conn = await getPool().getConnection();
  try {
    // READ COMMITTED: after waiting on a row lock, later reads must see rows the other transaction just committed
    // (REPEATABLE READ would keep serving the stale snapshot and allow double bookings).
    await conn.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await conn.beginTransaction();
    const out = await fn({ query: async (sql, params = []) => (await conn.query(sql, params))[0] });
    await conn.commit();
    return out;
  } catch (e) { try { await conn.rollback(); } catch { /* ignore */ } throw e; }
  finally { conn.release(); }
}
const close = async () => { if (pool) { const p = pool; pool = null; await p.end(); } };
module.exports = { query, tx, close, isConfigured: () => !!process.env.MYSQL_URL };
