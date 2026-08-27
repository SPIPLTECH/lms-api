const studentState = require("../../../../student-state");
const assessment = require("../../../../assessment");
const motivation = require("../../../../motivation");

const { METRIC_KEY } = require("../../../constants");
const { round2 } = require("../../../utils/scoreMath.util");

/**
 * Student Analytics reads what Student State/Assessment/Motivation already
 * compute rather than re-deriving it from raw LearningEvents — this agent
 * aggregates the aggregators, it never duplicates a peer's domain logic
 * (and per the constraints, it must never generate a recommendation or
 * make a learning decision, only report on what already exists).
 *
 * Tolerant of a student with no state yet (fresh signup): every peer read
 * is wrapped so a 404/empty result degrades to a neutral value instead of
 * throwing — a read-only aggregator should never fail hard over a peer
 * simply not having data yet.
 *
 * @param {string} studentId
 * @returns {Promise<import("../../../types/analytics.types").MetricRecord[]>}
 */
const calculateStudentMetrics = async (studentId) => {
  const [state, assessmentState, streak] = await Promise.all([
    studentState.getFullState(studentId).catch(() => null),
    assessment.getFullState(studentId).catch(() => null),
    motivation.getStreak(studentId).catch(() => null),
  ]);

  const concepts = assessmentState?.mastery?.concepts || [];
  const avgMastery = concepts.length ? round2(concepts.reduce((sum, c) => sum + c.masteryScore, 0) / concepts.length) : 0;

  return [
    { metricKey: METRIC_KEY.STUDY_TIME, value: state?.engagement?.dailyStudyTimeSeconds || 0, unit: "seconds" },
    {
      metricKey: METRIC_KEY.LEARNING_STREAK,
      value: streak?.currentStreakDays || 0,
      unit: "days",
      metadata: { longestStreakDays: streak?.longestStreakDays || 0, streakStatus: streak?.streakStatus || "BROKEN" },
    },
    { metricKey: METRIC_KEY.PROGRESS_TREND, value: state?.scores?.overallLearningScore || 0, unit: "score" },
    { metricKey: METRIC_KEY.COMPLETION_RATE, value: state?.progress?.courseCompletionPercent || 0, unit: "%" },
    {
      metricKey: METRIC_KEY.ASSESSMENT_TREND,
      value: avgMastery,
      unit: "score",
      metadata: { weakTopics: assessmentState?.mastery?.weakTopics || [], strongTopics: assessmentState?.mastery?.strongTopics || [] },
    },
  ];
};

module.exports = { calculateStudentMetrics };
