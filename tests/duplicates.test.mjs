import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fillsShares, findDuplicates, sharesToFill } from '../js/duplicates.js';
import { createDemoStore } from '../js/store.js';

const trade = (occurred_at, fields = {}) => ({
  id: occurred_at,
  occurred_at,
  type: 'buy',
  ticker: 'AAAA',
  amount_usd: -10,
  shares: null,
  ...fields,
});

const kinds = (rows, saved) => findDuplicates(rows, saved).map((found) => found?.kind ?? null);

test('the same moment and figures are the same trade', () => {
  const saved = [trade('2026-01-05T03:15:37.000Z')];
  assert.deepEqual(kinds([trade('2026-01-05T10:15:37+07:00')], saved), ['same']);
});

test('a trade typed without seconds is similar to the one from a screenshot', () => {
  const saved = [trade('2026-01-05T03:15:00.000Z')];
  const [found] = findDuplicates([trade('2026-01-05T03:15:37.000Z')], saved);
  assert.equal(found.kind, 'similar');
  assert.equal(found.match, saved[0]);
});

test('a different day, type, ticker or amount is a different trade', () => {
  const saved = [trade('2026-01-05T03:15:00.000Z')];
  assert.deepEqual(kinds([
    trade('2026-01-06T03:15:00.000Z'),
    trade('2026-01-05T03:15:00.000Z', { type: 'sell', amount_usd: 10 }),
    trade('2026-01-05T03:15:00.000Z', { ticker: 'BBBB' }),
    trade('2026-01-05T03:15:00.000Z', { amount_usd: -10.01 }),
  ], saved), [null, null, null, null]);
});

test('days follow Bangkok time, not UTC', () => {
  const saved = [trade('2026-01-05T16:30:00.000Z')];
  assert.deepEqual(kinds([trade('2026-01-04T18:00:00.000Z')], saved), ['similar']);
  assert.deepEqual(kinds([trade('2026-01-05T17:30:00.000Z')], saved), [null]);
});

test('each saved trade answers for one row', () => {
  const fee = { type: 'fee_taf', ticker: '', amount_usd: -0.01 };
  const saved = [
    trade('2026-01-05T03:00:00.000Z', fee),
    trade('2026-01-05T04:00:00.000Z', fee),
  ];
  assert.deepEqual(kinds([
    trade('2026-01-05T04:00:00.000Z', fee),
    trade('2026-01-05T03:00:00.000Z', fee),
    trade('2026-01-05T05:00:00.000Z', fee),
  ], saved), ['same', 'same', null]);
});

test('an exact match is found first, whatever the order of the rows', () => {
  const saved = [trade('2026-01-05T03:00:00.000Z')];
  assert.deepEqual(kinds([
    trade('2026-01-05T04:00:00.000Z'),
    trade('2026-01-05T03:00:00.000Z'),
  ], saved), [null, 'same']);
});

test('shares fill only a saved trade that has none', () => {
  const blank = { kind: 'same', match: trade('x') };
  const counted = { kind: 'same', match: trade('x', { shares: '4.000000' }) };
  const similar = { kind: 'similar', match: trade('x') };
  const typed = { shares: 2 };

  assert.equal(fillsShares(typed, blank), true);
  assert.equal(fillsShares(typed, counted), false);
  assert.equal(fillsShares(typed, similar), false);
  assert.equal(fillsShares({ shares: null }, blank), false);
  assert.equal(fillsShares(typed, null), false);
});

test('lists which saved trades take a share count', () => {
  const saved = [
    trade('2026-01-05T03:00:00.000Z', { id: 'blank' }),
    trade('2026-01-05T04:00:00.000Z', { id: 'counted', shares: 4 }),
  ];
  assert.deepEqual(sharesToFill([
    trade('2026-01-05T03:00:00.000Z', { shares: 2 }),
    trade('2026-01-05T04:00:00.000Z', { shares: 2 }),
    trade('2026-01-06T04:00:00.000Z', { shares: 2 }),
  ], saved), [{ id: 'blank', shares: 2 }]);
});

test('the demo store skips what is here and fills blank share counts', async () => {
  const store = createDemoStore({
    transactions: [trade('2026-01-05T03:00:00.000Z')],
    statuses: {},
    holdings: {},
  });

  assert.deepEqual(await store.importRows([
    trade('2026-01-05T03:00:00.000Z', { shares: 2 }),
    trade('2026-01-06T03:00:00.000Z', { shares: 3 }),
  ]), { added: 1, filled: 1 });

  const { transactions } = await store.load();
  assert.deepEqual(transactions.map((row) => row.shares), [3, 2]);
  await assert.rejects(
    store.add(trade('2026-01-05T03:00:00.000Z')),
    { code: '23505' },
  );
});

const holding = {
  ticker: 'AAAA', shares: 10, total_cost_usd: 25, updated_at: '2026-01-01T00:00:00.000Z',
};
const demoHolding = () => createDemoStore({
  transactions: [], statuses: {}, holdings: { AAAA: holding },
});
const takenAt = '2026-02-01T00:00:00.000Z';

test('full figures are dated when they were true', async () => {
  const store = demoHolding();
  await store.saveHoldings([{ ticker: 'AAAA', shares: 20, total_cost_usd: 60 }], takenAt);
  const { holdings } = await store.load();
  assert.equal(holdings.AAAA.updated_at, takenAt);
  assert.equal(holdings.AAAA.shares, 20);
});

test('a new price leaves the holding and its date alone', async () => {
  const store = demoHolding();
  await store.saveHoldings([{
    ticker: 'AAAA', shares: 99, total_cost_usd: 99, priceOnly: true, current_price_usd: 2,
  }], takenAt);
  const { holdings } = await store.load();
  assert.equal(holdings.AAAA.updated_at, holding.updated_at);
  assert.equal(holdings.AAAA.shares, 10);
  assert.equal(holdings.AAAA.current_price_usd, 2);
});

test('a partial change is dated now, not when the figures were true', async () => {
  const store = demoHolding();
  await store.saveHoldings([{
    ticker: 'AAAA', shares: 20, total_cost_usd: 25, partial: true,
  }], takenAt);
  const { holdings } = await store.load();
  assert.notEqual(holdings.AAAA.updated_at, takenAt);
});
