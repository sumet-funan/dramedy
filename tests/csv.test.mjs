import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  costsAgree, normalizeRow, parseBackup, parseCsv, readHoldings, toBackup, toCsv,
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

const entry = (ticker, shares, total, unrealized = '', perShare = '') => ({
  ticker, shares, total, unrealized, perShare,
});

test('reads the holdings form', () => {
  assert.deepEqual(readHoldings([entry('aaa', '10', '25'), entry('BBB', '0.5', '20')]), {
    rows: [
      { ticker: 'AAA', shares: 10, total_cost_usd: 25 },
      { ticker: 'BBB', shares: 0.5, total_cost_usd: 20 },
    ],
    errors: [],
    problems: [],
  });
});

test('works out the price from the amount, which is the gain or loss', () => {
  const { rows, errors } = readHoldings([entry('AAA', '10', '25', '-5')]);
  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [{
    ticker: 'AAA', shares: 10, total_cost_usd: 25, current_price_usd: 2,
  }]);
});

test('an implied price gives back the exact value for fractional shares', () => {
  const [row] = readHoldings([entry('AAA', '0.3', '30', '-7.77')]).rows;
  assert.equal(Math.round(row.shares * row.current_price_usd * 100), 2223);
});

test('a blank amount leaves the price out', () => {
  const [row] = readHoldings([entry('AAA', '10', '25')]).rows;
  assert.equal('current_price_usd' in row, false);
});

test('a blank total cost comes from the cost per share', () => {
  assert.equal(readHoldings([entry('AAA', '200', '', '', '1.25')]).rows[0].total_cost_usd, 250);
  assert.equal(readHoldings([entry('AAA', '3', '', '', '1.1111')]).rows[0].total_cost_usd, 3.3333);
  assert.equal(readHoldings([entry('AAA', '0.1', '', '', '3')]).rows[0].total_cost_usd, 0.3);
});

test('figures are kept exactly as typed', () => {
  const [row] = readHoldings([entry('AAA', '0.123456', '98.765', '', '800.1234')]).rows;
  assert.deepEqual(row, {
    ticker: 'AAA', shares: 0.123456, total_cost_usd: 98.765, cost_per_share_usd: 800.1234,
  });
});

test('a total cost given wins over the cost per share', () => {
  assert.equal(readHoldings([entry('AAA', '10', '26', '', '2.5')]).rows[0].total_cost_usd, 26);
});

const saved = { AAA: { shares: 10, total: 25 } };

test('a result alone changes only the price of a stock already held', () => {
  const { rows, errors } = readHoldings([entry('aaa', '', '', '-5')], saved);
  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [{
    ticker: 'AAA', shares: 10, total_cost_usd: 25, priceOnly: true, current_price_usd: 2,
  }]);
});

test('typed figures replace the saved ones', () => {
  const [row] = readHoldings([entry('AAA', '20', '60')], saved).rows;
  assert.deepEqual(row, { ticker: 'AAA', shares: 20, total_cost_usd: 60 });
});

test('a cost per share alone is a partial change', () => {
  const [row] = readHoldings([entry('AAA', '', '', '', '3')], saved).rows;
  assert.deepEqual(row, {
    ticker: 'AAA', shares: 10, total_cost_usd: 30, cost_per_share_usd: 3, partial: true,
  });
});

test('shares alone are a partial change', () => {
  const [row] = readHoldings([entry('AAA', '20', '')], saved).rows;
  assert.deepEqual(row, {
    ticker: 'AAA', shares: 20, total_cost_usd: 25, partial: true,
  });
});

const outdated = { AAA: { shares: 10, total: 25, outdated: true } };

test('an outdated stock can still take a new result', () => {
  const { rows, errors } = readHoldings([entry('AAA', '', '', '-5')], outdated);
  assert.deepEqual(errors, []);
  assert.equal(rows[0].priceOnly, true);
});

test('an outdated stock needs both shares and cost to change', () => {
  const expected = ['AAA: a later trade has no share count, so enter both the shares and the cost'];
  assert.deepEqual(readHoldings([entry('AAA', '20', '')], outdated).errors, expected);
  assert.deepEqual(readHoldings([entry('AAA', '', '60')], outdated).errors, expected);
  assert.deepEqual(readHoldings([entry('AAA', '20', '60')], outdated).errors, []);
});

test('a stock already held needs at least one figure', () => {
  assert.deepEqual(
    readHoldings([entry('AAA', '', '')], saved).errors,
    ['AAA: enter at least one figure'],
  );
});

test('a new stock needs its shares and cost', () => {
  assert.deepEqual(readHoldings([entry('BBB', '', '', '-5')], saved).errors, ['BBB has no share count']);
  assert.deepEqual(readHoldings([entry('BBB', '1', '', '-5')], saved).errors, ['BBB has no total cost']);
});

test('a problem points at its row, counting blank rows', () => {
  const { problems } = readHoldings([entry('', '', ''), entry('AAA', '', '1')]);
  assert.deepEqual(problems, [{ index: 1, message: 'AAA has no share count' }]);
});

test('skips blank rows', () => {
  const { rows, errors } = readHoldings([entry('', '', ''), entry('AAA', '1', '1')]);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 1);
});

test('a total cost of zero counts, but a blank one does not', () => {
  assert.deepEqual(readHoldings([entry('AAA', '1', '0')]).errors, []);
  assert.deepEqual(readHoldings([entry('AAA', '1', '')]).errors, ['AAA has no total cost']);
});

test('rejects a loss larger than the cost', () => {
  assert.deepEqual(
    readHoldings([entry('AAA', '10', '25', '-30')]).errors,
    ['AAA: the loss is larger than the total cost'],
  );
});

test('flags an empty form, bad tickers, missing shares and duplicates', () => {
  assert.deepEqual(readHoldings([]).errors, ['Add at least one stock']);
  assert.deepEqual(readHoldings([entry('', '1', '1')]).errors, ['Row 1 needs a valid ticker']);
  assert.deepEqual(readHoldings([entry('AAA', '', '1')]).errors, ['AAA has no share count']);
  assert.deepEqual(
    readHoldings([entry('AAA', '1', '1'), entry('aaa', '1', '1')]).errors,
    ['AAA is listed twice'],
  );
});

test('shares, cost per share and total cost have to fit each other', () => {
  assert.equal(costsAgree({ shares: 120, perShare: 1.25, total: 150 }), true);
  assert.equal(costsAgree({ shares: 7, perShare: 1.4286, total: 10 }), true);
  assert.equal(costsAgree({ shares: 10, perShare: 2.5, total: 26 }), false);
});

test('a rounded cost per share adds up on a large holding', () => {
  assert.equal(costsAgree({ shares: 50000, perShare: 1.2346, total: 61728 }), true);
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

test('a note with a line break survives an export and import', () => {
  const row = {
    occurred_at: '2026-01-02T14:00:00.000Z',
    type: 'buy',
    ticker: 'AAA',
    amount_usd: -10,
    shares: null,
    note: 'first line\nsecond, "quoted" line',
  };
  const { rows, errors } = parseCsv(toCsv([row]));
  assert.deepEqual(errors, []);
  assert.deepEqual(rows, [row]);
});

test('blank lines and Windows line endings are ignored', () => {
  const { rows, errors } = parseCsv(`${HEADER}\r\n\r\n2026-01-01T07:00:00+07:00,deposit,,100.00,,\r\n\r\n`);
  assert.deepEqual(errors, []);
  assert.equal(rows.length, 1);
});

const account = {
  transactions: [{
    id: 'x',
    occurred_at: '2026-01-02T14:00:00.000Z',
    type: 'buy',
    ticker: 'AAA',
    amount_usd: -10,
    shares: 2,
    note: null,
  }],
  holdings: {
    AAA: {
      ticker: 'AAA',
      shares: 2,
      total_cost_usd: 10,
      cost_per_share_usd: 5.1234,
      updated_at: '2026-01-03T00:00:00.000Z',
      current_price_usd: 6,
      price_updated_at: '2026-01-04T00:00:00.000Z',
    },
  },
  statuses: { BBB: 'sold' },
};
const backupOf = (changes) => JSON.stringify({
  ...JSON.parse(toBackup(account, '2026-01-05T00:00:00.000Z')),
  ...changes,
});

test('a backup brings back trades, holdings and statuses', () => {
  const backup = parseBackup(toBackup(account, '2026-01-05T00:00:00.000Z'));
  assert.deepEqual(backup.errors, []);
  assert.equal(backup.exportedAt, '2026-01-05T00:00:00.000Z');
  assert.equal(backup.rows.length, 1);
  assert.equal(backup.rows[0].shares, 2);
  assert.equal('id' in backup.rows[0], false);
  assert.deepEqual(backup.holdings, [account.holdings.AAA]);
  assert.deepEqual(backup.statuses, [{ ticker: 'BBB', status: 'sold' }]);
});

test('other files are refused as backups', () => {
  const expected = ["This isn’t a Dramedy backup file"];
  assert.deepEqual(parseBackup('not json').errors, expected);
  assert.deepEqual(parseBackup('null').errors, expected);
  assert.deepEqual(parseBackup('{"app":"other"}').errors, expected);
  assert.deepEqual(parseBackup(backupOf({ version: 2 })).errors, expected);
  assert.deepEqual(parseBackup(backupOf({ holdings: {} })).errors, expected);
  assert.deepEqual(parseBackup(backupOf({ exported_at: 'soon' })).errors, expected);
});

test('a backup with a bad part reports it', () => {
  assert.deepEqual(
    parseBackup(backupOf({ holdings: [{ ticker: 'AAA', shares: 0 }] })).errors,
    ['Holding 1 isn’t valid'],
  );
  assert.deepEqual(
    parseBackup(backupOf({ statuses: [{ ticker: 'AAA', status: 'review' }] })).errors,
    ['Status 1 isn’t valid'],
  );
  assert.equal(parseBackup(backupOf({ transactions: [null] })).errors.length, 1);
});

const buy = (fields) => normalizeRow({
  occurred_at: '2026-01-02T10:00:00+07:00', type: 'buy', ticker: 'AAA', amount_usd: -10, ...fields,
});

test('a time with no zone is Bangkok time', () => {
  assert.equal(buy({ occurred_at: '2026-01-02T10:00:00' }).row.occurred_at, '2026-01-02T03:00:00.000Z');
  assert.equal(buy({ occurred_at: '2026-01-02T10:00' }).row.occurred_at, '2026-01-02T03:00:00.000Z');
  assert.equal(buy({ occurred_at: '2026-01-02' }).row.occurred_at, '2026-01-01T17:00:00.000Z');
});

test('a time with a zone keeps it', () => {
  assert.equal(buy({ occurred_at: '2026-01-02T10:00:00Z' }).row.occurred_at, '2026-01-02T10:00:00.000Z');
});

test('values the database would refuse are caught first', () => {
  assert.ok(buy({ amount_usd: -0.004 }).error);
  assert.ok(buy({ amount_usd: 'Infinity' }).error);
  assert.ok(buy({ amount_usd: -1e13 }).error);
  assert.ok(buy({ shares: 'Infinity' }).error);
  assert.ok(buy({ shares: '1e13' }).error);
});
