import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  normalizeRow, parseCsv, readHoldings, readPortfolio, toCsv,
} from '../js/csv.js';
import { setLanguage } from '../js/i18n.js';

setLanguage('en');

const HEADER = 'occurred_at,type,ticker,amount_usd,shares,note';

test('parses a valid file and converts times to UTC', () => {
  const { rows, errors } = parseCsv(
    `${HEADER}\n2026-01-01T07:00:00+07:00,deposit,,100.00,,\n2026-01-02T21:00:00+07:00,buy,aaa,-100.00,2.5,first`,
  );
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].occurred_at, '2026-01-01T00:00:00.000Z');
  assert.equal(rows[0].ticker, '');
  assert.deepEqual(rows[1], {
    occurred_at: '2026-01-02T14:00:00.000Z',
    type: 'buy',
    ticker: 'AAA',
    amount_usd: -100,
    shares: 2.5,
    note: 'first',
  });
});

test('reports bad rows by line and keeps the good ones', () => {
  const { rows, errors } = parseCsv(
    `${HEADER}\n2026-01-01T07:00:00+07:00,deposit,,1,,\nnot-a-date,deposit,,1,,\n2026-02-01T00:00:00Z,mystery,,1,,`,
  );
  assert.equal(rows.length, 1);
  assert.deepEqual(errors, ['Line 3: Invalid date "not-a-date"', 'Line 4: Unknown type "mystery"']);
});

test('rejects a file without the required columns', () => {
  const { errors } = parseCsv('date,amount\n2026-01-01,1');
  assert.deepEqual(errors, ['Missing column: occurred_at, type, amount_usd']);
});

test('rejects an empty file, wrong signs and missing tickers', () => {
  assert.deepEqual(parseCsv('').errors, ['The file is empty']);
  assert.match(
    normalizeRow({ occurred_at: '2026-01-01', type: 'buy', ticker: 'AAA', amount_usd: 10 }).error,
    /wrong sign/,
  );
  assert.match(
    normalizeRow({ occurred_at: '2026-01-01', type: 'sell', ticker: '', amount_usd: 10 }).error,
    /valid ticker/,
  );
});

test('strips a byte order mark and handles Windows line endings', () => {
  const { rows, errors } = parseCsv(`﻿${HEADER}\r\n2026-01-01T00:00:00Z,deposit,,5,,\r\n`);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 1);
});

const entry = (ticker, shares, value, unrealized = '', percent = '') => ({
  ticker, shares, value, unrealized, percent,
});

test('works out the cost and price when saving', () => {
  assert.deepEqual(readHoldings([entry('aaa', '10', '20', '-5'), entry('BBB', '0.5', '30', '10')]), {
    rows: [
      { ticker: 'AAA', shares: 10, total_cost_usd: 25, current_price_usd: 2 },
      { ticker: 'BBB', shares: 0.5, total_cost_usd: 20, current_price_usd: 60 },
    ],
    errors: [],
    problems: [],
  });
});

test('cents stay exact when the cost is worked out', () => {
  const [row] = readHoldings([entry('AAA', '1', '10.10', '-0.20')]).rows;
  assert.equal(row.total_cost_usd, 10.3);
});

test('a price gives back the exact value for fractional shares', () => {
  const [row] = readHoldings([entry('AAA', '0.3', '22.23', '-7.77')]).rows;
  assert.equal(Math.round(row.shares * row.current_price_usd * 100), 2223);
});

const saved = { AAA: { shares: 10, total: 25 } };

test('a stock already held keeps its cost when given only a gain or loss', () => {
  const { rows, errors } = readHoldings([entry('aaa', '', '', '-5')], saved);
  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [{
    ticker: 'AAA', shares: 10, total_cost_usd: 25, current_price_usd: 2,
  }]);
});

test('a stock already held keeps its cost when given only a value', () => {
  const [row] = readHoldings([entry('AAA', '', '30')], saved).rows;
  assert.deepEqual(row, {
    ticker: 'AAA', shares: 10, total_cost_usd: 25, current_price_usd: 3,
  });
});

test('a new share count alone leaves the cost and price', () => {
  const [row] = readHoldings([entry('AAA', '20', '')], saved).rows;
  assert.deepEqual(row, { ticker: 'AAA', shares: 20, total_cost_usd: 25 });
});

test('value and gain or loss replace a saved cost', () => {
  const [row] = readHoldings([entry('AAA', '20', '60', '12')], saved).rows;
  assert.deepEqual(row, {
    ticker: 'AAA', shares: 20, total_cost_usd: 48, current_price_usd: 3,
  });
});

test('a cost within the rounding of the screen stays as saved', () => {
  const [row] = readHoldings([entry('AAA', '', '20.03', '-5')], saved).rows;
  assert.equal(row.total_cost_usd, 25);
});

test('a stock already held needs at least one figure', () => {
  const expected = ['AAA: enter at least one figure'];
  assert.deepEqual(readHoldings([entry('AAA', '', '')], saved).errors, expected);
  assert.deepEqual(readHoldings([entry('AAA', '', '', '', '-5')], saved).errors, expected);
});

test('a new stock needs its shares, value and gain or loss', () => {
  assert.deepEqual(readHoldings([entry('BBB', '', '20', '-5')], saved).errors, ['BBB has no share count']);
  assert.deepEqual(
    readHoldings([entry('BBB', '1', '', '-5')], saved).errors,
    ['BBB needs its value and unrealized'],
  );
  assert.deepEqual(
    readHoldings([entry('BBB', '1', '20')], saved).errors,
    ['BBB needs its value and unrealized'],
  );
});

test('a problem points at its row, counting blank rows', () => {
  const { problems } = readHoldings([entry('', '', ''), entry('AAA', '', '1', '0')]);
  assert.deepEqual(problems, [{ index: 1, message: 'AAA has no share count' }]);
});

test('skips blank rows', () => {
  const { rows, errors } = readHoldings([entry('', '', ''), entry('AAA', '1', '1', '0')]);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 1);
});

test('a gain or loss of zero counts, but a blank one does not', () => {
  assert.deepEqual(readHoldings([entry('AAA', '1', '5', '0')]).errors, []);
  assert.deepEqual(
    readHoldings([entry('AAA', '1', '5', '')]).errors,
    ['AAA needs its value and unrealized'],
  );
});

test('rejects a gain larger than the value', () => {
  assert.deepEqual(
    readHoldings([entry('AAA', '10', '25', '30')]).errors,
    ['AAA: the gain is larger than the value'],
  );
});

test('rejects a loss larger than the saved cost', () => {
  assert.deepEqual(
    readHoldings([entry('AAA', '', '', '-30')], saved).errors,
    ['AAA: the loss is larger than the total cost'],
  );
});

test('flags an empty form, bad tickers, missing shares and duplicates', () => {
  assert.deepEqual(readHoldings([]).errors, ['Add at least one stock']);
  assert.deepEqual(readHoldings([entry('', '1', '1', '0')]).errors, ['Row 1 needs a valid ticker']);
  assert.deepEqual(readHoldings([entry('AAA', '', '1', '0')]).errors, ['AAA has no share count']);
  assert.deepEqual(
    readHoldings([entry('AAA', '1', '1', '0'), entry('aaa', '1', '1', '0')]).errors,
    ['AAA is listed twice'],
  );
});

const screen = (line, result) => `${line}\n12.00% 1,000.00 THB (${result} USD)`;

test('reads a stock from the portfolio screen', () => {
  assert.deepEqual(readPortfolio(screen('Q AAA 312.00 N -25.00%', '-104.00')), [{
    ticker: 'AAA', value: 312, percent: -25, unrealized: -104, total: 416, agrees: true,
  }]);
});

test('reads gains and thousands separators', () => {
  const [stock] = readPortfolio(screen('ZZ.A 1,560.00 +50.00%', '+520.00'));
  assert.deepEqual(stock, {
    ticker: 'ZZ.A', value: 1560, percent: 50, unrealized: 520, total: 1040, agrees: true,
  });
});

test('flags a misread figure', () => {
  const [stock] = readPortfolio(screen('AAA 312.00 N -25.00%', '-187.00'));
  assert.equal(stock.agrees, false);
  assert.equal(stock.unrealized, -187);
});

test('puts back a lost minus sign, wherever it was lost', () => {
  const loss = {
    ticker: 'AAA', value: 312, percent: -25, unrealized: -104, total: 416, agrees: true,
  };
  assert.deepEqual(readPortfolio(screen('AAA 312.00 N -25.00%', '104.00'))[0], loss);
  assert.deepEqual(readPortfolio(screen('AAA 312.00 N 25.00%', '-104.00'))[0], loss);
  assert.deepEqual(readPortfolio(screen('AAA 312.00 N 25.00%', '104.00'))[0], loss);
});

test('a gain with a stray minus sign stays a gain', () => {
  const [stock] = readPortfolio(screen('AAA 416.00 N -33.33%', '104.00'));
  assert.deepEqual(stock, {
    ticker: 'AAA', value: 416, percent: 33.33, unrealized: 104, total: 312, agrees: true,
  });
});

test('a very small change keeps a minus sign read on either figure', () => {
  const [stock] = readPortfolio(screen('AAA 52.00 N -0.38%', '0.20'));
  assert.equal(stock.unrealized, -0.2);
});

test('skips the page header and a stock cut off by the screen edge', () => {
  const text = [
    '1,521.10',
    'AS 12.34% (-500.00 USD)',
    screen('AAA 300.00 N -25.00%', '-100.00'),
    'BBB 200.00 N -10.00%',
  ].join('\n');
  assert.deepEqual(readPortfolio(text).map((stock) => stock.ticker), ['AAA']);
});

test('an export can be imported again without changes', () => {
  const original = [{
    occurred_at: '2026-01-02T14:00:00.000Z',
    type: 'buy',
    ticker: 'AAA',
    amount_usd: -10.5,
    shares: 1.25,
    note: 'said "hi", twice',
  }];
  const { rows, errors } = parseCsv(toCsv(original));
  assert.deepEqual(errors, []);
  assert.deepEqual(rows, original);
});
