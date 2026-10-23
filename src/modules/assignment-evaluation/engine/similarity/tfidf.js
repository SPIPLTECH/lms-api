'use strict';

/**
 * Small TF-IDF model built per question. Documents are lists of terms made
 * from canonical content tokens (unigrams + within-sentence bigrams), so
 * synonyms and inflections already line up before weighting.
 *
 * Similarity here measures shared vocabulary, not correctness: an answer that
 * reverses a cause and effect can score as high as the ideal answer. The
 * scorer therefore uses it only as supporting evidence.
 */

function termsFromTokens(tokens) {
  const content = tokens.filter((t) => !t.isStop && !t.isNegator);
  const terms = [];
  for (let i = 0; i < content.length; i += 1) {
    // Negated words become a separate term so "need light" and
    // "do not need light" do not look identical.
    const uni = content[i].negated ? `not:${content[i].canon}` : content[i].canon;
    terms.push(uni);
    const next = content[i + 1];
    if (next && next.sentence === content[i].sentence) {
      const bi = `${uni} ${next.negated ? `not:${next.canon}` : next.canon}`;
      terms.push(bi);
    }
  }
  return terms;
}

class TfidfModel {
  constructor(documents = []) {
    this.docCount = 0;
    this.df = new Map();
    for (const d of documents) this.addDocument(d);
  }

  addDocument(terms) {
    this.docCount += 1;
    for (const t of new Set(terms)) this.df.set(t, (this.df.get(t) || 0) + 1);
  }

  idf(term) {
    // Smoothed IDF, always positive, so unseen student terms still count
    // against the match through the vector norm.
    return Math.log((1 + this.docCount) / (1 + (this.df.get(term) || 0))) + 1;
  }

  vector(terms) {
    const tf = new Map();
    for (const t of terms) tf.set(t, (tf.get(t) || 0) + 1);
    const vec = new Map();
    for (const [t, count] of tf) {
      // Bigrams carry half weight: they reward word order without letting
      // phrase overlap dominate the score.
      const weight = t.includes(' ') ? 0.5 : 1;
      vec.set(t, (1 + Math.log(count)) * this.idf(t) * weight);
    }
    return vec;
  }

  similarity(termsA, termsB) {
    return cosine(this.vector(termsA), this.vector(termsB));
  }
}

function cosine(a, b) {
  if (!a.size || !b.size) return 0;
  let dot = 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  for (const [t, w] of small) {
    const o = large.get(t);
    if (o) dot += w * o;
  }
  let na = 0;
  let nb = 0;
  for (const w of a.values()) na += w * w;
  for (const w of b.values()) nb += w * w;
  if (!na || !nb) return 0;
  return Math.min(1, dot / Math.sqrt(na * nb));
}

/**
 * Answer segments to compare against a criterion: each sentence and each
 * pair of adjacent sentences, so a point made across two sentences is found.
 */
function answerSegments(answer) {
  const segs = answer.sentences.map((s) => ({ text: s.text, terms: termsFromTokens(s.tokens) }));
  for (let i = 0; i + 1 < answer.sentences.length; i += 1) {
    const a = answer.sentences[i];
    const b = answer.sentences[i + 1];
    segs.push({ text: `${a.text}. ${b.text}`, terms: termsFromTokens([...a.tokens, ...b.tokens]) });
  }
  return segs;
}

function bestSegmentSimilarity(model, referenceTerms, segments) {
  let best = { score: 0, text: null };
  for (const seg of segments) {
    const s = model.similarity(referenceTerms, seg.terms);
    if (s > best.score) best = { score: s, text: seg.text };
  }
  return best;
}

module.exports = { TfidfModel, termsFromTokens, cosine, answerSegments, bestSegmentSimilarity };
