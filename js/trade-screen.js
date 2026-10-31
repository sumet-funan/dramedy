// Turns text read from the broker's history screen into rows. Pure, so it can be
// tested without images. The screen lists rows newest first, with amounts in
// English and dates in Thai such as "5 มิ.ย. 69 - 10:00:00 น.".

const MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];
// The short and long vowels look alike in this font, so they count as one.
const shapeOf = (text) => text.replace(/[^ก-๙]/g, '').replaceAll('ี', 'ิ');
const MONTH_SHAPES = MONTHS.map(shapeOf);
const FEE_TYPES = { SEC: 'fee_sec', TAF: 'fee_taf', CAT: 'fee_cat' };
const BUDDHIST_YEARS = 543;
const TICKER_TYPES = new Set(['buy', 'sell', 'dividend', 'withholding']);

const AMOUNT_LINE = /([-+])?\s?([\d,]+\.\d{2})\s*USD/;
const DAY = /^\D*(\d{1,2})\s/;
const WORDED_DAY = /^\D*?(\d{1,2})(?=\s|[ก-๙])/;
export const TIME = /(?:^|\D)(\d{2}:\d{2}:\d{2})(?!\d)/;
const YEAR = /(\d{2})\s*-?\s*\d{2}:/;

export const MONTH_LETTERS = [...new Set(MONTHS.join('').replaceAll('.', ''))].join('');

// A line such as "AAAA -12.34 USD", or null if it isn't a row. The Thai word in
// front of a ticker reads as stray letters, as in "O0AAAA", so a ticker already
// known is looked for at the end of the word. Anything else is marked as a guess.
export function readAmountLine(text, knownTickers = []) {
  const match = text.match(AMOUNT_LINE);
  if (!match) return null;

  const words = text.slice(0, match.index).match(/[A-Z0-9][A-Z0-9.-]+/g) ?? [];
  const word = words.at(-1) ?? '';
  const known = [...knownTickers]
    .sort((a, b) => b.length - a.length)
    .find((ticker) => word.endsWith(ticker));

  return {
    sign: match[1] ?? null,
    amount: Number(match[2].replaceAll(',', '')),
    label: known ?? word,
    knownLabel: Boolean(known) || Boolean(FEE_TYPES[word]),
    noComma: /\d{4}/.test(match[2]),
  };
}

// The amount is read a second time, enlarged on its own, which catches a misread
// digit and finds a lost sign. The broker writes a comma from 1,000 up, so a large
// amount without one has picked up a digit. Whatever doesn't add up is left for
// checking, because a wrong amount gives no other sign of itself.
export function settleAmount(first, again) {
  const read = again ?? first;
  const sign = first?.sign ?? again?.sign ?? null;
  const differ = Boolean(first && again) && first.amount !== again.amount;
  return {
    sign,
    amount: read.amount,
    checkAmount: !first || !sign || differ || read.noComma,
  };
}

// The Thai reading keeps the day apart from the month, while the digits alone give
// the cleanest time. When the day runs into the month's letters in the digits, which
// read as stray digits, it can't be trusted there and is left for checking. A digit
// gets lost far more often than one appears, so the longer day wins, and between
// two of the same length the digits do. A day in dispute or a time only the Thai
// reading found comes back unsure.
export function readDateLine(digits, worded = '') {
  const digitDay = digits.match(DAY)?.[1] ?? '';
  const wordedDay = worded.match(WORDED_DAY)?.[1] ?? '';
  const day = Number(wordedDay.length > digitDay.length ? wordedDay : digitDay);
  const digitTime = digits.match(TIME)?.[1];
  const year = Number(digits.match(YEAR)?.[1] ?? worded.match(YEAR)?.[1]);
  return {
    day: day >= 1 && day <= 31 ? day : null,
    time: digitTime ?? worded.match(TIME)?.[1] ?? null,
    year: year >= 60 && year <= 99 ? 2500 + year - BUDDHIST_YEARS : null,
    unsure: !digitTime || (digitDay.length === wordedDay.length && digitDay !== wordedDay),
  };
}

// The longest match wins, because มีค would otherwise pass as มค.
export function readMonth(text) {
  const letters = shapeOf(text);
  const matches = MONTH_SHAPES
    .map((shape, index) => ({ shape, index }))
    .filter(({ shape }) => letters.includes(shape))
    .sort((a, b) => b.shape.length - a.shape.length);
  return matches[0]?.index ?? null;
}

export function readType(thai, label, sign) {
  if (FEE_TYPES[label]) return FEE_TYPES[label];
  if (/ป.{0,2}นผล/.test(thai)) return 'dividend';
  if (/ภาษี/.test(thai)) return 'withholding';
  if (/ถอน/.test(thai)) return 'withdrawal';
  if (/คืน/.test(thai)) return 'commission_refund';
  if (/แลก/.test(thai)) return sign === '+' ? 'fx_in' : 'fx_out';
  if (/โอน|ฝาก/.test(thai) || !label) return sign === '+' ? 'deposit' : 'withdrawal';
  return sign === '+' ? 'sell' : 'buy';
}

const stamp = ({ monthCount, day, time }) => monthCount * 31 * 86400
  + day * 86400
  + Number(time.slice(0, 2)) * 3600
  + Number(time.slice(3, 5)) * 60
  + Number(time.slice(6, 8));

function mostCommon(values) {
  const counts = new Map();
  values.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

// A month is the hardest thing to read, so one reading doesn't decide it. Rows run
// newest first, so a day that rises means the month before, and each month read
// on the screen votes for where the list starts. Rows that don't fit the vote or
// the time order, or whose day had to be guessed, come back marked for checking.
export function settleDates(rows) {
  let monthsBack = 0;
  let lastDay = null;
  const placed = rows.map((row) => {
    // With no time the whole line was misread, so its day says nothing about the rest.
    const day = row.time === null ? null : row.day;
    if (day !== null && lastDay !== null && day > lastDay) monthsBack += 1;
    if (day !== null) lastDay = day;
    return { ...row, monthsBack, usedDay: row.day ?? lastDay };
  });

  const start = mostCommon(placed
    .filter((row) => row.month !== null && row.year !== null)
    .map((row) => row.year * 12 + row.month + row.monthsBack));

  let newest = null;
  return placed.map((row) => {
    if (start === null || row.usedDay === null || row.time === null) {
      return { date: null, doubtful: true };
    }

    const monthCount = start - row.monthsBack;
    const year = Math.floor(monthCount / 12);
    const month = monthCount % 12;
    const seconds = stamp({ monthCount, day: row.usedDay, time: row.time });
    const outOfOrder = newest !== null && seconds > newest;
    const doubtful = outOfOrder || row.day === null || Boolean(row.unsure)
      || (row.month !== null && row.month !== month);
    if (!doubtful) newest = seconds;

    const pad = (value) => String(value).padStart(2, '0');
    return {
      date: `${year}-${pad(month + 1)}-${pad(row.usedDay)}T${row.time}`,
      doubtful,
    };
  });
}

// With no sign read at all, the title's first letter tells a sale from a purchase.
const SALE_TITLE = /^[ขบ]/;

function readRow(line, knownTickers) {
  const first = readAmountLine(line.line, knownTickers);
  const again = readAmountLine(line.again ?? '');
  if (!first && !again) return null;

  const { label, knownLabel } = first ?? again;
  return {
    ...line, ...settleAmount(first, again), label, knownLabel: Boolean(first) && knownLabel,
  };
}

// Turns what was read from each screenshot into rows to check. Overlapping
// screenshots repeat rows, so each one is kept once.
export function readTradeRows(images, knownTickers) {
  const rows = images.flatMap((lines) => {
    const parsed = lines.map((line) => readRow(line, knownTickers)).filter(Boolean);
    const dates = settleDates(parsed.map((line) => ({
      ...readDateLine(line.digits, line.month),
      month: readMonth(line.month),
    })));

    return parsed.map((line, index) => {
      const sign = line.sign ?? (SALE_TITLE.test(line.thai) ? '+' : '-');
      const type = readType(line.thai, line.label, sign);
      const hasTicker = !type.startsWith('fee_') && TICKER_TYPES.has(type);
      return {
        type,
        ticker: hasTicker ? line.label : '',
        amount: line.amount,
        date: dates[index].date ?? '',
        checkAmount: line.checkAmount,
        checkDate: dates[index].doubtful,
        checkTicker: hasTicker && !line.knownLabel,
      };
    });
  });

  return [...new Map(rows.map((row, index) => [
    [row.type, row.ticker, row.amount, row.date || index].join('|'),
    row,
  ])).values()];
}
