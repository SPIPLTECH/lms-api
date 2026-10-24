'use strict';

// PDF text comes out with a line break at the end of every printed line.
// The evaluator treats line breaks as sentence ends, so wrapped lines must be
// rejoined before evaluation or phrases and negation that span a line break
// are lost.

// Lines that are only page furniture: "3", "- 3 -", "Page 3", "Page 3 of 7", "3/7".
const PAGE_NUMBER_LINE = /^\s*(?:page\s*)?[-–(\[]?\s*\d{1,4}\s*(?:(?:of|\/)\s*\d{1,4})?\s*[-–)\]]?\s*$/i;
const ENDS_SENTENCE = /[.!?:;]["')\]]?\s*$/;
const LIST_ITEM = /^\s*(?:[-•*▪●◦]|\(?\d{1,2}[.)]|\(?[a-z][.)])\s+/i;
const MAX_HEADING_LENGTH = 60;

/**
 * Cleans the text of one page:
 *  - drops page-number lines
 *  - rejoins words hyphenated across a line break ("en-" + "ergy")
 *  - keeps blank lines, list items and short headings as separate lines
 *  - joins every other wrapped line with a space
 */
function cleanPageText(raw) {
  const lines = String(raw || '')
    .replace(/\r\n?/g, '\n')
    .replace(/[­]/g, '') // soft hyphens
    .split('\n')
    .map((l) => l.replace(/[ \t\f\v ]+/g, ' ').trim());

  const out = [];
  let current = '';
  const flush = () => {
    if (current) out.push(current);
    current = '';
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line) { flush(); continue; }
    if (PAGE_NUMBER_LINE.test(line)) continue;

    if (!current) { current = line; }
    else if (/[a-z]-$/i.test(current) && /^[a-z]/.test(line)) {
      // "en-" + "ergy." -> "energy." (only before a lower-case continuation)
      current = current.slice(0, -1) + line;
    } else if (LIST_ITEM.test(line)) {
      flush();
      current = line;
    } else {
      current = `${current} ${line}`;
    }

    // A short line without end punctuation followed by a capitalised line
    // is a heading ("Answer 2", "Conclusion"): keep it on its own line.
    const next = lines[i + 1];
    if (current === line && line.length <= MAX_HEADING_LENGTH && !ENDS_SENTENCE.test(line)
      && !/-$/.test(line) && next && /^[A-Z]/.test(next) && !LIST_ITEM.test(line)) {
      flush();
    }
  }
  flush();
  return out.join('\n');
}

/** Cleans every page and joins them; a sentence may continue onto the next page. */
function cleanPdfText(pageTexts) {
  const pages = pageTexts.map(cleanPageText).filter(Boolean);
  let text = '';
  for (const page of pages) {
    if (!text) { text = page; continue; }
    if (/[a-z]-$/i.test(text) && /^[a-z]/.test(page)) text = text.slice(0, -1) + page;
    else if (!ENDS_SENTENCE.test(text) && /^[a-z]/.test(page)) text = `${text} ${page}`;
    else text = `${text}\n${page}`;
  }
  return text.trim();
}

/** Number of letters and digits; whitespace and punctuation do not count as readable text. */
function readableLength(text) {
  return (String(text || '').match(/[\p{L}\p{N}]/gu) || []).length;
}

module.exports = { cleanPageText, cleanPdfText, readableLength, };
