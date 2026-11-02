import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newTickers, tickerLines } from '../js/ticker-check.js';

test('only tickers the account never had are new, each once', () => {
  const rows = [
    { ticker: 'zeta' }, { ticker: 'ALFA' }, { ticker: ' ZETA ' }, { ticker: '' }, { ticker: 'MIKE' },
  ];
  assert.deepEqual(newTickers(rows, new Set(['ALFA'])), ['MIKE', 'ZETA']);
});

test('rows without a ticker bring nothing new', () => {
  assert.deepEqual(newTickers([{ ticker: '' }, {}], new Set()), []);
});

test('each new ticker is found, missing or not yet checked', () => {
  const result = { names: { MIKE: 'Mike Made Up Inc.' }, missing: ['ZETA'], failed: ['OSCR'] };
  assert.deepEqual(tickerLines(result, ['MIKE', 'OSCR', 'ZETA']), [
    { ticker: 'MIKE', kind: 'found', name: 'Mike Made Up Inc.' },
    { ticker: 'OSCR', kind: 'unchecked' },
    { ticker: 'ZETA', kind: 'missing' },
  ]);
});

test('a ticker left out of the answer is not yet checked', () => {
  assert.deepEqual(tickerLines({}, ['MIKE']), [{ ticker: 'MIKE', kind: 'unchecked' }]);
});
