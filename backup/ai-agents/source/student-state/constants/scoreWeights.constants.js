/**
 * Every weight set sums to 1. Changing these changes score *values* for
 * every student on the next event/recalculate — treat as a deliberate,
 * reviewed change, not a tuning knob to poke casually.
 */

const PERFORMANCE_WEIGHTS = Object.freeze({
  quizAverage: 0.4,
  assignmentAverage: 0.2,
  passRate: 0.25,
  accuracy: 0.15,
});

const ENGAGEMENT_WEIGHTS = Object.freeze({
  studyTime: 0.35, // normalized against ENGAGEMENT_STUDY_TIME_CAP_MINUTES/day
  streak: 0.35, // normalized against CONSISTENCY_STREAK_CAP_DAYS
  sessionActivity: 0.3, // normalized against ENGAGEMENT_SESSION_CAP_PER_WEEK
});

const OVERALL_LEARNING_WEIGHTS = Object.freeze({
  performance: 0.4,
  engagement: 0.35,
  progress: 0.25,
});

const LEARNING_HEALTH_WEIGHTS = Object.freeze({
  overallLearning: 0.7,
  riskInverse: 0.3, // 100 - dropoutRiskScore
});

const DROPOUT_RISK_WEIGHTS = Object.freeze({
  inactivity: 0.45,
  lowEngagement: 0.3,
  lowPerformance: 0.25,
});

module.exports = {
  PERFORMANCE_WEIGHTS,
  ENGAGEMENT_WEIGHTS,
  OVERALL_LEARNING_WEIGHTS,
  LEARNING_HEALTH_WEIGHTS,
  DROPOUT_RISK_WEIGHTS,
};
