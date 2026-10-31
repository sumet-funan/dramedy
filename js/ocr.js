// Reads screenshots inside the browser, so they never leave the device. The
// engine is large, so it only loads when someone picks an image.

import { MONTH_LETTERS } from './trade-screen.js';

const ENGINE = new URL('../vendor/tesseract', import.meta.url).href;
const SINGLE_BLOCK = '6';
const SINGLE_LINE = '7';

// Only tickers and figures matter, and this stops the Thai labels on the screen
// being read as lookalike letters.
const CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,%()+- ';

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

export async function readImages(files, onProgress) {
  const worker = await startWorker('eng');

  try {
    await worker.setParameters({ tessedit_char_whitelist: CHARACTERS });
    const texts = [];
    for (const [index, file] of files.entries()) {
      onProgress(index + 1);
      const { data } = await worker.recognize(file);
      texts.push(data.text);
    }
    return texts;
  } finally {
    await worker.terminate();
  }
}

const ROW_CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,+- ';
const DATE_CHARACTERS = '0123456789:. -';

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

// Each row's amount line locates its date line below it and its Thai title to the left.
function rowCrops(bitmap, usd) {
  const height = usd.bbox.y1 - usd.bbox.y0;
  const dateTop = usd.bbox.y1 + Math.round(height * 0.55);
  const dateHeight = Math.min(Math.round(height * 1.9), bitmap.height - dateTop);
  if (dateHeight < 8) return null;

  const dateLeft = Math.max(0, usd.bbox.x1 - Math.round(bitmap.width * 0.346));
  const titleTop = Math.max(0, usd.bbox.y0 - Math.round(height / 3));
  return {
    date: cleanedCrop(bitmap, {
      left: dateLeft,
      top: dateTop,
      width: Math.min(Math.round(bitmap.width * 0.357), bitmap.width - dateLeft),
      height: dateHeight,
    }, 3),
    title: cleanedCrop(bitmap, {
      left: Math.round(bitmap.width * 0.2),
      top: titleTop,
      width: Math.round(bitmap.width * 0.34),
      height: height * 2,
    }, 2),
  };
}

async function readEach(worker, parameters, crops) {
  await worker.setParameters(parameters);
  const texts = [];
  for (const crop of crops) {
    const { data } = await worker.recognize(crop);
    texts.push(data.text);
  }
  return texts;
}

// Returns what each screenshot's rows say. Making sense of it is left to
// trade-screen.js, so that part can be tested without images.
export async function readTradeImages(files, onProgress) {
  const english = await startWorker('eng');
  const thai = await startWorker('tha');

  try {
    const images = [];
    for (const [index, file] of files.entries()) {
      onProgress(index + 1);
      const bitmap = await createImageBitmap(file);
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
        .map((row) => ({ ...row, crops: rowCrops(bitmap, row.usd) }))
        .filter((row) => row.crops);

      const dates = rows.map((row) => row.crops.date);
      const digits = await readEach(english, {
        tessedit_pageseg_mode: SINGLE_LINE,
        tessedit_char_whitelist: DATE_CHARACTERS,
      }, dates);
      const months = await readEach(thai, {
        tessedit_pageseg_mode: SINGLE_LINE,
        tessedit_char_whitelist: `${DATE_CHARACTERS}${MONTH_LETTERS}`,
      }, dates);
      const titles = await readEach(thai, {
        tessedit_pageseg_mode: SINGLE_LINE,
        tessedit_char_whitelist: '',
      }, rows.map((row) => row.crops.title));

      bitmap.close();
      images.push(rows.map((row, i) => ({
        line: row.line,
        digits: digits[i].trim(),
        month: months[i].trim(),
        thai: titles[i].replace(/\s/g, ''),
      })));
    }
    return images;
  } finally {
    await english.terminate();
    await thai.terminate();
  }
}
