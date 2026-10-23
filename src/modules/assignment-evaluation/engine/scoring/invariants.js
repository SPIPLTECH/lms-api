'use strict';

const { isMultipleOf, round2, EPS } = require('./marks');

class EvaluationIntegrityError extends Error {
  constructor(problems) {
    super(`Evaluation failed integrity checks: ${problems.join('; ')}`);
    this.name = 'EvaluationIntegrityError';
    this.problems = problems;
  }
}

/**
 * Last line of defence before an evaluation is stored or shown. A result
 * that breaks any rule here is never published; the caller marks the
 * submission as failed and an instructor must look at it.
 */
function assertEvaluationInvariants(result) {
  const problems = [];
  const finite = (n) => typeof n === 'number' && Number.isFinite(n);
  const { maxMarks, marksAwarded, markStep, criteria } = result;

  if (!finite(maxMarks) || maxMarks <= 0) problems.push('maxMarks must be a positive number');
  if (!finite(marksAwarded)) problems.push('marksAwarded is not a number');
  else {
    if (marksAwarded < -EPS) problems.push('marksAwarded is negative');
    if (marksAwarded > maxMarks + EPS) problems.push(`marksAwarded ${marksAwarded} exceeds maxMarks ${maxMarks}`);
    if (!isMultipleOf(marksAwarded, markStep)) problems.push(`marksAwarded ${marksAwarded} is not on the ${markStep} mark step`);
  }

  let criteriaMax = 0;
  let criteriaAwarded = 0;
  for (const c of criteria || []) {
    if (!finite(c.awarded) || c.awarded < -EPS || c.awarded > c.maxMarks + EPS) {
      problems.push(`criterion "${c.description}" awarded ${c.awarded} of ${c.maxMarks}`);
    }
    criteriaMax += c.maxMarks;
    criteriaAwarded += c.awarded;
  }
  if (criteria && criteria.length) {
    if (Math.abs(criteriaMax - maxMarks) > EPS) problems.push(`criteria are worth ${round2(criteriaMax)}, question is worth ${maxMarks}`);
    if (Math.abs(criteriaAwarded - marksAwarded) > EPS) problems.push('criterion marks do not add up to the question total');
  }
  if (!finite(result.confidence) || result.confidence < 0 || result.confidence > 1) problems.push('confidence must be within 0..1');

  if (problems.length) throw new EvaluationIntegrityError(problems);
}

module.exports = { assertEvaluationInvariants, EvaluationIntegrityError };
