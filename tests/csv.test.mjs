import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeRow, parseCsv, parseHoldings, toCsv } from '../js/csv.js';
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

const holding = (ticker, shares, average, total) => [
  `หุ้น: ${ticker}`,
  `จำนวนหุ้นคงเหลือ: ${shares}`,
  `ต้นทุนต่อหุ้น(USD): ${average}`,
  `ต้นทุนรวม(USD): ${total}`,
].join('\n');

test('reads the Thai holdings list', () => {
  const text = `${holding('aaa', 10, 2.5, 25)}\r\n\r\n${holding('BBB', 0.5, 40, '20.00')}\n`;
  assert.deepEqual(parseHoldings(text), {
    rows: [
      { ticker: 'AAA', shares: 10, total_cost_usd: 25 },
      { ticker: 'BBB', shares: 0.5, total_cost_usd: 20 },
    ],
    errors: [],
  });
});

test('handles thousands separators and rounded averages', () => {
  const { rows, errors } = parseHoldings(holding('AAA', '1,000', 1.2345, '1,234.50'));
  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [{ ticker: 'AAA', shares: 1000, total_cost_usd: 1234.5 }]);
});

const withResult = (block, value) => `${block}\nมูลค่า(USD): ${value}`;

test('works out the price from the profit or loss line', () => {
  const { rows, errors } = parseHoldings(withResult(holding('AAA', 10, 2.5, 25), -5));
  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [{
    ticker: 'AAA', shares: 10, total_cost_usd: 25, current_price_usd: 2,
  }]);
});

test('reads gains, thousands separators and the typographic minus', () => {
  const read = (value) => parseHoldings(withResult(holding('AAA', 10, 200, 2000), value))
    .rows[0].current_price_usd;
  assert.equal(read('1,000'), 300);
  assert.equal(read('+500'), 250);
  assert.equal(read('−500'), 150);
});

test('an implied price gives back the exact value for fractional shares', () => {
  const [row] = parseHoldings(withResult(holding('AAA', 0.3, 100, 30), -7.77)).rows;
  assert.equal(Math.round(row.shares * row.current_price_usd * 100), 2223);
});

test('a list without the line leaves the price out', () => {
  const [row] = parseHoldings(holding('AAA', 10, 2.5, 25)).rows;
  assert.equal('current_price_usd' in row, false);
});

test('rejects a loss larger than the cost', () => {
  assert.deepEqual(
    parseHoldings(withResult(holding('AAA', 10, 2.5, 25), -30)).errors,
    ['AAA: the loss is larger than the total cost'],
  );
});

test('flags holdings that do not add up', () => {
  const { errors } = parseHoldings(holding('AAA', 10, 2.5, 99));
  assert.deepEqual(errors, ['AAA: shares × cost per share doesn’t match the total cost']);
});

test('flags missing lines, duplicates and unrelated text', () => {
  assert.deepEqual(parseHoldings('hello').errors, ['No holdings found in the pasted text']);
  assert.deepEqual(parseHoldings('หุ้น: AAA').errors, ['AAA has no share count']);
  assert.deepEqual(
    parseHoldings(`${holding('AAA', 1, 1, 1)}\n${holding('AAA', 1, 1, 1)}`).errors,
    ['AAA is listed twice'],
  );
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
