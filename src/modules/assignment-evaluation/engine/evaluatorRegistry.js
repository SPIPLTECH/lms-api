'use strict';

/**
 * Registry of evaluators by type. The rule-based evaluator is the default.
 * A subject-specific evaluator (for example numeric answers with units, or
 * code) registers under its own type and must expose the same interface:
 *
 *   { name, version, evaluateAnswer({ question, answerText, synonymGroups }) -> Promise<result> }
 *
 * where `result` follows the rule-based evaluator's result shape so grading,
 * review and feedback screens keep working.
 */
class EvaluatorRegistry {
  constructor() {
    this.evaluators = new Map();
    this.defaultType = null;
  }

  register(type, evaluator, { isDefault = false } = {}) {
    if (!evaluator || typeof evaluator.evaluateAnswer !== 'function') {
      throw new Error(`Evaluator "${type}" must implement evaluateAnswer()`);
    }
    this.evaluators.set(type, evaluator);
    if (isDefault || !this.defaultType) this.defaultType = type;
    return this;
  }

  get(type) {
    const key = type || this.defaultType;
    const evaluator = this.evaluators.get(key);
    if (!evaluator) throw new Error(`No evaluator registered for type "${key}"`);
    return evaluator;
  }

  types() {
    return [...this.evaluators.keys()];
  }
}

module.exports = { EvaluatorRegistry };
