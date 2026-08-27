const { CODING_EXERCISE_TYPE } = require("../../constants");
const { getNumber, getString, getScoreMap } = require("../../utils/eventPayload.util");
const { EVENT_TYPES } = require("../../../observation");

/**
 * Percentage score from a payload: explicit percentage/scorePercent, or
 * derived from score/totalMarks.
 */
const deriveScorePercent = (payload) => {
  const direct = getNumber(payload, "percentage") ?? getNumber(payload, "scorePercent");
  if (direct !== null) return Math.min(100, Math.max(0, direct));

  const score = getNumber(payload, "score");
  const totalMarks = getNumber(payload, "totalMarks");
  if (score !== null && totalMarks && totalMarks > 0) {
    return Math.min(100, Math.max(0, (score / totalMarks) * 100));
  }

  return null;
};

const classifyEvidenceType = (event) => {
  const exerciseType = getString(event.payload, "exerciseType");
  if (exerciseType === CODING_EXERCISE_TYPE) return "CODING";
  if (event.eventType === EVENT_TYPES.ASSIGNMENT_SUBMITTED || event.eventType === EVENT_TYPES.ASSIGNMENT_RESUBMITTED) {
    return "ASSIGNMENT";
  }
  return "QUIZ";
};

/**
 * Extracts concept-level evidence from one evaluative LearningEvent.
 * Prefers a per-concept breakdown (payload.conceptScores, 0-1 scale, same
 * contract as QuizSubmission.conceptScores); falls back to a single
 * payload.concept tag when a per-concept map isn't available. Events with
 * neither produce no concept evidence — they're still recorded as an
 * AssessmentAttempt (history), just without a mastery update.
 *
 * @param {object} event - a LearningEvent row
 * @returns {import("../../types/assessment.types").ConceptEvidence[]}
 */
const extractEvidence = (event) => {
  const evidenceType = classifyEvidenceType(event);
  const conceptScores = getScoreMap(event.payload, "conceptScores");

  if (conceptScores) {
    return Object.entries(conceptScores).map(([concept, ratio]) => ({
      concept,
      scorePercent: Math.min(100, Math.max(0, ratio * 100)),
      courseId: event.courseId || null,
      sourceEventId: event.id || null,
      evidenceType,
      observedAt: event.createdAt,
    }));
  }

  const singleConcept = getString(event.payload, "concept");
  const scorePercent = deriveScorePercent(event.payload);

  if (singleConcept && scorePercent !== null) {
    return [
      {
        concept: singleConcept,
        scorePercent,
        courseId: event.courseId || null,
        sourceEventId: event.id || null,
        evidenceType,
        observedAt: event.createdAt,
      },
    ];
  }

  return [];
};

/** The overall attempt score, independent of per-concept breakdown — used for AssessmentAttempt.scorePercent. */
const extractOverallScore = (event) => deriveScorePercent(event.payload);

module.exports = { extractEvidence, extractOverallScore, deriveScorePercent, classifyEvidenceType };
