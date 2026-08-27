const { EVENT_TYPES, RISK_LEVELS } = require("../../constants");
const {
  INACTIVITY_MEDIUM_RISK_DAYS,
  INACTIVITY_HIGH_RISK_DAYS,
  DEADLINE_RISK_GRACE_DAYS,
  DEADLINE_RISK_MAX_DAYS,
  DROPOUT_RISK_HIGH,
  DROPOUT_RISK_MEDIUM,
} = require("../../constants/thresholds.constants");
const { DROPOUT_RISK_WEIGHTS } = require("../../constants/scoreWeights.constants");
const { clamp, round2, weightedAverage } = require("../../utils/scoreMath.util");
const { wholeDaysBetween } = require("../../utils/time.util");

/**
 * inactivityScore ramps 0 -> 100 linearly between the medium and high
 * inactivity-day thresholds; below medium it's 0, at/above high it's 100.
 */
const computeInactivity = (lastActiveAt, now) => {
  if (!lastActiveAt) return { inactivityDays: 0, inactivityScore: 0 };

  const inactivityDays = Math.max(0, wholeDaysBetween(lastActiveAt, now));
  const range = INACTIVITY_HIGH_RISK_DAYS - INACTIVITY_MEDIUM_RISK_DAYS;
  const raw =
    ((inactivityDays - INACTIVITY_MEDIUM_RISK_DAYS) / range) * 100;
  const inactivityScore = round2(clamp(raw, 0, 100));

  return { inactivityDays, inactivityScore };
};

const computeDeadlineRisk = (pendingAssignmentStartedAt, now) => {
  if (!pendingAssignmentStartedAt) return 0;

  const daysPending = Math.max(0, wholeDaysBetween(pendingAssignmentStartedAt, now));
  const range = DEADLINE_RISK_MAX_DAYS - DEADLINE_RISK_GRACE_DAYS;
  const raw = ((daysPending - DEADLINE_RISK_GRACE_DAYS) / range) * 100;
  return round2(clamp(raw, 0, 100));
};

const computeDropoutRisk = ({ inactivityScore, lowEngagementFlag, performance }) => {
  const lowPerformanceScore = clamp(100 - performance.quizAverage, 0, 100);

  const score = weightedAverage([
    { value: inactivityScore, weight: DROPOUT_RISK_WEIGHTS.inactivity },
    { value: lowEngagementFlag ? 100 : 0, weight: DROPOUT_RISK_WEIGHTS.lowEngagement },
    { value: performance.quizAttemptsCount > 0 ? lowPerformanceScore : 0, weight: DROPOUT_RISK_WEIGHTS.lowPerformance },
  ]);

  return round2(clamp(score, 0, 100));
};

const dropoutRiskLevelFor = (score) => {
  if (score >= DROPOUT_RISK_HIGH) return RISK_LEVELS.HIGH;
  if (score >= DROPOUT_RISK_MEDIUM) return RISK_LEVELS.MEDIUM;
  return RISK_LEVELS.LOW;
};

const computeCompletionProbability = ({ progress, performance, dropoutRiskScore }) => {
  const probability = weightedAverage([
    { value: progress.courseCompletionPercent, weight: 0.5 },
    { value: performance.quizAttemptsCount > 0 ? performance.quizAverage : 50, weight: 0.3 },
    { value: 100 - dropoutRiskScore, weight: 0.2 },
  ]);

  return round2(clamp(probability, 0, 100) / 100);
};

/**
 * Live, event-driven path. An event just arrived, so the student is active
 * *right now* by definition — inactivityDays is 0 here. Time-based decay
 * for students who go quiet (no new events to trigger this reducer) is the
 * scheduler's job — see refreshRiskForInactivity below.
 *
 * @param {import("../../types/studentState.types").RiskState} risk
 * @param {object} event
 * @param {{progress: object, engagement: object, performance: object}} context
 *   Already-updated sibling slices for this same event.
 */
const reduceRisk = (risk, event, context) => {
  const next = { ...risk, inactivityDays: 0, inactivityScore: 0, lowEngagementFlag: false };

  if (event.eventType === EVENT_TYPES.ASSIGNMENT_STARTED) {
    next.pendingAssignmentStartedAt = event.createdAt;
  }
  if (
    event.eventType === EVENT_TYPES.ASSIGNMENT_SUBMITTED ||
    event.eventType === EVENT_TYPES.ASSIGNMENT_RESUBMITTED
  ) {
    next.pendingAssignmentStartedAt = null;
  }
  next.deadlineRiskScore = computeDeadlineRisk(next.pendingAssignmentStartedAt, event.createdAt);

  next.dropoutRiskScore = computeDropoutRisk({
    inactivityScore: next.inactivityScore,
    lowEngagementFlag: next.lowEngagementFlag,
    performance: context.performance,
  });
  next.dropoutRiskLevel = dropoutRiskLevelFor(next.dropoutRiskScore);

  next.completionProbability = computeCompletionProbability({
    progress: context.progress,
    performance: context.performance,
    dropoutRiskScore: next.dropoutRiskScore,
  });

  return next;
};

/**
 * Scheduler path: recomputes purely time-based risk fields (inactivity,
 * deadline risk, and everything derived from them) against the current
 * clock, with no new event involved.
 */
const refreshRiskForInactivity = (risk, { progress, engagement, performance }, now) => {
  const { inactivityDays, inactivityScore } = computeInactivity(engagement.lastActiveAt, now);
  const lowEngagementFlag = inactivityDays >= INACTIVITY_MEDIUM_RISK_DAYS;

  const next = {
    ...risk,
    inactivityDays,
    inactivityScore,
    lowEngagementFlag,
    deadlineRiskScore: computeDeadlineRisk(risk.pendingAssignmentStartedAt, now),
  };

  next.dropoutRiskScore = computeDropoutRisk({ inactivityScore, lowEngagementFlag, performance });
  next.dropoutRiskLevel = dropoutRiskLevelFor(next.dropoutRiskScore);
  next.completionProbability = computeCompletionProbability({
    progress,
    performance,
    dropoutRiskScore: next.dropoutRiskScore,
  });

  return next;
};

module.exports = {
  reduceRisk,
  refreshRiskForInactivity,
  computeInactivity,
  computeDeadlineRisk,
  computeDropoutRisk,
  computeCompletionProbability,
  dropoutRiskLevelFor,
};
