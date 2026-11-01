// Filters trades by year, month and day in Bangkok time. Pure, so it can be tested
// without a page. A period holds strings such as { year: '2026', month: '04', day: '' }.

import { dayOf } from './calc.js';

const partsOf = (tx) => {
  const [year, month, day] = dayOf(tx.occurred_at).split('-');
  return { year, month, day };
};

const fits = (parts, { year = '', month = '', day = '' }) => (!year || parts.year === year)
  && (!month || parts.month === month)
  && (!day || parts.day === day);

export const matchesPeriod = (tx, period) => fits(partsOf(tx), period);

const newestFirst = (values) => [...new Set(values)].sort().reverse();

// Each list holds only what the choices before it can reach, so no choice leads to
// an empty list. Days need a month, because a day means little across months.
export function periodOptions(transactions, { year = '', month = '' }) {
  const parts = transactions.map(partsOf);
  return {
    years: newestFirst(parts.map((item) => item.year)),
    months: newestFirst(parts.filter((item) => fits(item, { year })).map((item) => item.month)),
    days: month
      ? newestFirst(parts.filter((item) => fits(item, { year, month })).map((item) => item.day))
      : [],
  };
}

// Changing one choice can leave a later one out of reach, so that one clears.
export function settlePeriod(period, transactions) {
  const { months } = periodOptions(transactions, period);
  const month = months.includes(period.month) ? period.month : '';
  const { days } = periodOptions(transactions, { ...period, month });
  return { year: period.year, month, day: days.includes(period.day) ? period.day : '' };
}
