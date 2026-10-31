-- The shares still held and what they cost, as reported by the broker. One row
-- per stock; a stock with no row here is not currently held.

create table public.holdings (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ticker text not null check (ticker <> '' and ticker = upper(ticker)),
  shares numeric(18, 6) not null check (shares > 0),
  total_cost_usd numeric(14, 2) not null check (total_cost_usd >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, ticker)
);

alter table public.holdings enable row level security;

revoke all on public.holdings from anon, public;
grant select, insert, update, delete on public.holdings to authenticated;

create policy "Own holdings: read" on public.holdings
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own holdings: add" on public.holdings
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Own holdings: change" on public.holdings
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Own holdings: remove" on public.holdings
  for delete to authenticated using ((select auth.uid()) = user_id);
