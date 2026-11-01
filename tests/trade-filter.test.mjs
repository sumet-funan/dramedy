import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesPeriod, periodOptions, settlePeriod } from '../js/trade-filter.js';

const trade = (occurred_at) => ({ occurred_at });

const trades = [
  trade('2025-12-31T02:00:00Z'),
  trade('2026-01-15T02:00:00Z'),
  trade('2026-01-20T02:00:00Z'),
  trade('2026-04-05T02:00:00Z'),
];

test('dates follow Bangkok time, not UTC', () => {
  const lateEvening = trade('2026-01-31T18:00:00Z');
  assert.equal(matchesPeriod(lateEvening, { year: '2026', month: '02', day: '01' }), true);
  assert.equal(matchesPeriod(lateEvening, { year: '2026', month: '01' }), false);
});

test('an empty period matches every trade', () => {
  assert.equal(trades.every((item) => matchesPeriod(item, { year: '', month: '', day: '' })), true);
});

test('filters by year, by month and by day', () => {
  const count = (period) => trades.filter((item) => matchesPeriod(item, period)).length;
  assert.equal(count({ year: '2026' }), 3);
  assert.equal(count({ year: '2026', month: '01' }), 2);
  assert.equal(count({ year: '2026', month: '01', day: '20' }), 1);
});

test('a month with no year matches that month in any year', () => {
  const trades2 = [trade('2025-04-01T02:00:00Z'), trade('2026-04-05T02:00:00Z')];
  assert.equal(trades2.filter((item) => matchesPeriod(item, { month: '04' })).length, 2);
});

test('lists run newest first and hold only dates with trades', () => {
  assert.deepEqual(periodOptions(trades, {}), {
    years: ['2026', '2025'],
    months: ['12', '04', '01'],
    days: [],
  });
  assert.deepEqual(periodOptions(trades, { year: '2026' }).months, ['04', '01']);
  assert.deepEqual(periodOptions(trades, { year: '2026', month: '01' }).days, ['20', '15']);
});

test('a choice out of reach of a new year clears', () => {
  assert.deepEqual(settlePeriod({ year: '2025', month: '01', day: '20' }, trades), {
    year: '2025', month: '', day: '',
  });
});

test('a day out of reach of a new month clears, and the month stays', () => {
  assert.deepEqual(settlePeriod({ year: '2026', month: '04', day: '20' }, trades), {
    year: '2026', month: '04', day: '',
  });
});

test('a choice that still fits stays', () => {
  const period = { year: '2026', month: '01', day: '15' };
  assert.deepEqual(settlePeriod(period, trades), period);
});
