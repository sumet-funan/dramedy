// CSV import and export, plus the validation shared with the add-trade form.

export const COLUMNS = ['occurred_at', 'type', 'ticker', 'amount_usd', 'shares', 'note'];

const POSITIVE_TYPES = new Set(['sell', 'dividend', 'commission_refund', 'deposit', 'fx_in']);
const NEGATIVE_TYPES = new Set([
  'buy', 'withholding', 'fee_sec', 'fee_taf', 'fee_cat', 'withdrawal', 'fx_out',
]);
const TICKER_TYPES = new Set(['buy', 'sell', 'dividend', 'withholding']);

export const needsTicker = (type) => TICKER_TYPES.has(type);
export const isPositiveType = (type) => POSITIVE_TYPES.has(type);

// Returns { row } when valid, otherwise { error } with a readable reason.
export function normalizeRow(input) {
  const type = String(input.type ?? '').trim();
  if (!POSITIVE_TYPES.has(type) && !NEGATIVE_TYPES.has(type)) {
    return { error: `Unknown type "${type}"` };
  }

  const time = Date.parse(input.occurred_at);
  if (Number.isNaN(time)) return { error: `Invalid date "${input.occurred_at}"` };

  const ticker = String(input.ticker ?? '').trim().toUpperCase();
  if (TICKER_TYPES.has(type) && !/^[A-Z0-9.-]{1,10}$/.test(ticker)) {
    return { error: `A ${type} needs a valid ticker` };
  }

  const amount = Number(input.amount_usd);
  if (!Number.isFinite(amount) || amount === 0) {
    return { error: `Invalid amount "${input.amount_usd}"` };
  }
  if (POSITIVE_TYPES.has(type) !== amount > 0) {
    return { error: `The amount for a ${type} has the wrong sign` };
  }

  const rawShares = String(input.shares ?? '').trim();
  const shares = rawShares === '' ? null : Number(rawShares);
  if (shares !== null && !(shares > 0)) return { error: `Invalid shares "${rawShares}"` };

  const note = String(input.note ?? '').trim();
  if (note.length > 500) return { error: 'Note is longer than 500 characters' };

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

const HOLDING_PATTERNS = {
  ticker: /^\s*หุ้น\s*:\s*([A-Za-z0-9.-]+)\s*$/,
  shares: /^\s*จำนวนหุ้นคงเหลือ\s*:\s*([\d,.]+)\s*$/,
  average: /^\s*ต้นทุนต่อหุ้น\s*\(USD\)\s*:\s*([\d,.]+)\s*$/,
  total: /^\s*ต้นทุนรวม\s*\(USD\)\s*:\s*([\d,.]+)\s*$/,
  unrealized: /^\s*มูลค่า\s*\(USD\)\s*:\s*([-−+]?[\d,.]+)\s*$/,
};

// The largest gap between shares × average and the total that rounding can explain.
const HOLDING_TOLERANCE_USD = 0.05;

const readNumber = (text) => Number(text.replaceAll(',', '').replace('−', '-'));

// Despite its name, the broker's "มูลค่า" line is profit or loss on the shares
// held, not their value. Adding it to the cost gives the value, and so the price.
const impliedPrice = ({ shares, total, unrealized }) => (
  Math.round(((total + unrealized) / shares) * 1e6) / 1e6
);

function holdingRow(block) {
  const row = { ticker: block.ticker, shares: block.shares, total_cost_usd: block.total };
  return block.unrealized === undefined
    ? row
    : { ...row, current_price_usd: impliedPrice(block) };
}

// Reads the Thai holdings list, one block of four or five lines per stock.
export function parseHoldings(text) {
  const blocks = [];
  for (const line of text.split(/\r?\n/)) {
    for (const [field, pattern] of Object.entries(HOLDING_PATTERNS)) {
      const match = line.match(pattern);
      if (!match) continue;
      if (field === 'ticker') blocks.push({ ticker: match[1].toUpperCase() });
      else if (blocks.length > 0) blocks.at(-1)[field] = readNumber(match[1]);
    }
  }

  if (blocks.length === 0) return { rows: [], errors: ['No holdings found in the pasted text'] };

  const errors = [];
  const seen = new Set();
  for (const { ticker, shares, average, total, unrealized } of blocks) {
    if (seen.has(ticker)) errors.push(`${ticker} is listed twice`);
    seen.add(ticker);

    if (!(shares > 0)) errors.push(`${ticker} has no share count`);
    else if (!(total >= 0)) errors.push(`${ticker} has no total cost`);
    else if (average > 0 && Math.abs(shares * average - total) > HOLDING_TOLERANCE_USD) {
      errors.push(`${ticker}: shares × cost per share doesn’t match the total cost`);
    } else if (Number.isNaN(unrealized) || total + unrealized < 0) {
      errors.push(`${ticker}: the loss is larger than the total cost`);
    }
  }

  return { rows: blocks.map(holdingRow), errors };
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
  if (lines.length === 0) return { rows: [], errors: ['The file is empty'] };

  const header = parseLine(lines[0]).map((name) => name.trim());
  const missing = ['occurred_at', 'type', 'amount_usd'].filter((name) => !header.includes(name));
  if (missing.length > 0) {
    return { rows: [], errors: [`Missing column: ${missing.join(', ')}`] };
  }

  const rows = [];
  const errors = [];
  lines.slice(1).forEach((line, index) => {
    const cells = parseLine(line);
    const input = Object.fromEntries(header.map((name, i) => [name, cells[i]]));
    const { row, error } = normalizeRow(input);
    if (error) errors.push(`Line ${index + 2}: ${error}`);
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
