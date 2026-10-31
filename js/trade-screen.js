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

const AMOUNT_LINE = /([-+])\s?([\d,]+\.\d{2})\s*USD/;
const DAY = /^\D*(\d{1,2})\s/;
const TIME = /\d{2}:\d{2}:\d{2}/;
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
    sign: match[1],
    amount: Number(match[2].replaceAll(',', '')),
    label: known ?? word,
    knownLabel: Boolean(known) || Boolean(FEE_TYPES[word]),
  };
}

// The day must stand apart from the month. When it runs into the month's letters,
// which read as stray digits, it can't be trusted and is left for checking.
export function readDateLine(text) {
  const day = Number(text.match(DAY)?.[1]);
  const year = Number(text.match(YEAR)?.[1]);
  return {
    day: day >= 1 && day <= 31 ? day : null,
    time: text.match(TIME)?.[0] ?? null,
    year: year >= 60 && year <= 99 ? 2500 + year - BUDDHIST_YEARS : null,
  };
}

// The longest match wins, because มีค would otherwise pass as มค.
export function readMonth(text) {
  const letters = shapeOf(text);
  const matches = MONTH_SHAPES
    .map((shape, index) => ({ shape, index }))
    .filter(({ shape }) => letters.startsWith(shape))
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
    if (row.day !== null && lastDay !== null && row.day > lastDay) monthsBack += 1;
    if (row.day !== null) lastDay = row.day;
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
    const doubtful = outOfOrder || row.day === null || (row.month !== null && row.month !== month);
    if (!doubtful) newest = seconds;

    const pad = (value) => String(value).padStart(2, '0');
    return {
      date: `${year}-${pad(month + 1)}-${pad(row.usedDay)}T${row.time}`,
      doubtful,
    };
  });
}

// Turns what was read from each screenshot into rows to check. Overlapping
// screenshots repeat rows, so each one is kept once.
export function readTradeRows(images, knownTickers) {
  const rows = images.flatMap((lines) => {
    const parsed = lines
      .map((line) => ({ ...line, amountLine: readAmountLine(line.line, knownTickers) }))
      .filter((line) => line.amountLine);
    const dates = settleDates(parsed.map((line) => ({
      ...readDateLine(line.digits),
      month: readMonth(line.month),
    })));

    return parsed.map((line, index) => {
      const { sign, amount, label, knownLabel } = line.amountLine;
      const type = readType(line.thai, label, sign);
      const hasTicker = !type.startsWith('fee_') && TICKER_TYPES.has(type);
      return {
        type,
        ticker: hasTicker ? label : '',
        amount,
        date: dates[index].date ?? '',
        checkDate: dates[index].doubtful,
        checkTicker: hasTicker && !knownLabel,
      };
    });
  });

  return [...new Map(rows.map((row, index) => [
    [row.type, row.ticker, row.amount, row.date || index].join('|'),
    row,
  ])).values()];
}
