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
- The broker's holdings figures make profit exact for stocks still held. Trades
  made after those figures carry on from them, using average cost per sale.
- Deposits, withdrawals and currency exchanges never count as profit.

## Reading screenshots

Trades can be filled in from screenshots of the broker's history screen. The text
is read in the browser by Tesseract in `vendor/tesseract`, so images are never
uploaded, and nothing is saved until the rows are checked and submitted. A row the
reader doubts blocks saving until the doubtful field is changed or the row is marked
as checked.

## Holdings

Holdings are typed in from the broker's list of each stock: outstanding shares, cost
per share, total cost and amount. Amount is the broker's "มูลค่า" line, which is the
gain or loss. A blank total cost is worked out from the shares and cost per share.
Typed figures are kept and shown with every digit, never rounded.
Full figures are dated with the time they were true, so later trades carry on from
them. An amount on its own only changes the price.

## Backups

More > Save Full Backup keeps trades, holdings and stock statuses in one JSON file, and
importing that file brings them back. Export All Trades is a CSV of trades only. Backup
files hold private data, so they must never be committed.

## Duplicates

The database refuses a trade with the same time, type, ticker and amount as one
already saved. A skipped row still fills in a share count the saved trade lacks.
A row that matches on everything but the time, on the same Bangkok day, may be the
same trade with a misread or missing time, so it's marked and needs confirming.

## Market prices

The sync button on Stocks calls the `market-prices` Edge Function in
`supabase/functions`. It reads the owner's tickers under the owner's own token
and asks Yahoo Finance's public chart endpoint, which is unofficial and can stop
working without notice. Prices are the latest regular market price, usually
delayed, so they can differ a little from the broker's.

## Database

Schema and access rules are in `supabase/migrations`.
