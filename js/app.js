import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config.js';
import { monthOf, summarize } from './calc.js';
import { isPositiveType, needsTicker, normalizeRow, parseCsv, toCsv } from './csv.js';
import { demoData } from './demo.js';
import { createDemoStore, createSupabaseStore } from './store.js';

const TYPE_LABELS = {
  buy: 'Buy',
  sell: 'Sell',
  dividend: 'Dividend',
  withholding: 'Dividend tax',
  fee_sec: 'SEC fee',
  fee_taf: 'TAF fee',
  fee_cat: 'CAT fee',
  commission_refund: 'Commission refund',
  deposit: 'Deposit',
  withdrawal: 'Withdrawal',
  fx_in: 'Exchange in',
  fx_out: 'Exchange out',
};

const VIEWS = [
  { id: 'overview', label: 'Overview', render: renderOverview },
  { id: 'stocks', label: 'Stocks', render: renderStocks },
  { id: 'trades', label: 'Trades', render: renderTrades },
  { id: 'add', label: 'Add', render: renderAdd },
  { id: 'more', label: 'More', render: renderMore },
];

const STOCK_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'review', label: 'Needs status' },
  { id: 'holding', label: 'Holding' },
  { id: 'sold', label: 'Sold' },
];

const root = document.getElementById('app');
const isDemo = new URLSearchParams(location.search).has('demo');

const state = {
  client: null,
  store: null,
  email: '',
  view: 'overview',
  stockFilter: 'all',
  tradeSearch: '',
  tradeType: '',
  transactions: [],
  statuses: {},
  summary: null,
  notice: null,
};

// Builds elements with textContent only, so imported text can never become markup.
function h(tag, props = {}, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') element.className = value;
    else if (key.startsWith('on')) element.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) element.setAttribute(key, '');
    else if (value !== false && value !== null && value !== undefined) {
      element.setAttribute(key, value);
    }
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child);
  }
  return element;
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
const money = (cents) => usd.format(cents / 100);
const signedMoney = (cents) => `${cents > 0 ? '+' : ''}${money(cents)}`;
const signedAmount = (amount) => signedMoney(Math.round(Number(amount) * 100));

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});
const monthFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  month: 'short',
  year: 'numeric',
});
const monthLabel = (key) => monthFormat.format(new Date(`${key}-01T00:00:00Z`));

function bangkokNowForInput() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function setNotice(kind, text) {
  state.notice = { kind, text };
}

function describeError(error) {
  const message = String(error?.message ?? error);
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return 'Can’t reach the database. If the app has been idle for a week, restore the project in the Supabase dashboard.';
  }
  return message;
}

async function refresh() {
  const { transactions, statuses } = await state.store.load();
  state.transactions = transactions;
  state.statuses = statuses;
  state.summary = summarize(transactions, statuses);
}

async function run(action, success) {
  try {
    const result = await action();
    await refresh();
    setNotice('good', typeof success === 'function' ? success(result) : success);
  } catch (error) {
    setNotice('bad', describeError(error));
  }
  render();
}

function render() {
  const view = VIEWS.find((item) => item.id === state.view);
  const notice = state.notice;
  state.notice = null;

  root.replaceChildren(
    h('header', { class: 'topbar' },
      h('h1', {}, 'Dramedy'),
      isDemo && h('span', { class: 'tag' }, 'Demo data')),
    h('main', { class: 'content' },
      notice && h('p', { class: `notice ${notice.kind}`, role: 'status' }, notice.text),
      view.render()),
    h('nav', { class: 'tabs', 'aria-label': 'Sections' },
      VIEWS.map((item) => h('button', {
        type: 'button',
        class: 'tab',
        'aria-current': item.id === state.view ? 'page' : null,
        onClick: () => {
          state.view = item.id;
          render();
          window.scrollTo(0, 0);
        },
      }, item.label))),
  );
}

function statTile(label, value, hint) {
  return h('div', { class: 'tile' },
    h('div', { class: 'tile-label' }, label),
    h('div', { class: 'tile-value' }, value),
    hint && h('div', { class: 'tile-hint' }, hint));
}

// Diverging bars around a zero line. Each row prints its own signed value, so
// the sign never depends on colour, and the rows double as the table view.
function monthlyChart(monthly) {
  const largest = Math.max(...monthly.map((item) => Math.abs(item.cents)), 1);
  const list = h('ul', { class: 'bars' });

  for (const item of monthly) {
    const bar = h('span', { class: `bar ${item.cents < 0 ? 'loss' : 'gain'}` });
    bar.style.width = `${(Math.abs(item.cents) / largest) * 50}%`;
    list.append(h('li', { class: 'bar-row' },
      h('span', { class: 'bar-month' }, monthLabel(item.month)),
      h('span', { class: 'bar-track' }, bar),
      h('span', { class: 'bar-value' }, signedMoney(item.cents))));
  }
  return list;
}

function renderOverview() {
  const s = state.summary;
  if (state.transactions.length === 0) {
    return h('section', { class: 'empty' },
      h('h2', {}, 'No trades yet'),
      h('p', {}, 'Import your history from a CSV file to get started.'),
      h('button', { class: 'primary', type: 'button', onClick: () => { state.view = 'more'; render(); } },
        'Go to import'));
  }

  return h('div', { class: 'stack' },
    h('section', { class: 'hero' },
      h('div', { class: 'tile-label' }, 'Total profit'),
      h('div', { class: 'hero-value' }, signedMoney(s.totalProfit)),
      h('div', { class: 'tile-hint' }, 'Sold stocks, plus dividends, minus fees')),

    s.needsReview > 0 && h('button', {
      class: 'callout',
      type: 'button',
      onClick: () => {
        state.view = 'stocks';
        state.stockFilter = 'review';
        render();
      },
    }, `${s.needsReview} ${s.needsReview === 1 ? 'stock needs' : 'stocks need'} a status. Only stocks marked fully sold count as profit. Review now →`),

    h('section', { class: 'tiles' },
      statTile('Sold stocks', signedMoney(s.realized)),
      statTile('Still invested', money(s.stillInvested), 'Money not yet returned'),
      statTile('Cash balance', money(s.cash), 'Calculated from your rows'),
      statTile('Money added', money(s.moneyAdded), 'Deposits and exchanges'),
      statTile('Dividends', signedMoney(s.dividends + s.tax), 'After tax'),
      statTile('Fees', money(Math.abs(s.fees + s.refunds)), 'After refunds')),

    h('section', { class: 'panel' },
      h('h2', {}, 'Profit by month'),
      s.monthly.length > 0
        ? monthlyChart(s.monthly)
        : h('p', { class: 'muted' }, 'Mark a stock as fully sold to see it here.'),
      s.monthly.length > 0 && h('p', { class: 'muted small' },
        'Without share counts, a stock’s whole profit appears in the month of its final sale.')));
}

function stockMeta(stock) {
  const parts = [`Bought ${money(stock.bought)}`, `Sold ${money(stock.sold)}`];
  if (stock.exact) parts.push(`${stock.sharesHeld.toLocaleString('en-US')} shares held`);
  return parts.join(' · ');
}

function statusControl(stock) {
  const choice = (status, label) => h('button', {
    type: 'button',
    'aria-pressed': stock.status === status ? 'true' : 'false',
    onClick: () => run(() => state.store.setStatus(stock.ticker, status), `${stock.ticker} updated`),
  }, label);

  return h('div', { class: 'segmented', role: 'group', 'aria-label': `Status of ${stock.ticker}` },
    choice('holding', 'Still holding'),
    choice('sold', 'Fully sold'));
}

function stockCard(stock) {
  const hasProfit = stock.realized !== null;
  return h('li', { class: 'stock' },
    h('div', { class: 'stock-head' },
      h('strong', { class: 'stock-ticker' }, stock.ticker),
      h('div', { class: 'stock-amount' },
        h('strong', {}, hasProfit ? signedMoney(stock.realized) : money(stock.costLeft)),
        h('span', { class: 'muted small' }, hasProfit ? 'Profit' : 'Still invested'))),
    h('p', { class: 'muted small' }, `${stockMeta(stock)} · ${stock.tradeCount} trades`),
    stock.oversold && h('p', { class: 'notice bad' },
      'More shares were sold than bought. A buy may be missing.'),
    stock.exact
      ? h('p', { class: 'muted small' }, 'Status comes from your share counts.')
      : statusControl(stock));
}

function renderStocks() {
  const stocks = state.summary.stocks.filter(
    (stock) => state.stockFilter === 'all' || stock.status === state.stockFilter,
  );

  return h('div', { class: 'stack' },
    h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter stocks' },
      STOCK_FILTERS.map((filter) => h('button', {
        type: 'button',
        class: 'chip',
        'aria-pressed': state.stockFilter === filter.id ? 'true' : 'false',
        onClick: () => {
          state.stockFilter = filter.id;
          render();
        },
      }, filter.label))),
    stocks.length > 0
      ? h('ul', { class: 'list' }, stocks.map(stockCard))
      : h('p', { class: 'muted' }, 'Nothing in this group.'));
}

function matchesTradeFilters(tx) {
  const search = state.tradeSearch.trim().toUpperCase();
  return (!search || tx.ticker.includes(search)) && (!state.tradeType || tx.type === state.tradeType);
}

function tradeRow(tx) {
  const label = [TYPE_LABELS[tx.type], tx.ticker].filter(Boolean).join(' ');
  return h('li', { class: 'trade' },
    h('div', {},
      h('div', { class: 'trade-title' }, label),
      h('div', { class: 'muted small' }, dateFormat.format(new Date(tx.occurred_at))),
      tx.note && h('div', { class: 'muted small' }, tx.note)),
    h('div', { class: 'trade-side' },
      h('div', { class: 'trade-amount' }, signedAmount(tx.amount_usd)),
      h('button', {
        class: 'link danger',
        type: 'button',
        'aria-label': `Delete ${label}`,
        onClick: () => {
          if (confirm(`Delete ${label} (${signedAmount(tx.amount_usd)})?`)) {
            run(() => state.store.remove(tx.id), 'Trade deleted');
          }
        },
      }, 'Delete')));
}

function renderTradeList(container) {
  const groups = new Map();
  for (const tx of state.transactions.filter(matchesTradeFilters)) {
    const month = monthOf(tx.occurred_at);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(tx);
  }

  if (groups.size === 0) {
    container.replaceChildren(h('p', { class: 'muted' }, 'No trades match.'));
    return;
  }
  container.replaceChildren(...[...groups].map(([month, rows]) => h('section', { class: 'group' },
    h('h2', {}, monthLabel(month)),
    h('ul', { class: 'list' }, rows.map(tradeRow)))));
}

function renderTrades() {
  const results = h('div', { class: 'stack' });
  renderTradeList(results);

  return h('div', { class: 'stack' },
    h('div', { class: 'filters' },
      h('label', { class: 'field' }, 'Ticker',
        h('input', {
          type: 'search',
          value: state.tradeSearch,
          autocapitalize: 'characters',
          autocomplete: 'off',
          onInput: (event) => {
            state.tradeSearch = event.target.value;
            renderTradeList(results);
          },
        })),
      h('label', { class: 'field' }, 'Type',
        h('select', {
          onChange: (event) => {
            state.tradeType = event.target.value;
            renderTradeList(results);
          },
        },
        h('option', { value: '' }, 'All types'),
        Object.entries(TYPE_LABELS).map(([value, label]) => h('option', {
          value,
          selected: value === state.tradeType,
        }, label))))),
    results);
}

function submitTrade(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const type = form.get('type');
  const amount = Math.abs(Number(form.get('amount')));

  const { row, error } = normalizeRow({
    type,
    occurred_at: `${form.get('occurred_at')}:00+07:00`,
    ticker: form.get('ticker'),
    amount_usd: isPositiveType(type) ? amount : -amount,
    shares: form.get('shares'),
    note: form.get('note'),
  });

  if (error) {
    setNotice('bad', error);
    render();
    return;
  }
  run(() => state.store.add(row), 'Trade added');
}

function renderAdd() {
  const ticker = h('label', { class: 'field' }, 'Ticker',
    h('input', { name: 'ticker', autocapitalize: 'characters', autocomplete: 'off', maxlength: 10 }));
  const shares = h('label', { class: 'field' }, 'Shares (optional)',
    h('input', { name: 'shares', type: 'number', step: 'any', min: '0', inputmode: 'decimal' }));

  const syncFields = (type) => {
    ticker.hidden = !needsTicker(type);
    ticker.querySelector('input').required = needsTicker(type);
    shares.hidden = !['buy', 'sell'].includes(type);
  };
  syncFields('buy');

  return h('form', { class: 'panel form', onSubmit: submitTrade },
    h('h2', {}, 'Add a trade'),
    h('label', { class: 'field' }, 'Type',
      h('select', { name: 'type', onChange: (event) => syncFields(event.target.value) },
        Object.entries(TYPE_LABELS).map(([value, label]) => h('option', { value }, label)))),
    ticker,
    h('label', { class: 'field' }, 'Amount in USD, including fees',
      h('input', {
        name: 'amount', type: 'number', step: '0.01', min: '0.01', inputmode: 'decimal', required: true,
      })),
    shares,
    h('label', { class: 'field' }, 'Date and time (Bangkok)',
      h('input', { name: 'occurred_at', type: 'datetime-local', value: bangkokNowForInput(), required: true })),
    h('label', { class: 'field' }, 'Note (optional)',
      h('input', { name: 'note', maxlength: 500 })),
    h('button', { class: 'primary', type: 'submit' }, 'Save trade'));
}

function downloadExport() {
  const blob = new Blob([toCsv(state.transactions)], { type: 'text/csv' });
  const link = h('a', {
    href: URL.createObjectURL(blob),
    download: `dramedy-trades-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  link.click();
  URL.revokeObjectURL(link.href);
  setNotice('good', `Exported ${state.transactions.length} rows`);
  render();
}

async function importFile(event) {
  const [file] = event.target.files;
  if (!file) return;

  const { rows, errors } = parseCsv(await file.text());
  if (errors.length > 0) {
    const more = errors.length > 3 ? ` and ${errors.length - 3} more` : '';
    setNotice('bad', `Nothing was imported. ${errors.slice(0, 3).join('. ')}${more}.`);
    render();
    return;
  }

  await run(
    () => state.store.importRows(rows),
    (added) => `${added} new rows added. ${rows.length - added} were already here.`,
  );
}

function renderMore() {
  return h('div', { class: 'stack' },
    h('section', { class: 'panel' },
      h('h2', {}, 'Import'),
      h('p', { class: 'muted' }, 'Load trades from a CSV file. Rows already here are skipped, so importing twice is safe.'),
      h('label', { class: 'field' }, 'CSV file',
        h('input', { type: 'file', accept: '.csv,text/csv', onChange: importFile }))),
    h('section', { class: 'panel' },
      h('h2', {}, 'Back up'),
      h('p', { class: 'muted' }, 'The free database plan has no automatic backups. Export now and then, and keep the file somewhere private.'),
      h('button', { class: 'secondary', type: 'button', onClick: downloadExport }, 'Export all trades')),
    !isDemo && h('section', { class: 'panel' },
      h('h2', {}, 'Account'),
      h('p', { class: 'muted' }, `Signed in as ${state.email}`),
      h('button', {
        class: 'secondary',
        type: 'button',
        onClick: () => state.client.auth.signOut(),
      }, 'Sign out')));
}

function renderLogin(message) {
  const status = h('p', { class: 'muted', role: 'status' }, message ?? '');

  const submit = async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button');
    button.disabled = true;
    status.textContent = 'Sending…';

    const { error } = await state.client.auth.signInWithOtp({
      email: new FormData(event.target).get('email'),
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${location.origin}${location.pathname}`,
      },
    });
    button.disabled = false;
    status.textContent = error
      ? `Couldn’t send the link: ${describeError(error)}`
      : 'Check your email for the sign-in link.';
  };

  root.replaceChildren(h('main', { class: 'login' },
    h('h1', {}, 'Dramedy'),
    h('p', { class: 'muted' }, 'Your private trade tracker.'),
    h('form', { class: 'panel form', onSubmit: submit },
      h('label', { class: 'field' }, 'Email',
        h('input', { name: 'email', type: 'email', autocomplete: 'email', required: true })),
      h('button', { class: 'primary', type: 'submit' }, 'Email me a sign-in link')),
    status));
}

async function openApp(session) {
  state.email = session.user.email;
  state.store = createSupabaseStore(state.client, session.user.id);
  try {
    await refresh();
    render();
  } catch (error) {
    renderLogin(describeError(error));
  }
}

async function start() {
  if (isDemo) {
    state.store = createDemoStore(demoData);
    await refresh();
    render();
    return;
  }

  state.client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  let openedFor = null;

  // Supabase calls can't run inside this callback, so they wait for the next tick.
  state.client.auth.onAuthStateChange((event, session) => {
    setTimeout(() => {
      if (!session) {
        openedFor = null;
        renderLogin();
      } else if (openedFor !== session.user.id) {
        openedFor = session.user.id;
        openApp(session);
      }
    });
  });
}

start();
