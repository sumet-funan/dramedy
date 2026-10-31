import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeRow, parseCsv, toCsv } from '../js/csv.js';

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
