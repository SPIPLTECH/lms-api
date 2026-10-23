'use strict';

const { prepareTerm, lcsMatch, spanText } = require('../keywords/termMatching');

// Matched words spread over more than this many tokens (relative to phrase
// length) are treated as a looser match.
const SPREAD_FACTOR = 2;
const SPREAD_PENALTY = 0.85;
// Phrases scoring at least this much are checked for polarity conflicts.
const POLARITY_CHECK_MIN = 0.5;
// All words present but in a different order: "chemical energy into light
// energy" versus "light energy into chemical energy". Meant for short
// instructor-written phrases, where order carries the relationship. Callers
// switch it off for whole model-answer sentences, which students can
// legitimately reorder ("heat from the sun makes water evaporate").
const ORDER_MISMATCH = { minUnordered: 0.8, maxOrdered: 0.6, minLength: 3, maxLength: 8 };

function unorderedCoverage(seq, tokens) {
  const pool = tokens.map((t) => t.canon);
  let hits = 0;
  for (const c of seq) {
    const idx = pool.indexOf(c);
    if (idx !== -1) { hits += 1; pool.splice(idx, 1); }
  }
  return hits / seq.length;
}

/**
 * Scores how completely a reference phrase appears in the answer, sentence by
 * sentence, using ordered word overlap (longest common subsequence).
 * Score 1 means every content word appears in the same order.
 */
function matchPhrase(phrase, answer, synonyms, { checkOrder = true } = {}) {
  const term = typeof phrase === 'string' ? prepareTerm(phrase, synonyms) : phrase;
  const result = {
    phrase: term.text,
    score: 0,
    rawScore: 0,
    unordered: 0,
    matchedText: null,
    orderMismatch: false,
    contradicted: false,
  };
  if (term.empty || !answer.sentences.length) return result;

  const n = term.seq.length;
  let best = null;
  let maxUnordered = 0;
  for (const sentence of answer.sentences) {
    const toks = sentence.content;
    if (!toks.length) continue;
    const { length, matched } = lcsMatch(term.seq, toks);
    const unordered = unorderedCoverage(term.seq, toks);
    maxUnordered = Math.max(maxUnordered, unordered);
    if (!length) continue;
    let score = length / n;
    const spread = matched[matched.length - 1] - matched[0] + 1;
    if (n > 1 && spread > n * SPREAD_FACTOR + 2) score *= SPREAD_PENALTY;
    if (!best || score > best.score) {
      best = { score, unordered, tokens: matched.map((k) => toks[k]) };
    }
  }
  if (!best) return { ...result, unordered: maxUnordered };

  const negated = best.tokens.some((t) => t.negated);
  const contradicted = best.score >= POLARITY_CHECK_MIN && negated !== term.expectNegated;
  const orderMismatch = checkOrder
    && n >= ORDER_MISMATCH.minLength && n <= ORDER_MISMATCH.maxLength
    && maxUnordered >= ORDER_MISMATCH.minUnordered
    && best.score <= ORDER_MISMATCH.maxOrdered;

  return {
    ...result,
    score: contradicted ? 0 : best.score,
    rawScore: best.score,
    unordered: maxUnordered,
    matchedText: spanText(answer, best.tokens, { withNegator: contradicted }),
    orderMismatch,
    contradicted,
  };
}

module.exports = { matchPhrase, ORDER_MISMATCH };
