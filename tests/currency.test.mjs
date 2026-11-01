import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bahtText, parseSavedRate, rateNeedsCheck, rateText, savedCurrency, usdText,
} from '../js/currency.js';

const HOUR_MS = 60 * 60 * 1000;
const NOW = Date.parse('2026-02-10T12:00:00Z');
const at = (ms) => new Date(ms).toISOString();

test('USD shows as saved and baht converts at the rate', () => {
  assert.equal(usdText(12345), '$123.45');
  assert.equal(bahtText(12345, 27), '฿3,333.15');
  assert.equal(bahtText(-250, 27), '-฿67.50');
});

test('a rate shows up to four places', () => {
  assert.equal(rateText(27.5), '27.5');
  assert.equal(rateText(27.123456), '27.1235');
});

test('a rate is checked again once it is an hour old', () => {
  assert.equal(rateNeedsCheck({ checkedAt: at(NOW - HOUR_MS + 1000) }, NOW), false);
  assert.equal(rateNeedsCheck({ checkedAt: at(NOW - HOUR_MS) }, NOW), true);
});

test('no rate, or a rate with no usable time, needs a check', () => {
  assert.equal(rateNeedsCheck(null, NOW), true);
  assert.equal(rateNeedsCheck({ checkedAt: 'not a date' }, NOW), true);
});

test('a kept rate comes back whole', () => {
  const saved = { rate: 27.5, at: at(NOW), checkedAt: at(NOW) };
  assert.deepEqual(parseSavedRate(JSON.stringify(saved)), saved);
});

test('a broken kept rate is ignored', () => {
  const when = at(NOW);
  for (const text of [
    null,
    'not json',
    '{}',
    JSON.stringify({ rate: 0, at: when, checkedAt: when }),
    JSON.stringify({ rate: -1, at: when, checkedAt: when }),
    JSON.stringify({ rate: 'x', at: when, checkedAt: when }),
    JSON.stringify({ rate: 27, at: 'x', checkedAt: when }),
    JSON.stringify({ rate: 27, at: when }),
  ]) {
    assert.equal(parseSavedRate(text), null, text);
  }
});

test('with nothing kept, the app starts in USD', () => {
  assert.equal(savedCurrency(), 'USD');
});
