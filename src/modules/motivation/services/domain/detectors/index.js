const inactivityAlert = require("./inactivityAlert.detector");
const streakAlert = require("./streakAlert.detector");
const deadlineAlert = require("./deadlineAlert.detector");
const congratulations = require("./congratulations.detector");
const milestoneCelebration = require("./milestoneCelebration.detector");
const weeklyGoalReminder = require("./weeklyGoalReminder.detector");
const revisionReminder = require("./revisionReminder.detector");
const studySessionReminder = require("./studySessionReminder.detector");
const personalizedEncouragement = require("./personalizedEncouragement.detector");
const smartNudge = require("./smartNudge.detector");

const { isLikelyBurnout } = require("../burnoutHeuristic");
const { computeTrend } = require("../trend");

/**
 * Runs every context-based detector (DAILY_REMINDER is schedule-driven —
 * see schedulers/reminderDispatch.scheduler.js — and isn't produced here).
 * Unlike Recommendation's generators, these don't compete for a ranked,
 * capped slot: each detector decides its own priority directly, and a
 * student can validly receive several different action types at once.
 *
 * @param {import("../../../types/motivation.types").StudentContext} context
 * @param {ReturnType<import("../streakEvaluator").evaluateStreak>} streakEvaluation
 * @param {number[]} recentTrendScoresOldestFirst - EngagementTrend.performanceScore, oldest-first.
 * @returns {import("../../../types/motivation.types").MotivationCandidate[]}
 */
const detectAllCandidates = (context, streakEvaluation, recentTrendScoresOldestFirst) => {
  const behavior = context.learningState?.behavior;
  const engagement = context.learningState?.engagement;
  const performanceTrend = computeTrend(recentTrendScoresOldestFirst);

  const isBurnedOut = isLikelyBurnout({
    quizRetryCount: behavior?.quizRetryCount || 0,
    aiHelpRequestCount: behavior?.aiHelpRequestCount || 0,
    dailyStudyTimeSeconds: engagement?.dailyStudyTimeSeconds || 0,
    performanceTrend,
  });

  return [
    ...inactivityAlert.detect(context, isBurnedOut),
    ...streakAlert.detect(context, streakEvaluation),
    ...deadlineAlert.detect(context),
    ...congratulations.detect(context),
    ...milestoneCelebration.detect(context, streakEvaluation),
    ...weeklyGoalReminder.detect(context),
    ...revisionReminder.detect(context),
    ...studySessionReminder.detect(context),
    ...personalizedEncouragement.detect(context, isBurnedOut),
    ...smartNudge.detect(context),
  ];
};

module.exports = { detectAllCandidates };
