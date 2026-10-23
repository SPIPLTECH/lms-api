'use strict';

const { prepareTerm, fuzzyEqual, spanText } = require('./termMatching');

// Evidence strength per match type. A keyword found verbatim (or through a
// configured synonym) is full evidence; looser matches count for less.
const MATCH_WEIGHTS = {
  exact: 1,
  synonym: 1,
  proximity: 0.85,
  fuzzy: 0.8,
  'fuzzy-proximity': 0.7,
};

const PROXIMITY_SLACK = 4;

function sameSentence(tokens) {
  return tokens.every((t) => t.sentence === tokens[0].sentence);
}

/** Contiguous occurrences of the term in the content tokens (same sentence). */
function contiguous(n, content, eq) {
  const occ = [];
  for (let i = 0; i + n <= content.length; i += 1) {
    const span = content.slice(i, i + n);
    if (sameSentence(span) && span.every((t, k) => eq(t, k))) occ.push(span);
  }
  return occ;
}

/** All term words present, in any order, within a short window of one sentence. */
function proximity(n, content, eq) {
  const occ = [];
  const window = n + PROXIMITY_SLACK;
  const positions = [...Array(n).keys()];
  for (let i = 0; i < content.length; i += 1) {
    if (!positions.some((k) => eq(content[i], k))) continue;
    const win = content.slice(i, i + window).filter((t) => t.sentence === content[i].sentence);
    const used = new Set();
    const picked = [];
    for (const k of positions) {
      const hit = win.find((t) => !used.has(t.i) && eq(t, k));
      if (!hit) break;
      used.add(hit.i);
      picked.push(hit);
    }
    if (picked.length === n) occ.push(picked);
  }
  return occ;
}

/**
 * Looks for one keyword in an analyzed answer.
 * Returns the best non-contradicted occurrence. A negated occurrence of a
 * positive keyword (or the reverse) scores zero and is reported as a
 * contradiction so the scorer can flag it for review.
 */
function matchKeyword(keyword, answer, synonyms) {
  const term = typeof keyword === 'string' ? prepareTerm(keyword, synonyms) : keyword;
  const result = {
    keyword: term.text,
    score: 0,
    matchType: 'none',
    matchedText: null,
    contradicted: false,
    mixedPolarity: false,
  };
  if (term.empty || !answer.content.length) return result;

  const n = term.seq.length;
  // A multi-word synonym token ("light energy") still contains its words, so
  // the keyword "light" matches inside it.
  const exactEq = (t, k) => t.canon === term.seq[k]
    || (t.viaSynonym && !term.stems[k].includes('_') && t.sourceStems.includes(term.stems[k]));
  const fuzzyEq = (t, k) => fuzzyEqual(t, term.seq[k], term.stems[k]);
  const attempts = [['exact', () => contiguous(n, answer.content, exactEq)]];
  if (n > 1) attempts.push(['proximity', () => proximity(n, answer.content, exactEq)]);
  attempts.push(['fuzzy', () => contiguous(n, answer.content, fuzzyEq)]);
  if (n > 1) attempts.push(['fuzzy-proximity', () => proximity(n, answer.content, fuzzyEq)]);

  for (const [type, find] of attempts) {
    const occurrences = find();
    if (!occurrences.length) continue;
    const agrees = (occ) => occ.some((t) => t.negated) === term.expectNegated;
    const good = occurrences.filter(agrees);
    const bad = occurrences.filter((o) => !agrees(o));
    if (good.length) {
      const occ = good[0];
      const viaSynonym = occ.some((t, k) => t.viaSynonym && t.sourceStems.join('_') !== term.stems[k]);
      const matchType = type === 'exact' && viaSynonym ? 'synonym' : type;
      return {
        ...result,
        score: MATCH_WEIGHTS[matchType],
        matchType,
        matchedText: spanText(answer, occ),
        mixedPolarity: bad.length > 0,
      };
    }
    return {
      ...result,
      matchType: 'contradicted',
      matchedText: spanText(answer, bad[0], { withNegator: true }),
      contradicted: true,
    };
  }
  return result;
}

module.exports = { matchKeyword, MATCH_WEIGHTS };
