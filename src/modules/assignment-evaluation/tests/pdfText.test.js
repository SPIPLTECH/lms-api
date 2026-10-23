'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanPageText, cleanPdfText, readableLength } = require('../pdf/pdfText');

test('wrapped lines are joined into one sentence', () => {
  assert.equal(
    cleanPageText('Carbon dioxide and water are converted\ninto glucose and oxygen.'),
    'Carbon dioxide and water are converted into glucose and oxygen.',
  );
});

test('words hyphenated across a line break are rejoined', () => {
  assert.equal(cleanPageText('chlorophyll absorbs light en-\nergy.'), 'chlorophyll absorbs light energy.');
});

test('a hyphen before a capitalised line is kept as a separate word', () => {
  assert.equal(cleanPageText('Newton-\nRaphson method'), 'Newton- Raphson method');
});

test('page-number lines are removed', () => {
  for (const footer of ['3', '- 3 -', 'Page 3', 'page 3 of 7', '3/7', '(3)']) {
    assert.equal(cleanPageText(`Plants make food.\n${footer}`), 'Plants make food.', footer);
  }
});

test('blank lines, list items and short headings stay on their own lines', () => {
  const raw = 'Answer 2\nPlants need light.\n\nSecond paragraph starts here\nand continues.\n- first point\n- second point';
  assert.equal(cleanPageText(raw), 'Answer 2\nPlants need light.\nSecond paragraph starts here and continues.\n- first point\n- second point');
});

test('a sentence continuing onto the next page is joined', () => {
  assert.equal(cleanPdfText(['Light energy is converted', 'into chemical energy.']), 'Light energy is converted into chemical energy.');
  assert.equal(cleanPdfText(['First page ends.', 'Second page starts.']), 'First page ends.\nSecond page starts.');
});

test('readableLength ignores whitespace and punctuation', () => {
  assert.equal(readableLength(' \n -- . -- \n'), 0);
  assert.equal(readableLength(' \n -- 1 of 1 -- \n'), 4);
  assert.equal(readableLength('CO₂ is a gas.'), 9);
});
