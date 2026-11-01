// Data access. The Supabase and demo stores share one interface so the
// interface code never needs to know which it is talking to.

import { DUPLICATE_ROW, findDuplicates, sharesToFill } from './duplicates.js';

const PAGE_SIZE = 1000;
const IMPORT_CHUNK = 200;
const CONFLICT_COLUMNS = 'user_id,occurred_at,type,ticker,amount_usd';
const DEMO_USD_THB = 31.75;

export function createSupabaseStore(client, userId) {
  async function setPrices(prices) {
    const price_updated_at = new Date().toISOString();
    const results = await Promise.all(prices.map(({ ticker, price }) => client
      .from('holdings')
      .update({ current_price_usd: price, price_updated_at })
      .eq('ticker', ticker)));
    const failed = results.find((result) => result.error);
    if (failed) throw failed.error;
  }

  async function loadTransactions() {
    const all = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await client
        .from('transactions')
        .select('id, occurred_at, type, ticker, amount_usd, shares, note')
        .order('occurred_at', { ascending: false })
        .order('id')
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      all.push(...data);
      if (data.length < PAGE_SIZE) return all;
    }
  }

  async function fillShares(rows) {
    const fills = sharesToFill(rows, await loadTransactions());
    const results = await Promise.all(fills.map(({ id, shares }) => client
      .from('transactions')
      .update({ shares })
      .eq('id', id)));
    const failed = results.find((result) => result.error);
    if (failed) throw failed.error;
    return fills.length;
  }

  return {
    async load() {
      const transactions = await loadTransactions();
      const [statusResult, holdingResult] = await Promise.all([
        client.from('stock_status').select('ticker, status'),
        client.from('holdings')
          .select('ticker, shares, total_cost_usd, cost_per_share_usd, updated_at, current_price_usd, price_updated_at'),
      ]);
      if (statusResult.error) throw statusResult.error;
      if (holdingResult.error) throw holdingResult.error;
      return {
        transactions,
        statuses: Object.fromEntries(statusResult.data.map((row) => [row.ticker, row.status])),
        holdings: Object.fromEntries(holdingResult.data.map((row) => [row.ticker, row])),
      };
    },

    async add(row) {
      const { error } = await client.from('transactions').insert({ ...row, user_id: userId });
      if (error) throw error;
    },

    async remove(id) {
      const { error } = await client.from('transactions').delete().eq('id', id);
      if (error) throw error;
    },

    async setStatus(ticker, status) {
      const { error } = await client.from('stock_status').upsert({
        user_id: userId,
        ticker,
        status,
        updated_at: new Date().toISOString(),
      });
      if (error) throw error;

      if (status === 'sold') {
        const removal = await client.from('holdings').delete().eq('ticker', ticker);
        if (removal.error) throw removal.error;
      }
    },

    setPrices,

    async fetchPrices() {
      const { data, error } = await client.functions.invoke('market-prices');
      if (error) throw error;
      return data;
    },

    async fetchRate() {
      const { data, error } = await client.functions.invoke('market-prices', {
        body: { rateOnly: true },
      });
      if (error) throw error;
      return data.usdThb;
    },

    // Only the listed stocks change. Prices are saved separately so a row without
    // one keeps the price it had. A full set of figures is dated when it was true,
    // while a partial one builds on what's known now.
    async saveHoldings(rows, takenAt) {
      const now = new Date().toISOString();
      const figures = rows.filter((row) => !row.priceOnly);
      if (figures.length > 0) {
        const saved = await client.from('holdings').upsert(
          figures.map(({
            ticker, shares, total_cost_usd, cost_per_share_usd, partial,
          }) => ({
            ticker,
            shares,
            total_cost_usd,
            cost_per_share_usd: cost_per_share_usd ?? null,
            user_id: userId,
            updated_at: partial ? now : takenAt,
          })),
        );
        if (saved.error) throw saved.error;

        const marked = await client.from('stock_status').upsert(figures.map(({ ticker }) => ({
          ticker, status: 'holding', user_id: userId, updated_at: now,
        })));
        if (marked.error) throw marked.error;
      }

      await setPrices(rows
        .filter((row) => row.current_price_usd !== undefined)
        .map((row) => ({ ticker: row.ticker, price: row.current_price_usd })));
    },

    // Duplicates are skipped by the database, so re-importing a file is safe. A
    // skipped row can still supply the share count its saved trade lacks. Returns
    // how many rows were actually new and how many saved trades gained a count.
    async importRows(rows) {
      let added = 0;
      for (let i = 0; i < rows.length; i += IMPORT_CHUNK) {
        const chunk = rows.slice(i, i + IMPORT_CHUNK).map((row) => ({ ...row, user_id: userId }));
        const { data, error } = await client
          .from('transactions')
          .upsert(chunk, { onConflict: CONFLICT_COLUMNS, ignoreDuplicates: true })
          .select('id');
        if (error) throw error;
        added += data.length;
      }
      const filled = added < rows.length ? await fillShares(rows) : 0;
      return { added, filled };
    },

    // Trades merge as any import does. Holdings and statuses replace those of the
    // same stock, which brings back their dates and prices as they were.
    async restoreBackup({ rows, holdings, statuses }) {
      const imported = await this.importRows(rows);

      if (holdings.length > 0) {
        const { error } = await client.from('holdings')
          .upsert(holdings.map((row) => ({ ...row, user_id: userId })));
        if (error) throw error;
      }
      if (statuses.length > 0) {
        const updated_at = new Date().toISOString();
        const { error } = await client.from('stock_status')
          .upsert(statuses.map((row) => ({ ...row, user_id: userId, updated_at })));
        if (error) throw error;
      }
      return imported;
    },
  };
}

// Keeps everything in memory, so nothing a demo visitor does is ever saved.
export function createDemoStore({ transactions, statuses, holdings }) {
  let rows = [...transactions];
  const chosen = { ...statuses };
  const held = { ...holdings };
  let nextId = rows.length + 1;

  return {
    async load() {
      return {
        transactions: [...rows].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
        statuses: { ...chosen },
        holdings: { ...held },
      };
    },
    async setPrices(prices) {
      const price_updated_at = new Date().toISOString();
      prices.forEach(({ ticker, price }) => {
        held[ticker] = { ...held[ticker], current_price_usd: price, price_updated_at };
      });
    },
    // Made-up movement, so nothing leaves the page in the demo.
    async fetchPrices() {
      const prices = Object.entries(held).map(([ticker, row]) => {
        const price = row.current_price_usd ?? row.total_cost_usd / row.shares;
        return [ticker, Math.round(price * 101) / 100];
      });
      return {
        prices: Object.fromEntries(prices),
        failed: [],
        usdThb: await this.fetchRate(),
      };
    },
    async fetchRate() {
      return { rate: DEMO_USD_THB, at: new Date().toISOString() };
    },
    async saveHoldings(listed, takenAt) {
      const now = new Date().toISOString();
      listed.forEach(({ priceOnly, partial, ...row }) => {
        const before = held[row.ticker];
        held[row.ticker] = {
          current_price_usd: before?.current_price_usd ?? null,
          price_updated_at: row.current_price_usd === undefined
            ? before?.price_updated_at ?? null
            : now,
          ...row,
          ...(priceOnly ? {
            shares: before.shares,
            total_cost_usd: before.total_cost_usd,
            cost_per_share_usd: before.cost_per_share_usd ?? null,
          } : {}),
          updated_at: priceOnly ? before.updated_at : (partial ? now : takenAt),
        };
        chosen[row.ticker] = 'holding';
      });
    },
    async add(row) {
      if (findDuplicates([row], rows)[0]?.kind === 'same') throw { code: DUPLICATE_ROW };
      rows.push({ ...row, id: String(nextId++) });
    },
    async remove(id) {
      rows = rows.filter((row) => row.id !== id);
    },
    async setStatus(ticker, status) {
      chosen[ticker] = status;
      if (status === 'sold') delete held[ticker];
    },
    async importRows(imported) {
      const found = findDuplicates(imported, rows);
      const fills = sharesToFill(imported, rows);
      const fresh = imported.filter((row, index) => found[index]?.kind !== 'same');
      fresh.forEach((row) => rows.push({ ...row, id: String(nextId++) }));
      rows = rows.map((row) => {
        const fill = fills.find(({ id }) => id === row.id);
        return fill ? { ...row, shares: fill.shares } : row;
      });
      return { added: fresh.length, filled: fills.length };
    },
    async restoreBackup({ rows: imported, holdings: stocks, statuses: choices }) {
      const result = await this.importRows(imported);
      stocks.forEach((row) => {
        held[row.ticker] = row;
      });
      choices.forEach(({ ticker, status }) => {
        chosen[ticker] = status;
      });
      return result;
    },
  };
}
