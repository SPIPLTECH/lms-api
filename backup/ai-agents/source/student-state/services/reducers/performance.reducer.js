const { EVENT_TYPES, TRENDS } = require("../../constants");
const {
  RECENT_QUIZ_SCORES_WINDOW,
  IMPROVEMENT_TREND_DELTA_POINTS,
  MIN_ATTEMPTS_FOR_TOPIC_RANKING,
  MAX_TOPICS_TRACKED,
} = require("../../constants/thresholds.constants");
const { getNumber, getBoolean, getScoreMap } = require("../../utils/eventPayload.util");
const { clamp, safeDivide, round2 } = require("../../utils/scoreMath.util");

/** Percentage score for a quiz submission: explicit `percentage`/`scorePercent`, or derived from score/totalMarks. */
const deriveQuizPercent = (payload) => {
  const direct = getNumber(payload, "percentage") ?? getNumber(payload, "scorePercent");
  if (direct !== null) return clamp(direct, 0, 100);

  const score = getNumber(payload, "score");
  const totalMarks = getNumber(payload, "totalMarks");
  if (score !== null && totalMarks && totalMarks > 0) {
    return clamp((score / totalMarks) * 100, 0, 100);
  }

  return null;
};

/**
 * Trend from a bounded recent-scores window: compares the mean of the
 * newer half against the older half. Needs at least 2 points to say
 * anything other than STABLE.
 */
const computeTrend = (recentScores) => {
  if (recentScores.length < 2) return TRENDS.STABLE;

  const mid = Math.floor(recentScores.length / 2);
  const older = recentScores.slice(0, mid);
  const newer = recentScores.slice(mid);

  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  const newerAvg = newer.reduce((a, b) => a + b, 0) / newer.length;
  const delta = newerAvg - olderAvg;

  if (delta >= IMPROVEMENT_TREND_DELTA_POINTS) return TRENDS.IMPROVING;
  if (delta <= -IMPROVEMENT_TREND_DELTA_POINTS) return TRENDS.DECLINING;
  return TRENDS.STABLE;
};

const mergeConceptScores = (topicStats, conceptScores) => {
  const next = { ...topicStats };

  for (const [topic, score] of Object.entries(conceptScores)) {
    const existing = next[topic] || { correctSum: 0, total: 0 };
    next[topic] = {
      correctSum: existing.correctSum + clamp(score, 0, 1),
      total: existing.total + 1,
    };
  }

  return next;
};

const rankTopics = (topicStats) => {
  const ranked = Object.entries(topicStats)
    .filter(([, stat]) => stat.total >= MIN_ATTEMPTS_FOR_TOPIC_RANKING)
    .map(([topic, stat]) => ({ topic, average: safeDivide(stat.correctSum, stat.total) }))
    .sort((a, b) => a.average - b.average);

  const weak = ranked.slice(0, MAX_TOPICS_TRACKED).map((r) => r.topic);
  const strong = ranked
    .slice()
    .reverse()
    .slice(0, MAX_TOPICS_TRACKED)
    .map((r) => r.topic);

  return { weak, strong };
};

/**
 * @param {import("../../types/studentState.types").PerformanceState} performance
 * @param {object} event
 * @returns {import("../../types/studentState.types").PerformanceState}
 */
const reducePerformance = (performance, event) => {
  const next = { ...performance };

  switch (event.eventType) {
    case EVENT_TYPES.QUIZ_COMPLETED: {
      next.quizAttemptsCount = performance.quizAttemptsCount + 1;

      const percent = deriveQuizPercent(event.payload);
      if (percent !== null) {
        next.quizSumScorePercent = round2(performance.quizSumScorePercent + percent);
        next.quizAverage = round2(safeDivide(next.quizSumScorePercent, next.quizAttemptsCount));
        next.recentQuizScores = [...performance.recentQuizScores, percent].slice(
          -RECENT_QUIZ_SCORES_WINDOW
        );
        next.improvementTrend = computeTrend(next.recentQuizScores);
      }

      const passed = getBoolean(event.payload, "passed");
      if (passed === true) {
        next.quizPassCount = performance.quizPassCount + 1;
      }
      next.passRate = round2(safeDivide(next.quizPassCount, next.quizAttemptsCount) * 100);

      const conceptScores = getScoreMap(event.payload, "conceptScores");
      if (conceptScores) {
        next.topicStats = mergeConceptScores(performance.topicStats, conceptScores);
        const { weak, strong } = rankTopics(next.topicStats);
        next.weakTopics = weak;
        next.strongTopics = strong;
      }

      break;
    }

    case EVENT_TYPES.QUIZ_QUESTION_ANSWERED: {
      const isCorrect = getBoolean(event.payload, "isCorrect");
      if (isCorrect === null) break;

      next.totalAnswersCount = performance.totalAnswersCount + 1;
      if (isCorrect) next.correctAnswersCount = performance.correctAnswersCount + 1;
      next.accuracy = round2(safeDivide(next.correctAnswersCount, next.totalAnswersCount) * 100);
      break;
    }

    case EVENT_TYPES.ASSIGNMENT_SUBMITTED:
    case EVENT_TYPES.ASSIGNMENT_RESUBMITTED: {
      next.assignmentAttemptsCount = performance.assignmentAttemptsCount + 1;

      // AssignmentSubmission.grade is a free-text string in this LMS, so a
      // numeric average is only possible when the emitter supplies one —
      // averaged over scored attempts only, not diluted by unscored ones.
      const scorePercent = getNumber(event.payload, "scorePercent");
      if (scorePercent !== null) {
        next.assignmentScoredCount = performance.assignmentScoredCount + 1;
        next.assignmentSumScorePercent = round2(
          performance.assignmentSumScorePercent + clamp(scorePercent, 0, 100)
        );
        next.assignmentAverage = round2(
          safeDivide(next.assignmentSumScorePercent, next.assignmentScoredCount)
        );
      }
      break;
    }

    default:
      break;
  }

  return next;
};

module.exports = { reducePerformance, deriveQuizPercent, computeTrend, rankTopics };
