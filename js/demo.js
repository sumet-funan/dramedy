// Made-up data for ?demo, used to look at the app without signing in.
// None of this is real, and none of it is ever saved.

const row = (id, occurred_at, type, ticker, amount_usd, shares = null) => ({
  id: String(id), occurred_at, type, ticker, amount_usd, shares, note: null,
});

export const demoData = {
  statuses: { ALFA: 'sold', BRVO: 'sold' },
  holdings: {
    ECHO: { ticker: 'ECHO', shares: 12, total_cost_usd: 419.4, updated_at: '2026-09-02T00:00:00Z' },
  },
  transactions: [
    row(1, '2026-03-02T02:00:00Z', 'deposit', '', 2000),
    row(2, '2026-03-03T14:00:00Z', 'buy', 'ALFA', -600),
    row(3, '2026-03-20T14:00:00Z', 'sell', 'ALFA', 648.25),
    row(4, '2026-03-21T00:20:00Z', 'fee_sec', '', -0.02),
    row(5, '2026-03-21T00:20:00Z', 'fee_taf', '', -0.03),
    row(6, '2026-04-06T14:00:00Z', 'buy', 'BRVO', -500),
    row(7, '2026-04-28T14:00:00Z', 'sell', 'BRVO', 462.4),
    row(8, '2026-05-04T14:00:00Z', 'buy', 'CHRL', -300, 10),
    row(9, '2026-05-18T14:00:00Z', 'sell', 'CHRL', 345.1, 5),
    row(10, '2026-06-01T14:00:00Z', 'buy', 'DLTA', -250),
    row(11, '2026-06-15T14:00:00Z', 'sell', 'DLTA', 120),
    row(12, '2026-07-06T14:00:00Z', 'buy', 'ECHO', -420),
    row(13, '2026-07-20T14:00:00Z', 'dividend', 'ECHO', 2.5),
    row(14, '2026-07-20T14:00:02Z', 'withholding', 'ECHO', -0.38),
    row(15, '2026-08-03T14:00:00Z', 'buy', 'FXTR', -150, 3),
    row(16, '2026-08-24T14:00:00Z', 'sell', 'FXTR', 171.3, 3),
    row(17, '2026-09-01T07:00:00Z', 'fx_out', '', -100),
  ],
};
