'use strict';

/**
 * Embedding service interface.
 *
 * The initial evaluator does not need embeddings. This interface lets a
 * locally hosted sentence-embedding model (for example a small
 * sentence-transformers model behind a local HTTP endpoint) be plugged in
 * later without changing the scoring code. Semantic similarity, like TF-IDF,
 * is used only as corroborating evidence, never as proof of correctness.
 *
 * A provider must implement:
 *   name: string
 *   isAvailable(): Promise<boolean>
 *   embed(texts: string[]): Promise<number[][]>   // one vector per text
 */
class EmbeddingProvider {
  get name() { return 'abstract'; }

  async isAvailable() { return false; }

  // eslint-disable-next-line no-unused-vars
  async embed(texts) {
    throw new Error(`${this.name} embedding provider does not implement embed()`);
  }
}

/** Default provider: embeddings disabled. */
class NullEmbeddingProvider extends EmbeddingProvider {
  get name() { return 'none'; }

  async isAvailable() { return false; }

  async embed() { return []; }
}

/**
 * Talks to a local embedding server. Expected contract:
 *   POST {url}  body: { "model": "...", "texts": ["..."] }
 *   200 -> { "embeddings": [[0.1, ...], ...] }
 * Any failure disables semantic evidence for that evaluation instead of
 * failing the evaluation.
 */
class HttpEmbeddingProvider extends EmbeddingProvider {
  constructor({ url, model = 'default', timeoutMs = 5000 } = {}) {
    super();
    if (!url) throw new Error('HttpEmbeddingProvider requires a url');
    this.url = url;
    this.model = model;
    this.timeoutMs = timeoutMs;
  }

  get name() { return `http:${this.model}`; }

  async isAvailable() { return true; }

  async embed(texts) {
    const res = await fetch(this.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, texts }),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!res.ok) throw new Error(`Embedding server responded ${res.status}`);
    const body = await res.json();
    if (!Array.isArray(body.embeddings) || body.embeddings.length !== texts.length) {
      throw new Error('Embedding server returned an unexpected payload');
    }
    return body.embeddings;
  }
}

function createEmbeddingProvider(config = {}) {
  const kind = (config.provider || 'none').toLowerCase();
  if (kind === 'none' || kind === '') return new NullEmbeddingProvider();
  if (kind === 'http') {
    return new HttpEmbeddingProvider({ url: config.url, model: config.model, timeoutMs: config.timeoutMs });
  }
  throw new Error(`Unknown embedding provider "${config.provider}"`);
}

module.exports = { EmbeddingProvider, NullEmbeddingProvider, HttpEmbeddingProvider, createEmbeddingProvider };
