-- Trade tracker schema. Every row belongs to one signed-in user, and row level
-- security is what keeps the data private: the site itself is public.

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  occurred_at timestamptz not null,
  type text not null check (type in (
    'buy', 'sell', 'dividend', 'withholding',
    'fee_sec', 'fee_taf', 'fee_cat', 'commission_refund',
    'deposit', 'withdrawal', 'fx_in', 'fx_out'
  )),
  ticker text not null default '' check (ticker = upper(ticker)),
  amount_usd numeric(14, 2) not null,
  shares numeric(18, 6) check (shares is null or shares > 0),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),

  constraint transactions_ticker_required check (
    type not in ('buy', 'sell', 'dividend', 'withholding') or ticker <> ''
  ),
  constraint transactions_amount_sign check (
    case
      when type in ('sell', 'dividend', 'commission_refund', 'deposit', 'fx_in') then amount_usd > 0
      else amount_usd < 0
    end
  ),
  -- Makes importing the same file twice harmless.
  constraint transactions_no_duplicates unique (user_id, occurred_at, type, ticker, amount_usd)
);

create table public.stock_status (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  ticker text not null check (ticker <> '' and ticker = upper(ticker)),
  status text not null check (status in ('holding', 'sold')),
  updated_at timestamptz not null default now(),
  primary key (user_id, ticker)
);

alter table public.transactions enable row level security;
alter table public.stock_status enable row level security;

revoke all on public.transactions from anon, public;
revoke all on public.stock_status from anon, public;
grant select, insert, update, delete on public.transactions to authenticated;
grant select, insert, update, delete on public.stock_status to authenticated;

create policy "Own transactions: read" on public.transactions
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own transactions: add" on public.transactions
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Own transactions: change" on public.transactions
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Own transactions: remove" on public.transactions
  for delete to authenticated using ((select auth.uid()) = user_id);

create policy "Own stock status: read" on public.stock_status
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "Own stock status: add" on public.stock_status
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "Own stock status: change" on public.stock_status
  for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "Own stock status: remove" on public.stock_status
  for delete to authenticated using ((select auth.uid()) = user_id);
