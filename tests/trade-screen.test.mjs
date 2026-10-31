import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readAmountLine, readDateLine, readMonth, readTradeRows, readType, settleAmount, settleDates,
} from '../js/trade-screen.js';

test('reads an amount line', () => {
  assert.deepEqual(readAmountLine('AAAA -12.34 USD'), {
    sign: '-', amount: 12.34, label: 'AAAA', knownLabel: false, noComma: false,
  });
  assert.equal(readAmountLine('+2,345.00 USD').amount, 2345);
  assert.equal(readAmountLine('12.34 THB'), null);
});

test('strips stray letters from a known ticker', () => {
  const line = readAmountLine('O0AAAA -12.34 USD', ['AAA', 'AAAA']);
  assert.equal(line.label, 'AAAA');
  assert.equal(line.knownLabel, true);
});

test('fee names count as known', () => {
  assert.equal(readAmountLine('TAF -0.05 USD').knownLabel, true);
});

test('reads a date line, taking the Buddhist year', () => {
  assert.deepEqual(readDateLine('2 0.9.69 - 10:20:30', '2 มิ.ย. 69 - 10:20:30'), {
    day: 2, time: '10:20:30', year: 2026, unsure: false,
  });
});

test('leaves a day alone when it runs into the month', () => {
  assert.equal(readDateLine('30..69-10:20:30').day, null);
  assert.equal(readDateLine('30..69-10:20:30').time, '10:20:30');
});

test('reads months, preferring the longer match', () => {
  assert.equal(readMonth('มิ.ย. 69'), 5);
  assert.equal(readMonth('2 มี.ย. 69 - 10:20:30'), 5);
  assert.equal(readMonth('มี.ค. 69'), 2);
  assert.equal(readMonth('ม.ค. 69'), 0);
  assert.equal(readMonth('กข'), null);
});

test('a month with a doubled letter still reads', () => {
  assert.equal(readMonth('16 กก.ย. 69 - 10:20:30'), 8);
});

test('the Thai reading gives a day the digits lost', () => {
  const digits = '1.. 69 - 10:20:30';
  assert.deepEqual(readDateLine(digits, '11 พ.ค. 69 - 10:2 0'), {
    day: 11, time: '10:20:30', year: 2026, unsure: false,
  });
  assert.equal(readDateLine('1.8.69 -10:20:30', '1เม.ย. 69 - 10:20:3 0').day, 1);
});

test('a time only the Thai reading found comes back unsure', () => {
  const date = readDateLine('', '5 พ.ค. 69 - 10:20:30');
  assert.equal(date.time, '10:20:30');
  assert.equal(date.unsure, true);
});

test('a time with a stray digit stuck to it does not count', () => {
  assert.equal(readDateLine('3..69-07:4152', '3 ก.ค. 69 - 017:41:152').time, null);
});

test('between two days of the same length the digits win, and it stays unsure', () => {
  const date = readDateLine('23 1.9. 69 - 10:20:30', '25ก.ย. 69 - 10:20:30');
  assert.equal(date.day, 23);
  assert.equal(date.unsure, true);
});

test('the digits give a day the Thai reading cut short', () => {
  assert.equal(readDateLine('21 .. 69 - 10:20:30', '2 พ.ค. 69 - 10:20:30').day, 21);
});

test('a row with no time does not move the rows after it to another month', () => {
  const rows = settleDates([
    { day: 25, time: '10:00:00', year: 2026, month: 8 },
    { day: 9, time: null, year: null, month: null },
    { day: 17, time: '09:00:00', year: 2026, month: 8 },
  ]);
  assert.equal(rows[1].doubtful, true);
  assert.equal(rows[2].date, '2026-09-17T09:00:00');
});

const amountOf = (text) => readAmountLine(text);

test('an amount read the same way twice needs no checking', () => {
  assert.deepEqual(settleAmount(amountOf('AAAA -12.34 USD'), amountOf('-12.34 USD')), {
    sign: '-', amount: 12.34, checkAmount: false,
  });
});

test('the enlarged reading gives back a lost sign', () => {
  assert.deepEqual(settleAmount(amountOf('AAAA 12.34 USD'), amountOf('-12.34 USD')), {
    sign: '-', amount: 12.34, checkAmount: false,
  });
});

test('amounts that differ are marked and the enlarged one is used', () => {
  assert.deepEqual(settleAmount(amountOf('AAAA -1234.56 USD'), amountOf('-124.56 USD')), {
    sign: '-', amount: 124.56, checkAmount: true,
  });
});

test('a large amount without a comma is marked', () => {
  assert.equal(settleAmount(amountOf('AAAA -1234.56 USD'), null).checkAmount, true);
  assert.equal(settleAmount(amountOf('AAAA -1,234.56 USD'), null).checkAmount, false);
});

test('an amount with no sign at all is marked', () => {
  assert.equal(settleAmount(amountOf('AAAA 12.34 USD'), null).checkAmount, true);
});

test('a row whose first reading failed is kept and marked', () => {
  const [row] = readTradeRows([[{
    line: 'AAAA', again: '-12.34 USD', digits: 'x', month: 'x', thai: 'ซื้อ',
  }]], []);
  assert.equal(row.amount, 12.34);
  assert.equal(row.checkAmount, true);
});

test('a purchase with no sign read stays a purchase and is marked', () => {
  const [row] = readTradeRows([[{
    line: 'AAAA 12.34 USD', digits: 'x', month: 'x', thai: 'ซื้อAAAA',
  }]], ['AAAA']);
  assert.equal(row.type, 'buy');
  assert.equal(row.checkAmount, true);
});

test('a sale with no sign read stays a sale and is marked', () => {
  const [row] = readTradeRows([[{
    line: 'AAAA 12.34 USD', digits: 'x', month: 'x', thai: 'ขายAAAA',
  }]], ['AAAA']);
  assert.equal(row.type, 'sell');
  assert.equal(row.checkAmount, true);
});

test('reads row types', () => {
  assert.equal(readType('', 'SEC', '-'), 'fee_sec');
  assert.equal(readType('เงินปินผลAAA', 'AAA', '+'), 'dividend');
  assert.equal(readType('ภาษีAAA', 'AAA', '-'), 'withholding');
  assert.equal(readType('แลกเงิน', '', '+'), 'fx_in');
  assert.equal(readType('แลกเงิน', '', '-'), 'fx_out');
  assert.equal(readType('โอนเงินอัตโนมัติ', 'AB', '+'), 'deposit');
  assert.equal(readType('', 'AAA', '+'), 'sell');
  assert.equal(readType('', 'AAA', '-'), 'buy');
});

const row = (day, time, month = null, year = 2026) => ({
  day, time, month, year,
});

test('a month read once settles the rows around it', () => {
  const dates = settleDates([row(5, '10:00:00', 5), row(4, '09:00:00'), row(3, '08:00:00')]);
  assert.deepEqual(dates.map((item) => item.date), [
    '2026-06-05T10:00:00', '2026-06-04T09:00:00', '2026-06-03T08:00:00',
  ]);
  assert.equal(dates.some((item) => item.doubtful), false);
});

test('a day that rises is the month before, across a new year too', () => {
  const dates = settleDates([row(2, '10:00:00', 0), row(30, '09:00:00')]);
  assert.equal(dates[1].date, '2025-12-30T09:00:00');
});

test('the most common month wins and the odd one is marked', () => {
  const dates = settleDates([row(5, '10:00:00', 5), row(4, '09:00:00', 5), row(3, '08:00:00', 7)]);
  assert.equal(dates[2].date, '2026-06-03T08:00:00');
  assert.equal(dates[2].doubtful, true);
  assert.equal(dates[0].doubtful, false);
});

test('a row out of time order is marked', () => {
  const dates = settleDates([row(5, '10:00:00', 5), row(5, '11:00:00', 5)]);
  assert.equal(dates[1].doubtful, true);
});

test('a guessed day is marked, and no month at all leaves the date blank', () => {
  const guessed = settleDates([row(5, '10:00:00', 5), row(null, '09:00:00')]);
  assert.equal(guessed[1].date, '2026-06-05T09:00:00');
  assert.equal(guessed[1].doubtful, true);
  assert.deepEqual(settleDates([row(5, '10:00:00')]), [{ date: null, doubtful: true }]);
});

const line = (text, digits, month, thai = '') => ({
  line: text, digits, month, thai,
});

test('turns screenshots into rows and drops overlaps', () => {
  const first = [
    line('AAAA -10.00 USD', '5 0.0. 69 - 10:00:00', 'มิ.ย.', 'ซื้อ'),
    line('TAF -0.05 USD', '5 0.0. 69 - 09:00:00', 'มิ.ย.', 'ค่าธรรมเนียม'),
  ];
  const rows = readTradeRows([first, first], ['AAAA']);
  assert.deepEqual(rows, [
    {
      type: 'buy',
      ticker: 'AAAA',
      amount: 10,
      date: '2026-06-05T10:00:00',
      checkAmount: false,
      checkDate: false,
      checkTicker: false,
    },
    {
      type: 'fee_taf',
      ticker: '',
      amount: 0.05,
      date: '2026-06-05T09:00:00',
      checkAmount: false,
      checkDate: false,
      checkTicker: false,
    },
  ]);
});

test('rows with unread dates are all kept', () => {
  const rows = readTradeRows([[
    line('AAAA -10.00 USD', 'x', 'x'),
    line('AAAA -10.00 USD', 'x', 'x'),
  ]], ['AAAA']);
  assert.equal(rows.length, 2);
});

test('an unknown ticker is marked for checking', () => {
  const [row1] = readTradeRows([[line('NEWW +10.00 USD', '5 0 69 - 10:00:00', 'มิ.ย.')]], []);
  assert.equal(row1.checkTicker, true);
});
