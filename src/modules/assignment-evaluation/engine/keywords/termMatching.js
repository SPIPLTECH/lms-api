'use strict';

const { analyze } = require('../normalization/normalizer');

/**
 * Prepares a keyword or phrase for matching: canonical content-token sequence
 * plus the polarity the reference expects. "without oxygen" expects the
 * oxygen token to appear negated in the student's answer too.
 */
function prepareTerm(text, synonyms) {
  const a = analyze(text, { synonyms });
  return {
    text: String(text).trim(),
    seq: a.content.map((t) => t.canon),
    stems: a.content.map((t) => t.sourceStems.join('_')),
    expectNegated: a.content.some((t) => t.negated),
    empty: a.content.length === 0,
  };
}

/** Levenshtein distance with an early exit once it exceeds `max`. */
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/**
 * Tolerates one typo in stems of 5+ letters and two in stems of 9+ letters
 * ("photosynthsis"). Never applied to synonyms, numbers or short words, where
 * a single letter changes the meaning (form/from, co2/co).
 */
function fuzzyEqual(token, canon, stem = canon) {
  if (token.canon === canon) return true;
  // Compare raw stems: a single-word synonym ("chlorophyll") has a synonym
  // canon, but its misspelling ("clorophyll") is still an ordinary token.
  if (token.viaSynonym || stem.includes('_')) return false;
  const a = token.stem;
  if (/\d/.test(a) || /\d/.test(stem)) return false;
  const len = Math.min(a.length, stem.length);
  if (len < 5) return false;
  const allowed = len >= 9 ? 2 : 1;
  return editDistance(a, stem, allowed) <= allowed;
}

/**
 * The student's own words for a match, including skipped stopwords and the
 * negator that flipped it ("does not absorb"), for readable feedback.
 */
function spanText(answer, tokens, { withNegator = false } = {}) {
  if (!tokens.length) return null;
  const idx = tokens.map((t) => t.i);
  let from = Math.min(...idx);
  const to = Math.max(...idx);
  if (withNegator) {
    const first = answer.tokens[from];
    for (let j = from - 1; j >= 0 && j >= from - 4; j -= 1) {
      const t = answer.tokens[j];
      if (t.clause !== first.clause) break;
      if (t.isNegator) { from = j; break; }
    }
  }
  return answer.tokens.slice(from, to + 1).map((t) => t.surface).join(' ');
}

/**
 * Longest common subsequence between a reference sequence and a list of
 * tokens. Returns the matched token indices so callers can inspect polarity.
 */
function lcsMatch(seq, tokens, eq = (t, c) => t.canon === c) {
  const n = seq.length;
  const m = tokens.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i += 1) {
    for (let j = 1; j <= m; j += 1) {
      dp[i][j] = eq(tokens[j - 1], seq[i - 1])
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  const matched = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    if (eq(tokens[j - 1], seq[i - 1]) && dp[i][j] === dp[i - 1][j - 1] + 1) {
      matched.unshift(j - 1);
      i -= 1; j -= 1;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) i -= 1;
    else j -= 1;
  }
  return { length: dp[n][m], matched };
}

module.exports = { prepareTerm, editDistance, fuzzyEqual, lcsMatch, spanText };
