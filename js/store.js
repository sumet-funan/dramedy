// Data access. The Supabase and demo stores share one interface so the
// interface code never needs to know which it is talking to.

const PAGE_SIZE = 1000;
const IMPORT_CHUNK = 200;
const CONFLICT_COLUMNS = 'user_id,occurred_at,type,ticker,amount_usd';

export function createSupabaseStore(client, userId) {
  async function loadTransactions() {
    const all = [];
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await client
        .from('transactions')
        .select('id, occurred_at, type, ticker, amount_usd, shares, note')
        .order('occurred_at', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw error;
      all.push(...data);
      if (data.length < PAGE_SIZE) return all;
    }
  }

  return {
    async load() {
      const transactions = await loadTransactions();
      const [statusResult, holdingResult] = await Promise.all([
        client.from('stock_status').select('ticker, status'),
        client.from('holdings').select('ticker, shares, total_cost_usd, updated_at'),
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

    // Replaces the whole list: anything traded but not listed is now fully sold.
    async replaceHoldings(rows, soldTickers) {
      const now = new Date().toISOString();
      const saved = await client.from('holdings').upsert(
        rows.map((row) => ({ ...row, user_id: userId, updated_at: now })),
      );
      if (saved.error) throw saved.error;

      const listed = rows.map((row) => `"${row.ticker}"`).join(',');
      const removal = await client.from('holdings').delete().not('ticker', 'in', `(${listed})`);
      if (removal.error) throw removal.error;

      const statuses = [
        ...rows.map((row) => ({ ticker: row.ticker, status: 'holding' })),
        ...soldTickers.map((ticker) => ({ ticker, status: 'sold' })),
      ].map((row) => ({ ...row, user_id: userId, updated_at: now }));
      const marked = await client.from('stock_status').upsert(statuses);
      if (marked.error) throw marked.error;
    },

    // Duplicates are skipped by the database, so re-importing a file is safe.
    // Returns how many rows were actually new.
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
      return added;
    },
  };
}

// Keeps everything in memory, so nothing a demo visitor does is ever saved.
export function createDemoStore({ transactions, statuses, holdings }) {
  let rows = [...transactions];
  const chosen = { ...statuses };
  let held = { ...holdings };
  let nextId = rows.length + 1;

  return {
    async load() {
      return {
        transactions: [...rows].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
        statuses: { ...chosen },
        holdings: { ...held },
      };
    },
    async replaceHoldings(listed, soldTickers) {
      const updated_at = new Date().toISOString();
      held = Object.fromEntries(listed.map((row) => [row.ticker, { ...row, updated_at }]));
      listed.forEach((row) => { chosen[row.ticker] = 'holding'; });
      soldTickers.forEach((ticker) => { chosen[ticker] = 'sold'; });
    },
    async add(row) {
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
      imported.forEach((row) => rows.push({ ...row, id: String(nextId++) }));
      return imported.length;
    },
  };
}
