// Returns the latest market price of each stock the signed-in owner holds. The
// tickers come from the database under the caller's own token, so row level
// security decides who gets an answer and this can't be used as an open proxy.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

const ALLOWED_ORIGINS = ['https://sumet-funan.github.io', 'http://localhost:4173'];
const QUOTE_TIMEOUT_MS = 8000;
const QUOTES_AT_ONCE = 5;

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

// Yahoo writes share classes with a dash, as in BRK-B.
async function quote(ticker: string): Promise<number | null> {
  try {
    const symbol = encodeURIComponent(ticker.replaceAll('.', '-'));
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1d`,
      {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(QUOTE_TIMEOUT_MS),
      },
    );
    if (!response.ok) return null;

    const meta = (await response.json())?.chart?.result?.[0]?.meta;
    const price = Number(meta?.regularMarketPrice);
    return meta?.currency === 'USD' && price > 0 ? price : null;
  } catch {
    return null;
  }
}

// A few at a time, because the market site limits bursts from shared addresses.
async function quotes(tickers: string[]): Promise<(number | null)[]> {
  const results: (number | null)[] = [];
  for (let i = 0; i < tickers.length; i += QUOTES_AT_ONCE) {
    results.push(...await Promise.all(tickers.slice(i, i + QUOTES_AT_ONCE).map(quote)));
  }
  return results;
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

  const results = await quotes(tickers);
  const prices: Record<string, number> = {};
  const failed: string[] = [];
  tickers.forEach((ticker, index) => {
    const price = results[index];
    if (price === null) failed.push(ticker);
    else prices[ticker] = price;
  });

  return reply({ prices, failed });
});
