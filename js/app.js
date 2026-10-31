import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config.js';
import { monthOf, summarize } from './calc.js';
import {
  isPositiveType, needsTicker, normalizeRow, parseCsv, parseHoldings, toCsv,
} from './csv.js';
import { demoData } from './demo.js';
import {
  LANGUAGES, applyLanguage, currentLanguage, plural, setLanguage, t,
} from './i18n.js';
import { icon } from './icons.js';
import { createDemoStore, createSupabaseStore } from './store.js';

const TRADE_TYPES = [
  'buy', 'sell', 'dividend', 'withholding', 'fee_sec', 'fee_taf', 'fee_cat',
  'commission_refund', 'deposit', 'withdrawal', 'fx_in', 'fx_out',
];

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
  { id: 'overview', render: renderOverview },
  { id: 'stocks', render: renderStocks },
  { id: 'trades', render: renderTrades },
  { id: 'add', render: renderAdd },
  { id: 'more', render: renderMore },
];

const STOCK_FILTERS = ['all', 'review', 'holding', 'sold'];

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

// Rebuilt when the language changes, because they are slow to create per row.
function makeFormats() {
  const { locale } = currentLanguage();
  return {
    date: new Intl.DateTimeFormat(locale, {
      timeZone: 'Asia/Bangkok',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }),
    month: new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'short', year: 'numeric' }),
    longMonth: new Intl.DateTimeFormat(locale, { timeZone: 'UTC', month: 'long', year: 'numeric' }),
    day: new Intl.DateTimeFormat(locale, {
      timeZone: 'Asia/Bangkok',
      day: 'numeric',
      month: 'short',
    }),
  };
}

let formats = makeFormats();

const priceText = (price) => `$${price.toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
})}`;
const monthDate = (key) => new Date(`${key}-01T00:00:00Z`);
const monthLabel = (key) => formats.month.format(monthDate(key));
const typeLabel = (type) => t(`type.${type}`);

function bangkokNowForInput() {
  return new Date(Date.now() + 7 * 60 * 60 * 1000).toISOString().slice(0, 16);
}

const listErrors = (errors) => errors.slice(0, 3).join(t('error.join'));

function setNotice(kind, text) {
  state.notice = { kind, text };
}

function describeError(error) {
  const message = String(error?.message ?? error);
  if (error?.code === 'over_email_send_rate_limit') {
    return t('error.emailLimit');
  }
  if (error?.code === 'invalid_credentials') {
    return t('error.credentials');
  }
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return t('error.network');
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

function languageSwitch(show) {
  return h('div', { class: 'segmented language', role: 'group', 'aria-label': t('language') },
    LANGUAGES.map(({ id, short, name }) => h('button', {
      type: 'button',
      lang: id,
      'aria-label': name,
      'aria-pressed': id === currentLanguage().id ? 'true' : 'false',
      onClick: () => {
        setLanguage(id);
        formats = makeFormats();
        show();
      },
    }, short)));
}

function tabBar() {
  return h('nav', { class: 'tabbar', 'aria-label': t('sections') },
    VIEWS.map((item) => h('button', {
      type: 'button',
      class: 'tab',
      'aria-current': item.id === state.view ? 'page' : null,
      onClick: () => goTo(item.id),
    }, icon(item.id), h('span', {}, t(`tab.${item.id}`)))));
}

function render() {
  const view = VIEWS.find((item) => item.id === state.view);
  const title = t(`title.${view.id}`);
  const notice = state.notice;
  state.notice = null;

  const main = h('main', { class: `content${state.animate ? ' enter' : ''}` },
    h('div', { class: 'title-row' },
      h('h1', { class: 'large-title' }, title),
      isDemo && h('span', { class: 'badge' }, t('demo')),
      languageSwitch(render)),
    view.render());
  state.animate = false;

  root.replaceChildren(...[
    h('header', { class: 'navbar' }, h('span', { class: 'navbar-title' }, title)),
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

function tile(label, value, hint, variant = '') {
  return h('div', { class: `tile ${variant}` },
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
    h('h2', {}, t('empty.title')),
    h('p', {}, t('empty.text')),
    h('button', { class: 'capsule', type: 'button', onClick: () => goTo('more') }, t('empty.action')));
}

function pricedHint(s) {
  return s.pricedCount === s.heldCount
    ? t('priced.all')
    : t('priced.some', { priced: s.pricedCount, held: s.heldCount });
}

function overallHint(s) {
  if (s.pricedCount < s.heldCount) {
    const incomplete = t('overall.incomplete', { priced: pricedHint(s).toLowerCase() });
    return `${t('overall.formula')} · ${incomplete}`;
  }
  if (s.moneyAdded <= 0) return t('overall.formula');
  const percent = ((s.overall / s.moneyAdded) * 100).toFixed(1);
  return `${t('overall.formula')} · ${t('overall.share', { percent })}`;
}

function renderOverview() {
  const s = state.summary;
  if (state.transactions.length === 0) return emptyState();

  return h('div', { class: 'stack' },
    h('section', { class: 'hero' },
      h('div', { class: 'hero-label' }, icon('overview'), t('hero.label')),
      h('div', { class: 'hero-value' }, signedMoney(s.totalProfit)),
      h('div', { class: 'hero-hint' }, t('hero.hint'))),

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
      h('span', { class: 'row-title' }, plural('review.title', s.needsReview)),
      h('span', { class: 'row-subtitle' }, t('review.hint'))),
    icon('chevron')),

    h('section', { class: 'tiles' },
      s.heldCount > 0 && tile(t('overall.label'), signedMoney(s.overall), overallHint(s), 'wide'),
      tile(t('tile.realized'), signedMoney(s.realized), t('tile.realizedHint')),
      s.heldCount > 0 && tile(
        t('tile.unrealized'),
        s.pricedCount > 0 ? signedMoney(s.unrealized) : '—',
        pricedHint(s),
      ),
      s.heldCount > 0 && tile(
        t('tile.marketValue'),
        s.pricedCount > 0 ? money(s.marketValue) : '—',
        pricedHint(s),
      ),
      tile(t('tile.invested'), money(s.stillInvested), t('tile.investedHint')),
      tile(t('tile.cash'), money(s.cash), t('tile.cashHint')),
      tile(t('tile.moneyAdded'), money(s.moneyAdded), t('tile.moneyAddedHint')),
      tile(t('tile.dividends'), signedMoney(s.dividends + s.tax), t('tile.dividendsHint')),
      tile(t('tile.fees'), money(Math.abs(s.fees + s.refunds)), t('tile.feesHint'))),

    section(
      t('chart.title'),
      s.monthly.length > 0
        ? monthlyChart(s.monthly)
        : h('div', { class: 'card card-note' }, t('chart.empty')),
      s.monthly.length > 0
        && t('chart.footer'),
    ));
}

function statusPicker(stock) {
  return h('select', {
    class: 'pill-select',
    'aria-label': t('status.label', { ticker: stock.ticker }),
    onChange: (event) => run(
      () => state.store.setStatus(stock.ticker, event.target.value),
      t('status.updated', { ticker: stock.ticker }),
    ),
  },
  stock.status === 'review' && h('option', {
    value: 'review', selected: true, disabled: true, hidden: true,
  }, t('status.review')),
  h('option', { value: 'holding', selected: stock.status === 'holding' }, t('status.holding')),
  h('option', { value: 'sold', selected: stock.status === 'sold' }, t('status.sold')));
}

function heldFacts(stock) {
  return t('stock.held', {
    shares: stock.sharesHeld.toLocaleString('en-US'),
    cost: money(Math.round(stock.costLeft / stock.sharesHeld)),
  });
}

function priceFacts(stock) {
  if (stock.price === null) return t('stock.noPrice');
  const facts = { price: priceText(stock.price), value: money(stock.marketValue) };
  return stock.priceUpdatedAt
    ? t('stock.priceOn', { ...facts, day: formats.day.format(new Date(stock.priceUpdatedAt)) })
    : t('stock.price', facts);
}

function stockAmounts(stock) {
  if (stock.fromHolding) {
    const hasPrice = stock.unrealized !== null;
    return [
      h('span', { class: `row-amount ${hasPrice ? toneOf(stock.unrealized) : ''}` },
        hasPrice ? signedMoney(stock.unrealized) : money(stock.costLeft)),
      h('span', { class: 'row-subtitle' }, t(hasPrice ? 'stock.unrealized' : 'stock.invested')),
      stock.realized !== null && h('span', { class: `row-amount small ${toneOf(stock.realized)}` },
        signedMoney(stock.realized)),
      stock.realized !== null && h('span', { class: 'row-subtitle' }, t('stock.realized')),
    ];
  }

  const hasProfit = stock.realized !== null;
  return [
    h('span', { class: `row-amount ${hasProfit ? toneOf(stock.realized) : ''}` },
      hasProfit ? signedMoney(stock.realized) : money(stock.costLeft)),
    h('span', { class: 'row-subtitle' }, t(hasProfit ? 'stock.profit' : 'stock.invested')),
  ];
}

function stockRow(stock) {
  const trades = t('stock.trades', { bought: money(stock.bought), sold: money(stock.sold) });
  const usesTradeShares = stock.exact && !stock.fromHolding;

  return h('li', { class: 'row stock-row' },
    monogram(stock.ticker),
    h('div', { class: 'row-main' },
      h('span', { class: 'row-title' }, stock.ticker),
      stock.fromHolding && h('span', { class: 'row-subtitle strong' }, heldFacts(stock)),
      stock.fromHolding && h('span', { class: 'row-subtitle' }, priceFacts(stock)),
      h('span', { class: 'row-subtitle' }, trades),
      usesTradeShares && h('span', { class: 'row-subtitle' },
        t('stock.sharesHeld', { shares: stock.sharesHeld.toLocaleString('en-US') })),
      stock.oversold && h('span', { class: 'row-warning' },
        icon('alert'), t('stock.oversold')),
      stock.outdated && h('span', { class: 'row-warning' },
        icon('alert'), t('stock.outdated')),
      usesTradeShares
        ? h('span', { class: 'row-subtitle' }, t('stock.fromShares'))
        : statusPicker(stock)),
    h('div', { class: 'row-end' }, stockAmounts(stock)));
}

function renderStocks() {
  const stocks = state.summary.stocks.filter(
    (stock) => state.stockFilter === 'all' || stock.status === state.stockFilter,
  );

  return h('div', { class: 'stack' },
    h('div', { class: 'segmented', role: 'group', 'aria-label': t('filter.label') },
      STOCK_FILTERS.map((filter) => h('button', {
        type: 'button',
        'aria-pressed': state.stockFilter === filter ? 'true' : 'false',
        onClick: () => {
          state.stockFilter = filter;
          render();
        },
      }, t(`filter.${filter}`)))),
    stocks.length > 0
      ? h('ul', { class: 'card' }, stocks.map(stockRow))
      : h('div', { class: 'card card-note' }, t('filter.empty')));
}

function matchesTradeFilters(tx) {
  const search = state.tradeSearch.trim().toUpperCase();
  return (!search || tx.ticker.includes(search)) && (!state.tradeType || tx.type === state.tradeType);
}

function tradeRow(tx, rerender) {
  const label = [typeLabel(tx.type), tx.ticker].filter(Boolean).join(' ');
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
      h('span', { class: 'row-subtitle' }, formats.date.format(new Date(tx.occurred_at)))),
    h('span', { class: `row-amount ${cents > 0 ? 'gain' : ''}` }, signedMoney(cents))),
    isOpen && h('div', { class: 'trade-detail' },
      tx.shares && h('p', {}, t('trade.shares', { shares: Number(tx.shares).toLocaleString('en-US') })),
      tx.note && h('p', {}, tx.note),
      h('button', {
        class: 'text-button destructive',
        type: 'button',
        onClick: () => {
          if (confirm(t('trade.confirmDelete', { label, amount: signedMoney(cents) }))) {
            run(() => state.store.remove(tx.id), t('trade.deleted'));
          }
        },
      }, t('trade.delete'))));
}

function renderTradeList(container) {
  const groups = new Map();
  for (const tx of state.transactions.filter(matchesTradeFilters)) {
    const month = monthOf(tx.occurred_at);
    if (!groups.has(month)) groups.set(month, []);
    groups.get(month).push(tx);
  }

  if (groups.size === 0) {
    container.replaceChildren(h('div', { class: 'card card-note' }, t('trade.noMatch')));
    return;
  }

  const rerender = () => renderTradeList(container);
  container.replaceChildren(...[...groups].map(([month, rows]) => section(
    formats.longMonth.format(monthDate(month)),
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
          placeholder: t('trade.search'),
          'aria-label': t('trade.search'),
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
        'aria-label': t('trade.filterType'),
        onChange: (event) => {
          state.tradeType = event.target.value;
          renderTradeList(results);
        },
      },
      h('option', { value: '' }, t('trade.allTypes')),
      TRADE_TYPES.map((value) => h('option', {
        value,
        selected: value === state.tradeType,
      }, typeLabel(value))))),
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
  run(() => state.store.add(row), t('trade.added'));
}

function formRow(label, control) {
  return h('label', { class: 'form-row' }, h('span', {}, label), control);
}

function renderAdd() {
  const ticker = formRow(t('form.ticker'), h('input', {
    name: 'ticker',
    placeholder: t('form.required'),
    autocapitalize: 'characters',
    autocomplete: 'off',
    maxlength: 10,
  }));
  const shares = formRow(t('form.shares'), h('input', {
    name: 'shares',
    type: 'number',
    step: 'any',
    min: '0',
    inputmode: 'decimal',
    placeholder: t('form.optional'),
  }));

  const syncFields = (type) => {
    ticker.hidden = !needsTicker(type);
    ticker.querySelector('input').required = needsTicker(type);
    shares.hidden = !['buy', 'sell'].includes(type);
  };
  syncFields('buy');

  return h('form', { class: 'stack', onSubmit: submitTrade },
    section(null, h('div', { class: 'card' },
      formRow(t('form.type'), h('select', {
        name: 'type',
        onChange: (event) => syncFields(event.target.value),
      }, TRADE_TYPES.map((value) => h('option', { value }, typeLabel(value))))),
      ticker,
      formRow(t('form.amount'), h('input', {
        name: 'amount',
        type: 'number',
        step: '0.01',
        min: '0.01',
        inputmode: 'decimal',
        placeholder: '0.00',
        required: true,
      })),
      shares), t('form.amountHint')),
    section(null, h('div', { class: 'card' },
      formRow(t('form.date'), h('input', {
        name: 'occurred_at', type: 'datetime-local', value: bangkokNowForInput(), required: true,
      })),
      formRow(t('form.note'), h('input', {
        name: 'note', maxlength: 500, placeholder: t('form.optional'),
      }))),
    t('form.timezone')),
    h('button', { class: 'capsule wide', type: 'submit' }, t('form.save')));
}

function downloadExport() {
  const blob = new Blob([toCsv(state.transactions)], { type: 'text/csv' });
  const link = h('a', {
    href: URL.createObjectURL(blob),
    download: `dramedy-trades-${new Date().toISOString().slice(0, 10)}.csv`,
  });
  link.click();
  URL.revokeObjectURL(link.href);
  setNotice('good', t('data.exported', { count: state.transactions.length }));
  render();
}

async function importFile(event) {
  const [file] = event.target.files;
  if (!file) return;

  const { rows, errors } = parseCsv(await file.text());
  if (errors.length > 0) {
    const more = errors.length > 3 ? t('error.more', { count: errors.length - 3 }) : '';
    setNotice('bad', t('data.importFailed', { errors: listErrors(errors), more }));
    render();
    return;
  }

  await run(
    () => state.store.importRows(rows),
    (added) => t('data.imported', { added, skipped: rows.length - added }),
  );
}

function pricesForm() {
  const held = state.summary.stocks.filter((stock) => stock.fromHolding);
  if (held.length === 0) return null;

  const submit = (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const changes = held
      .map((stock) => {
        const text = String(form.get(stock.ticker)).trim();
        return { ticker: stock.ticker, price: text === '' ? null : Number(text), before: stock.price };
      })
      .filter(({ price, before }) => price !== before);

    if (changes.length === 0) {
      setNotice('good', t('prices.unchanged'));
      render();
      return;
    }
    run(
      () => state.store.setPrices(changes),
      plural('prices.saved', changes.length),
    );
  };

  return section(t('prices.title'), h('form', { class: 'card', onSubmit: submit },
    held.map((stock) => formRow(stock.ticker, h('input', {
      name: stock.ticker,
      type: 'number',
      step: 'any',
      min: '0',
      inputmode: 'decimal',
      placeholder: t('prices.placeholder'),
      value: stock.price ?? '',
      'aria-label': t('prices.label', { ticker: stock.ticker }),
    }))),
    h('button', { class: 'row row-button action', type: 'submit' }, t('prices.save'))),
  t('prices.footer'));
}

// A dropped minus sign in the list still parses, so the total goes in front of
// the viewer to compare with the broker's own figure before anything is saved.
function unrealizedCheck(rows) {
  const priced = rows.filter((row) => row.current_price_usd !== undefined);
  if (priced.length === 0) return '';

  const cents = priced.reduce(
    (sum, row) => sum + Math.round(row.shares * row.current_price_usd * 100)
      - Math.round(row.total_cost_usd * 100),
    0,
  );
  return `\n\n${t('holdings.check', { amount: signedMoney(cents) })}`;
}

function holdingsForm() {
  const box = h('textarea', {
    class: 'paste-box',
    name: 'holdings',
    rows: 6,
    'aria-label': t('holdings.box'),
    placeholder: 'หุ้น: AAPL\nจำนวนหุ้นคงเหลือ: 10\nต้นทุนต่อหุ้น(USD): 150\nต้นทุนรวม(USD): 1500\nมูลค่า(USD): -50',
  });

  const submit = (event) => {
    event.preventDefault();
    const { rows, errors } = parseHoldings(box.value);
    if (errors.length > 0) {
      setNotice('bad', t('holdings.failed', { errors: listErrors(errors) }));
      render();
      return;
    }

    const listed = new Set(rows.map((row) => row.ticker));
    const sold = state.summary.stocks
      .filter((stock) => stock.tradeCount > 0 && !listed.has(stock.ticker))
      .map((stock) => stock.ticker);
    const question = t('holdings.confirm', { count: rows.length, sold: sold.length });
    if (confirm(`${question}${unrealizedCheck(rows)}`)) {
      run(
        () => state.store.replaceHoldings(rows, sold),
        t('holdings.saved', { count: rows.length }),
      );
    }
  };

  const dates = state.summary.stocks.map((stock) => stock.updatedAt).filter(Boolean).sort();
  const updated = dates.length > 0
    ? t('holdings.updated', { date: formats.date.format(new Date(dates.at(-1))) })
    : '';

  return section(t('holdings.title'), h('form', { class: 'card', onSubmit: submit },
    box,
    h('button', { class: 'row row-button action', type: 'submit' }, t('holdings.save'))),
  `${updated}${t('holdings.footer')}`);
}

function passwordForm() {
  const submit = async (event) => {
    event.preventDefault();
    const password = new FormData(event.target).get('password');
    const { error } = await state.client.auth.updateUser({ password });
    if (error) setNotice('bad', describeError(error));
    else setNotice('good', t('password.saved'));
    render();
  };

  return section(t('password.title'), h('form', { class: 'card', onSubmit: submit },
    formRow(t('password.new'), h('input', {
      name: 'password',
      type: 'password',
      autocomplete: 'new-password',
      minlength: 12,
      required: true,
      placeholder: t('password.hint'),
    })),
    h('button', { class: 'row row-button action', type: 'submit' }, t('password.save'))));
}

function renderMore() {
  return h('div', { class: 'stack' },
    pricesForm(),
    holdingsForm(),
    section(t('data.title'), h('div', { class: 'card' },
      h('label', { class: 'row row-button' },
        h('span', { class: 'row-icon' }, icon('import')),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, t('data.import'))),
        icon('chevron'),
        h('input', {
          class: 'file-input',
          type: 'file',
          accept: '.csv,text/csv',
          'aria-label': t('data.import'),
          onChange: importFile,
        })),
      h('button', { class: 'row row-button', type: 'button', onClick: downloadExport },
        h('span', { class: 'row-icon' }, icon('export')),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, t('data.export'))),
        icon('chevron'))),
    t('data.footer')),
    !isDemo && passwordForm(),
    !isDemo && section(t('account.title'), h('div', { class: 'card' },
      h('div', { class: 'row' },
        h('span', { class: 'row-main' },
          h('span', { class: 'row-subtitle' }, t('account.signedIn')),
          h('span', { class: 'row-title' }, state.email))),
      h('button', {
        class: 'row row-button action destructive',
        type: 'button',
        onClick: () => state.client.auth.signOut(),
      }, t('account.signOut')))));
}

function renderLogin(message, typedEmail = '') {
  const status = h('p', { class: 'login-status', role: 'status' }, message ?? '');
  const email = h('input', {
    name: 'email',
    type: 'email',
    autocomplete: 'username',
    placeholder: 'you@example.com',
    value: typedEmail,
    required: true,
  });
  const password = h('input', {
    name: 'password',
    type: 'password',
    autocomplete: 'current-password',
    placeholder: t('form.required'),
    required: true,
  });

  const submit = async (event) => {
    event.preventDefault();
    const button = event.target.querySelector('button[type=submit]');
    button.disabled = true;
    status.textContent = t('login.signingIn');

    const { error } = await state.client.auth.signInWithPassword({
      email: email.value,
      password: password.value,
    });
    button.disabled = false;
    status.textContent = error ? describeError(error) : '';
  };

  const sendLink = async () => {
    if (!email.reportValidity()) return;
    status.textContent = t('login.sending');

    const { error } = await state.client.auth.signInWithOtp({
      email: email.value,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${location.origin}${location.pathname}`,
      },
    });
    status.textContent = error
      ? describeError(error)
      : t('login.checkEmail');
  };

  document.body.classList.remove('scrolled');
  root.replaceChildren(h('main', { class: 'login enter' },
    h('div', { class: 'orb', 'aria-hidden': 'true' }),
    h('h1', {}, 'Dramedy'),
    h('p', { class: 'login-tagline' }, t('login.tagline')),
    h('form', { class: 'login-form', onSubmit: submit },
      h('div', { class: 'card' }, formRow(t('login.email'), email), formRow(t('login.password'), password)),
      h('button', { class: 'capsule wide', type: 'submit' }, t('login.signIn')),
      h('button', { class: 'text-button', type: 'button', onClick: sendLink }, t('login.link'))),
    status,
    languageSwitch(() => renderLogin('', email.value))));
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
  applyLanguage();
  root.querySelector('.loading').textContent = t('loading');
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
