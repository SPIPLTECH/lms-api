'use strict';

// Builds real PDF files for tests: typed (text layer) and scanned (image only).

const { PDFDocument, StandardFonts } = require('pdf-lib');
const { createCanvas } = require('@napi-rs/canvas');

/** pages: array of arrays of lines. Each page gets a page number footer. */
async function typedPdf(pages) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  pages.forEach((lines, p) => {
    const page = doc.addPage([595, 842]);
    lines.forEach((line, i) => page.drawText(line, { x: 50, y: 780 - i * 18, size: 12, font }));
    page.drawText(String(p + 1), { x: 290, y: 30, size: 10, font });
  });
  return Buffer.from(await doc.save());
}

/** A page that is only a picture of text, like a phone scan. */
async function scannedPdf(lines) {
  const canvas = createCanvas(1240, 140 + lines.length * 70);
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#000000';
  g.font = '40px sans-serif';
  lines.forEach((l, i) => g.fillText(l, 60, 100 + i * 70));
  const jpg = await canvas.encode('jpeg', 92);
  const doc = await PDFDocument.create();
  const img = await doc.embedJpg(jpg);
  const page = doc.addPage([595, (595 * canvas.height) / canvas.width]);
  page.drawImage(img, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  return Buffer.from(await doc.save());
}

/** Typed text plus an embedded picture (e.g. a diagram). */
async function typedWithImagePdf(lines) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  lines.forEach((line, i) => page.drawText(line, { x: 50, y: 780 - i * 18, size: 12, font }));
  const canvas = createCanvas(400, 300);
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, 400, 300);
  g.strokeStyle = '#000'; g.lineWidth = 6; g.strokeRect(40, 40, 320, 220);
  g.beginPath(); g.moveTo(40, 40); g.lineTo(360, 260); g.stroke();
  const img = await doc.embedJpg(await canvas.encode('jpeg', 90));
  page.drawImage(img, { x: 50, y: 300, width: 300, height: 225 });
  return Buffer.from(await doc.save());
}

/** A page with no text and nothing to read. */
async function blankPdf() {
  const doc = await PDFDocument.create();
  doc.addPage([595, 842]);
  return Buffer.from(await doc.save());
}

module.exports = { typedPdf, scannedPdf, typedWithImagePdf, blankPdf };
