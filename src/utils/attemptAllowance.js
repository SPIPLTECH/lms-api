/**
 * How many attempts a student actually gets at a quiz, and where they stand
 * against it.
 *
 * Lifted out of quiz.service so that every read of the allowance — submit,
 * the result payload, the next-action decision — answers from ONE rule. When
 * nextAction.service worked it out from `Quiz.attempts` directly it told a
 * student "1 of 3 attempts used" on a Self-Test that submit would have let
 * them retake forever, because the stored number is not the rule.
 */

/** Quiz.attempts is how many attempts each student gets; 0 means unlimited. */
const isUnlimitedAttempts = (maxAttempts) => !(Number(maxAttempts) > 0);

/**
 * The limit that actually applies. A Self-Test can always be retaken whatever
 * is stored — rows saved before that rule still hold the schema default of 1.
 * A Final uses its stored limit (1 unless the instructor changed it).
 */
const effectiveMaxAttempts = (quiz) => (quiz.quizTag === "SELF_TEST" ? 0 : quiz.attempts);

/** Where a student stands against a quiz's attempt limit. */
const buildAttemptAllowance = (maxAttempts, attemptsUsed) => {
  const unlimited = isUnlimitedAttempts(maxAttempts);
  return {
    attemptsUsed,
    maxAttempts: unlimited ? null : maxAttempts,
    unlimitedAttempts: unlimited,
    attemptsRemaining: unlimited ? null : Math.max(0, maxAttempts - attemptsUsed),
    canAttempt: unlimited || attemptsUsed < maxAttempts
  };
};

module.exports = {
  isUnlimitedAttempts,
  effectiveMaxAttempts,
  buildAttemptAllowance
};
