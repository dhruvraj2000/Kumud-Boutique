'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { priceRange, eachDate } = require('../server/rates');
const item = { id: 1, base_price: 1000 };
const R = (o) => ({ id: 1, item_id: null, weekday: null, start_date: null, end_date: null, label: null, priority: 0, ...o });

test('no rules: base price per day', () => {
  const r = priceRange(item, [], '2026-12-07', '2026-12-10');
  assert.equal(r.total, 3000); assert(r.days.every(d => d.source === 'base')); assert.equal(r.days.length, 3);
});
test('weekday rule applies on that weekday only (Saturday=6)', () => {
  const r = priceRange(item, [R({ type: 'weekday', weekday: 6, price: 1500 })], '2026-12-11', '2026-12-14'); // Fri,Sat,Sun
  assert.deepStrictEqual(r.days.map(d => d.price), [1000, 1500, 1000]);
});
test('period beats weekday; period is inclusive of both ends', () => {
  const rules = [R({ id: 1, type: 'weekday', weekday: 6, price: 1500 }), R({ id: 2, type: 'period', start_date: '2026-12-10', end_date: '2026-12-15', price: 2500 })];
  const r = priceRange(item, rules, '2026-12-09', '2026-12-17');
  assert.deepStrictEqual(r.days.map(d => d.price), [1000, 2500, 2500, 2500, 2500, 2500, 2500, 1000]);
});
test('single date beats period', () => {
  const rules = [R({ id: 2, type: 'period', start_date: '2026-12-10', end_date: '2026-12-15', price: 2500 }), R({ id: 3, type: 'date', start_date: '2026-12-12', price: 4000 })];
  const r = priceRange(item, rules, '2026-12-11', '2026-12-14');
  assert.deepStrictEqual(r.days.map(d => [d.price, d.source]), [[2500, 'period'], [4000, 'date'], [2500, 'period']]);
});
test('higher priority wins between overlapping periods', () => {
  const rules = [R({ id: 1, type: 'period', start_date: '2026-12-01', end_date: '2026-12-31', price: 1200, priority: 1 }), R({ id: 2, type: 'period', start_date: '2026-12-05', end_date: '2026-12-08', price: 3000, priority: 5 })];
  assert.equal(priceRange(item, rules, '2026-12-06', '2026-12-07').total, 3000);
});
test('item-specific rule beats global rule of the same type', () => {
  const rules = [R({ id: 1, item_id: null, type: 'weekday', weekday: 1, price: 1100, priority: 9 }), R({ id: 2, item_id: 1, type: 'weekday', weekday: 1, price: 1300 })];
  assert.equal(priceRange(item, rules, '2026-12-07', '2026-12-08').total, 1300); // Monday
});
test('rules for another item are ignored', () => {
  assert.equal(priceRange(item, [R({ item_id: 2, type: 'weekday', weekday: 1, price: 9999 })], '2026-12-07', '2026-12-08').total, 1000);
});
test('range crossing a year boundary', () => {
  assert.deepStrictEqual(eachDate('2026-12-30', '2027-01-02'), ['2026-12-30', '2026-12-31', '2027-01-01']);
});
test('to must be after from', () => {
  assert.throws(() => priceRange(item, [], '2026-12-10', '2026-12-10'), RangeError);
  assert.throws(() => priceRange(item, [], '2026-12-10', '2026-12-09'), /to must be after from/);
});
