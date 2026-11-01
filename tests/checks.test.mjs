import assert from 'node:assert/strict';
import { test } from 'node:test';
import { firstChecks, settleChecks } from '../js/checks.js';

test('a doubt clears only through the fields that settle it', () => {
  assert.deepEqual(settleChecks(['date', 'ticker'], 'shares'), ['date', 'ticker']);
  assert.deepEqual(settleChecks(['date', 'ticker'], 'date'), ['ticker']);
  assert.deepEqual(settleChecks(['date', 'ticker'], 'ticker'), ['date']);
  assert.deepEqual(settleChecks(['date'], undefined), ['date']);
});

test('the amount doubt clears through the amount or the type', () => {
  assert.deepEqual(settleChecks(['amount'], 'amount'), []);
  assert.deepEqual(settleChecks(['amount'], 'type'), []);
  assert.deepEqual(settleChecks(['amount'], 'date'), ['amount']);
});

test('the figures doubt clears through any of its three fields', () => {
  ['shares', 'perShare', 'total'].forEach((field) => {
    assert.deepEqual(settleChecks(['figures'], field), []);
  });
  assert.deepEqual(settleChecks(['figures'], 'unrealized'), ['figures']);
});

test('a row read from an image starts with its doubts', () => {
  assert.deepEqual(firstChecks({ checkAmount: true, checkDate: false, checkTicker: true }), ['amount', 'ticker']);
  assert.deepEqual(firstChecks({}), []);
});

test('a row coming back from a draft keeps what is left of its doubts', () => {
  assert.deepEqual(firstChecks({ checks: [], checkDate: true }), []);
  assert.deepEqual(firstChecks({ checks: ['date'] }), ['date']);
});
