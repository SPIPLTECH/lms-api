const config = require("./learningHealth.config");

/**
 * Learning Health scoring — pure. Signals in (see learningHealth.signals.js
 * for how they are read), state out. No database, no clock: `now` is part of
 * the input, so every rule here is testable as a plain function.
 *
 * @typedef {object} LearnerSignals
 * @property {Date} now
 * @property {Date} enrolledAt
 * @property {boolean} completed
 * @property {number} progressPercent
 * @property {Date|null} lastActivityAt
 * @property {boolean} hasAnyActivity
 * @property {Set<string>} activeDates            UTC "YYYY-MM-DD", inside the window
 * @property {number} videoMinutes
 * @property {boolean} courseHasVideo
 * @property {{percentage:number, passed:boolean, correctCount:number, incorrectCount:number}[]} quizAttempts  newest first
 * @property {number[]} assignmentScores           0-100
 * @property {number[]} masteryScores              0-1 (BKT probability)
 * @property {{hasDeadlines:boolean, overdue:number, dueSoonDaysLeft:number[]}} deadlines
 *
 * @typedef {object} LearningHealthState
 * @property {number} engagementScore
 * @property {number|null} performanceScore        null = no evidence yet
 * @property {number} consistencyScore
 * @property {number} progressPercent
 * @property {number} inactivityDays
 * @property {number} deadlineRisk
 * @property {number} completionProbability        0-1
 * @property {"IMPROVING"|"DECLINING"|"STABLE"} improvementTrend
 * @property {number} riskScore
 * @property {"NEW"|"LOW"|"MEDIUM"|"HIGH"|"CRITICAL"} riskLevel
 * @property {string[]} riskReasons
 */

const DAY_MS = 86_400_000;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const round2 = (value) => Math.round(value * 100) / 100;
const dateKey = (date) => new Date(date).toISOString().slice(0, 10);
const wholeDaysBetween = (from, to) => Math.floor((to.getTime() - new Date(from).getTime()) / DAY_MS);
const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * Weighted average over only the terms that have real underlying data,
 * renormalising the weights across the rest. Returns null when no term does.
 * Carried over from the original Student State agent: a learner with no quiz
 * attempts must not be dragged down by a "0% average" that never happened.
 */
const availableWeightedAverage = (terms) => {
  const usable = terms.filter((t) => t.available && Number.isFinite(t.value));
  const totalWeight = usable.reduce((sum, t) => sum + t.weight, 0);
  if (totalWeight === 0) return null;
  return usable.reduce((sum, t) => sum + t.value * t.weight, 0) / totalWeight;
};

/** Days of the window that apply to this learner (fewer if enrolled recently). */
const windowDays = (s) => clamp(wholeDaysBetween(s.enrolledAt, s.now) + 1, 1, config.WINDOW_DAYS);

const engagementScore = (s) => {
  const days = windowDays(s);
  const targetDays = Math.max(1, Math.round((config.TARGET_ACTIVE_DAYS * days) / config.WINDOW_DAYS));
  const targetMinutes = (config.TARGET_VIDEO_MINUTES * days) / config.WINDOW_DAYS;
  return round2(
    availableWeightedAverage([
      { value: clamp(s.activeDates.size / targetDays, 0, 1) * 100, weight: config.ENGAGEMENT_WEIGHTS.activeDays, available: true },
      { value: clamp(s.videoMinutes / targetMinutes, 0, 1) * 100, weight: config.ENGAGEMENT_WEIGHTS.videoMinutes, available: s.courseHasVideo },
    ])
  );
};

const longestGapDays = (s) => {
  let longest = 0;
  let run = 0;
  for (let i = windowDays(s) - 1; i >= 0; i--) {
    if (s.activeDates.has(dateKey(new Date(s.now.getTime() - i * DAY_MS)))) {
      run = 0;
    } else {
      run += 1;
      longest = Math.max(longest, run);
    }
  }
  return longest;
};

const consistencyScore = (s) => {
  const share = s.activeDates.size / windowDays(s);
  const base = clamp(share / config.TARGET_ACTIVE_SHARE, 0, 1) * 100;
  const penalty =
    Math.max(0, longestGapDays(s) - config.CONSISTENCY_GAP_GRACE_DAYS) * config.CONSISTENCY_GAP_PENALTY_PER_DAY;
  return round2(clamp(base - penalty, 0, 100));
};

/** Quiz metrics over all of this course's attempts; null when there are none. */
const quizMetrics = (attempts) => {
  if (attempts.length === 0) return null;

  let weightSum = 0;
  let valueSum = 0;
  attempts.slice(0, config.RECENT_QUIZ_WINDOW).forEach((a, i) => {
    const weight = config.QUIZ_RECENCY_DECAY ** i;
    weightSum += weight;
    valueSum += a.percentage * weight;
  });

  const correct = attempts.reduce((n, a) => n + (a.correctCount || 0), 0);
  const answered = attempts.reduce((n, a) => n + (a.correctCount || 0) + (a.incorrectCount || 0), 0);

  return {
    average: valueSum / weightSum,
    passRate: (attempts.filter((a) => a.passed).length / attempts.length) * 100,
    accuracy: answered > 0 ? (correct / answered) * 100 : null,
  };
};

const performanceScore = (s, quiz) => {
  const w = config.PERFORMANCE_WEIGHTS;
  const value = availableWeightedAverage([
    { value: quiz?.average, weight: w.quizAverage, available: Boolean(quiz) },
    { value: quiz?.passRate, weight: w.passRate, available: Boolean(quiz) },
    { value: quiz?.accuracy, weight: w.accuracy, available: quiz?.accuracy != null },
    { value: s.assignmentScores.length ? mean(s.assignmentScores) : NaN, weight: w.assignmentAverage, available: s.assignmentScores.length > 0 },
    { value: s.masteryScores.length ? mean(s.masteryScores) * 100 : NaN, weight: w.mastery, available: s.masteryScores.length > 0 },
  ]);
  return value === null ? null : round2(clamp(value, 0, 100));
};

/** Original ramp: 0 below the medium threshold, linear to 100 at the high one. */
const inactivity = (s) => {
  const last = s.lastActivityAt ?? s.enrolledAt;
  const inactivityDays = Math.max(0, wholeDaysBetween(last, s.now));
  const low = config.INACTIVITY_MEDIUM_RISK_DAYS;
  const high = config.INACTIVITY_HIGH_RISK_DAYS;
  return {
    inactivityDays,
    inactivityScore: round2(clamp(((inactivityDays - low) / (high - low)) * 100, 0, 100)),
  };
};

const deadlineRisk = (s) => {
  if (s.deadlines.overdue > 0) return 100;
  const dueSoon = s.deadlines.dueSoonDaysLeft;
  if (dueSoon.length === 0) return 0;
  const closest = Math.min(...dueSoon);
  const closeness = 1 - clamp(closest / config.DEADLINE_SOON_DAYS, 0, 1);
  const base = config.DEADLINE_SOON_BASE + (config.DEADLINE_SOON_MAX - config.DEADLINE_SOON_BASE) * closeness;
  return round2(clamp(base + config.DEADLINE_EXTRA_PER_ITEM * (dueSoon.length - 1), 0, 100));
};

/** IMPROVING / DECLINING / STABLE — newer half vs older half of the last 6. */
const improvementTrend = (attempts) => {
  const scores = attempts.slice(0, config.TREND_WINDOW).map((a) => a.percentage).reverse();
  if (scores.length < config.TREND_MIN_ATTEMPTS) return "STABLE";
  const half = Math.floor(scores.length / 2);
  const delta = mean(scores.slice(-half)) - mean(scores.slice(0, half));
  if (delta >= config.TREND_DELTA_POINTS) return "IMPROVING";
  if (delta <= -config.TREND_DELTA_POINTS) return "DECLINING";
  return "STABLE";
};

const levelFor = (riskScore) => {
  const t = config.RISK_LEVEL_THRESHOLDS;
  if (riskScore >= t.CRITICAL) return "CRITICAL";
  if (riskScore >= t.HIGH) return "HIGH";
  if (riskScore >= t.MEDIUM) return "MEDIUM";
  return "LOW";
};

/** Plain-English reasons, most severe first, capped. */
const buildReasons = ({ s, quiz, engagement, performance, inactive, trend }) => {
  const reasons = [];
  const { overdue, dueSoonDaysLeft } = s.deadlines;

  if (overdue > 0) {
    reasons.push({ severity: 100, text: `${plural(overdue, "assignment")} overdue` });
  }
  if (inactive.inactivityDays >= config.INACTIVITY_MEDIUM_RISK_DAYS) {
    reasons.push({ severity: 50 + inactive.inactivityScore / 2, text: `Inactive for ${inactive.inactivityDays} days` });
  }
  if (performance !== null && performance < config.REASON_THRESHOLDS.lowPerformance) {
    reasons.push({
      severity: 100 - performance,
      text: quiz ? `Recent quiz average ${Math.round(quiz.average)}%` : "Low assignment and mastery results",
    });
  }
  if (dueSoonDaysLeft.length > 0) {
    reasons.push({ severity: 60, text: `${plural(dueSoonDaysLeft.length, "assignment")} due within ${config.DEADLINE_SOON_DAYS} days` });
  }
  if (engagement < config.REASON_THRESHOLDS.lowEngagement && inactive.inactivityDays < config.INACTIVITY_MEDIUM_RISK_DAYS) {
    reasons.push({ severity: 80 - engagement, text: `Active on ${s.activeDates.size} of the last ${windowDays(s)} days` });
  }
  if (trend === "DECLINING") {
    reasons.push({ severity: 40, text: "Quiz scores declining" });
  }

  return reasons
    .sort((a, b) => b.severity - a.severity)
    .slice(0, config.MAX_REASONS)
    .map((r) => r.text);
};

/**
 * @param {LearnerSignals} s
 * @returns {LearningHealthState}
 */
const scoreLearner = (s) => {
  const quiz = quizMetrics(s.quizAttempts);
  const engagement = engagementScore(s);
  const consistency = consistencyScore(s);
  const performance = performanceScore(s, quiz);
  const inactive = inactivity(s);
  const deadline = deadlineRisk(s);
  const trend = improvementTrend(s.quizAttempts);

  const w = config.RISK_WEIGHTS;
  const riskScore = round2(
    clamp(
      availableWeightedAverage([
        { value: inactive.inactivityScore, weight: w.inactivity, available: true },
        { value: 100 - engagement, weight: w.lowEngagement, available: true },
        { value: 100 - (performance ?? 0), weight: w.lowPerformance, available: performance !== null },
        { value: deadline, weight: w.deadline, available: s.deadlines.hasDeadlines },
      ]),
      0,
      100
    )
  );

  const c = config.COMPLETION_WEIGHTS;
  const completionProbability = round2(
    clamp(
      availableWeightedAverage([
        { value: s.progressPercent, weight: c.progress, available: true },
        { value: performance ?? config.COMPLETION_NEUTRAL_PERFORMANCE, weight: c.performance, available: true },
        { value: 100 - riskScore, weight: c.riskInverse, available: true },
      ]),
      0,
      100
    ) / 100
  );

  const base = {
    engagementScore: engagement,
    performanceScore: performance,
    consistencyScore: consistency,
    progressPercent: s.progressPercent,
    inactivityDays: inactive.inactivityDays,
    // null when the learner has never done anything in this course, so the
    // UI can say "no activity yet" instead of "last active N days ago".
    lastActivityAt: s.hasAnyActivity ? s.lastActivityAt : null,
    deadlineRisk: deadline,
    completionProbability,
    improvementTrend: trend,
  };

  if (s.completed) {
    return { ...base, completionProbability: 1, riskScore: 0, riskLevel: "LOW", riskReasons: ["Course completed"] };
  }

  const isNew = wholeDaysBetween(s.enrolledAt, s.now) < config.NEW_LEARNER_DAYS && !s.hasAnyActivity;
  if (isNew) {
    return { ...base, riskScore: 0, riskLevel: "NEW", riskReasons: ["Recently enrolled"] };
  }

  return {
    ...base,
    riskScore,
    riskLevel: levelFor(riskScore),
    riskReasons: buildReasons({ s, quiz, engagement, performance, inactive, trend }),
  };
};

module.exports = {
  scoreLearner,
  availableWeightedAverage,
  inactivity,
  levelFor,
  improvementTrend,
  dateKey,
};
