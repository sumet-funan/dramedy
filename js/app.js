import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from './config.js';
import {
  BANGKOK_OFFSET_MS, monthOf, summarize, toCents,
} from './calc.js';
import { CHECK_FIELDS, firstChecks, settleChecks } from './checks.js';
import {
  costsAgree, isPositiveType, needsTicker, normalizeRow, parseBackup, parseCsv, readHoldings,
  toBackup, toCsv, usesShares,
} from './csv.js';
import { demoData } from './demo.js';
import { DUPLICATE_ROW, fillsShares, findDuplicates } from './duplicates.js';
import {
  LANGUAGES, applyLanguage, currentLanguage, plural, setLanguage, t,
} from './i18n.js';
import { icon } from './icons.js';
import { readTradeImages } from './ocr.js';
import { createDemoStore, createSupabaseStore } from './store.js';
import { readTradeRows } from './trade-screen.js';

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
const ADD_MODES = ['trade', 'holdings'];

// Long enough for a browser to finish fetching a saved file.
const DOWNLOAD_WINDOW_MS = 60000;
const TYPING_PAUSE_MS = 200;

const root = document.getElementById('app');
const isDemo = new URLSearchParams(location.search).has('demo');

const state = {
  client: null,
  store: null,
  email: '',
  view: 'overview',
  stockFilter: 'all',
  addMode: 'trade',
  holdingDraft: [],
  holdingNote: '',
  holdingAsOf: '',
  tradeDraft: [],
  tradeNote: '',
  manualTrade: null,
  readingImages: false,
  tradeSearch: '',
  tradeType: '',
  openTrade: null,
  transactions: [],
  statuses: {},
  holdings: {},
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
const shareText = (shares) => shares.toLocaleString('en-US', { maximumSignificantDigits: 15 });

// Shows every digit a figure has, with at least the two of a dollar amount.
function exactMoney(value) {
  const places = Math.max(2, String(value).split('.')[1]?.length ?? 0);
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  })}`;
}

const signedExact = (value) => {
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${exactMoney(Math.abs(value))}`;
};
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

// A price worked out from a result is a division that may never end.
const priceText = (price) => `$${price.toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
})}`;
const monthDate = (key) => new Date(`${key}-01T00:00:00Z`);
const monthLabel = (key) => formats.month.format(monthDate(key));
const typeLabel = (type) => t(`type.${type}`);

function bangkokNowForInput() {
  return new Date(Date.now() + BANGKOK_OFFSET_MS).toISOString().slice(0, 19);
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
  if (/^Functions/.test(error?.name)) return t('sync.error');
  if (error?.code === 'invalid_credentials') {
    return t('error.credentials');
  }
  if (error?.code === DUPLICATE_ROW) return t('error.duplicate');
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return t('error.network');
  }
  return message;
}

// Nothing of one account may carry over to whoever signs in next.
function clearAccount() {
  Object.assign(state, {
    store: null,
    email: '',
    view: 'overview',
    holdingDraft: [],
    holdingNote: '',
    holdingAsOf: '',
    tradeDraft: [],
    tradeNote: '',
    manualTrade: null,
    tradeSearch: '',
    tradeType: '',
    openTrade: null,
    transactions: [],
    statuses: {},
    holdings: {},
    summary: null,
    notice: null,
  });
}

async function refresh() {
  const { transactions, statuses, holdings } = await state.store.load();
  state.transactions = transactions;
  state.statuses = statuses;
  state.holdings = holdings;
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

function segmented(label, options, current, labelOf, pick) {
  return h('div', { class: 'segmented', role: 'group', 'aria-label': label },
    options.map((option) => h('button', {
      type: 'button',
      'aria-pressed': current === option ? 'true' : 'false',
      onClick: () => {
        pick(option);
        render();
      },
    }, labelOf(option))));
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
    h('button', { class: 'capsule', type: 'button', onClick: () => goTo('add') }, t('empty.action')));
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
  if (state.transactions.length === 0 && s.heldCount === 0) return emptyState();

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

// Marking a held stock as sold deletes its saved shares, cost and price.
function confirmSold(stock) {
  return confirm(t('status.confirmSold', {
    ticker: stock.ticker,
    shares: shareText(stock.sharesHeld),
    cost: exactMoney(stock.totalCost),
  }));
}

function statusPicker(stock) {
  return h('select', {
    class: 'pill-select',
    'aria-label': t('status.label', { ticker: stock.ticker }),
    onChange: (event) => {
      const status = event.target.value;
      if (status === 'sold' && stock.fromHolding && !confirmSold(stock)) {
        event.target.value = stock.status;
        return;
      }
      run(
        () => state.store.setStatus(stock.ticker, status),
        t('status.updated', { ticker: stock.ticker }),
      );
    },
  },
  stock.status === 'review' && h('option', {
    value: 'review', selected: true, disabled: true, hidden: true,
  }, t('status.review')),
  h('option', { value: 'holding', selected: stock.status === 'holding' }, t('status.holding')),
  h('option', { value: 'sold', selected: stock.status === 'sold' }, t('status.sold')));
}

// With no cost per share given, the broker's four decimal places are the nearest
// a division can come.
const costPerShare = (stock) => stock.perShare
  ?? Number((stock.totalCost / stock.sharesHeld).toFixed(4));

function heldFacts(stock) {
  return t('stock.held', {
    shares: shareText(stock.sharesHeld),
    cost: exactMoney(costPerShare(stock)),
    total: exactMoney(stock.totalCost),
  });
}

function priceFacts(stock) {
  if (stock.price === null) return t('stock.noPrice');
  const facts = { price: priceText(stock.price), value: exactMoney(stock.valueUsd) };
  return stock.priceUpdatedAt
    ? t('stock.priceOn', { ...facts, day: formats.day.format(new Date(stock.priceUpdatedAt)) })
    : t('stock.price', facts);
}

function stockAmounts(stock) {
  if (stock.fromHolding) {
    const hasPrice = stock.unrealized !== null;
    return [
      h('span', { class: `row-amount ${hasPrice ? toneOf(stock.unrealized) : ''}` },
        hasPrice ? signedExact(stock.unrealizedUsd) : exactMoney(stock.totalCost)),
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
      usesTradeShares && stock.sharesHeld > 0 && h('span', { class: 'row-subtitle' },
        t('stock.sharesHeld', { shares: shareText(stock.sharesHeld) })),
      stock.oversold && h('span', { class: 'row-warning' },
        icon('alert'), t('stock.oversold')),
      stock.outdated && h('span', { class: 'row-warning' },
        icon('alert'), t('stock.outdated')),
      usesTradeShares
        ? h('span', { class: 'row-subtitle' }, t('stock.fromShares'))
        : statusPicker(stock)),
    h('div', { class: 'row-end' }, stockAmounts(stock)));
}

// Prices come from the server, because market sites don't answer browsers directly.
function syncPrices(event) {
  const button = event.currentTarget;
  button.disabled = true;
  button.querySelector('.row-subtitle').textContent = t('sync.running');

  return run(async () => {
    // A stock closed by later trades keeps its saved row, but has no price to show.
    const held = new Set(
      state.summary.stocks.filter((stock) => stock.fromHolding).map((stock) => stock.ticker),
    );
    const { prices, failed } = await state.store.fetchPrices();
    const changes = Object.entries(prices)
      .filter(([ticker]) => held.has(ticker))
      .map(([ticker, price]) => ({ ticker, price }));
    if (changes.length === 0) throw new Error(t('sync.none'));
    await state.store.setPrices(changes);
    return { updated: changes.length, failed: failed.filter((ticker) => held.has(ticker)) };
  }, ({ updated, failed }) => [
    plural('sync.done', updated),
    failed.length > 0 && t('sync.missed', { tickers: failed.join(', ') }),
  ].filter(Boolean).join(' '));
}

function syncButton() {
  const dates = state.summary.stocks.map((stock) => stock.priceUpdatedAt).filter(Boolean).sort();

  return h('button', { class: 'card row row-button', type: 'button', onClick: syncPrices },
    h('span', { class: 'row-icon' }, icon('sync')),
    h('span', { class: 'row-main' },
      h('span', { class: 'row-title' }, t('sync.title')),
      h('span', { class: 'row-subtitle' }, dates.length > 0
        ? t('sync.last', { date: formats.date.format(new Date(dates.at(-1))) })
        : t('sync.never'))));
}

function renderStocks() {
  const stocks = state.summary.stocks.filter(
    (stock) => state.stockFilter === 'all' || stock.status === state.stockFilter,
  );

  return h('div', { class: 'stack' },
    state.summary.heldCount > 0 && syncButton(),
    segmented(t('filter.label'), STOCK_FILTERS, state.stockFilter, (filter) => t(`filter.${filter}`), (filter) => {
      state.stockFilter = filter;
    }),
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
  const cents = toCents(tx.amount_usd);
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
      tx.shares && h('p', {}, t('trade.shares', { shares: shareText(Number(tx.shares)) })),
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

const SIMILAR_SHOWN = 5;

// Two rows can honestly match, such as equal fees on one day, so the viewer decides.
function confirmSimilar(rows) {
  const similar = findDuplicates(rows, state.transactions)
    .filter((found) => found?.kind === 'similar');
  if (similar.length === 0) return true;

  const lines = similar.slice(0, SIMILAR_SHOWN).map(({ match }) => [
    typeLabel(match.type),
    match.ticker,
    money(toCents(match.amount_usd)),
    formats.date.format(new Date(match.occurred_at)),
  ].filter(Boolean).join(' · '));
  const more = similar.length > SIMILAR_SHOWN
    ? [t('error.more', { count: similar.length - SIMILAR_SHOWN }).trim()]
    : [];
  return confirm(`${plural('data.confirmSimilar', similar.length)}\n\n${[...lines, ...more].join('\n')}`);
}

const importedText = ({ added, filled }, total) => [
  t('data.imported', { added, skipped: total - added }),
  filled > 0 && t('data.filled', { count: filled }),
].filter(Boolean).join(' ');

function submitTrade(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  const type = form.get('type');
  const amount = Math.abs(Number(form.get('amount')));

  const { row, error } = normalizeRow({
    type,
    occurred_at: `${form.get('occurred_at')}+07:00`,
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

  const [found] = findDuplicates([row], state.transactions);
  if (fillsShares(row, found)) {
    run(() => state.store.importRows([row]), (saved) => {
      state.manualTrade = null;
      return importedText(saved, 1);
    });
    return;
  }
  if (found?.kind === 'same') {
    setNotice('bad', t('error.duplicate'));
    render();
    return;
  }
  if (confirmSimilar([row])) {
    run(() => state.store.add(row), () => {
      state.manualTrade = null;
      return t('trade.added');
    });
  }
}

function formRow(label, control) {
  return h('label', { class: 'form-row' }, h('span', {}, label), control);
}

function renderAdd() {
  return h('div', { class: 'stack' },
    segmented(t('add.label'), ADD_MODES, state.addMode, (mode) => t(`add.${mode}`), (mode) => {
      state.addMode = mode;
    }),
    state.addMode === 'holdings' && holdingsForm(),
    state.addMode === 'trade' && state.tradeDraft.length > 0 && tradeReview(),
    state.addMode === 'trade' && state.tradeDraft.length === 0 && tradeImport(),
    state.addMode === 'trade' && state.tradeDraft.length === 0 && tradeForm());
}

function tradeImport() {
  const note = h('p', {
    class: 'row-warning holding-note',
    role: 'status',
    hidden: !state.tradeNote,
  }, state.tradeNote);

  const show = (text) => {
    state.tradeNote = text;
    note.textContent = text;
    note.hidden = !text;
  };

  const importImages = async (event) => {
    const files = [...event.target.files];
    event.target.value = '';
    if (files.length === 0) return;

    state.readingImages = true;
    event.target.disabled = true;
    show(t('image.loading'));
    try {
      const images = await readTradeImages(files, (current) => {
        show(t('image.reading', { current, total: files.length }));
      });
      const known = state.summary.stocks.map((stock) => stock.ticker);
      const rows = readTradeRows(images, known);
      if (rows.length === 0) {
        show(t('tradeImage.none'));
        return;
      }

      state.tradeDraft = rows;
      state.tradeNote = plural('tradeImage.read', rows.length);
    } catch (error) {
      show(`${t('image.failed')} ${describeError(error)}`);
    } finally {
      state.readingImages = false;
      render();
    }
  };

  return section(null, h('div', { class: 'card' },
    note,
    h('label', { class: 'row row-button action' }, t('image.import'), h('input', {
      class: 'file-input',
      type: 'file',
      accept: 'image/*',
      multiple: true,
      'aria-label': t('image.import'),
      disabled: state.readingImages,
      onChange: importImages,
    }))), t('tradeImage.overlap'));
}

const CHECK_TEXT = {
  amount: () => t('tradeImage.checkAmount'),
  date: () => t('tradeImage.checkDate'),
  ticker: () => t('tradeImage.checkTicker'),
  figures: () => t('holdings.checkFigures'),
};

const checksOf = (row) => (row.dataset.checks || '').split(' ').filter(Boolean);
const unsettled = (row, field) => settleChecks(checksOf(row), field);

function showChecks(row, checks) {
  row.dataset.checks = checks.join(' ');
  row.classList.toggle('bad', checks.length > 0);
  row.querySelector('.holding-checked').hidden = checks.length === 0;
  if (checks.length > 0) {
    const hint = row.querySelector('.holding-hint');
    hint.textContent = checks.map((check) => CHECK_TEXT[check]()).join(' · ');
    hint.hidden = false;
  }
}

const checkedButton = (onClick) => h('button', {
  class: 'text-button holding-checked',
  type: 'button',
  hidden: true,
  onClick,
}, t('check.done'));

const waitingRows = (list) => [...list.children].filter((row) => checksOf(row).length > 0);

// The button stays pressable while rows wait, so it can lead to the next one.
function showWaiting(list, button, label) {
  const count = waitingRows(list).length;
  button.textContent = count > 0 ? plural('check.waiting', count) : label;
  button.classList.toggle('waiting', count > 0);
}

function readyToSave(list) {
  const [next] = waitingRows(list);
  next?.scrollIntoView({ block: 'center' });
  return !next;
}

function settleRow(row, field) {
  row.querySelector('.holding-hint').hidden = true;
  showChecks(row, unsettled(row, field));
}

function markRow(row, message) {
  row.classList.add('bad');
  const hint = row.querySelector('.holding-hint');
  hint.textContent = message;
  hint.hidden = false;
}

const tickerInput = (value) => h('input', {
  class: 'holding-ticker',
  name: 'ticker',
  value: value ?? '',
  placeholder: t('form.ticker'),
  'aria-label': t('form.ticker'),
  autocapitalize: 'characters',
  autocomplete: 'off',
  maxlength: 10,
});

const removeButton = (onClick) => h('button', {
  class: 'holding-remove',
  type: 'button',
  'aria-label': t('holdings.remove'),
  onClick,
}, icon('close'));

function reviewRow(entry, onRemove, onChecked) {
  const hint = h('p', { class: 'holding-hint', hidden: true });
  const match = h('p', { class: 'holding-match', hidden: true });
  const settle = (field) => settleRow(row, field);

  const refresh = () => {
    const type = fieldOf(row, 'type').value;
    fieldOf(row, 'ticker').hidden = !needsTicker(type);
    fieldOf(row, 'shares').closest('label').hidden = !usesShares(type);
    if (!needsTicker(type)) settle('ticker');
  };

  const row = h('li', {
    class: 'holding',
    'data-checks': firstChecks(entry).join(' '),
    onInput: (event) => settle(event.target.name),
    onChange: refresh,
  },
  h('div', { class: 'holding-head' },
    h('select', { class: 'pill-select', name: 'type', 'aria-label': t('form.type') },
      TRADE_TYPES.map((value) => h('option', {
        value,
        selected: value === entry.type,
      }, typeLabel(value)))),
    tickerInput(entry.ticker),
    removeButton(() => onRemove(row))),
  hint,
  checkedButton(() => {
    const ticker = checksOf(row).includes('ticker') ? tickerOf(row) : '';
    row.dataset.checks = '';
    settle('');
    onChecked(ticker);
  }),
  match,
  h('div', { class: 'holding-fields review' },
    holdingField('date', t('form.date'), {
      type: 'datetime-local', step: '1', required: true, value: entry.date ?? '',
    }),
    holdingField('amount', t('form.amount'), {
      min: '0.01', step: '0.01', inputmode: 'decimal', required: true, value: entry.amount ?? '',
    }),
    holdingField('shares', t('form.shares'), {
      min: '0', inputmode: 'decimal', placeholder: t('form.optional'), value: entry.shares ?? '',
    })));

  settle('');
  refresh();
  return row;
}

const reviewEntry = (row) => ({
  ...Object.fromEntries(
    [...row.querySelectorAll('input, select')].map((field) => [field.name, field.value.trim()]),
  ),
  checks: checksOf(row),
});

function reviewedRow(entry) {
  const amount = Math.abs(Number(entry.amount));
  return normalizeRow({
    type: entry.type,
    occurred_at: `${entry.date}+07:00`,
    ticker: entry.ticker,
    amount_usd: isPositiveType(entry.type) ? amount : -amount,
    shares: entry.shares,
    note: '',
  });
}

function matchText(row, found) {
  if (found?.kind === 'similar') {
    return t('tradeImage.similar', { time: formats.date.format(new Date(found.match.occurred_at)) });
  }
  const fills = fillsShares(row, found);
  return found ? t(fills ? 'tradeImage.fill' : 'tradeImage.same') : '';
}

function tradeReview() {
  let typing = null;

  const finish = () => {
    clearTimeout(typing);
    state.tradeDraft = [];
    state.tradeNote = '';
  };

  const saveDraft = () => {
    state.tradeDraft = [...list.children].map(reviewEntry);
  };

  const note = h('p', { class: 'row-warning holding-note', role: 'status' }, state.tradeNote);
  const matches = h('p', { class: 'row-warning holding-note', role: 'status', hidden: true });

  // Pairing runs across the list, so one row's edit can change another's match.
  const showMatches = () => {
    const items = [...list.children].map((item) => ({ item, ...reviewedRow(reviewEntry(item)) }));
    const ready = items.filter(({ row }) => row);
    const found = findDuplicates(ready.map(({ row }) => row), state.transactions);
    const text = new Map(ready.map(({ item, row }, index) => [item, matchText(row, found[index])]));
    const kind = new Map(ready.map(({ item }, index) => [item, found[index]?.kind]));

    for (const { item } of items) {
      const line = item.querySelector('.holding-match');
      line.textContent = text.get(item) ?? '';
      line.hidden = !line.textContent;
      item.classList.toggle('similar', kind.get(item) === 'similar');
    }

    const count = (wanted) => found.filter((match) => match?.kind === wanted).length;
    const waiting = waitingRows(list).length;
    matches.textContent = [
      waiting > 0 && t('tradeImage.doubtful', { count: waiting }),
      count('same') > 0 && t('tradeImage.sameCount', { count: count('same') }),
      count('similar') > 0 && t('tradeImage.similarCount', { count: count('similar') }),
    ].filter(Boolean).join(' ');
    matches.hidden = !matches.textContent;
  };

  const removeRow = (row) => {
    row.remove();
    saveDraft();
    if (state.tradeDraft.length === 0) {
      finish();
      render();
    } else {
      showProgress();
    }
  };

  const update = () => {
    clearTimeout(typing);
    if (!list.isConnected) return;
    saveDraft();
    showProgress();
  };

  // Each update rereads every row, so typing waits for a pause.
  const typed = () => {
    clearTimeout(typing);
    typing = setTimeout(update, TYPING_PAUSE_MS);
  };

  // Checking a ticker once vouches for it on every row that reads the same.
  const confirmTicker = (ticker) => {
    [...list.children]
      .filter((row) => ticker && tickerOf(row) === ticker)
      .forEach((row) => settleRow(row, 'ticker'));
    update();
  };

  const list = h('ul', {}, state.tradeDraft.map((entry) => (
    reviewRow(entry, removeRow, confirmTicker)
  )));
  const save = h('button', { class: 'capsule wide', type: 'submit' });

  const showProgress = () => {
    showMatches();
    showWaiting(list, save, t('tradeImage.save'));
  };

  const cancel = () => {
    if (confirm(t('tradeImage.confirmCancel'))) {
      finish();
      render();
    }
  };

  const submit = (event) => {
    event.preventDefault();
    if (!readyToSave(list)) return;

    const items = [...list.children];
    const results = items.map(reviewEntry).map(reviewedRow);

    const problems = results
      .map(({ error }, index) => ({ error, index }))
      .filter(({ error }) => error);
    if (problems.length > 0) {
      problems.forEach(({ error, index }) => markRow(items[index], error));
      items[problems[0].index].scrollIntoView({ block: 'center' });
      return;
    }

    const rows = results.map(({ row }) => row);
    if (!confirmSimilar(rows)) return;

    run(() => state.store.importRows(rows), (saved) => {
      finish();
      return importedText(saved, rows.length);
    });
  };

  showProgress();

  return h('form', { class: 'stack', onSubmit: submit, onInput: typed, onChange: update },
    section(null, h('div', { class: 'card' }, note, matches, list), t('tradeImage.footer')),
    save,
    h('button', { class: 'text-button', type: 'button', onClick: cancel }, t('tradeImage.cancel')));
}

function tradeForm() {
  const draft = state.manualTrade ?? {};

  const ticker = formRow(t('form.ticker'), h('input', {
    name: 'ticker',
    value: draft.ticker,
    placeholder: t('form.required'),
    autocapitalize: 'characters',
    autocomplete: 'off',
    maxlength: 10,
  }));
  const shares = formRow(t('form.shares'), h('input', {
    name: 'shares',
    value: draft.shares,
    type: 'number',
    step: 'any',
    min: '0',
    inputmode: 'decimal',
    placeholder: t('form.required'),
  }));

  const syncFields = (type) => {
    ticker.hidden = !needsTicker(type);
    ticker.querySelector('input').required = needsTicker(type);
    // Holdings carry on from each trade, which takes a share count.
    shares.hidden = !usesShares(type);
    shares.querySelector('input').required = !shares.hidden;
  };
  syncFields(draft.type ?? 'buy');

  // Rendering rebuilds the form, so what's typed has to live outside it.
  const keepDraft = (event) => {
    state.manualTrade = Object.fromEntries(new FormData(event.currentTarget));
  };

  return h('form', { class: 'stack', onSubmit: submitTrade, onInput: keepDraft },
    section(null, h('div', { class: 'card' },
      formRow(t('form.type'), h('select', {
        name: 'type',
        onChange: (event) => syncFields(event.target.value),
      }, TRADE_TYPES.map((value) => h('option', {
        value,
        selected: value === draft.type,
      }, typeLabel(value))))),
      ticker,
      formRow(t('form.amount'), h('input', {
        name: 'amount',
        value: draft.amount,
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
        name: 'occurred_at',
        type: 'datetime-local',
        step: '1',
        value: draft.occurred_at ?? bangkokNowForInput(),
        required: true,
      })),
      formRow(t('form.note'), h('input', {
        name: 'note', value: draft.note, maxlength: 500, placeholder: t('form.optional'),
      }))),
    t('form.timezone')),
    h('button', { class: 'capsule wide', type: 'submit' }, t('form.save')));
}

// Safari starts fetching after the click returns, so the address has to outlive it.
function saveFile(prefix, extension, text, type) {
  const link = h('a', {
    href: URL.createObjectURL(new Blob([text], { type })),
    download: `${prefix}-${new Date().toISOString().slice(0, 10)}.${extension}`,
  });
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), DOWNLOAD_WINDOW_MS);
}

function downloadExport() {
  saveFile('dramedy-trades', 'csv', toCsv(state.transactions), 'text/csv');
  setNotice('good', t('data.exported', { count: state.transactions.length }));
  render();
}

function downloadBackup() {
  const backup = toBackup(state, new Date().toISOString());
  saveFile('dramedy-backup', 'json', backup, 'application/json');
  setNotice('good', t('data.backedUp', {
    trades: state.transactions.length,
    holdings: Object.keys(state.holdings).length,
  }));
  render();
}

function restoreFile(text) {
  const backup = parseBackup(text);
  const { rows, holdings, statuses, errors, exportedAt } = backup;
  if (errors.length > 0) {
    const more = errors.length > 3 ? t('error.more', { count: errors.length - 3 }) : '';
    setNotice('bad', t('data.importFailed', { errors: listErrors(errors), more }));
    render();
    return undefined;
  }

  const counts = { holdings: holdings.length, statuses: statuses.length };
  const date = formats.date.format(new Date(exportedAt));
  if (!confirm(t('data.confirmRestore', { ...counts, date, trades: rows.length }))) return undefined;

  return run(
    () => state.store.restoreBackup(backup),
    (saved) => `${importedText(saved, rows.length)} ${t('data.restored', counts)}`,
  );
}

async function importFile(event) {
  const [file] = event.target.files;
  if (!file) return;
  event.target.value = '';

  const text = await file.text();
  if (file.name.toLowerCase().endsWith('.json')) {
    await restoreFile(text);
    return;
  }

  const { rows, errors } = parseCsv(text);
  if (errors.length > 0) {
    const more = errors.length > 3 ? t('error.more', { count: errors.length - 3 }) : '';
    setNotice('bad', t('data.importFailed', { errors: listErrors(errors), more }));
    render();
    return;
  }

  if (!confirmSimilar(rows)) return;

  await run(
    () => state.store.importRows(rows),
    (saved) => importedText(saved, rows.length),
  );
}

// A dropped minus sign still saves, so the total goes in front of the viewer to
// compare with the broker's own figure before anything is saved.
function unrealizedCheck(entries) {
  const filled = entries.filter((entry) => entry.unrealized !== '');
  if (filled.length === 0) return '';

  const cents = filled.reduce((sum, entry) => sum + toCents(entry.unrealized), 0);
  return `\n\n${t('holdings.check', { amount: signedMoney(cents) })}`;
}

function holdingField(name, label, props = {}) {
  return h('label', { class: 'holding-field' },
    h('span', {}, label),
    h('input', {
      name, type: 'number', step: 'any', ...props,
    }));
}

const fieldOf = (row, name) => row.querySelector(`[name=${name}]`);
const tickerOf = (row) => fieldOf(row, 'ticker').value.trim().toUpperCase();

const holdingEntry = (row) => ({
  ...Object.fromEntries(
    [...row.querySelectorAll('input')].map((input) => [input.name, input.value.trim()]),
  ),
  checks: checksOf(row),
});

// Shares, cost per share and total cost have to fit each other, so a mistyped one
// shows as soon as it's entered.
function figuresOff(row) {
  const { shares, perShare, total } = holdingEntry(row);
  return shares !== '' && perShare !== '' && total !== '' && !costsAgree({
    shares: Number(shares), perShare: Number(perShare), total: Number(total),
  });
}

function holdingRow(saved, entry, onRemove, onChecked) {
  const hint = h('p', { class: 'holding-hint', hidden: true });

  // A held stock shows its saved figures as placeholders, because leaving a
  // field blank keeps exactly that figure.
  const refresh = (event) => {
    const ticker = tickerOf(row);
    const held = saved[ticker];
    hint.hidden = ticker === '';
    hint.textContent = held
      ? t('holdings.heldHint', { shares: shareText(held.shares) })
      : t('holdings.newHint');
    fieldOf(row, 'shares').placeholder = held?.shares ?? t('form.required');
    fieldOf(row, 'perShare').placeholder = held?.perShare ?? t('form.optional');
    fieldOf(row, 'total').placeholder = held?.total ?? t('form.required');
    fieldOf(row, 'unrealized').placeholder = held?.unrealized ?? t('form.optional');

    const field = event?.target.name;
    const checks = unsettled(row, field);
    const recheck = CHECK_FIELDS.figures.includes(field) && figuresOff(row);
    showChecks(row, recheck ? [...checks, 'figures'] : checks);
  };

  const row = h('li', {
    class: 'holding',
    'data-checks': (entry.checks ?? []).join(' '),
    onInput: refresh,
  },
    h('div', { class: 'holding-head' },
      tickerInput(entry.ticker),
      removeButton(() => onRemove(row))),
    hint,
    checkedButton(() => {
      row.dataset.checks = '';
      refresh();
      onChecked();
    }),
    h('div', { class: 'holding-fields' },
      holdingField('shares', t('holdings.shares'), {
        min: '0', inputmode: 'decimal', value: entry.shares ?? '',
      }),
      holdingField('perShare', t('holdings.perShare'), {
        min: '0', inputmode: 'decimal', value: entry.perShare ?? '',
      }),
      holdingField('total', t('holdings.total'), {
        min: '0', inputmode: 'decimal', value: entry.total ?? '',
      }),
      // No inputmode here, because the decimal keypad on iPhones has no minus key.
      holdingField('unrealized', t('holdings.amount'), { value: entry.unrealized ?? '' })));
  refresh();
  return row;
}

function savedHoldings() {
  const held = state.summary.stocks.filter((stock) => stock.fromHolding);
  return Object.fromEntries(held.map((stock) => [
    stock.ticker,
    {
      shares: stock.sharesHeld,
      total: stock.totalCost,
      price: stock.price,
      outdated: stock.outdated,
      perShare: costPerShare(stock),
      unrealized: stock.unrealizedUsd ?? undefined,
    },
  ]));
}

// One line per stock, so the viewer can see what a save replaces before it does.
function changeLine(row, held) {
  const {
    ticker, shares, total_cost_usd: total, current_price_usd: price,
  } = row;
  if (!held) {
    return t('holdings.newLine', {
      ticker, shares: shareText(shares), cost: exactMoney(total),
    });
  }

  const current = price ?? held.price;
  const result = current === null ? undefined : Number((current * shares - total).toFixed(10));
  const resultText = (value) => (value === undefined ? '—' : signedExact(value));
  const changes = [
    shares !== held.shares && t('holdings.sharesChange', { from: held.shares, to: shares }),
    total !== held.total && t('holdings.costChange', {
      from: exactMoney(held.total), to: exactMoney(total),
    }),
    result !== held.unrealized && t('holdings.resultChange', {
      from: resultText(held.unrealized), to: resultText(result),
    }),
  ].filter(Boolean);

  return `${ticker}: ${changes.join(' · ') || t('holdings.noChange')}`;
}

function holdingsForm() {
  const saved = savedHoldings();

  const saveDraft = () => {
    state.holdingDraft = [...list.children].map(holdingEntry);
    showWaiting(list, save, t('holdings.save'));
  };

  const note = h('p', {
    class: 'row-warning holding-note',
    role: 'status',
    hidden: !state.holdingNote,
  }, state.holdingNote);

  const show = (text) => {
    state.holdingNote = text;
    note.textContent = text;
    note.hidden = !text;
  };

  const removeRow = (row) => {
    row.remove();
    if (list.children.length === 0) list.append(newRow({}));
    show('');
    saveDraft();
  };

  const newRow = (entry) => holdingRow(saved, entry, removeRow, saveDraft);
  const start = state.holdingDraft.length > 0 ? state.holdingDraft : [{}];
  const list = h('ul', {}, start.map(newRow));
  const save = h('button', { class: 'capsule wide', type: 'submit' });

  const addRow = () => {
    const row = newRow({});
    list.append(row);
    row.querySelector('input').focus();
    saveDraft();
  };

  const markProblems = (problems) => {
    const rows = [...list.children];
    problems.forEach(({ index, message }) => markRow(rows[index], message));
    if (problems.length > 0) rows[problems[0].index].scrollIntoView({ block: 'center' });
  };

  const submit = (event) => {
    event.preventDefault();
    if (!readyToSave(list)) return;

    const entries = [...list.children].map(holdingEntry);
    const { rows, errors, problems } = readHoldings(entries, saved);

    // Shown in place, because rendering again would throw away what was typed.
    if (errors.length > 0) {
      show(t('holdings.failed', { errors: listErrors(errors) }));
      markProblems(problems);
      return;
    }
    // Left alone, the figures are as of the moment they're saved.
    const takenAt = state.holdingAsOf
      ? new Date(`${state.holdingAsOf}+07:00`).toISOString()
      : new Date().toISOString();
    if (Date.parse(takenAt) > Date.now()) {
      show(t('holdings.failed', { errors: t('holdings.futureAsOf') }));
      return;
    }
    show('');

    const lines = rows.map((row) => changeLine(row, saved[row.ticker]));
    if (confirm(`${t('holdings.confirm')}\n\n${lines.join('\n')}${unrealizedCheck(entries)}`)) {
      run(() => state.store.saveHoldings(rows, takenAt), () => {
        state.holdingDraft = [];
        state.holdingAsOf = '';
        return t('holdings.saved', { count: rows.length });
      });
    }
  };

  showWaiting(list, save, t('holdings.save'));

  return h('form', { class: 'stack', onSubmit: submit, onInput: saveDraft },
    section(null, h('div', { class: 'card' },
      list,
      note,
      h('button', { class: 'row row-button action', type: 'button', onClick: addRow }, t('holdings.add'))),
    t('holdings.footer')),
    section(null, h('div', { class: 'card' },
      formRow(t('holdings.asOf'), h('input', {
        type: 'datetime-local',
        step: '1',
        value: state.holdingAsOf || bangkokNowForInput(),
        onInput: (event) => {
          state.holdingAsOf = event.target.value;
        },
      }))), t('holdings.asOfHint')),
    save);
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
    section(t('data.title'), h('div', { class: 'card' },
      h('label', { class: 'row row-button' },
        h('span', { class: 'row-icon' }, icon('import')),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, t('data.import'))),
        icon('chevron'),
        h('input', {
          class: 'file-input',
          type: 'file',
          accept: '.csv,text/csv,.json,application/json',
          'aria-label': t('data.import'),
          onChange: importFile,
        })),
      h('button', { class: 'row row-button', type: 'button', onClick: downloadBackup },
        h('span', { class: 'row-icon' }, icon('export')),
        h('span', { class: 'row-main' }, h('span', { class: 'row-title' }, t('data.backup'))),
        icon('chevron')),
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
    return true;
  } catch (error) {
    renderLogin(describeError(error));
    return false;
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
        clearAccount();
        renderLogin();
      } else if (openedFor !== session.user.id) {
        openedFor = session.user.id;
        // A failed load leaves the sign-in form up, and signing in again must retry.
        openApp(session).then((opened) => {
          if (!opened) openedFor = null;
        });
      }
    });
  });
}

start();
