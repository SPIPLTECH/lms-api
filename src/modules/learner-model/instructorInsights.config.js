/**
 * Phase 9 — thresholds for instructor-facing analytics.
 *
 * Named and explained for the same reason the Phase 8 ones are: an instructor
 * is going to act on these, possibly by contacting a student, so "why is this
 * learner on the list" has to have an answer better than "the code said so".
 *
 * None of these affect a learning decision. They decide what an instructor is
 * SHOWN; the student's path, recommendations and next action are unaffected
 * by every number in this file.
 */

/** The reasons a learner can appear on the attention list. */
const ATTENTION_REASON = {
  RETENTION_DECAYED: "RETENTION_DECAYED",
  REPEATED_INCORRECT: "REPEATED_INCORRECT",
  MISCONCEPTION_OPEN: "MISCONCEPTION_OPEN",
  WEAK_TRANSFER: "WEAK_TRANSFER",
  QUALIFYING_FAILED: "QUALIFYING_FAILED",
  QUALIFYING_EXHAUSTED: "QUALIFYING_EXHAUSTED",
  STALLED: "STALLED"
};

const ATTENTION_CONFIG = {
  /**
   * Incorrect answers on ONE concept before it is worth an instructor's time.
   *
   * Three, not two. Two wrong answers on a topic is an ordinary afternoon;
   * flagging it would fill the list with every learner in the cohort and make
   * the list itself worthless.
   */
  REPEATED_INCORRECT: 3,

  /**
   * Failed qualifying attempts before it is reported.
   *
   * Two, because the qualifying rules already give a second attempt as normal
   * practice — one failure is the system working as designed, not a signal.
   */
  QUALIFYING_FAILURES: 2,

  /**
   * Concepts a learner must be REPEATED_ONLY on before weak transfer is
   * raised. One concept is noise; a pattern across several suggests the
   * learner is pattern-matching questions rather than applying the idea.
   */
  WEAK_TRANSFER_CONCEPTS: 2,

  /**
   * Days of no activity on an unfinished course before it is reported.
   *
   * Fourteen: long enough to survive a holiday or a busy fortnight, short
   * enough that an instructor can still do something about it.
   */
  STALLED_DAYS: 14,

  /** How much of the long tail the overview carries. The full set is always
   *  available through the per-concept and per-learner views. */
  MAX_CONCEPTS: 20,
  MAX_MISCONCEPTIONS: 10,

  /** Learner-list pagination. MAX is a hard ceiling, not a suggestion: it is
   *  what stops one request asking for an entire cohort. */
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100
};

module.exports = {
  ATTENTION_REASON,
  ATTENTION_CONFIG
};
