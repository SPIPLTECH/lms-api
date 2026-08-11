const {
  MASTERY_STATUS,
  MASTERY_EMA_ALPHA,
  MASTERY_SCORE_THRESHOLD,
  WEAK_SCORE_THRESHOLD,
  MASTERY_CONFIDENCE_THRESHOLD,
  RECENT_SCORES_WINDOW,
} = require("../../constants");
const { computeConfidence } = require("./confidence");
const { computeTrend } = require("./trend");
const { scheduleNextReassessment } = require("./reassessmentScheduler");
const { clamp, round2 } = require("../../utils/scoreMath.util");

const defaultConceptMasteryState = (concept) => ({
  concept,
  masteryScore: 0,
  confidenceLevel: 0,
  status: MASTERY_STATUS.UNASSESSED,
  attemptsCount: 0,
  recentScores: [],
  trend: "STABLE",
  lastCourseId: null,
  lastAssessedAt: null,
  nextReassessmentAt: null,
});

/**
 * MASTERED requires both a high score AND enough confidence in that score
 * — a single lucky 100% isn't mastery, it's one data point.
 */
const deriveStatus = (masteryScore, confidenceLevel) => {
  if (masteryScore >= MASTERY_SCORE_THRESHOLD && confidenceLevel >= MASTERY_CONFIDENCE_THRESHOLD) {
    return MASTERY_STATUS.MASTERED;
  }
  if (masteryScore < WEAK_SCORE_THRESHOLD) return MASTERY_STATUS.WEAK;
  return MASTERY_STATUS.DEVELOPING;
};

/**
 * Folds one piece of ConceptEvidence into a concept's mastery state via an
 * exponential moving average — recent evidence outweighs old, so a
 * student who struggled early but has since improved isn't permanently
 * penalized, while still requiring sustained good performance (via the
 * confidence gate) to be called "mastered".
 *
 * @param {import("../../types/assessment.types").ConceptMasteryState} masteryState
 * @param {import("../../types/assessment.types").ConceptEvidence} evidence
 * @param {Date} now - clock to schedule reassessment against (evidence.observedAt during replay)
 * @returns {import("../../types/assessment.types").ConceptMasteryState}
 */
const applyEvidence = (masteryState, evidence, now) => {
  const isFirstEvidence = masteryState.attemptsCount === 0;

  const masteryScore = round2(
    clamp(
      isFirstEvidence
        ? evidence.scorePercent
        : MASTERY_EMA_ALPHA * evidence.scorePercent + (1 - MASTERY_EMA_ALPHA) * masteryState.masteryScore,
      0,
      100
    )
  );

  const attemptsCount = masteryState.attemptsCount + 1;
  const recentScores = [...masteryState.recentScores, evidence.scorePercent].slice(-RECENT_SCORES_WINDOW);
  const confidenceLevel = computeConfidence(attemptsCount, recentScores);
  const trend = computeTrend(recentScores);
  const status = deriveStatus(masteryScore, confidenceLevel);

  return {
    concept: masteryState.concept,
    masteryScore,
    confidenceLevel,
    status,
    attemptsCount,
    recentScores,
    trend,
    lastCourseId: evidence.courseId || masteryState.lastCourseId,
    lastAssessedAt: evidence.observedAt,
    nextReassessmentAt: scheduleNextReassessment(status, now),
  };
};

module.exports = { defaultConceptMasteryState, deriveStatus, applyEvidence };
