'use strict';

const { stem } = require('./stemmer');
const { NEGATORS, STOPWORDS, SCOPE_BREAKERS } = require('./stopwords');

// How many tokens back a negator can reach ("does not really need light").
const NEGATION_WINDOW = 4;

const CONTRACTIONS = [
  [/\bcan't\b/g, 'can not'],
  [/\bwon't\b/g, 'will not'],
  [/\bshan't\b/g, 'shall not'],
  [/\bain't\b/g, 'is not'],
  [/n't\b/g, ' not'],
  [/'re\b/g, ' are'],
  [/'ve\b/g, ' have'],
  [/'ll\b/g, ' will'],
  [/'d\b/g, ' would'],
  [/'m\b/g, ' am'],
  [/'s\b/g, ''],
  [/\bcannot\b/g, 'can not'],
];

/**
 * Lower-cases and cleans text: Unicode compatibility folding (CO₂ -> co2),
 * curly quotes, contractions, and hyphenated words split into parts.
 */
function normalizeText(text) {
  if (text === null || text === undefined) return '';
  let t = String(text).normalize('NFKC').toLowerCase();
  t = t.replace(/[‘’‛′`]/g, "'").replace(/[“”″]/g, '"');
  for (const [re, rep] of CONTRACTIONS) t = t.replace(re, rep);
  t = t.replace(/'/g, '');
  // "light-dependent" -> "light dependent"; a free-standing dash stays a clause break.
  t = t.replace(/([a-z0-9])[-‐‑]([a-z0-9])/g, '$1 $2');
  t = t.replace(/[‒-―]/g, ' - ');
  return t.replace(/[ \t\r\f\v]+/g, ' ').trim();
}

const TOKEN_RE = /[a-z0-9]+(?:\.\d+)?|[.!?;\n]|[,:()\-\[\]]/g;
const SENTENCE_BREAK = new Set(['.', '!', '?', ';', '\n']);

function stemToken(surface) {
  return /^[a-z]+$/.test(surface) ? stem(surface) : surface;
}

/**
 * Splits normalized text into word tokens with sentence and clause indices.
 * Punctuation is consumed as boundaries and never becomes a token.
 */
function tokenizeWords(text) {
  const normalized = normalizeText(text);
  const words = [];
  let sentence = 0;
  let clause = 0;
  let sentenceHasWords = false;
  for (const m of normalized.matchAll(TOKEN_RE)) {
    const tok = m[0];
    if (SENTENCE_BREAK.has(tok)) {
      if (sentenceHasWords) { sentence += 1; clause += 1; sentenceHasWords = false; }
      continue;
    }
    if (tok.length === 1 && /[,:()\-\[\]]/.test(tok)) {
      if (sentenceHasWords) clause += 1;
      continue;
    }
    words.push({ surface: tok, stem: stemToken(tok), sentence, clause });
    sentenceHasWords = true;
  }
  return { normalized, words };
}

/**
 * Marks each token whose meaning is inverted by a negator earlier in the
 * same clause. Uses parity, so "can not make food without light" leaves
 * "light" un-negated (two negators cancel).
 */
function markNegation(tokens) {
  for (let i = 0; i < tokens.length; i += 1) {
    const tok = tokens[i];
    if (tok.isNegator) { tok.negated = false; continue; }
    let count = 0;
    for (let j = i - 1; j >= 0 && j >= i - NEGATION_WINDOW; j -= 1) {
      const prev = tokens[j];
      if (prev.clause !== tok.clause) break;
      if (SCOPE_BREAKERS.has(prev.surface)) break;
      if (prev.isNegator) {
        // "not only X but also Y" is emphasis, not negation.
        const next = tokens[j + 1];
        if (prev.surface === 'not' && next && next.surface === 'only') continue;
        count += 1;
      }
    }
    tok.negated = count % 2 === 1;
  }
}

/**
 * Full analysis used by every matcher. The synonym dictionary (optional)
 * collapses equivalent terms ("co2", "carbon dioxide") into one canonical
 * token so later stages compare meanings, not spellings.
 */
function analyze(text, { synonyms = null } = {}) {
  const { normalized, words } = tokenizeWords(text);
  let tokens = words.map((w) => ({
    ...w,
    canon: w.stem,
    viaSynonym: false,
    sourceStems: [w.stem],
  }));
  if (synonyms) tokens = synonyms.canonicalize(tokens);

  tokens.forEach((t, i) => {
    t.i = i;
    t.isNegator = !t.viaSynonym && NEGATORS.has(t.surface);
    t.isStop = !t.viaSynonym && !t.isNegator && STOPWORDS.has(t.surface);
  });
  markNegation(tokens);

  const content = tokens.filter((t) => !t.isStop && !t.isNegator);
  const sentenceCount = tokens.length ? tokens[tokens.length - 1].sentence + 1 : 0;
  const sentences = [];
  for (let s = 0; s < sentenceCount; s += 1) {
    const sTokens = tokens.filter((t) => t.sentence === s);
    if (!sTokens.length) continue;
    sentences.push({
      index: s,
      tokens: sTokens,
      content: sTokens.filter((t) => !t.isStop && !t.isNegator),
      text: sTokens.map((t) => t.surface).join(' '),
    });
  }

  return {
    raw: text == null ? '' : String(text),
    normalized,
    tokens,
    content,
    sentences,
    wordCount: tokens.length,
    stopwordRatio: tokens.length ? tokens.filter((t) => t.isStop).length / tokens.length : 0,
  };
}

/** Splits raw text into sentence strings, keeping decimals like 9.8 intact. */
function splitSentences(text) {
  return String(text || '')
    // A period is a decimal point only with digits on both sides ("9.8").
    .split(/(?<!\d)[.!?]+|[.!?]+(?!\d)|[;\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

module.exports = { normalizeText, tokenizeWords, analyze, splitSentences, stemToken, NEGATION_WINDOW };
