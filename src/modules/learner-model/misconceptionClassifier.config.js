/**
 * Phase 7B — MisconceptionClassifier configuration.
 *
 * Deliberately a separate file from misconception.config.js, so that file's
 * diff stays empty — the accumulation/decay/OPEN-CLOSED severity thresholds
 * it defines are untouched by Tier 2. This governs an entirely different,
 * upstream decision: whether a single LLM classification is trusted enough
 * to even attempt creating/continuing a hypothesis at all.
 *
 * Note: there is no dedicated classifier timeout here. llmService.generate()/
 * ollamaClient.chat() only expose a `think` boolean, which selects between
 * two global timeouts (OLLAMA_TIMEOUT_MS / OLLAMA_THINK_TIMEOUT_MS) — no
 * per-call override exists. Adding one would require modifying llm.service.js
 * / ollama.client.js / llm.config.js, which are outside Phase 7B's approved
 * file list. The classifier therefore shares the same non-thinking timeout
 * (OLLAMA_TIMEOUT_MS, default 60s) as the tutoring flow.
 */

const MISCONCEPTION_CLASSIFIER_CONFIG = {
  // Below this, a classifier response is discarded outright — never reaches
  // misconception.service.js, regardless of how well-formed the JSON is.
  MIN_CONFIDENCE: 0.6,
};

module.exports = { MISCONCEPTION_CLASSIFIER_CONFIG };
