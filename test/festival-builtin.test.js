'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const F = require('../server/festival-data');
const P = require('../server/festival-pricing');

test('built-in calendar schedules every festival without a database', () => {
  const at = P.toMs('2026-12-20 12:00:00');
  const list = F.builtinCampaigns(at);
  const live = P.liveCampaigns(list, at);
  assert.deepEqual(live.map(c => c.slug), ['christmas-2026']);
  assert.equal(live[0].max_pct, 40);
  assert.ok(list.some(c => c.slug === 'diwali-2027'), 'lunar festivals use the listed dates');
  assert.ok(list.some(c => c.slug === 'christmas-2029'), 'fixed festivals roll forward three years');
  assert.ok(!list.some(c => c.slug === 'diwali-2026'), 'finished sales are dropped');
  assert.equal(new Set(list.map(c => c.id)).size, list.length, 'ids are unique');
});
test('new year sale spans the year boundary', () => {
  const at = P.toMs('2027-01-01 10:00:00');
  assert.ok(P.liveCampaigns(F.builtinCampaigns(at), at).some(c => c.slug === 'new-year-2027'));
});
test('Diwali 2027 is live in the lead-up window and over afterwards', () => {
  const l = F.builtinCampaigns(P.toMs('2027-10-25 09:00:00')), c = l.find(x => x.slug === 'diwali-2027');
  assert.equal(P.status(c, P.toMs('2027-10-25 09:00:00')), 'live');
  assert.equal(P.status(c, P.toMs('2027-11-02 00:00:00')), 'ended');
});
