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

const held = (shares, total_cost_usd, updated_at = '2026-12-01T00:00:00Z') => ({
  shares, total_cost_usd, updated_at,
});

test('a holding makes profit exact while shares are still held', () => {
  const rows = [
    tx('2026-01-01T10:00:00Z', 'buy', 'AAA', -300),
    tx('2026-02-01T10:00:00Z', 'sell', 'AAA', 200),
  ];
  const result = summarize(rows, {}, { AAA: held(10, 150) });
  const [stock] = result.stocks;
  assert.equal(stock.status, 'holding');
  assert.equal(stock.sharesHeld, 10);
  assert.equal(stock.costLeft, 15000);
  assert.equal(stock.realized, 5000);
  assert.deepEqual(result.monthly, [{ month: '2026-02', cents: 5000 }]);
  assert.equal(result.needsReview, 0);
});

test('commission on shares still held counts against profit', () => {
  const rows = [tx('2026-01-01T10:00:00Z', 'buy', 'AAA', -100.15)];
  const [stock] = summarize(rows, {}, { AAA: held(1, 100) }).stocks;
  assert.equal(stock.realized, -15);
  assert.equal(stock.costLeft, 10000);
});

test('a holding beats a manual status', () => {
  const rows = [tx('2026-01-01T10:00:00Z', 'buy', 'AAA', -100)];
  const [stock] = summarize(rows, { AAA: 'sold' }, { AAA: held(1, 100) }).stocks;
  assert.equal(stock.status, 'holding');
});

test('a holding with no trades adds to invested but not to profit', () => {
  const result = summarize([], {}, { AAA: held(1, 100) });
  assert.equal(result.stocks[0].realized, null);
  assert.equal(result.stillInvested, 10000);
  assert.equal(result.totalProfit, 0);
});

test('a trade after the holding date marks it as outdated', () => {
  const rows = [tx('2026-06-02T10:00:00Z', 'buy', 'AAA', -100)];
  const before = summarize(rows, {}, { AAA: held(1, 100, '2026-06-01T00:00:00Z') });
  const after = summarize(rows, {}, { AAA: held(1, 100, '2026-06-03T00:00:00Z') });
  assert.equal(before.stocks[0].outdated, true);
  assert.equal(after.stocks[0].outdated, false);
});

test('profit ties to cash: cash + invested - money added', () => {
  const rows = [
    tx('2026-01-01T10:00:00Z', 'deposit', '', 1000),
    tx('2026-01-02T10:00:00Z', 'buy', 'AAA', -300.3),
    tx('2026-01-03T10:00:00Z', 'sell', 'AAA', 100),
    tx('2026-01-04T10:00:00Z', 'buy', 'BBB', -200),
    tx('2026-01-05T10:00:00Z', 'sell', 'BBB', 250),
    tx('2026-01-06T10:00:00Z', 'fee_sec', '', -0.05),
    tx('2026-01-07T10:00:00Z', 'dividend', 'AAA', 2),
  ];
  const s = summarize(rows, { BBB: 'sold' }, { AAA: held(5, 225.5) });
  assert.equal(s.totalProfit, s.cash + s.stillInvested - s.moneyAdded);
});

const opening = [
  tx('2026-01-01T00:00:00Z', 'deposit', '', 1000),
  tx('2026-01-02T00:00:00Z', 'buy', 'AAA', -100),
];
const snapshot = { AAA: { ...held(10, 100, '2026-02-01T00:00:00Z'), current_price_usd: 12 } };
const later = (type, amount, shares) => tx('2026-03-01T00:00:00Z', type, 'AAA', amount, shares);

test('a later buy adds to the holding and stays out of profit', () => {
  const s = summarize([...opening, later('buy', -60, 5)], {}, snapshot);
  const [stock] = s.stocks;
  assert.equal(stock.sharesHeld, 15);
  assert.equal(stock.costLeft, 16000);
  assert.equal(stock.marketValue, 18000);
  assert.equal(stock.unrealized, 2000);
  assert.equal(stock.outdated, false);
  assert.equal(s.realized, 0);
});

test('a later sale takes average cost out and its profit is dated to the sale', () => {
  const s = summarize([...opening, later('sell', 48, 4)], {}, snapshot);
  const [stock] = s.stocks;
  assert.equal(stock.sharesHeld, 6);
  assert.equal(stock.costLeft, 6000);
  assert.equal(stock.unrealized, 1200);
  assert.equal(s.realized, 800);
  assert.deepEqual(s.monthly, [{ month: '2026-01', cents: 0 }, { month: '2026-03', cents: 800 }]);
});

test('selling everything later closes the holding', () => {
  const s = summarize([...opening, later('sell', 120, 10)], {}, snapshot);
  const [stock] = s.stocks;
  assert.equal(stock.status, 'sold');
  assert.equal(stock.fromHolding, undefined);
  assert.equal(stock.costLeft, 0);
  assert.equal(s.realized, 2000);
  assert.equal(s.heldCount, 0);
  assert.equal(s.unrealized, 0);
});

test('buying again after selling everything holds the new shares', () => {
  const rows = [
    ...opening,
    later('sell', 120, 10),
    tx('2026-04-01T00:00:00Z', 'buy', 'AAA', -30, 3),
  ];
  const [stock] = summarize(rows, {}, snapshot).stocks;
  assert.equal(stock.status, 'holding');
  assert.equal(stock.sharesHeld, 3);
  assert.equal(stock.costLeft, 3000);
  assert.equal(stock.realized, 2000);
});

test('selling more than held later is flagged', () => {
  const [stock] = summarize([...opening, later('sell', 150, 12)], {}, snapshot).stocks;
  assert.equal(stock.oversold, true);
});

test('later trades keep the tie to cash and the account value', () => {
  const rows = [...opening, later('buy', -60, 5), tx('2026-04-01T00:00:00Z', 'sell', 'AAA', 70, 6)];
  const s = summarize(rows, {}, snapshot);
  assert.equal(s.totalProfit, s.cash + s.stillInvested - s.moneyAdded);
  assert.equal(s.overall, s.cash + s.marketValue - s.moneyAdded);
});

test('a later trade with no share count leaves the holding and marks it outdated', () => {
  const [stock] = summarize([...opening, later('buy', -60)], {}, snapshot).stocks;
  assert.equal(stock.sharesHeld, 10);
  assert.equal(stock.costLeft, 10000);
  assert.equal(stock.outdated, true);
});

test('a trade before the holding date is already in the figures', () => {
  const rows = [...opening, tx('2026-01-20T00:00:00Z', 'buy', 'AAA', -60, 5)];
  const [stock] = summarize(rows, {}, snapshot).stocks;
  assert.equal(stock.sharesHeld, 10);
  assert.equal(stock.costLeft, 10000);
});

test('a price gives market value and unrealized profit', () => {
  const rows = [tx('2026-01-01T10:00:00Z', 'buy', 'AAA', -300.5)];
  const holding = { ...held(100, 300), current_price_usd: 2.5, price_updated_at: '2026-12-01T00:00:00Z' };
  const result = summarize(rows, {}, { AAA: holding });
  const [stock] = result.stocks;
  assert.equal(stock.marketValue, 25000);
  assert.equal(stock.unrealized, -5000);
  assert.equal(result.marketValue, 25000);
  assert.equal(result.unrealized, -5000);
  assert.equal(result.pricedCount, 1);
});

test('unrealized profit stays out of total profit', () => {
  const rows = [tx('2026-01-01T10:00:00Z', 'buy', 'AAA', -300)];
  const holding = { ...held(100, 300), current_price_usd: 5 };
  assert.equal(summarize(rows, {}, { AAA: holding }).totalProfit, 0);
});

test('a price of zero counts, but a missing price does not', () => {
  const rows = [
    tx('2026-01-01T10:00:00Z', 'buy', 'AAA', -100),
    tx('2026-01-01T10:00:00Z', 'buy', 'BBB', -100),
  ];
  const result = summarize(rows, {}, {
    AAA: { ...held(1, 100), current_price_usd: 0 },
    BBB: { ...held(1, 100), current_price_usd: null },
  });
  assert.equal(result.stocks[0].unrealized, -10000);
  assert.equal(result.stocks[1].unrealized, null);
  assert.equal(result.heldCount, 2);
  assert.equal(result.pricedCount, 1);
  assert.equal(result.unrealized, -10000);
});

test('overall is total profit plus unrealized, and ties to the account value', () => {
  const rows = [
    tx('2026-01-01T10:00:00Z', 'deposit', '', 1000),
    tx('2026-01-02T10:00:00Z', 'buy', 'AAA', -300.3),
    tx('2026-01-03T10:00:00Z', 'sell', 'AAA', 100),
    tx('2026-01-04T10:00:00Z', 'fee_taf', '', -0.05),
    tx('2026-01-05T10:00:00Z', 'dividend', 'AAA', 2),
  ];
  const holding = { ...held(5, 225.5), current_price_usd: 30 };
  const s = summarize(rows, {}, { AAA: holding });
  assert.equal(s.overall, s.totalProfit + s.unrealized);
  assert.equal(s.overall, s.cash + s.marketValue - s.moneyAdded);
});

test('overall equals total profit when nothing is held', () => {
  const rows = [
    tx('2026-01-01T10:00:00Z', 'buy', 'AAA', -100),
    tx('2026-01-02T10:00:00Z', 'sell', 'AAA', 90),
  ];
  const s = summarize(rows, { AAA: 'sold' });
  assert.equal(s.overall, s.totalProfit);
});

test('rows are processed by time whatever order they arrive in', () => {
  const rows = [
    tx('2026-02-01T10:00:00Z', 'sell', 'AAA', 150, 10),
    tx('2026-01-01T10:00:00Z', 'buy', 'AAA', -100, 10),
  ];
  assert.equal(summarize(rows).stocks[0].realized, 5000);
});
