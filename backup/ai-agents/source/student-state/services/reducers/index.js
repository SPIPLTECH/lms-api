const { reduceProgress } = require("./progress.reducer");
const { reducePerformance } = require("./performance.reducer");
const { reduceEngagement } = require("./engagement.reducer");
const { reduceBehavior } = require("./behavior.reducer");
const { reduceRisk, refreshRiskForInactivity } = require("./risk.reducer");
const { calculateOverallScores } = require("../scoreCalculator.service");

/**
 * The pipeline from the spec, as pure functions with no I/O:
 *   Update Progress -> Update Performance -> Update Engagement ->
 *   Update Behavior -> Update Risk -> Calculate Overall Scores
 *
 * Same function powers both the live event-bus subscriber (one event at a
 * time) and recalculate() (folded over a student's full event history) —
 * there is exactly one place this business logic lives.
 *
 * @param {import("../../types/studentState.types").StudentStateAggregate} aggregate
 * @param {object} event - a LearningEvent row
 * @returns {import("../../types/studentState.types").StudentStateAggregate}
 */
const applyEvent = (aggregate, event) => {
  const progress = reduceProgress(aggregate.progress, event);
  const performance = reducePerformance(aggregate.performance, event);
  const engagement = reduceEngagement(aggregate.engagement, event);

  const behavior = reduceBehavior(aggregate.behavior, event);
  // Cross-domain derivation, not something behavior can compute from a
  // single event in isolation.
  behavior.preferredStudyDurationSeconds = engagement.averageSessionDurationSeconds
    ? Math.round(engagement.averageSessionDurationSeconds)
    : null;

  const risk = reduceRisk(aggregate.risk, event, { progress, engagement, performance });

  const scores = calculateOverallScores({ progress, performance, engagement, risk });

  const state = {
    ...aggregate.state,
    ...scores,
    lastEventId: event.id,
    lastEventAt: event.createdAt,
    version: aggregate.state.version + 1,
  };

  return { studentId: aggregate.studentId, state, progress, performance, engagement, behavior, risk };
};

/**
 * Time-only refresh (no event): recomputes inactivity/deadline-derived
 * risk and the scores that depend on it. Used by the reconciliation
 * scheduler for students who haven't generated a new event recently.
 *
 * @param {import("../../types/studentState.types").StudentStateAggregate} aggregate
 * @param {Date} now
 */
const refreshForInactivity = (aggregate, now) => {
  const risk = refreshRiskForInactivity(
    aggregate.risk,
    { progress: aggregate.progress, engagement: aggregate.engagement, performance: aggregate.performance },
    now
  );

  const scores = calculateOverallScores({
    progress: aggregate.progress,
    performance: aggregate.performance,
    engagement: aggregate.engagement,
    risk,
  });

  const state = { ...aggregate.state, ...scores, version: aggregate.state.version + 1 };

  return { ...aggregate, state, risk };
};

module.exports = { applyEvent, refreshForInactivity };
