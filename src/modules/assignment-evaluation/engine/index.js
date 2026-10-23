'use strict';

const { createRuleBasedEvaluator, ENGINE_NAME, ENGINE_VERSION } = require('./assignmentEvaluator');
const { EvaluatorRegistry } = require('./evaluatorRegistry');
const { createEmbeddingProvider, EmbeddingProvider, NullEmbeddingProvider } = require('./embeddings/embeddingProvider');
const { SynonymDictionary } = require('./synonyms/synonymDictionary');
const { validateQuestion, RubricError } = require('./scoring/rubric');
const { EvaluationIntegrityError } = require('./scoring/invariants');
const { DEFAULT_POLICY, ALLOWED_MARK_STEPS } = require('./scoring/scoringPolicy');
const defaultSynonyms = require('./synonyms/defaultSynonyms');

/** Builds the registry the application uses, with the rule-based evaluator as default. */
function createEvaluatorRegistry({ embeddings = {}, policy = {} } = {}) {
  const embeddingProvider = createEmbeddingProvider(embeddings);
  return new EvaluatorRegistry().register(ENGINE_NAME, createRuleBasedEvaluator({ embeddingProvider, policy }), { isDefault: true });
}

module.exports = {
  createEvaluatorRegistry,
  createRuleBasedEvaluator,
  EvaluatorRegistry,
  EmbeddingProvider,
  NullEmbeddingProvider,
  SynonymDictionary,
  validateQuestion,
  RubricError,
  EvaluationIntegrityError,
  DEFAULT_POLICY,
  ALLOWED_MARK_STEPS,
  ENGINE_NAME,
  ENGINE_VERSION,
  defaultSynonyms,
};
