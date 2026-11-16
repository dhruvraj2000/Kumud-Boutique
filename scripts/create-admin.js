'use strict';
// Usage: npm run admin:create -- you@example.com "Your Name"   (password is prompted, min 12 characters)
const readline = require('readline');
const mysql = require('../server/mysql');
const { run } = require('../server/migrate');
const { hashPassword } = require('../server/admin-auth');

function askHidden(prompt) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.includes(prompt)) process.stdout.write(s); };
    rl.question(prompt, a => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}

(async () => {
  const [email, name = 'Admin'] = process.argv.slice(2);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { console.error('Usage: npm run admin:create -- email@example.com "Name"'); process.exit(1); }
  const pw = process.env.ADMIN_NEW_PASSWORD || await askHidden('Password (min 12 chars): ');
  if (pw.length < 12) { console.error('Password must be at least 12 characters.'); process.exit(1); }
  await run();
  await mysql.query('INSERT INTO admins(email,password_hash,name) VALUES(?,?,?) ON DUPLICATE KEY UPDATE password_hash=VALUES(password_hash), name=VALUES(name), failed_attempts=0, locked_until=NULL', [email.toLowerCase(), await hashPassword(pw), name]);
  console.log('Admin saved:', email.toLowerCase());
  await mysql.close();
})().catch(e => { console.error(e.message); process.exit(1); });
