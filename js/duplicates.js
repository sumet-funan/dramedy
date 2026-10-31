// Compares rows about to be saved with the trades already here. Pure, so it can be
// tested without a database.

import { toCents } from './calc.js';

export const DUPLICATE_ROW = '23505';

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

const dayOf = (iso) => new Date(Date.parse(iso) + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
const sameTime = (a, b) => Date.parse(a.occurred_at) === Date.parse(b.occurred_at);
const sameDay = (a, b) => dayOf(a.occurred_at) === dayOf(b.occurred_at);
const sameFigures = (a, b) => a.type === b.type
  && a.ticker === b.ticker
  && toCents(a.amount_usd) === toCents(b.amount_usd);

// Returns, for each row, { kind, match } or null. "same" is what the database will
// refuse. "similar" differs only in its time, as when a trade typed by hand has no
// seconds or a date was misread. Each saved trade answers for one row, so a day of
// equal small fees isn't all blamed on the one already here.
export function findDuplicates(rows, saved) {
  const free = [...saved];
  const claim = (row, fits) => {
    const index = free.findIndex((item) => sameFigures(item, row) && fits(item, row));
    return index === -1 ? null : free.splice(index, 1)[0];
  };

  const exact = rows.map((row) => claim(row, sameTime));
  return rows.map((row, index) => {
    if (exact[index]) return { kind: 'same', match: exact[index] };
    const near = claim(row, sameDay);
    return near ? { kind: 'similar', match: near } : null;
  });
}

// A skipped row's share count is only worth keeping where the saved trade has none.
export const fillsShares = (row, found) => found?.kind === 'same'
  && row.shares > 0
  && !(Number(found.match.shares) > 0);

export const sharesToFill = (rows, saved) => findDuplicates(rows, saved)
  .flatMap((found, index) => (fillsShares(rows[index], found)
    ? [{ id: found.match.id, shares: rows[index].shares }]
    : []));
