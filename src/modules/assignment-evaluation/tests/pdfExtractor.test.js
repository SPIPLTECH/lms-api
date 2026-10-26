'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createPdfExtractor } = require('../pdf/pdfExtractor');
const { typedPdf, scannedPdf, typedWithImagePdf, blankPdf } = require('./makePdf');

const extractor = createPdfExtractor({ ocrCachePath: path.resolve(__dirname, '../../../../.cache/tesseract') });
after(() => extractor.close());

test('typed PDF: text layer is read and cleaned, nothing to review', async () => {
  const pdf = await typedPdf([
    ['In photosynthesis chlorophyll absorbs light en-', 'ergy. Carbon dioxide and water are converted', 'into glucose and oxygen.'],
  ]);
  const r = await extractor.extract(pdf);
  assert.equal(r.method, 'TEXT');
  assert.equal(r.pageCount, 1);
  assert.equal(r.text, 'In photosynthesis chlorophyll absorbs light energy. Carbon dioxide and water are converted into glucose and oxygen.');
  assert.deepEqual(r.reviewReasons, []);
  assert.equal(r.hasImages, false);
});

test('multi-page typed PDF joins a sentence split across pages and drops page numbers', async () => {
  const r = await extractor.extract(await typedPdf([['Light energy is converted'], ['into chemical energy.']]));
  assert.equal(r.text, 'Light energy is converted into chemical energy.');
  assert.equal(r.pageCount, 2);
});

test('scanned PDF: read by OCR and always flagged for review', async () => {
  const r = await extractor.extract(await scannedPdf(['Chlorophyll absorbs light energy.', 'Carbon dioxide and water make glucose.']));
  assert.equal(r.method, 'OCR');
  assert.deepEqual(r.ocrPages, [1]);
  assert.match(r.text.toLowerCase(), /chlorophyll absorbs light energy/);
  assert.ok(r.ocrConfidence > 0.5 && r.ocrConfidence <= 1, `confidence ${r.ocrConfidence}`);
  assert.match(r.reviewReasons[0], /OCR/);
});

test('embedded images are reported for review', async () => {
  const r = await extractor.extract(await typedWithImagePdf(['See the diagram below.']));
  assert.equal(r.method, 'TEXT');
  assert.equal(r.hasImages, true);
  assert.ok(r.reviewReasons.some((x) => /images/.test(x)));
});

test('a PDF with no readable text is flagged, not treated as an empty answer', async () => {
  const r = await extractor.extract(await blankPdf());
  assert.equal(r.method, 'NONE');
  assert.equal(r.text, '');
  assert.match(r.reviewReasons[0], /No readable text/);
});

test('non-PDF data and broken PDFs are rejected with a clear message', async () => {
  await assert.rejects(extractor.extract(Buffer.from('hello, I am not a PDF')), /not a PDF/);
  await assert.rejects(extractor.extract(Buffer.from('%PDF-1.7\nthis is garbage')), (err) => err.status === 400);
});

test('page limit is enforced', async () => {
  const small = createPdfExtractor({ maxPages: 1, ocrEnabled: false });
  await assert.rejects(small.extract(await typedPdf([['a page'], ['another page']])), /limit is 1/);
});

test('with OCR switched off, scanned pages are flagged instead of read', async () => {
  const noOcr = createPdfExtractor({ ocrEnabled: false });
  const r = await noOcr.extract(await scannedPdf(['Some handwritten looking text.']));
  assert.equal(r.method, 'NONE');
  assert.ok(r.reviewReasons.some((x) => /OCR is switched off/.test(x)));
});
