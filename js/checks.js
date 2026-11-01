// Doubts about rows waiting to be saved. Each one names the fields that settle it,
// so it can only clear when one of them changes or the viewer says the row is right.

export const CHECK_FIELDS = {
  amount: ['amount', 'type'],
  date: ['date'],
  ticker: ['ticker'],
  figures: ['shares', 'perShare', 'total'],
};

export const settleChecks = (checks, field) => checks
  .filter((check) => !CHECK_FIELDS[check].includes(field));

export const firstChecks = ({
  checks, checkAmount, checkDate, checkTicker,
}) => checks ?? [
  checkAmount && 'amount',
  checkDate && 'date',
  checkTicker && 'ticker',
].filter(Boolean);
