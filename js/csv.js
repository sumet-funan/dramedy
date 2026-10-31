// CSV import and export, plus the validation shared with the add-trade form.

import { t } from './i18n.js';

export const COLUMNS = ['occurred_at', 'type', 'ticker', 'amount_usd', 'shares', 'note'];

const POSITIVE_TYPES = new Set(['sell', 'dividend', 'commission_refund', 'deposit', 'fx_in']);
const NEGATIVE_TYPES = new Set([
  'buy', 'withholding', 'fee_sec', 'fee_taf', 'fee_cat', 'withdrawal', 'fx_out',
]);
const TICKER_TYPES = new Set(['buy', 'sell', 'dividend', 'withholding']);
const TICKER_PATTERN = /^[A-Z0-9.-]{1,10}$/;

export const needsTicker = (type) => TICKER_TYPES.has(type);
export const isPositiveType = (type) => POSITIVE_TYPES.has(type);

// Returns { row } when valid, otherwise { error } with a readable reason.
export function normalizeRow(input) {
  const type = String(input.type ?? '').trim();
  if (!POSITIVE_TYPES.has(type) && !NEGATIVE_TYPES.has(type)) {
    return { error: t('csv.unknownType', { type }) };
  }

  const time = Date.parse(input.occurred_at);
  if (Number.isNaN(time)) return { error: t('csv.invalidDate', { value: input.occurred_at }) };

  const ticker = String(input.ticker ?? '').trim().toUpperCase();
  if (TICKER_TYPES.has(type) && !TICKER_PATTERN.test(ticker)) {
    return { error: t('csv.needsTicker', { type: t(`type.${type}`) }) };
  }

  const amount = Number(input.amount_usd);
  if (!Number.isFinite(amount) || amount === 0) {
    return { error: t('csv.invalidAmount', { value: input.amount_usd }) };
  }
  if (POSITIVE_TYPES.has(type) !== amount > 0) {
    return { error: t('csv.wrongSign', { type: t(`type.${type}`) }) };
  }

  const rawShares = String(input.shares ?? '').trim();
  const shares = rawShares === '' ? null : Number(rawShares);
  if (shares !== null && !(shares > 0)) return { error: t('csv.invalidShares', { value: rawShares }) };

  const note = String(input.note ?? '').trim();
  if (note.length > 500) return { error: t('csv.noteTooLong') };

  return {
    row: {
      occurred_at: new Date(time).toISOString(),
      type,
      ticker: TICKER_TYPES.has(type) ? ticker : '',
      amount_usd: Math.round(amount * 100) / 100,
      shares,
      note: note || null,
    },
  };
}

// Close to this, the saved cost stays, because it's the broker's own figure and the
// one worked out from the screen comes from rounded ones.
const COST_TOLERANCE_USD = 0.05;

// The screen shows a stock's value and its gain or loss, so the cost is the
// difference. With only one of them, a stock already held keeps its cost.
function costFrom(entry, held) {
  if (entry.value === '' || entry.unrealized === '') return held?.total;
  const cost = roundCents(Number(entry.value) - Number(entry.unrealized));
  return held && Math.abs(held.total - cost) <= COST_TOLERANCE_USD ? held.total : cost;
}

function worthOf(entry, total) {
  if (entry.value !== '') return Number(entry.value);
  return entry.unrealized === '' ? null : total + Number(entry.unrealized);
}

// Reads the holdings form, which follows the broker's portfolio screen. A stock
// already held keeps any figure left blank, so a row can update just one of them.
// Anything new needs its shares, value and gain or loss.
export function readHoldings(entries, saved = {}) {
  const filled = entries.filter((entry) => (
    entry.ticker || entry.shares || entry.value || entry.percent || entry.unrealized
  ));
  if (filled.length === 0) return { rows: [], errors: [t('holdings.none')], problems: [] };

  const problems = [];
  const seen = new Set();
  const rows = filled.map((entry) => {
    const ticker = entry.ticker.toUpperCase();
    const held = saved[ticker];
    const shares = entry.shares === '' ? held?.shares : Number(entry.shares);
    const total = costFrom(entry, held);
    const worth = worthOf(entry, total);
    const index = entries.indexOf(entry);
    const report = (key, values) => problems.push({ index, message: t(key, values) });

    if (!TICKER_PATTERN.test(ticker)) report('holdings.badTicker', { row: index + 1 });
    else if (seen.has(ticker)) report('holdings.twice', { ticker });
    else if (held && !entry.shares && !entry.value && !entry.unrealized) {
      report('holdings.nothing', { ticker });
    } else if (!(shares > 0)) report('holdings.noShares', { ticker });
    else if (total === undefined) report('holdings.noFigures', { ticker });
    else if (total < 0) report('holdings.gainTooLarge', { ticker });
    else if (worth < 0) report('holdings.lossTooLarge', { ticker });
    seen.add(ticker);

    const row = { ticker, shares, total_cost_usd: total };
    return worth === null
      ? row
      : { ...row, current_price_usd: Math.round((worth / shares) * 1e6) / 1e6 };
  });

  return { rows, errors: problems.map((problem) => problem.message), problems };
}

// The percentage is rounded, so a small position can land slightly off.
const PERCENT_TOLERANCE = 0.1;

const roundCents = (value) => Math.round(value * 100) / 100;

// The screen shows value, gain or loss and percentage, so a mistyped figure leaves
// the three disagreeing.
export function figuresAgree({ value, unrealized, percent }) {
  const cost = value - unrealized;
  return cost > 0 && Math.abs((unrealized / cost) * 100 - percent) <= PERCENT_TOLERANCE;
}

function parseLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell);
  return cells;
}

export function parseCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim() !== '');
  if (lines.length === 0) return { rows: [], errors: [t('csv.empty')] };

  const header = parseLine(lines[0]).map((name) => name.trim());
  const missing = ['occurred_at', 'type', 'amount_usd'].filter((name) => !header.includes(name));
  if (missing.length > 0) {
    return { rows: [], errors: [t('csv.missingColumn', { columns: missing.join(', ') })] };
  }

  const rows = [];
  const errors = [];
  lines.slice(1).forEach((line, index) => {
    const cells = parseLine(line);
    const input = Object.fromEntries(header.map((name, i) => [name, cells[i]]));
    const { row, error } = normalizeRow(input);
    if (error) errors.push(t('csv.line', { line: index + 2, error }));
    else rows.push(row);
  });
  return { rows, errors };
}

const quoteCell = (value) => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export function toCsv(rows) {
  const lines = rows.map((row) => COLUMNS.map((name) => quoteCell(row[name])).join(','));
  return `${[COLUMNS.join(','), ...lines].join('\n')}\n`;
}
