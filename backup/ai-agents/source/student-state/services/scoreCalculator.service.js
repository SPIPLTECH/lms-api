const {
  PERFORMANCE_WEIGHTS,
  ENGAGEMENT_WEIGHTS,
  OVERALL_LEARNING_WEIGHTS,
  LEARNING_HEALTH_WEIGHTS,
  ENGAGEMENT_STUDY_TIME_CAP_MINUTES_PER_DAY,
  CONSISTENCY_STREAK_CAP_DAYS,
} = require("../constants");
const { clamp, round2, weightedAverage } = require("../utils/scoreMath.util");

/**
 * Weighted average over only the terms that have real underlying data
 * (`available`), renormalizing weights across the remainder. A student
 * with zero quiz attempts shouldn't have their performanceScore dragged
 * to 0 by a "0% quiz average" that never actually happened.
 */
const availableWeightedAverage = (terms) => {
  const usable = terms.filter((t) => t.available);
  if (usable.length === 0) return 0;
  return weightedAverage(usable);
};

const calculatePerformanceScore = (performance) => {
  return round2(
    clamp(
      availableWeightedAverage([
        { value: performance.quizAverage, weight: PERFORMANCE_WEIGHTS.quizAverage, available: performance.quizAttemptsCount > 0 },
        { value: performance.assignmentAverage, weight: PERFORMANCE_WEIGHTS.assignmentAverage, available: performance.assignmentAttemptsCount > 0 },
        { value: performance.passRate, weight: PERFORMANCE_WEIGHTS.passRate, available: performance.quizAttemptsCount > 0 },
        { value: performance.accuracy, weight: PERFORMANCE_WEIGHTS.accuracy, available: performance.totalAnswersCount > 0 },
      ]),
      0,
      100
    )
  );
};

const calculateEngagementScore = (engagement) => {
  const studyTimeComponent = clamp(
    (engagement.dailyStudyTimeSeconds / 60 / ENGAGEMENT_STUDY_TIME_CAP_MINUTES_PER_DAY) * 100,
    0,
    100
  );
  const streakComponent = clamp(
    (engagement.consecutiveLearningDays / CONSISTENCY_STREAK_CAP_DAYS) * 100,
    0,
    100
  );
  // Average session length vs. a 10-minute reference — a session-depth
  // signal, distinct from the raw time-volume and streak components above.
  const sessionDepthComponent = clamp((engagement.averageSessionDurationSeconds / 600) * 100, 0, 100);

  return round2(
    clamp(
      weightedAverage([
        { value: studyTimeComponent, weight: ENGAGEMENT_WEIGHTS.studyTime },
        { value: streakComponent, weight: ENGAGEMENT_WEIGHTS.streak },
        { value: sessionDepthComponent, weight: ENGAGEMENT_WEIGHTS.sessionActivity },
      ]),
      0,
      100
    )
  );
};

const calculateConsistencyScore = (engagement) => {
  const consecutiveComponent = clamp(
    (engagement.consecutiveLearningDays / CONSISTENCY_STREAK_CAP_DAYS) * 100,
    0,
    100
  );
  const loginComponent = clamp((engagement.loginStreakDays / CONSISTENCY_STREAK_CAP_DAYS) * 100, 0, 100);

  return round2(
    clamp(weightedAverage([
      { value: consecutiveComponent, weight: 0.6 },
      { value: loginComponent, weight: 0.4 },
    ]), 0, 100)
  );
};

const calculateOverallLearningScore = ({ performanceScore, engagementScore, progress }) => {
  return round2(
    clamp(
      weightedAverage([
        { value: performanceScore, weight: OVERALL_LEARNING_WEIGHTS.performance },
        { value: engagementScore, weight: OVERALL_LEARNING_WEIGHTS.engagement },
        { value: progress.courseCompletionPercent, weight: OVERALL_LEARNING_WEIGHTS.progress },
      ]),
      0,
      100
    )
  );
};

const calculateLearningHealthScore = ({ overallLearningScore, dropoutRiskScore }) => {
  return round2(
    clamp(
      weightedAverage([
        { value: overallLearningScore, weight: LEARNING_HEALTH_WEIGHTS.overallLearning },
        { value: 100 - dropoutRiskScore, weight: LEARNING_HEALTH_WEIGHTS.riskInverse },
      ]),
      0,
      100
    )
  );
};

/**
 * @param {import("../types/studentState.types").StudentStateAggregate} aggregate
 *   Aggregate with progress/performance/engagement/behavior/risk already updated.
 * @returns {Pick<import("../types/studentState.types").StateFields,
 *   "performanceScore"|"engagementScore"|"consistencyScore"|"overallLearningScore"|"learningHealthScore">}
 */
const calculateOverallScores = ({ progress, performance, engagement, risk }) => {
  const performanceScore = calculatePerformanceScore(performance);
  const engagementScore = calculateEngagementScore(engagement);
  const consistencyScore = calculateConsistencyScore(engagement);
  const overallLearningScore = calculateOverallLearningScore({ performanceScore, engagementScore, progress });
  const learningHealthScore = calculateLearningHealthScore({
    overallLearningScore,
    dropoutRiskScore: risk.dropoutRiskScore,
  });

  return { performanceScore, engagementScore, consistencyScore, overallLearningScore, learningHealthScore };
};

module.exports = {
  calculateOverallScores,
  calculatePerformanceScore,
  calculateEngagementScore,
  calculateConsistencyScore,
  calculateOverallLearningScore,
  calculateLearningHealthScore,
};
