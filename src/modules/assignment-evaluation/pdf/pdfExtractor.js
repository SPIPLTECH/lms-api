'use strict';

const fs = require('fs');
const { PDFParse } = require('pdf-parse');
const { cleanPdfText, readableLength } = require('./pdfText');
const ApiError = require('../../../utils/ApiError');

const badRequest = (message) => new ApiError(400, message);

const PDF_MAGIC = Buffer.from('%PDF-');

/** "Page 3" / "Pages 2, 5" for review messages. */
const pagesLabel = (nums) => `${nums.length === 1 ? 'Page' : 'Pages'} ${nums.join(', ')}`;

/**
 * Reads the text of a PDF answer, locally (no external services):
 *  1. the PDF's own text layer (typed documents)
 *  2. OCR with Tesseract for pages without a text layer (scanned pages)
 *
 * Returns the cleaned text plus everything an instructor needs to judge how
 * far that text can be trusted. OCR output, missing text and embedded images
 * always produce review reasons, so such answers are never auto-published.
 */
function createPdfExtractor({
  maxPages = 30,
  ocrEnabled = true,
  ocrMaxPages = 10,
  ocrCachePath,
  ocrLanguage = 'eng',
  // A page with fewer readable characters than this is treated as scanned.
  minPageChars = 20,
  maxTextChars = 20000,
} = {}) {
  let workerPromise = null;
  let queue = Promise.resolve();

  async function getWorker() {
    if (!workerPromise) {
      workerPromise = (async () => {
        // eslint-disable-next-line global-require
        const { createWorker } = require('tesseract.js');
        if (ocrCachePath) fs.mkdirSync(ocrCachePath, { recursive: true });
        return createWorker(ocrLanguage, 1, ocrCachePath ? { cachePath: ocrCachePath } : {});
      })().catch((err) => { workerPromise = null; throw err; });
    }
    return workerPromise;
  }

  /** One OCR job at a time: Tesseract is CPU-bound and this keeps memory flat. */
  function recognize(image) {
    const job = queue.then(async () => {
      const worker = await getWorker();
      const { data } = await worker.recognize(image);
      return { text: data.text || '', confidence: data.confidence };
    });
    queue = job.catch(() => {});
    return job;
  }

  async function extract(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length < 8 || !buffer.subarray(0, 5).equals(PDF_MAGIC)) {
      throw badRequest('The file is not a PDF.');
    }

    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      let pages;
      try {
        const result = await parser.getText();
        pages = result.pages.map((p) => ({ num: p.num, text: p.text || '' }));
      } catch (err) {
        if (/password/i.test(err.name) || /password/i.test(err.message)) {
          throw badRequest('The PDF is password-protected. Upload a version without a password.');
        }
        throw badRequest('The PDF could not be read. It may be damaged.');
      }
      if (!pages.length) throw badRequest('The PDF has no pages.');
      if (pages.length > maxPages) throw badRequest(`The PDF has ${pages.length} pages; the limit is ${maxPages}.`);

      const reviewReasons = [];
      const needOcr = pages.filter((p) => readableLength(p.text) < minPageChars).map((p) => p.num);
      const ocrPages = [];
      const confidences = [];

      if (needOcr.length && ocrEnabled) {
        const toRead = needOcr.slice(0, ocrMaxPages);
        if (needOcr.length > ocrMaxPages) {
          reviewReasons.push(`Only the first ${ocrMaxPages} scanned pages were read; ${pagesLabel(needOcr.slice(ocrMaxPages)).toLowerCase()} could not be read.`);
        }
        const shots = await parser.getScreenshot({ partial: toRead, scale: 2, imageDataUrl: false, imageBuffer: true });
        for (const shot of shots.pages) {
          const { text, confidence } = await recognize(Buffer.from(shot.data));
          const page = pages.find((p) => p.num === shot.pageNumber);
          if (readableLength(text) > readableLength(page.text)) {
            page.text = text;
            ocrPages.push(shot.pageNumber);
            confidences.push(confidence);
          }
        }
      } else if (needOcr.length) {
        reviewReasons.push(`${pagesLabel(needOcr)} ${needOcr.length === 1 ? 'has' : 'have'} no text layer and OCR is switched off.`);
      }

      // Embedded images on pages that were not OCR'd may hold diagrams,
      // equations or handwritten work the evaluator cannot read.
      let hasImages = false;
      const textPages = pages.map((p) => p.num).filter((n) => !ocrPages.includes(n));
      if (textPages.length) {
        try {
          const imgs = await parser.getImage({ partial: textPages, imageThreshold: 80, imageDataUrl: false, imageBuffer: false });
          hasImages = imgs.pages.some((p) => p.images.length > 0);
        } catch {
          hasImages = false;
        }
      }

      let text = cleanPdfText(pages.sort((a, b) => a.num - b.num).map((p) => p.text));
      let truncated = false;
      if (text.length > maxTextChars) {
        text = text.slice(0, maxTextChars);
        truncated = true;
      }

      const ocrConfidence = confidences.length
        ? Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length) / 100
        : null;
      const anyText = readableLength(text) > 0;
      let method;
      if (!anyText) method = 'NONE';
      else if (!ocrPages.length) method = 'TEXT';
      else if (ocrPages.length === pages.length) method = 'OCR';
      else method = 'MIXED';

      if (method === 'NONE') {
        reviewReasons.unshift('No readable text was found in the PDF. Mark it from the original file.');
      } else if (ocrPages.length) {
        reviewReasons.unshift(`${pagesLabel(ocrPages)} ${ocrPages.length === 1 ? 'was a scanned image' : 'were scanned images'} read by OCR (confidence ${Math.round((ocrConfidence || 0) * 100)}%). Compare the text with the original PDF.`);
      }
      if (hasImages) reviewReasons.push('The PDF contains images (diagrams, photos or handwriting) that the evaluator cannot read.');
      if (truncated) reviewReasons.push(`The PDF text was longer than ${maxTextChars} characters; only the first ${maxTextChars} were evaluated.`);

      return {
        text,
        pageCount: pages.length,
        method,
        ocrPages,
        ocrConfidence,
        hasImages,
        truncated,
        reviewReasons,
      };
    } finally {
      await parser.destroy().catch(() => {});
    }
  }

  async function close() {
    if (workerPromise) {
      const w = await workerPromise.catch(() => null);
      workerPromise = null;
      if (w) await w.terminate();
    }
  }

  return { extract, close };
}

module.exports = { createPdfExtractor };
