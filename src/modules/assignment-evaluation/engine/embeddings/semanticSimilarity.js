'use strict';

function cosineVectors(a, b) {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (!na || !nb) return 0;
  return Math.max(0, Math.min(1, dot / Math.sqrt(na * nb)));
}

/**
 * For each reference text, the best cosine similarity against any answer
 * segment. Returns null when no provider is available or the provider fails,
 * so callers carry on with lexical evidence only.
 */
async function semanticSimilarities(provider, referenceTexts, segmentTexts) {
  if (!provider || !referenceTexts.length || !segmentTexts.length) return null;
  try {
    if (!(await provider.isAvailable())) return null;
    const vectors = await provider.embed([...referenceTexts, ...segmentTexts]);
    const refs = vectors.slice(0, referenceTexts.length);
    const segs = vectors.slice(referenceTexts.length);
    return refs.map((r) => Math.max(...segs.map((s) => cosineVectors(r, s))));
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = { semanticSimilarities, cosineVectors };
