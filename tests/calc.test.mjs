import assert from 'node:assert/strict';
import { test } from 'node:test';
import { monthOf, summarize } from '../js/calc.js';

const tx = (occurred_at, type, ticker, amount_usd, shares = null) => ({
  occurred_at, type, ticker, amount_usd, shares,
});

test('months follow Bangkok time, not UTC', () => {
  assert.equal(monthOf('2026-01-31T18:00:00Z'), '2026-02');
  assert.equal(monthOf('2026-02-01T00:30:00+07:00'), '2026-02');
});

test('a stock with no sales defaults to holding and has no profit yet', () => {
  const result = summarize([tx('2026-05-01T10:00:00Z', 'buy', 'AAA', -100)]);
  const [stock] = result.stocks;
  assert.equal(stock.status, 'holding');
  assert.equal(stock.realized, null);
  assert.equal(stock.costLeft, 10000);
  assert.equal(result.realized, 0);
  assert.equal(result.stillInvested, 10000);
});

test('without share counts, a sold stock needs review before it counts', () => {
  const rows = [
    tx('2026-05-01T10:00:00Z', 'buy', 'KKK', -100.25),
    tx('2026-05-02T10:00:00Z', 'sell', 'KKK', 102),
  ];

  const unmarked = summarize(rows);
  assert.equal(unmarked.stocks[0].status, 'review');
  assert.equal(unmarked.realized, 0);
  assert.equal(unmarked.needsReview, 1);

  const marked = summarize(rows, { KKK: 'sold' });
  assert.equal(marked.stocks[0].realized, 175);
  assert.equal(marked.realized, 175);
  assert.equal(marked.needsReview, 0);
  assert.deepEqual(marked.monthly, [{ month: '2026-05', cents: 175 }]);
});

test('a holding stock with partial sales shows the money still in it', () => {
  const rows = [
    tx('2026-05-01T10:00:00Z', 'buy', 'AAA', -300),
    tx('2026-05-02T10:00:00Z', 'sell', 'AAA', 100),
  ];
  const result = summarize(rows, { AAA: 'holding' });
  assert.equal(result.stocks[0].costLeft, 20000);
  assert.equal(result.stocks[0].realized, null);
  assert.equal(result.totalProfit, 0);
});

test('a loss on a sold stock is negative and dated to its final sale', () => {
  const rows = [
    tx('2026-02-01T10:00:00Z', 'buy', 'BBB', -200),
    tx('2026-03-01T10:00:00Z', 'sell', 'BBB', 150.5),
  ];
  const result = summarize(rows, { BBB: 'sold' });
  assert.equal(result.realized, -4950);
  assert.deepEqual(result.monthly, [{ month: '2026-03', cents: -4950 }]);
});

test('share counts give exact average cost profit per sale', () => {
  const rows = [
    tx('2026-01-01T10:00:00Z', 'buy', 'AAA', -100, 10),
    tx('2026-01-02T10:00:00Z', 'buy', 'AAA', -200, 10),
    tx('2026-02-01T10:00:00Z', 'sell', 'AAA', 200, 10),
  ];
  const [stock] = summarize(rows).stocks;
  assert.equal(stock.exact, true);
  assert.equal(stock.status, 'holding');
  assert.equal(stock.sharesHeld, 10);
  assert.equal(stock.realized, 5000);
  assert.equal(stock.costLeft, 15000);
});

test('share counts decide the status, ignoring a manual choice', () => {
  const rows = [
    tx('2026-01-01T10:00:00Z', 'buy', 'AAA', -100, 10),
    tx('2026-02-01T10:00:00Z', 'sell', 'AAA', 90, 10),
  ];
  const [stock] = summarize(rows, { AAA: 'holding' }).stocks;
  assert.equal(stock.status, 'sold');
  assert.equal(stock.realized, -1000);
  assert.equal(stock.costLeft, 0);
});

test('selling more shares than were bought is flagged', () => {
  const rows = [
    tx('2026-01-01T10:00:00Z', 'buy', 'AAA', -100, 1),
    tx('2026-02-01T10:00:00Z', 'sell', 'AAA', 500, 5),
  ];
  assert.equal(summarize(rows).stocks[0].oversold, true);
});

test('a missing share count on one trade falls back to cash flow', () => {
  const rows = [
    tx('2026-01-01T10:00:00Z', 'buy', 'AAA', -100, 10),
    tx('2026-02-01T10:00:00Z', 'sell', 'AAA', 120),
  ];
  const [stock] = summarize(rows, { AAA: 'sold' }).stocks;
  assert.equal(stock.exact, false);
  assert.equal(stock.realized, 2000);
});

test('money movements affect cash but never profit', () => {
  const rows = [
    tx('2026-01-01T10:00:00Z', 'deposit', '', 500),
    tx('2026-01-02T10:00:00Z', 'fx_in', '', 100),
    tx('2026-01-03T10:00:00Z', 'fx_out', '', -50),
    tx('2026-01-04T10:00:00Z', 'withdrawal', '', -25),
  ];
  const result = summarize(rows);
  assert.equal(result.moneyAdded, 52500);
  assert.equal(result.cash, 52500);
  assert.equal(result.totalProfit, 0);
});

test('total profit includes dividends, tax, fees and refunds', () => {
  const rows = [
    tx('2026-01-01T10:00:00Z', 'buy', 'AAA', -100),
    tx('2026-01-02T10:00:00Z', 'sell', 'AAA', 110),
    tx('2026-01-03T10:00:00Z', 'dividend', 'AAA', 1),
    tx('2026-01-03T10:00:01Z', 'withholding', 'AAA', -0.15),
    tx('2026-01-04T10:00:00Z', 'fee_sec', '', -0.02),
    tx('2026-01-04T10:00:00Z', 'fee_taf', '', -0.03),
    tx('2026-01-04T10:00:00Z', 'fee_cat', '', -0.01),
    tx('2026-01-05T10:00:00Z', 'commission_refund', '', 0.01),
  ];
  const result = summarize(rows, { AAA: 'sold' });
  assert.equal(result.fees, -6);
  assert.equal(result.totalProfit, 1000 + 100 - 15 - 6 + 1);
});

test('rows are processed by time whatever order they arrive in', () => {
  const rows = [
    tx('2026-02-01T10:00:00Z', 'sell', 'AAA', 150, 10),
    tx('2026-01-01T10:00:00Z', 'buy', 'AAA', -100, 10),
  ];
  assert.equal(summarize(rows).stocks[0].realized, 5000);
});
