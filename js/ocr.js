// Reads screenshots inside the browser, so they never leave the device. The
// engine is large, so it only loads when someone picks an image.

import { MONTH_LETTERS, TIME, TRADE_TITLE } from './trade-screen.js';

const ENGINE = new URL('../vendor/tesseract', import.meta.url).href;
const SINGLE_BLOCK = '6';
const SINGLE_LINE = '7';

async function startWorker(language) {
  const { default: Tesseract } = await import('../vendor/tesseract/tesseract.esm.min.js');
  return Tesseract.createWorker(language, 1, {
    workerPath: `${ENGINE}/worker.min.js`,
    corePath: `${ENGINE}/tesseract-core-simd-lstm.wasm.js`,
    langPath: ENGINE,
    gzip: false,
    workerBlobURL: false,
  });
}

// Only tickers and figures matter, and this stops the Thai labels on the screen
// being read as lookalike letters.
const ROW_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,+- ';
const DATE_CHARACTERS = '0123456789:. -';
const AMOUNT_CHARACTERS = '0123456789.,+-USD ';
const TICKER_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-';

// Small grey text on black reads far better enlarged and as dark on light.
function cleanedCrop(bitmap, box, scale) {
  const canvas = document.createElement('canvas');
  canvas.width = box.width * scale;
  canvas.height = box.height * scale;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.imageSmoothingQuality = 'high';
  context.drawImage(
    bitmap, box.left, box.top, box.width, box.height, 0, 0, canvas.width, canvas.height,
  );

  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = image;
  const greys = new Float32Array(data.length / 4);
  let total = 0;
  for (let i = 0; i < greys.length; i++) {
    greys[i] = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2];
    total += greys[i];
  }

  const dark = total / greys.length < 128;
  const lowest = greys.reduce((low, grey) => Math.min(low, grey), 255);
  const highest = greys.reduce((high, grey) => Math.max(high, grey), 0);
  const range = Math.max(1, highest - lowest);
  greys.forEach((grey, i) => {
    const level = ((grey - lowest) / range) * 255;
    const value = dark ? 255 - level : level;
    data[i * 4] = value;
    data[i * 4 + 1] = value;
    data[i * 4 + 2] = value;
  });
  context.putImageData(image, 0, 0);
  return canvas;
}

// Each row's amount line locates its date line below it and its Thai title to the
// left. A date cut off by the screen edge has no crop, and its row stays in the list
// for checking, because the next screenshot may not repeat it.
function rowCrops(bitmap, usd) {
  const height = usd.bbox.y1 - usd.bbox.y0;
  const dateTop = usd.bbox.y1 + Math.round(height * 0.55);
  const dateHeight = Math.min(Math.round(height * 1.9), bitmap.height - dateTop);
  const hasDate = dateHeight >= 8;

  const dateLeft = Math.max(0, usd.bbox.x1 - Math.round(bitmap.width * 0.346));
  const titleTop = Math.max(0, usd.bbox.y0 - Math.round(height / 3));
  const amountLeft = Math.max(0, usd.bbox.x1 - Math.round(bitmap.width * 0.42));
  const dateBox = (top) => ({
    left: dateLeft,
    top,
    width: Math.min(Math.round(bitmap.width * 0.357), bitmap.width - dateLeft),
    height: dateHeight,
  });
  const lowerTop = dateTop + dateHeight + Math.round(height / 2);

  return {
    date: hasDate ? cleanedCrop(bitmap, dateBox(dateTop), 3) : null,
    // A title on two lines pushes the date one line down.
    lowerDate: hasDate && lowerTop + dateHeight <= bitmap.height
      ? cleanedCrop(bitmap, dateBox(lowerTop), 3)
      : null,
    amount: cleanedCrop(bitmap, {
      left: amountLeft,
      top: titleTop,
      width: Math.min(usd.bbox.x1 + Math.round(height / 2), bitmap.width) - amountLeft,
      height: height * 2,
    }, 3),
    title: cleanedCrop(bitmap, {
      left: Math.round(bitmap.width * 0.2),
      top: titleTop,
      width: Math.round(bitmap.width * 0.34),
      height: height * 2,
    }, 2),
    // On a buy or sell row, the ticker starts just after the short Thai word.
    ticker: cleanedCrop(bitmap, {
      left: Math.round(bitmap.width * 0.28),
      top: titleTop,
      width: Math.round(bitmap.width * 0.3),
      height: height * 2,
    }, 3),
  };
}

async function readEach(worker, parameters, crops) {
  await worker.setParameters(parameters);
  const texts = [];
  for (const crop of crops) {
    const { data } = crop ? await worker.recognize(crop) : { data: { text: '' } };
    texts.push(data.text);
  }
  return texts;
}

async function readTradeImage(file, english, thai) {
  const bitmap = await createImageBitmap(file);

  try {
    await english.setParameters({
      tessedit_pageseg_mode: SINGLE_BLOCK,
      tessedit_char_whitelist: ROW_CHARACTERS,
    });
    const { data } = await english.recognize(file, {}, { blocks: true });

    const rows = data.blocks
      .flatMap((block) => block.paragraphs)
      .flatMap((paragraph) => paragraph.lines)
      .map((line) => ({
        line: line.text.trim(),
        usd: line.words.find((word) => word.text.includes('USD')),
      }))
      .filter((row) => row.usd)
      .map((row) => ({ ...row, crops: rowCrops(bitmap, row.usd) }));

    const digitsOnly = {
      tessedit_pageseg_mode: SINGLE_LINE,
      tessedit_char_whitelist: DATE_CHARACTERS,
    };
    const dateWords = {
      tessedit_pageseg_mode: SINGLE_LINE,
      tessedit_char_whitelist: `${DATE_CHARACTERS}${MONTH_LETTERS}`,
    };
    const dates = rows.map((row) => row.crops.date);
    const digits = await readEach(english, digitsOnly, dates);
    const months = await readEach(thai, dateWords, dates);

    const lower = rows.flatMap((row, i) => (
      row.crops.lowerDate && !TIME.test(digits[i]) && !TIME.test(months[i]) ? [i] : []
    ));
    const lowerDates = lower.map((i) => rows[i].crops.lowerDate);
    const lowerDigits = await readEach(english, digitsOnly, lowerDates);
    const lowerMonths = await readEach(thai, dateWords, lowerDates);
    lower.forEach((rowIndex, i) => {
      digits[rowIndex] = lowerDigits[i];
      months[rowIndex] = lowerMonths[i];
    });

    const amounts = await readEach(english, {
      tessedit_pageseg_mode: SINGLE_LINE,
      tessedit_char_whitelist: AMOUNT_CHARACTERS,
    }, rows.map((row) => row.crops.amount));
    const titles = (await readEach(thai, {
      tessedit_pageseg_mode: SINGLE_LINE,
      tessedit_char_whitelist: '',
    }, rows.map((row) => row.crops.title))).map((title) => title.replace(/\s/g, ''));
    const tickers = await readEach(english, {
      tessedit_pageseg_mode: SINGLE_LINE,
      tessedit_char_whitelist: TICKER_CHARACTERS,
    }, rows.map((row, i) => (TRADE_TITLE.test(titles[i]) ? row.crops.ticker : null)));

    return rows.map((row, i) => ({
      line: row.line,
      again: amounts[i].trim(),
      ticker: tickers[i].trim(),
      digits: digits[i].trim(),
      month: months[i].trim(),
      thai: titles[i],
    }));
  } finally {
    bitmap.close();
  }
}

// Returns what each screenshot's rows say. Making sense of it is left to
// trade-screen.js, so that part can be tested without images.
export async function readTradeImages(files, onProgress) {
  let english;
  let thai;

  try {
    english = await startWorker('eng');
    thai = await startWorker('tha');

    const images = [];
    for (const [index, file] of files.entries()) {
      onProgress(index + 1);
      images.push(await readTradeImage(file, english, thai));
    }
    return images;
  } finally {
    await english?.terminate();
    await thai?.terminate();
  }
}
