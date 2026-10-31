# dramedy

A private, phone-first tracker for US stock trades. It shows profit overall, per
stock and per month, and keeps a searchable list of every transaction.

The site is plain HTML, CSS and JavaScript served by GitHub Pages from `main`, so
there is no build step. Data lives in Supabase and is only returned to the
signed-in owner.

## Privacy rules

This repository is public. Trade data, screenshots and CSV files must never be
committed, and `.gitignore` blocks them. The key in `js/config.js` is the public
publishable key; never add a `service_role` or other secret key.

## Run locally

```bash
npm start
```

Open <http://localhost:4173/?demo> to use the app with made-up data. Nothing is
saved in demo mode.

## Test

```bash
npm test
```

## How profit is worked out

- With share counts on every trade of a stock, profit uses average cost per sale.
- Without them, profit is known only once a stock is marked fully sold: everything
  received minus everything paid, dated to the final sale.
- Deposits, withdrawals and currency exchanges never count as profit.

## Database

Schema and access rules are in `supabase/migrations`.
