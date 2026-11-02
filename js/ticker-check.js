// Tickers new to an account are checked against the US market before they're saved,
// because a misread ticker can still be a real one, and only its company name shows
// that. Pure, so it can be tested without a page.

export const newTickers = (rows, known) => [...new Set(rows
  .map((row) => String(row.ticker ?? '').trim().toUpperCase())
  .filter((ticker) => ticker && !known.has(ticker)))]
  .sort();

// Anything the market site didn't answer for counts as not yet checked.
export const tickerLines = ({ names = {}, missing = [] }, tickers) => tickers.map((ticker) => {
  if (names[ticker]) return { ticker, kind: 'found', name: names[ticker] };
  return { ticker, kind: missing.includes(ticker) ? 'missing' : 'unchecked' };
});
