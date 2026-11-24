'use strict';
// Static files on Vercel are served by its CDN, not Express, so the security headers must also live in vercel.json.
// Run `node scripts/sync-vercel-headers.js` after changing public/index.html inline scripts or the CSP in server/security.js.
// (test/security.test.js fails if vercel.json is out of date.)
process.env.KUMUD_DB = ':memory:';
const fs = require('fs');
const path = require('path');
const S = require('../server/security');

const file = path.join(__dirname, '..', 'vercel.json');
const cfg = JSON.parse(fs.readFileSync(file, 'utf8'));
cfg.headers = [{
  source: '/(.*)',
  headers: [
    { key: 'Content-Security-Policy', value: S.csp(true) },
    { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    { key: 'Permissions-Policy', value: 'geolocation=(self), camera=(), microphone=(), payment=(self), usb=()' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' }
  ]
}];
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n');
console.log('vercel.json headers updated');
process.exit(0);
