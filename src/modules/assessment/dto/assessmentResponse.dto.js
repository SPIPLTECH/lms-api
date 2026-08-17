const { MASTERY_STATUS } = require("../constants");

const toMasteryEntry = (row) => ({
  concept: row.concept,
  masteryScore: row.masteryScore,
  confidenceLevel: row.confidenceLevel,
  status: row.status,
  attemptsCount: row.attemptsCount,
  trend: row.trend,
  lastCourseId: row.lastCourseId,
  lastAssessedAt: row.lastAssessedAt,
  nextReassessmentAt: row.nextReassessmentAt,
});

/** GET /assessment/mastery */
const toMasteryMapResponse = (studentId, masteryRows) => {
  const concepts = masteryRows.map(toMasteryEntry);
  return {
    studentId,
    concepts,
    weakTopics: masteryRows.filter((m) => m.status === MASTERY_STATUS.WEAK).map((m) => m.concept),
    strongTopics: masteryRows.filter((m) => m.status === MASTERY_STATUS.MASTERED).map((m) => m.concept),
  };
};

/** GET /assessment/:studentId — everything, for other agents/system integrations. */
const toFullStateResponse = (studentId, { masteryRows, openGaps, currentRecommendations, pendingReassessments }) => ({
  studentId,
  mastery: toMasteryMapResponse(studentId, masteryRows),
  knowledgeGaps: openGaps.map(toKnowledgeGapEntry),
  recommendations: currentRecommendations.map(toRecommendationEntry),
  reassessmentPlan: pendingReassessments.map(toReassessmentEntry),
});

const toKnowledgeGapEntry = (gap) => ({
  concept: gap.concept,
  severity: gap.severity,
  status: gap.status,
  detectedAt: gap.detectedAt,
  closedAt: gap.closedAt,
});

/** GET /assessment/knowledge-gaps */
const toKnowledgeGapsResponse = (studentId, gaps) => ({
  studentId,
  gaps: gaps.map(toKnowledgeGapEntry),
});

const toRecommendationEntry = (assessment) => ({
  id: assessment.id,
  type: assessment.type,
  targetConcepts: assessment.targetConcepts,
  difficulty: assessment.difficulty,
  rationale: assessment.rationale,
  courseId: assessment.courseId,
  createdAt: assessment.createdAt,
});

/** GET /assessment/recommendations */
const toRecommendationsResponse = (studentId, assessments) => ({
  studentId,
  recommendations: assessments.map(toRecommendationEntry),
});

const toReassessmentEntry = (plan) => ({
  id: plan.id,
  concept: plan.concept,
  scheduledFor: plan.scheduledFor,
  reason: plan.reason,
  priority: plan.priority,
  status: plan.status,
});

/** GET /assessment/reassessment-plan */
const toReassessmentPlanResponse = (studentId, plans) => ({
  studentId,
  plan: plans.map(toReassessmentEntry),
});

const toAttemptEntry = (attempt) => ({
  id: attempt.id,
  assessmentId: attempt.assessmentId,
  attemptNumber: attempt.attemptNumber,
  scorePercent: attempt.scorePercent,
  passed: attempt.passed,
  submittedAt: attempt.submittedAt,
  result: attempt.result
    ? {
        overallScore: attempt.result.overallScore,
        masteryDeltas: attempt.result.masteryDeltas,
        gapsDetected: attempt.result.gapsDetected,
        gapsClosed: attempt.result.gapsClosed,
        confidenceAtTime: attempt.result.confidenceAtTime,
      }
    : null,
});

/** GET /assessment/history */
const toHistoryResponse = (studentId, attempts, pagination) => ({
  studentId,
  attempts: attempts.map(toAttemptEntry),
  pagination,
});

module.exports = {
  toMasteryMapResponse,
  toFullStateResponse,
  toKnowledgeGapsResponse,
  toRecommendationsResponse,
  toReassessmentPlanResponse,
  toHistoryResponse,
};
