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

// Despite its name, the broker's "มูลค่า" line is profit or loss on the shares
// held, not their value. Adding it to the cost gives the value, and so the price.
const impliedPrice = ({ shares, total, unrealized }) => (
  Math.round(((total + unrealized) / shares) * 1e6) / 1e6
);

// Reads the holdings form. A stock already held keeps any figure left blank, so
// a row can update just its result. Anything new needs its shares and cost.
export function readHoldings(entries, saved = {}) {
  const filled = entries.filter((entry) => (
    entry.ticker || entry.shares || entry.total || entry.unrealized
  ));
  if (filled.length === 0) return { rows: [], errors: [t('holdings.none')] };

  const errors = [];
  const seen = new Set();
  const rows = filled.map((entry) => {
    const ticker = entry.ticker.toUpperCase();
    const held = saved[ticker];
    const shares = entry.shares === '' ? held?.shares : Number(entry.shares);
    const total = entry.total === '' ? held?.total : Number(entry.total);
    const unrealized = Number(entry.unrealized);
    const hasResult = entry.unrealized !== '';

    if (!TICKER_PATTERN.test(ticker)) errors.push(t('holdings.badTicker'));
    else if (seen.has(ticker)) errors.push(t('holdings.twice', { ticker }));
    else if (held && !entry.shares && !entry.total && !hasResult) {
      errors.push(t('holdings.nothing', { ticker }));
    } else if (!(shares > 0)) errors.push(t('holdings.noShares', { ticker }));
    else if (!(total >= 0)) errors.push(t('holdings.noTotal', { ticker }));
    else if (hasResult && !(total + unrealized >= 0)) {
      errors.push(t('holdings.lossTooLarge', { ticker }));
    }
    seen.add(ticker);

    const row = { ticker, shares, total_cost_usd: total };
    return hasResult
      ? { ...row, current_price_usd: impliedPrice({ shares, total, unrealized }) }
      : row;
  });

  return { rows, errors };
}

const PORTFOLIO_STOCK = /([A-Z][A-Z0-9.-]{0,9})\s+([\d,]+\.\d{2})\s+(?:\S+\s+){0,2}?([-+]?[\d,]+\.\d{2})\s*%/;
const PORTFOLIO_RESULT = /\(\s*([-+]?[\d,]+\.\d{2})\s*USD/;

// The percentage is rounded, so a small position can land slightly off.
const PERCENT_TOLERANCE = 0.1;

const readAmount = (text) => Number(text.replaceAll(',', ''));
const roundCents = (value) => Math.round(value * 100) / 100;

// The screen shows value, gain or loss and percentage, so a misread figure or a
// lost minus sign leaves the three disagreeing.
function figuresAgree({ value, unrealized, percent }) {
  const cost = value - unrealized;
  return cost > 0 && Math.abs((unrealized / cost) * 100 - percent) <= PERCENT_TOLERANCE;
}

// Reads the broker's portfolio screen, where each stock takes two lines. The
// screen has no share counts, so the cost comes from value minus gain or loss.
export function readPortfolio(text) {
  const stocks = [];
  let open = null;

  for (const line of text.split(/\r?\n/)) {
    const stock = line.match(PORTFOLIO_STOCK);
    const result = line.match(PORTFOLIO_RESULT);
    if (stock) {
      open = { ticker: stock[1], value: readAmount(stock[2]), percent: readAmount(stock[3]) };
    } else if (result && open) {
      const unrealized = readAmount(result[1]);
      const figures = { ...open, unrealized };
      stocks.push({
        ticker: open.ticker,
        unrealized,
        total: roundCents(open.value - unrealized),
        agrees: figuresAgree(figures),
      });
      open = null;
    }
  }
  return stocks;
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
