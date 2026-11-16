'use strict';
// Creates a throwaway MySQL schema from MYSQL_TEST_URL; suites skip when it is not configured.
const crypto = require('crypto');
const mysql2 = require('mysql2/promise');
const have = () => !!process.env.MYSQL_TEST_URL;
let admin, dbName;
async function freshDb() {
  const u = new URL(process.env.MYSQL_TEST_URL);
  admin = await mysql2.createConnection({ uri: process.env.MYSQL_TEST_URL });
  dbName = 'kb_test_' + crypto.randomBytes(4).toString('hex');
  await admin.query('CREATE DATABASE `' + dbName + '` CHARACTER SET utf8mb4');
  u.pathname = '/' + dbName;
  process.env.MYSQL_URL = u.toString();
  await require('../server/mysql').close();
  await require('../server/migrate').run();
}
async function dropDb() {
  await require('../server/mysql').close();
  if (admin) { await admin.query('DROP DATABASE IF EXISTS `' + dbName + '`'); await admin.end(); admin = null; }
}
// Seed: one rental (base 1000) and one appointment (base 500) with a 10:00 slot (capacity 1) every weekday.
async function seed() {
  const { query } = require('../server/mysql');
  const rental = (await query("INSERT INTO items(name,kind,base_price,deposit) VALUES('Test Lehenga','rental',1000,500)")).insertId;
  const appt = (await query("INSERT INTO items(name,kind,base_price) VALUES('Consultation','appointment',500)")).insertId;
  for (let d = 0; d < 7; d++) await query("INSERT INTO appointment_slots(weekday,start_time,end_time,capacity) VALUES(?,'10:00','11:00',1)", [d]);
  return { rental, appt };
}
const future = n => new Date(Date.now() + (n + 1) * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
module.exports = { have, freshDb, dropDb, seed, future, SKIP: have() ? false : 'MYSQL_TEST_URL not set' };
