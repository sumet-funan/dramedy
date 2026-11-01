-- Figures are kept exactly as the broker lists them, with no fixed number of
-- decimal places, and the cost per share is kept as given rather than worked out.

alter table public.holdings
  alter column shares type numeric,
  alter column total_cost_usd type numeric,
  alter column current_price_usd type numeric,
  add column cost_per_share_usd numeric check (cost_per_share_usd >= 0);
