-- Prices are entered by hand, so each one keeps the time it was last saved.

alter table public.holdings
  add column current_price_usd numeric(18, 6) check (current_price_usd >= 0),
  add column price_updated_at timestamptz;
