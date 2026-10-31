import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config.js';
import { monthOf, summarize } from './calc.js';
import {
  isPositiveType, needsTicker, normalizeRow, parseCsv, parseHoldings, toCsv,
} from './csv.js';
import { demoData } from './demo.js';
import { icon } from './icons.js';
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

const TYPE_GLYPHS = {
  fee_sec: '%',
  fee_taf: '%',
  fee_cat: '%',
  commission_refund: '↩',
  deposit: '+',
  withdrawal: '−',
  fx_in: '⇄',
  fx_out: '⇄',
};

const VIEWS = [
  { id: 'overview', label: 'Overview', title: 'Overview', render: renderOverview },
  { id: 'stocks', label: 'Stocks', title: 'Stocks', render: renderStocks },
  { id: 'trades', label: 'Trades', title: 'Trades', render: renderTrades },
  { id: 'add', label: 'Add', title: 'New Trade', render: renderAdd },
  { id: 'more', label: 'More', title: 'More', render: renderMore },
];

const STOCK_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'review', label: 'Review' },
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
  openTrade: null,
  transactions: [],
  statuses: {},
  summary: null,
  notice: null,
  animate: true,
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
const toneOf = (cents) => (cents > 0 ? 'gain' : cents < 0 ? 'loss' : '');

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
const longMonthFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC',
  month: 'long',
  year: 'numeric',
});
const monthDate = (key) => new Date(`${key}-01T00:00:00Z`);
const monthLabel = (key) => monthFormat.format(monthDate(key));

function bangkokNowForInput() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

function setNotice(kind, text) {
  state.notice = { kind, text };
}

function describeError(error) {
  const message = String(error?.message ?? error);
  if (error?.code === 'over_email_send_rate_limit') {
    return 'Too many sign-in emails. The free plan sends about 2 an hour, so try again later or sign in with your password.';
  }
  if (error?.code === 'invalid_credentials') {
    return 'Wrong email or password. If you haven’t set a password yet, sign in with an email link first.';
  }
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return 'Can’t reach the database. If the app has been idle for a week, restore the project in the Supabase dashboard.';
  }
  return message;
}

async function refresh() {
  const { transactions, statuses, holdings } = await state.store.load();
  state.transactions = transactions;
  state.statuses = statuses;
  state.summary = summarize(transactions, statuses, holdings);
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

function goTo(viewId) {
  state.view = viewId;
  state.animate = true;
  render();
  window.scrollTo(0, 0);
}

function updateNavbar() {
  document.body.classList.toggle('scrolled', window.scrollY > 40);
}

function tabBar() {
  return h('nav', { class: 'tabbar', 'aria-label': 'Sections' },
    VIEWS.map((item) => h('button', {
      type: 'button',
      class: 'tab',
      'aria-current': item.id === state.view ? 'page' : null,
      onClick: () => goTo(item.id),
    }, icon(item.id), h('span', {}, item.label))));
}

function render() {
  const view = VIEWS.find((item) => item.id === state.view);
  const notice = state.notice;
  state.notice = null;

  const main = h('main', { class: `content${state.animate ? ' enter' : ''}` },
    h('div', { class: 'title-row' },
      h('h1', { class: 'large-title' }, view.title),
      isDemo && h('span', { class: 'badge' }, 'Demo')),
    view.render());
  state.animate = false;

  root.replaceChildren(...[
    h('header', { class: 'navbar' }, h('span', { class: 'navbar-title' }, view.title)),
    notice && h('p', {
      class: `toast ${notice.kind}`,
      role: notice.kind === 'bad' ? 'alert' : 'status',
    }, icon(notice.kind === 'bad' ? 'alert' : 'check'), h('span', {}, notice.text)),
    main,
    tabBar(),
  ].filter(Boolean));
  updateNavbar();
}

function section(title, content, footer) {
  return h('section', { class: 'section' },
    title && h('h2', { class: 'section-title' }, title),
    content,
    footer && h('p', { class: 'section-footer' }, footer));
}

function monogram(text) {
  const label = text.slice(0, 2);
  const mark = h('span', { class: 'monogram', 'aria-hidden': 'true' }, label);
  const hash = [...text].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  mark.dataset.tint = String(hash % 5);
  return mark;
}

function tile(label, value, hint) {
  return h('div', { class: 'tile' },
    h('div', { class: 'tile-label' }, label),
    h('div', { class: 'tile-value' }, value),
    hint && h('div', { class: 'tile-hint' }, hint));
}

// Diverging bars around a zero line. Each row prints its own signed value, so
// the sign never depends on colour, and the rows double as the table view.
function monthlyChart(monthly) {
  const largest = Math.max(...monthly.map((item) => Math.abs(item.cents)), 1);

  return h('ul', { class: 'card bars' }, monthly.map((item) => {
    const bar = h('span', { class: `bar ${item.cents < 0 ? 'loss' : 'gain'}` });
    bar.style.width = `${(Math.abs(item.cents) / largest) * 50}%`;
    return h('li', { class: 'bar-row' },
      h('span', { class: 'bar-month' }, monthLabel(item.month)),
      h('span', { class: 'bar-track' }, bar),
      h('span', { class: 'bar-value' }, signedMoney(item.cents)));
  }));
}

function emptyState() {
  return h('section', { class: 'empty' },
    h('div', { class: 'orb', 'aria-hidden': 'true' }),
    h('h2', {}, 'Your story starts here'),
    h('p', {}, 'Import your trade history to bring this place to life.'),
    h('button', { class: 'capsule', type: 'button', onClick: () => goTo('more') }, 'Import trades'));
}

function renderOverview() {
  const s = state.summary;
  if (state.transactions.length === 0) return emptyState();

  return h('div', { class: 'stack' },
    h('section', { class: 'hero' },
      h('div', { class: 'hero-label' }, icon('overview'), 'Total profit'),
      h('div', { class: 'hero-value' }, signedMoney(s.totalProfit)),
      h('div', { class: 'hero-hint' }, 'Realized profit, plus dividends, minus fees')),

    s.needsReview > 0 && h('button', {
      class: 'card row row-button review',
      type: 'button',
      onClick: () => {
        state.stockFilter = 'review';
        goTo('stocks');
      },
    },
    h('span', { class: 'row-icon warn' }, icon('alert')),
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title' },
        `${s.needsReview} ${s.needsReview === 1 ? 'stock needs' : 'stocks need'} a status`),
      h('span', { class: 'row-subtitle' }, 'Its profit isn’t counted until then')),
    icon('chevron')),

    h('section', { class: 'tiles' },
      tile('Realized', signedMoney(s.realized), 'Profit taken so far'),
      tile('Still invested', money(s.stillInvested), 'Not yet returned'),
      tile('Cash balance', money(s.cash), 'From your rows'),
      tile('Money added', money(s.moneyAdded), 'Deposits and exchanges'),
      tile('Dividends', signedMoney(s.dividends + s.tax), 'After tax'),
      tile('Fees', money(Math.abs(s.fees + s.refunds)), 'After refunds')),

    section(
      'Profit by month',
      s.monthly.length > 0
        ? monthlyChart(s.monthly)
        : h('div', { class: 'card card-note' }, 'Mark a stock as fully sold to see it here.'),
      s.monthly.length > 0
        && 'Each stock’s whole realized profit appears in the month of its latest sale.',
    ));
}

function statusPicker(stock) {
  return h('select', {
    class: 'pill-select',
    'aria-label': `Status of ${stock.ticker}`,
    onChange: (event) => run(
      () => state.store.setStatus(stock.ticker, event.target.value),
      `${stock.ticker} updated`,
    ),
  },
  stock.status === 'review' && h('option', {
    value: 'review', selected: true, disabled: true, hidden: true,
  }, 'Needs status'),
  h('option', { value: 'holding', selected: stock.status === 'holding' }, 'Still holding'),
  h('option', { value: 'sold', selected: stock.status === 'sold' }, 'Fully sold'));
}

function heldFacts(stock) {
  const shares = stock.sharesHeld.toLocaleString('en-US');
  return `${shares} shares · ${money(Math.round(stock.costLeft / stock.sharesHeld))} avg cost`;
}

function stockAmounts(stock) {
  if (stock.fromHolding) {
    return [
      h('span', { class: 'row-amount' }, money(stock.costLeft)),
      h('span', { class: 'row-subtitle' }, 'Invested'),
      stock.realized !== null && h('span', { class: `row-amount small ${toneOf(stock.realized)}` },
        signedMoney(stock.realized)),
      stock.realized !== null && h('span', { class: 'row-subtitle' }, 'Realized'),
    ];
  }

  const hasProfit = stock.realized !== null;
  return [
    h('span', { class: `row-amount ${hasProfit ? toneOf(stock.realized) : ''}` },
      hasProfit ? signedMoney(stock.realized) : money(stock.costLeft)),
    h('span', { class: 'row-subtitle' }, hasProfit ? 'Profit' : 'Invested'),
  ];
}

function stockRow(stock) {
  const trades = `Bought ${money(stock.bought)} · Sold ${money(stock.sold)}`;
  const usesTradeShares = stock.exact && !stock.fromHolding;

  return h('li', { class: 'row stock-row' },
    monogram(stock.ticker),
    h('div', { class: 'row-main' },
      h('span', { class: 'row-title' }, stock.ticker),
      stock.fromHolding && h('span', { class: 'row-subtitle strong' }, heldFacts(stock)),
      h('span', { class: 'row-subtitle' }, trades),
      usesTradeShares && h('span', { class: 'row-subtitle' },
        `${stock.sharesHeld.toLocaleString('en-US')} shares held`),
      stock.oversold && h('span', { class: 'row-warning' },
        icon('alert'), 'More shares sold than bought. A buy may be missing.'),
      stock.outdated && h('span', { class: 'row-warning' },
        icon('alert'), 'Traded since this holding was updated'),
      usesTradeShares
        ? h('span', { class: 'row-subtitle' }, 'Status comes from your share counts')
        : statusPicker(stock)),
    h('div', { class: 'row-end' }, stockAmounts(stock)));
}

function renderStocks() {
  const stocks = state.summary.stocks.filter(
    (stock) => state.stockFilter === 'all' || stock.status === state.stockFilter,
  );

  return h('div', { class: 'stack' },
    h('div', { class: 'segmented', role: 'group', 'aria-label': 'Filter stocks' },
      STOCK_FILTERS.map((filter) => h('button', {
        type: 'button',
        'aria-pressed': state.stockFilter === filter.id ? 'true' : 'false',
        onClick: () => {
          state.stockFilter = filter.id;
          render();
        },
      }, filter.label))),
    stocks.length > 0
      ? h('ul', { class: 'card' }, stocks.map(stockRow))
      : h('div', { class: 'card card-note' }, 'Nothing in this group.'));
}

function matchesTradeFilters(tx) {
  const search = state.tradeSearch.trim().toUpperCase();
  return (!search || tx.ticker.includes(search)) && (!state.tradeType || tx.type === state.tradeType);
}

function tradeRow(tx, rerender) {
  const label = [TYPE_LABELS[tx.type], tx.ticker].filter(Boolean).join(' ');
  const cents = Math.round(Number(tx.amount_usd) * 100);
  const isOpen = state.openTrade === tx.id;

  return h('li', { class: 'trade' },
    h('button', {
      class: 'row row-button',
      type: 'button',
      'aria-expanded': isOpen ? 'true' : 'false',
      onClick: () => {
        state.openTrade = isOpen ? null : tx.id;
        rerender();
      },
    },
    tx.ticker
      ? monogram(tx.ticker)
      : h('span', { class: 'monogram quiet', 'aria-hidden': 'true' }, TYPE_GLYPHS[tx.type] ?? '·'),
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title' }, label),
      h('span', { class: 'row-subtitle' }, dateFormat.format(new Date(tx.occurred_at)))),
    h('span', { class: `row-amount ${cents > 0 ? 'gain' : ''}` }, signedMoney(cents))),
    isOpen && h('div', { class: 'trade-detail' },
      tx.shares && h('p', {}, `${Number(tx.shares).toLocaleString('en-US')} shares`),
      tx.note && h('p', {}, tx.note),
      h('button', {
        class: 'text-button destructive',
        type: 'button',
        onClick: () => {
          if (confirm(`Delete ${label} (${signedMoney(cents)})?`)) {
            run(() => state.store.remove(tx.id), 'Trade deleted');
          }
        },
      }, 'Delete trade')));
}

function renderTradeList(container) {
  const groups = new Map();
  for (const tx of state.transactions.filter(matchesTradeFilters)) {
    const month = monthOf(tx.occurred_at);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(tx);
  }

  if (groups.size === 0) {
    container.replaceChildren(h('div', { class: 'card card-note' }, 'No trades match.'));
    return;
  }

  const rerender = () => renderTradeList(container);
  container.replaceChildren(...[...groups].map(([month, rows]) => section(
    longMonthFormat.format(monthDate(month)),
    h('ul', { class: 'card' }, rows.map((tx) => tradeRow(tx, rerender))),
  )));
}

function renderTrades() {
  const results = h('div', { class: 'stack' });
  renderTradeList(results);

  return h('div', { class: 'stack' },
    h('div', { class: 'search-row' },
      h('label', { class: 'search' },
        icon('search'),
        h('input', {
          type: 'search',
          placeholder: 'Search ticker',
          'aria-label': 'Search ticker',
          value: state.tradeSearch,
          autocapitalize: 'characters',
          autocomplete: 'off',
          onInput: (event) => {
            state.tradeSearch = event.target.value;
            renderTradeList(results);
          },
        })),
      h('select', {
        class: 'pill-select',
        'aria-label': 'Filter by type',
        onChange: (event) => {
          state.tradeType = event.target.value;
          renderTradeList(results);
        },
      },
      h('option', { value: '' }, 'All types'),
      Object.entries(TYPE_LABELS).map(([value, label]) => h('option', {
        value,
        selected: value === state.tradeType,
      }, label)))),
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

function formRow(label, control) {
  return h('label', { class: 'form-row' }, h('span', {}, label), control);
}

function renderAdd() {
  const ticker = formRow('Ticker', h('input', {
    name: 'ticker',
    placeholder: 'Required',
    autocapitalize: 'characters',
    autocomplete: 'off',
    maxlength: 10,
  }));
  const shares = formRow('Shares', h('input', {
    name: 'shares', type: 'number', step: 'any', min: '0', inputmode: 'decimal', placeholder: 'Optional',
  }));

  const syncFields = (type) => {
    ticker.hidden = !needsTicker(type);
    ticker.querySelector('input').required = needsTicker(type);
    shares.hidden = !['buy', 'sell'].includes(type);
  };
  syncFields('buy');

  return h('form', { class: 'stack', onSubmit: submitTrade },
    section(null, h('div', { class: 'card' },
      formRow('Type', h('select', {
        name: 'type',
        onChange: (event) => syncFields(event.target.value),
      }, Object.entries(TYPE_LABELS).map(([value, label]) => h('option', { value }, label)))),
      ticker,
      formRow('Amount (USD)', h('input', {
        name: 'amount',
        type: 'number',
        step: '0.01',
        min: '0.01',
        inputmode: 'decimal',
        placeholder: '0.00',
        required: true,
      })),
      shares), 'Enter the total amount, including any fees.'),
    section(null, h('div', { class: 'card' },
      formRow('Date', h('input', {
        name: 'occurred_at', type: 'datetime-local', value: bangkokNowForInput(), required: true,
      })),
      formRow('Note', h('input', { name: 'note', maxlength: 500, placeholder: 'Optional' }))),
    'Times are in Bangkok time.'),
    h('button', { class: 'capsule wide', type: 'submit' }, 'Save Trade'));
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
    (added) => `Added ${added} new, skipped ${rows.length - added} already here.`,
  );
}

function holdingsForm() {
  const box = h('textarea', {
    class: 'paste-box',
    name: 'holdings',
    rows: 6,
    'aria-label': 'Holdings list',
    placeholder: 'หุ้น: AAPL\nจำนวนหุ้นคงเหลือ: 10\nต้นทุนต่อหุ้น(USD): 150\nต้นทุนรวม(USD): 1500',
  });

  const submit = (event) => {
    event.preventDefault();
    const { rows, errors } = parseHoldings(box.value);
    if (errors.length > 0) {
      setNotice('bad', `Nothing was saved. ${errors.slice(0, 3).join('. ')}.`);
      render();
      return;
    }

    const listed = new Set(rows.map((row) => row.ticker));
    const sold = state.summary.stocks
      .filter((stock) => stock.tradeCount > 0 && !listed.has(stock.ticker))
      .map((stock) => stock.ticker);
    const question = `Save ${rows.length} holdings and mark ${sold.length} other stocks as fully sold?`;
    if (confirm(question)) {
      run(() => state.store.replaceHoldings(rows, sold), `${rows.length} holdings saved`);
    }
  };

  const dates = state.summary.stocks.map((stock) => stock.updatedAt).filter(Boolean).sort();
  const updated = dates.length > 0
    ? `Last updated ${dateFormat.format(new Date(dates.at(-1)))}. `
    : '';

  return section('Holdings', h('form', { class: 'card', onSubmit: submit },
    box,
    h('button', { class: 'row row-button action', type: 'submit' }, 'Save Holdings')),
  `${updated}Paste your full list. Stocks you’ve traded that aren’t listed are marked as fully sold.`);
}

function passwordForm() {
  const submit = async (event) => {
    event.preventDefault();
    const password = new FormData(event.target).get('password');
    const { error } = await state.client.auth.updateUser({ password });
    if (error) setNotice('bad', describeError(error));
    else setNotice('good', 'Password saved. You can now sign in with it on any device.');
    render();
  };

  return section('Password', h('form', { class: 'card', onSubmit: submit },
    formRow('New password', h('input', {
      name: 'password',
      type: 'password',
      autocomplete: 'new-password',
      minlength: 12,
      required: true,
      placeholder: '12+ characters',
    })),
    h('button', { class: 'row row-button action', type: 'submit' }, 'Save Password')));
}

function renderMore() {
  return h('div', { class: 'stack' },
    holdingsForm(),
    section('Your data', h('div', { class: 'card' },
      h('label', { class: 'row row-button' },
        h('span', { class: 'row-icon' }, icon('import')),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'Import CSV')),
        icon('chevron'),
        h('input', {
          class: 'file-input',
          type: 'file',
          accept: '.csv,text/csv',
          'aria-label': 'Import CSV',
          onChange: importFile,
        })),
      h('button', { class: 'row row-button', type: 'button', onClick: downloadExport },
        h('span', { class: 'row-icon' }, icon('export')),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, 'Export All Trades')),
        icon('chevron'))),
    'Importing twice is safe because rows already here are skipped. The free database plan has no automatic backups, so export now and then and keep the file private.'),
    !isDemo && passwordForm(),
    !isDemo && section('Account', h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('span', { class: 'row-main' },
          h('span', { class: 'row-subtitle' }, 'Signed in as'),
          h('span', { class: 'row-title' }, state.email))),
      h('button', {
        class: 'row row-button action destructive',
        type: 'button',
        onClick: () => state.client.auth.signOut(),
      }, 'Sign Out'))));
}

function renderLogin(message) {
  const status = h('p', { class: 'login-status', role: 'status' }, message ?? '');
  const email = h('input', {
    name: 'email',
    type: 'email',
    autocomplete: 'username',
    placeholder: 'you@example.com',
    required: true,
  });
  const password = h('input', {
    name: 'password',
    type: 'password',
    autocomplete: 'current-password',
    placeholder: 'Required',
    required: true,
  });

  const submit = async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type=submit]');
    button.disabled = true;
    status.textContent = 'Signing in…';

    const { error } = await state.client.auth.signInWithPassword({
      email: email.value,
      password: password.value,
    });
    button.disabled = false;
    status.textContent = error ? describeError(error) : '';
  };

  const sendLink = async () => {
    if (!email.reportValidity()) return;
    status.textContent = 'Sending…';

    const { error } = await state.client.auth.signInWithOtp({
      email: email.value,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${location.origin}${location.pathname}`,
      },
    });
    status.textContent = error
      ? describeError(error)
      : 'Check your email for the sign-in link. Open it in this browser.';
  };

  document.body.classList.remove('scrolled');
  root.replaceChildren(h('main', { class: 'login enter' },
    h('div', { class: 'orb', 'aria-hidden': 'true' }),
    h('h1', {}, 'Dramedy'),
    h('p', { class: 'login-tagline' }, 'Every trade tells a story.'),
    h('form', { class: 'login-form', onSubmit: submit },
      h('div', { class: 'card' }, formRow('Email', email), formRow('Password', password)),
      h('button', { class: 'capsule wide', type: 'submit' }, 'Sign In'),
      h('button', { class: 'text-button', type: 'button', onClick: sendLink }, 'Email me a link instead')),
    status));
}

async function openApp(session) {
  state.email = session.user.email;
  state.store = createSupabaseStore(state.client, session.user.id);
  try {
    await refresh();
    state.animate = true;
    render();
  } catch (error) {
    renderLogin(describeError(error));
  }
}

async function start() {
  window.addEventListener('scroll', updateNavbar, { passive: true });

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
