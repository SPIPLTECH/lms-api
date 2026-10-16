/**
 * Phase 8 — thresholds for the long-term learning signals.
 *
 * Every number here is a judgement call, so every number here is named and
 * explained. Nothing in retention.service.js hard-codes a boundary; if a
 * threshold is wrong it is wrong in one place, and the tests that pin the
 * behaviour say which rule they are pinning.
 *
 * These describe EVIDENCE, not the student. "DECAYED" means the delayed
 * answers went badly, not that the student has forgotten — the distinction
 * is what keeps the student-facing wording honest.
 */

const RETENTION_STATUS = {
  RETAINED: "RETAINED",
  SHAKY: "SHAKY",
  DECAYED: "DECAYED",
  INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE"
};

const TRANSFER_STATUS = {
  TRANSFERRED: "TRANSFERRED",
  REPEATED_ONLY: "REPEATED_ONLY",
  NOT_DEMONSTRATED: "NOT_DEMONSTRATED",
  INSUFFICIENT_EVIDENCE: "INSUFFICIENT_EVIDENCE"
};

const CALIBRATION_STATUS = {
  WELL_CALIBRATED: "WELL_CALIBRATED",
  OVERCONFIDENT: "OVERCONFIDENT",
  UNDERCONFIDENT: "UNDERCONFIDENT",
  UNAVAILABLE: "UNAVAILABLE"
};

const RETENTION_CONFIG = {
  /**
   * How long after first getting a concept right an answer has to be before
   * it counts as evidence of RETENTION rather than of the same sitting.
   *
   * Answering correctly twice in one quiz says the concept was available in
   * working memory that afternoon; it says nothing about whether it lasted.
   * Three days is the smallest gap that reliably spans a break from the
   * material in a course taken a few times a week.
   */
  GAP_DAYS: 3,

  /**
   * Delayed answers needed before retention is classified at all.
   *
   * One delayed answer is a coin flip — a single slip would read as decay and
   * a single lucky guess as retention. Below this the status is
   * INSUFFICIENT_EVIDENCE and no recommendation is made.
   */
  MIN_DELAYED_OBSERVATIONS: 2,

  /** Delayed accuracy at or above this is RETAINED (2 of 3). */
  RETAINED_MIN_RATE: 2 / 3,

  /** Delayed accuracy at or below this is DECAYED (1 of 3). Between the two: SHAKY. */
  DECAYED_MAX_RATE: 1 / 3,

  /**
   * How long a concept can go untouched before a review is worth suggesting.
   *
   * Only ever applied to a concept the student has actually demonstrated —
   * something never learned is not "due for review", it is unlearned, and
   * that is the ordinary learning path's job.
   */
  REVIEW_DUE_DAYS: 14,

  /**
   * Transfer needs correct answers on this many DISTINCT questions, spread
   * across this many DISTINCT quizzes.
   *
   * Both conditions matter. Distinct questions alone can be satisfied inside
   * a single paper, which is one context; distinct quizzes alone can be
   * satisfied by the same question reused in a retake, which is one question.
   * Requiring both is the smallest honest definition of "applied it somewhere
   * else".
   */
  TRANSFER_MIN_DISTINCT_QUESTIONS: 2,
  TRANSFER_MIN_DISTINCT_QUIZZES: 2,

  /**
   * Distinct questions the student must have SEEN before transfer is
   * classified. Below this there has been no opportunity to transfer, which
   * is not the same as failing to.
   */
  TRANSFER_MIN_DISTINCT_SEEN: 2,

  /**
   * Calibration — unused today, and deliberately kept.
   *
   * Nothing in the schema records how sure a student felt: QuestionAttempt
   * has no confidence column and the submit payload carries no such field.
   * Rather than invent one, evaluateCalibration returns UNAVAILABLE whenever
   * it is handed no confidence observations, and these thresholds sit ready
   * for the day it is handed some. See CALIBRATION_CAPTURE_NOTE below.
   */
  CALIBRATION_MIN_OBSERVATIONS: 4,
  /** On a 1–5 self-report, 4 and above is "I'm sure". */
  CALIBRATION_HIGH_CONFIDENCE: 4,
  CALIBRATION_LOW_CONFIDENCE: 2,
  /** Sure-but-wrong more often than this is OVERCONFIDENT. */
  OVERCONFIDENT_MAX_ACCURACY: 0.5,
  /** Unsure-but-right more often than this is UNDERCONFIDENT. */
  UNDERCONFIDENT_MIN_ACCURACY: 0.8
};

/**
 * The smallest change that would make calibration real, recorded here so the
 * decision is visible rather than folded into a commit message:
 *
 *   1. `QuestionAttempt.confidence Int?` — one nullable column, null meaning
 *      "not asked", which is what every existing row would be.
 *   2. The attempt UI asks once per question (a 1–5 or three-point control),
 *      and submit carries it in the questionStates payload it already sends.
 *   3. buildQuestionAttemptRows writes it through.
 *
 * It is NOT added here. A column with no writer is dead schema, and a
 * calibration figure derived from an unasked question would be fabricated —
 * which §2 of the brief rules out. evaluateCalibration below is written and
 * tested against supplied observations so that step 3 is the whole job.
 */
const CALIBRATION_CAPTURE_NOTE =
  "Confidence is not captured by any quiz surface today; calibration reports UNAVAILABLE.";

module.exports = {
  RETENTION_STATUS,
  TRANSFER_STATUS,
  CALIBRATION_STATUS,
  RETENTION_CONFIG,
  CALIBRATION_CAPTURE_NOTE
};
