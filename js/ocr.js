// Reads screenshots inside the browser, so they never leave the device. The
// engine is large, so it only loads when someone picks an image.

const ENGINE = new URL('../vendor/tesseract', import.meta.url).href;

// Only tickers and figures matter, and this stops the Thai labels on the screen
// being read as lookalike letters.
const CHARACTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,%()+- ';

export async function readImages(files, onProgress) {
  const { default: Tesseract } = await import('../vendor/tesseract/tesseract.esm.min.js');
  const worker = await Tesseract.createWorker('eng', 1, {
    workerPath: `${ENGINE}/worker.min.js`,
    corePath: `${ENGINE}/tesseract-core-simd-lstm.wasm.js`,
    langPath: ENGINE,
    gzip: false,
    workerBlobURL: false,
  });

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
