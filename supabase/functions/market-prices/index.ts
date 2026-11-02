// Returns the latest market price of each stock the signed-in owner holds, and the
// latest USD/THB rate. The tickers come from the database under the caller's own
// token, so row level security decides who gets an answer. Tickers typed before
// they're saved can be looked up too, but only by a signed-in owner, a few at a
// time, and only in the shape of a ticker, so this can't be used as an open proxy.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const ALLOWED_ORIGINS = ['https://sumet-funan.github.io', 'http://localhost:4173'];
const QUOTE_TIMEOUT_MS = 8000;
const QUOTES_AT_ONCE = 5;
const USD_THB_SYMBOL = 'THB=X';
// A first import of a whole history can bring this many new tickers at once.
const MOST_LOOKUPS = 60;
const TICKER_PATTERN = /^[A-Z0-9.-]{1,10}$/;

// deno-lint-ignore no-explicit-any
type Meta = any;
// 'missing' means the market site doesn't know the symbol. null means it couldn't
// be asked, so nothing is known either way.
type Lookup = { meta: Meta } | 'missing' | null;

function corsHeaders(request: Request) {
  const origin = request.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    Vary: 'Origin',
  };
}

async function heldTickers(authorization: string): Promise<string[] | null> {
  const response = await fetch(`${SUPABASE_URL}/rest/v1/holdings?select=ticker`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: authorization },
  });
  if (!response.ok) return null;
  const rows: { ticker: string }[] = await response.json();
  return rows.map((row) => row.ticker);
}

async function marketMeta(symbol: string): Promise<Lookup> {
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
      },
    );
    if (response.status === 404) return 'missing';
    if (!response.ok) return null;
    const meta = (await response.json())?.chart?.result?.[0]?.meta;
    return meta ? { meta } : 'missing';
  } catch {
    return null;
  }
}

// Yahoo writes share classes with a dash, as in BRK-B. A symbol priced in another
// currency is listed outside the US, so it isn't the stock a USD account holds.
async function usStock(ticker: string): Promise<Lookup> {
  const found = await marketMeta(ticker.replaceAll('.', '-'));
  if (found === null || found === 'missing') return found;
  return found.meta.currency === 'USD' ? found : 'missing';
}

// The time is when the market set this rate, which over a weekend is days ago.
async function usdThb(): Promise<{ rate: number; at: string } | null> {
  const found = await marketMeta(USD_THB_SYMBOL);
  if (found === null || found === 'missing') return null;
  const rate = Number(found.meta.regularMarketPrice);
  const seconds = Number(found.meta.regularMarketTime);
  return found.meta.currency === 'THB' && rate > 0 && seconds > 0
    ? { rate, at: new Date(seconds * 1000).toISOString() }
    : null;
}

// A few at a time, because the market site limits bursts from shared addresses.
async function usStocks(tickers: string[]): Promise<Lookup[]> {
  const results: Lookup[] = [];
  for (let i = 0; i < tickers.length; i += QUOTES_AT_ONCE) {
    results.push(...await Promise.all(tickers.slice(i, i + QUOTES_AT_ONCE).map(usStock)));
  }
  return results;
}

async function lookUp(tickers: string[]) {
  const results = await usStocks(tickers);
  const names: Record<string, string> = {};
  const missing: string[] = [];
  const failed: string[] = [];
  tickers.forEach((ticker, index) => {
    const found = results[index];
    if (found === null) failed.push(ticker);
    else if (found === 'missing') missing.push(ticker);
    else names[ticker] = found.meta.longName ?? found.meta.shortName ?? ticker;
  });
  return { names, missing, failed };
}

async function prices(tickers: string[]) {
  const [results, rate] = await Promise.all([usStocks(tickers), usdThb()]);
  const found: Record<string, number> = {};
  const missing: string[] = [];
  const failed: string[] = [];
  tickers.forEach((ticker, index) => {
    const result = results[index];
    const price = result && result !== 'missing' ? Number(result.meta.regularMarketPrice) : 0;
    if (price > 0) found[ticker] = price;
    else failed.push(ticker);
    if (result === 'missing') missing.push(ticker);
  });
  return { prices: found, failed, missing, usdThb: rate };
}

Deno.serve(async (request) => {
  const cors = corsHeaders(request);
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });

  if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

  const tickers = await heldTickers(request.headers.get('Authorization') ?? '');
  if (tickers === null) return reply({ error: 'Not signed in' }, 401);

  const body = await request.json().catch(() => ({}));
  if (body?.rateOnly) return reply({ usdThb: await usdThb() });

  if (body?.lookup !== undefined) {
    const asked = Array.isArray(body.lookup)
      ? [...new Set(body.lookup.map((item: unknown) => String(item).trim().toUpperCase()))] as string[]
      : [];
    if (asked.length === 0 || asked.length > MOST_LOOKUPS
      || !asked.every((ticker) => TICKER_PATTERN.test(ticker))) {
      return reply({ error: 'Bad tickers' }, 400);
    }
    return reply(await lookUp(asked));
  }

  return reply(await prices(tickers));
});
