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
      const { data, error } = await client.from('stock_status').select('ticker, status');
      if (error) throw error;
      return {
        transactions,
        statuses: Object.fromEntries(data.map((row) => [row.ticker, row.status])),
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
export function createDemoStore({ transactions, statuses }) {
  let rows = [...transactions];
  const chosen = { ...statuses };
  let nextId = rows.length + 1;

  return {
    async load() {
      return {
        transactions: [...rows].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)),
        statuses: { ...chosen },
      };
    },
    async add(row) {
      rows.push({ ...row, id: String(nextId++) });
    },
    async remove(id) {
      rows = rows.filter((row) => row.id !== id);
    },
    async setStatus(ticker, status) {
      chosen[ticker] = status;
    },
    async importRows(imported) {
      imported.forEach((row) => rows.push({ ...row, id: String(nextId++) }));
      return imported.length;
    },
  };
}
