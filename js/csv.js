// CSV import and export, plus the validation shared with the add-trade form.

import { t } from './i18n.js';

export const COLUMNS = ['occurred_at', 'type', 'ticker', 'amount_usd', 'shares', 'note'];

const POSITIVE_TYPES = new Set(['sell', 'dividend', 'commission_refund', 'deposit', 'fx_in']);
const NEGATIVE_TYPES = new Set([
  'buy', 'withholding', 'fee_sec', 'fee_taf', 'fee_cat', 'withdrawal', 'fx_out',
]);
const TICKER_TYPES = new Set(['buy', 'sell', 'dividend', 'withholding']);
const TICKER_PATTERN = /^[A-Z0-9.-]{1,10}$/;
const LOCAL_TIME = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?)?$/;
// The database keeps amounts and share counts below this.
const LARGEST_NUMBER = 1e12;

export const needsTicker = (type) => TICKER_TYPES.has(type);
export const usesShares = (type) => type === 'buy' || type === 'sell';
export const isPositiveType = (type) => POSITIVE_TYPES.has(type);

// The broker works in Bangkok time, so a time with no zone means that, whichever
// device reads the file.
function withZone(value) {
  const text = String(value ?? '').trim();
  if (!LOCAL_TIME.test(text)) return text;
  return `${text.includes('T') ? text : `${text}T00:00:00`}+07:00`;
}

// Returns { row } when valid, otherwise { error } with a readable reason.
export function normalizeRow(input) {
  const type = String(input.type ?? '').trim();
  if (!POSITIVE_TYPES.has(type) && !NEGATIVE_TYPES.has(type)) {
    return { error: t('csv.unknownType', { type }) };
  }

  const time = Date.parse(withZone(input.occurred_at));
  if (Number.isNaN(time)) return { error: t('csv.invalidDate', { value: input.occurred_at }) };

  const ticker = String(input.ticker ?? '').trim().toUpperCase();
  if (TICKER_TYPES.has(type) && !TICKER_PATTERN.test(ticker)) {
    return { error: t('csv.needsTicker', { type: t(`type.${type}`) }) };
  }

  const amount = Number(input.amount_usd);
  if (!(Math.abs(amount) < LARGEST_NUMBER) || Math.round(amount * 100) === 0) {
    return { error: t('csv.invalidAmount', { value: input.amount_usd }) };
  }
  if (POSITIVE_TYPES.has(type) !== amount > 0) {
    return { error: t('csv.wrongSign', { type: t(`type.${type}`) }) };
  }

  const rawShares = String(input.shares ?? '').trim();
  const shares = rawShares === '' ? null : Number(rawShares);
  if (shares !== null && !(shares > 0 && shares < LARGEST_NUMBER)) {
    return { error: t('csv.invalidShares', { value: rawShares }) };
  }

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

// A blank total comes from the cost per share, which is rounded, so a total the
// broker gives is always preferred.
function costFrom(entry, shares, held) {
  if (entry.total !== '') return Number(entry.total);
  if (entry.perShare !== '') return roundCents(shares * Number(entry.perShare));
  return held?.total;
}

// Reads the holdings form, which follows the broker's list of what's held. A stock
// already held keeps any figure left blank, so a row can update just its result.
// Anything new needs its shares and cost.
export function readHoldings(entries, saved = {}) {
  const filled = entries.filter((entry) => (
    entry.ticker || entry.shares || entry.perShare || entry.total || entry.unrealized
  ));
  if (filled.length === 0) return { rows: [], errors: [t('holdings.none')], problems: [] };

  const problems = [];
  const seen = new Set();
  const rows = filled.map((entry) => {
    const ticker = entry.ticker.toUpperCase();
    const held = saved[ticker];
    const shares = entry.shares === '' ? held?.shares : Number(entry.shares);
    const total = costFrom(entry, shares, held);
    const unrealized = Number(entry.unrealized);
    const hasResult = entry.unrealized !== '';
    const hasShares = entry.shares !== '';
    const hasCost = entry.total !== '' || entry.perShare !== '';
    const index = entries.indexOf(entry);
    const report = (key, values) => problems.push({ index, message: t(key, values) });

    if (!TICKER_PATTERN.test(ticker)) report('holdings.badTicker', { row: index + 1 });
    else if (seen.has(ticker)) report('holdings.twice', { ticker });
    else if (held && !hasShares && !hasCost && !hasResult) {
      report('holdings.nothing', { ticker });
    } else if (held?.outdated && (hasShares || hasCost) && !(hasShares && hasCost)) {
      report('holdings.outdated', { ticker });
    } else if (!(shares > 0)) report('holdings.noShares', { ticker });
    else if (!(total >= 0)) report('holdings.noTotal', { ticker });
    else if (hasResult && !(total + unrealized >= 0)) {
      report('holdings.lossTooLarge', { ticker });
    }
    seen.add(ticker);

    // Only a full set of figures describes the holding at a moment in time. A row
    // with just a result changes the price, and the holding itself stays as it is.
    const row = { ticker, shares, total_cost_usd: total };
    if (!hasShares && !hasCost) row.priceOnly = true;
    else if (held && !(hasShares && hasCost)) row.partial = true;
    return hasResult
      ? { ...row, current_price_usd: impliedPrice({ shares, total, unrealized }) }
      : row;
  });

  return { rows, errors: problems.map((problem) => problem.message), problems };
}

const roundCents = (value) => Math.round(value * 100) / 100;

// Shares times cost per share gives the total, so a mistyped figure leaves the
// three disagreeing. The cost per share is rounded, which adds up on a large holding.
export function costsAgree({ shares, perShare, total }) {
  return Math.abs(shares * perShare - total) <= Math.max(0.05, shares * 0.0001);
}

// A quoted cell can hold line breaks, so records can't be split by line first.
function parseRecords(text) {
  const records = [];
  let cells = [];
  let cell = '';
  let quoted = false;

  const endCell = () => {
    cells.push(cell);
    cell = '';
  };
  const endRecord = () => {
    endCell();
    if (cells.some((value) => value.trim() !== '')) records.push(cells);
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
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
      endCell();
    } else if (char === '\n') {
      endRecord();
    } else if (char !== '\r') {
      cell += char;
    }
  }
  endRecord();
  return records;
}

export function parseCsv(text) {
  const [headerCells, ...records] = parseRecords(text.replace(/^﻿/, ''));
  if (!headerCells) return { rows: [], errors: [t('csv.empty')] };

  const header = headerCells.map((name) => name.trim());
  const missing = ['occurred_at', 'type', 'amount_usd'].filter((name) => !header.includes(name));
  if (missing.length > 0) {
    return { rows: [], errors: [t('csv.missingColumn', { columns: missing.join(', ') })] };
  }

  const rows = [];
  const errors = [];
  records.forEach((cells, index) => {
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

const BACKUP_APP = 'dramedy';
const BACKUP_VERSION = 1;
const STATUSES = new Set(['holding', 'sold']);

// The whole account, because trades alone can't rebuild what's held or which
// stocks were closed.
export function toBackup({ transactions, holdings, statuses }, exportedAt) {
  return JSON.stringify({
    app: BACKUP_APP,
    version: BACKUP_VERSION,
    exported_at: exportedAt,
    transactions: transactions.map((row) => (
      Object.fromEntries(COLUMNS.map((name) => [name, row[name]]))
    )),
    holdings: Object.values(holdings),
    statuses: Object.entries(statuses).map(([ticker, status]) => ({ ticker, status })),
  }, null, 2);
}

const validHolding = (row) => TICKER_PATTERN.test(row?.ticker)
  && row.shares > 0
  && row.total_cost_usd >= 0
  && !Number.isNaN(Date.parse(row.updated_at))
  && (row.current_price_usd ?? 0) >= 0;

export function parseBackup(text) {
  const invalid = { rows: [], holdings: [], statuses: [], errors: [t('backup.invalid')] };
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return invalid;
  }

  const hasParts = [data?.transactions, data?.holdings, data?.statuses].every(Array.isArray);
  const dated = !Number.isNaN(Date.parse(data?.exported_at));
  if (data?.app !== BACKUP_APP || data.version !== BACKUP_VERSION || !hasParts || !dated) {
    return invalid;
  }

  const errors = [];
  const rows = data.transactions.flatMap((input, index) => {
    const { row, error } = normalizeRow(input ?? {});
    if (error) errors.push(t('csv.line', { line: index + 1, error }));
    return row ? [row] : [];
  });

  data.holdings.forEach((row, index) => {
    if (!validHolding(row)) errors.push(t('backup.badHolding', { row: index + 1 }));
  });
  data.statuses.forEach((row, index) => {
    const valid = TICKER_PATTERN.test(row?.ticker) && STATUSES.has(row?.status);
    if (!valid) errors.push(t('backup.badStatus', { row: index + 1 }));
  });

  return {
    rows,
    holdings: data.holdings.filter(validHolding).map((row) => ({
      ticker: row.ticker,
      shares: row.shares,
      total_cost_usd: row.total_cost_usd,
      updated_at: row.updated_at,
      current_price_usd: row.current_price_usd ?? null,
      price_updated_at: row.price_updated_at ?? null,
    })),
    statuses: data.statuses.map(({ ticker, status }) => ({ ticker, status })),
    exportedAt: data.exported_at,
    errors,
  };
}
