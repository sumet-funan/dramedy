// Pure calculations, kept free of the DOM and Supabase so they can be unit tested.
// All money is handled in integer cents to avoid floating point drift.

export const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
const FEE_TYPES = new Set(['fee_sec', 'fee_taf', 'fee_cat']);
const MONEY_MOVE_TYPES = new Set(['deposit', 'withdrawal', 'fx_in', 'fx_out']);
const EPSILON_SHARES = 0.000001;
// Enough to clear binary float noise without touching any real digit.
const USD_PLACES = 10;

export const toCents = (value) => Math.round(Number(value) * 100);
const exactUsd = (value) => Number(value.toFixed(USD_PLACES));

// Thailand has no daylight saving, so a fixed offset is always correct.
export const dayOf = (iso) =>
  new Date(Date.parse(iso) + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
export const monthOf = (iso) => dayOf(iso).slice(0, 7);

const byTime = (a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at);

const tradeTotals = (trades) => ({
  bought: trades
    .filter((t) => t.type === 'buy')
    .reduce((sum, t) => sum - toCents(t.amount_usd), 0),
  sold: trades
    .filter((t) => t.type === 'sell')
    .reduce((sum, t) => sum + toCents(t.amount_usd), 0),
});

// With share counts, profit is exact per sale using average cost.
function applyTrades(trades, startShares = 0, startCost = 0) {
  let shares = startShares;
  let cost = startCost;
  let oversold = false;
  const sales = [];

  for (const trade of trades) {
    const amount = toCents(trade.amount_usd);
    const quantity = Number(trade.shares);

    if (trade.type === 'buy') {
      shares += quantity;
      cost += -amount;
      continue;
    }

    if (quantity > shares + EPSILON_SHARES) oversold = true;
    const sold = Math.min(quantity, shares);
    const soldCost = shares > 0 ? (cost / shares) * sold : 0;
    sales.push({ month: monthOf(trade.occurred_at), cents: amount - soldCost });
    shares -= sold;
    cost -= soldCost;
    if (shares < EPSILON_SHARES) {
      shares = 0;
      cost = 0;
    }
  }

  return { shares, cost, oversold, sales };
}

function averageCostResult(trades) {
  const { shares, cost, oversold, sales } = applyTrades(trades);
  return {
    exact: true,
    oversold,
    status: shares === 0 ? 'sold' : 'holding',
    sharesHeld: shares,
    costLeft: Math.round(cost),
    sales,
  };
}

// Without share counts, only a fully sold stock has a known profit: everything
// received minus everything paid. It is dated to the final sale.
function cashFlowResult(trades, bought, sold, chosenStatus) {
  const status = chosenStatus ?? (sold === 0 ? 'holding' : 'review');
  const lastTrade = trades.at(-1);
  const lastSale = trades.filter((t) => t.type === 'sell').at(-1) ?? lastTrade;

  return {
    exact: false,
    oversold: false,
    status,
    sharesHeld: null,
    costLeft: status === 'sold' ? 0 : Math.max(0, bought - sold),
    sales: status === 'sold'
      ? [{ month: monthOf(lastSale.occurred_at), cents: sold - bought }]
      : [],
  };
}

// The broker's own figures for what is still held make profit exact: whatever
// isn't in the remaining cost has been realized. Commission paid on shares still
// held is part of that, because the broker's cost leaves it out. It is dated to
// the latest sale, or the latest trade if nothing has been sold. Trades made since
// those figures carry on from them, which needs a share count on each one.
function holdingResult(trades, holding) {
  const takenAt = Date.parse(holding.updated_at);
  const later = trades.filter((t) => Date.parse(t.occurred_at) > takenAt);
  const carriesOn = later.every((t) => Number(t.shares) > 0);
  const known = carriesOn ? trades.filter((t) => !later.includes(t)) : trades;

  const startCost = toCents(holding.total_cost_usd);
  const { bought, sold } = tradeTotals(known);
  const lastSale = known.filter((t) => t.type === 'sell').at(-1) ?? known.at(-1);
  const opening = lastSale
    ? [{ month: monthOf(lastSale.occurred_at), cents: sold + startCost - bought }]
    : [];

  const { shares, cost, oversold, sales } = applyTrades(
    carriesOn ? later : [],
    Number(holding.shares),
    startCost,
  );

  if (shares === 0) {
    return {
      exact: true,
      oversold,
      status: 'sold',
      sharesHeld: 0,
      costLeft: 0,
      sales: [...opening, ...sales],
    };
  }

  // Figures moved by later trades are worked out. Otherwise they stay as given.
  const rolled = carriesOn && later.length > 0;
  const totalCost = rolled ? exactUsd(cost / 100) : Number(holding.total_cost_usd);
  const perShare = rolled ? null : holding.cost_per_share_usd ?? null;

  const costLeft = Math.round(cost);
  const price = holding.current_price_usd ?? null;
  const marketValue = price === null ? null : Math.round(shares * Number(price) * 100);
  const valueUsd = price === null ? null : exactUsd(shares * Number(price));

  return {
    exact: true,
    fromHolding: true,
    oversold,
    status: 'holding',
    sharesHeld: shares,
    costLeft,
    totalCost,
    perShare: perShare === null ? null : Number(perShare),
    price: price === null ? null : Number(price),
    priceUpdatedAt: holding.price_updated_at ?? null,
    marketValue,
    valueUsd,
    unrealized: marketValue === null ? null : marketValue - costLeft,
    unrealizedUsd: valueUsd === null ? null : exactUsd(valueUsd - totalCost),
    updatedAt: holding.updated_at,
    outdated: !carriesOn,
    sales: [...opening, ...sales],
  };
}

function summarizeStock(ticker, trades, chosenStatus, holding) {
  const { bought, sold } = tradeTotals(trades);
  const hasAllShares = trades.every((t) => Number(t.shares) > 0);

  let result;
  if (holding) result = holdingResult(trades, holding);
  else if (hasAllShares) result = averageCostResult(trades);
  else result = cashFlowResult(trades, bought, sold, chosenStatus);

  const hasRealized = result.sales.length > 0;
  return {
    ticker,
    bought,
    sold,
    net: sold - bought,
    tradeCount: trades.length,
    lastAt: trades.at(-1)?.occurred_at ?? null,
    realized: hasRealized
      ? Math.round(result.sales.reduce((sum, s) => sum + s.cents, 0))
      : null,
    ...result,
  };
}

export function summarize(transactions, statuses = {}, holdings = {}) {
  const totals = { cash: 0, moneyAdded: 0, dividends: 0, tax: 0, fees: 0, refunds: 0 };
  const tradesByTicker = new Map();

  for (const tx of [...transactions].sort(byTime)) {
    const cents = toCents(tx.amount_usd);
    totals.cash += cents;

    if (tx.type === 'buy' || tx.type === 'sell') {
      if (!tradesByTicker.has(tx.ticker)) tradesByTicker.set(tx.ticker, []);
      tradesByTicker.get(tx.ticker).push(tx);
    } else if (MONEY_MOVE_TYPES.has(tx.type)) {
      totals.moneyAdded += cents;
    } else if (FEE_TYPES.has(tx.type)) {
      totals.fees += cents;
    } else if (tx.type === 'dividend') {
      totals.dividends += cents;
    } else if (tx.type === 'withholding') {
      totals.tax += cents;
    } else if (tx.type === 'commission_refund') {
      totals.refunds += cents;
    }
  }

  for (const ticker of Object.keys(holdings)) {
    if (!tradesByTicker.has(ticker)) tradesByTicker.set(ticker, []);
  }

  const stocks = [...tradesByTicker]
    .map(([ticker, trades]) => summarizeStock(ticker, trades, statuses[ticker], holdings[ticker]))
    .sort((a, b) => a.ticker.localeCompare(b.ticker));

  const monthlyMap = new Map();
  for (const stock of stocks) {
    for (const sale of stock.sales) {
      monthlyMap.set(sale.month, (monthlyMap.get(sale.month) ?? 0) + sale.cents);
    }
  }
  const monthly = [...monthlyMap]
    .map(([month, cents]) => ({ month, cents: Math.round(cents) }))
    .sort((a, b) => a.month.localeCompare(b.month));

  const realized = stocks.reduce((sum, s) => sum + (s.realized ?? 0), 0);
  const held = stocks.filter((s) => s.fromHolding);
  const priced = held.filter((s) => s.marketValue !== null);
  const unrealized = priced.reduce((sum, s) => sum + s.unrealized, 0);
  const totalProfit = realized + totals.dividends + totals.tax + totals.fees + totals.refunds;
  return {
    ...totals,
    stocks,
    monthly,
    realized,
    heldCount: held.length,
    pricedCount: priced.length,
    marketValue: priced.reduce((sum, s) => sum + s.marketValue, 0),
    unrealized,
    overall: totalProfit + unrealized,
    stillInvested: stocks.reduce((sum, s) => sum + s.costLeft, 0),
    needsReview: stocks.filter((s) => s.status === 'review').length,
    totalProfit,
  };
}
