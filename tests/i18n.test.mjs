import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseCsv, readHoldings } from '../js/csv.js';
import { messages, plural, setLanguage, t } from '../js/i18n.js';

const placeholders = (text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
const source = (file) => readFileSync(new URL(`../js/${file}`, import.meta.url), 'utf8');

test('both languages have the same keys', () => {
  assert.deepEqual(Object.keys(messages.th).sort(), Object.keys(messages.en).sort());
});

test('both languages use the same placeholders', () => {
  for (const [key, text] of Object.entries(messages.en)) {
    assert.deepEqual(placeholders(messages.th[key]), placeholders(text), key);
  }
});

test('every key used in the code exists', () => {
  const code = source('app.js') + source('csv.js');
  const used = [...code.matchAll(/\bt\('([^']+)'/g)].map((match) => match[1]);
  const pluralized = [...code.matchAll(/\bplural\('([^']+)'/g)]
    .flatMap((match) => [`${match[1]}.one`, `${match[1]}.many`]);
  const chosen = [...code.matchAll(/\bt\(\w+ \? '([^']+)' : '([^']+)'/g)]
    .flatMap((match) => [match[1], match[2]]);

  assert.ok(used.length > 50);
  for (const key of [...used, ...pluralized, ...chosen]) {
    assert.ok(key in messages.en, key);
  }
});

test('text follows the chosen language and fills in values', () => {
  setLanguage('th');
  assert.equal(t('stock.trades', { bought: '$1.00', sold: '$2.00' }), 'ซื้อ $1.00 · ขาย $2.00');
  assert.equal(plural('prices.saved', 2), 'บันทึกราคา 2 ตัวแล้ว');

  setLanguage('en');
  assert.equal(t('stock.trades', { bought: '$1.00', sold: '$2.00' }), 'Bought $1.00 · Sold $2.00');
  assert.equal(plural('prices.saved', 1), '1 price saved');
  assert.equal(plural('prices.saved', 2), '2 prices saved');
});

test('import errors follow the chosen language', () => {
  setLanguage('th');
  assert.deepEqual(parseCsv('').errors, ['ไฟล์ว่างเปล่า']);
  assert.deepEqual(readHoldings([]).errors, ['เพิ่มหุ้นอย่างน้อย 1 ตัว']);
  assert.deepEqual(
    parseCsv('occurred_at,type,ticker,amount_usd\n2026-01-01T00:00:00Z,buy,AAA,1').errors,
    ['บรรทัด 2: จำนวนเงินของรายการ ซื้อ มีเครื่องหมายบวกลบผิด'],
  );
  setLanguage('en');
});
