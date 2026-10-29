const config = require("./studyPlan.config");

/**
 * Learning Path engine (study plan) — pure. The remaining learning sequence,
 * the learner's own time budget and Learning Health's pace signals in; a
 * 7-day plan and a completion estimate out. No database, no clock.
 *
 * The order is never re-decided here: it is the course's own learning
 * sequence (the one the player and the access checks use). This agent only
 * decides how much of it fits in each day.
 */

const DAY_MS = 86_400_000;

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));
const startOfUtcDay = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));

const TYPE_LABELS = {
  VIDEO: "Video",
  QUIZ: "Quiz",
  ASSIGNMENT: "Assignment",
  PDF: "Reading",
  TEXT: "Reading",
  HTML: "Reading",
  DOCUMENT: "Reading",
  PRESENTATION: "Slides",
  CODE: "Code",
  LINK: "Link",
  EXTERNAL_LINK: "Link",
  IMAGE: "Image",
  FILE: "File",
};

/**
 * Estimated minutes for one sequence step.
 * @param {{kind: string, type: string, questionCount?: number|null, timeLimit?: number|null}} step
 * @param {number|null} durationSeconds  Content.duration
 */
function estimateStepMinutes(step, durationSeconds) {
  let minutes;
  if (step.kind === "QUIZ") {
    minutes = step.timeLimit || (step.questionCount ? step.questionCount * config.QUIZ_MINUTES_PER_QUESTION : config.QUIZ_DEFAULT_MINUTES);
  } else if (step.kind === "ASSIGNMENT") {
    minutes = config.ASSIGNMENT_MINUTES;
  } else if (step.type === "VIDEO") {
    minutes = durationSeconds ? durationSeconds / 60 : config.VIDEO_DEFAULT_MINUTES;
  } else if (config.READING_TYPES.includes(step.type)) {
    minutes = config.READING_MINUTES;
  } else {
    minutes = config.OTHER_MINUTES;
  }
  return Math.round(clamp(minutes, config.MIN_STEP_MINUTES, config.MAX_STEP_MINUTES));
}

/** The learner's own weekly hours (StudentProfile.weeklyStudyHours) as a daily budget. */
function dailyBudget(weeklyStudyHours) {
  if (!weeklyStudyHours || weeklyStudyHours <= 0) return config.DEFAULT_DAILY_MINUTES;
  return Math.max(config.MIN_DAILY_MINUTES, Math.round((weeklyStudyHours * 60) / 7));
}

/** Original pace adjustment, from Learning Health's performance and trend. */
function paceAdjustment(health) {
  const performance = health?.performanceScore;
  if (typeof performance === "number" && performance < config.EASE_UP_PERFORMANCE_BELOW) {
    return {
      adjustment: "EASE_UP",
      multiplier: config.EASE_UP_MULTIPLIER,
      reason: "Lighter days for now, so there's time to consolidate before moving on.",
    };
  }
  if (typeof performance === "number" && performance >= config.ACCELERATE_PERFORMANCE_AT && health?.improvementTrend === "IMPROVING") {
    return {
      adjustment: "ACCELERATE",
      multiplier: config.ACCELERATE_MULTIPLIER,
      reason: "Your results are strong and improving, so the plan moves a little faster.",
    };
  }
  return { adjustment: "STANDARD", multiplier: 1, reason: null };
}

/**
 * Original greedy 7-day bucketing: fill each day up to the budget, always at
 * least one item per day while items remain.
 */
function buildWeeklyPlan(items, dailyMinutes, now) {
  const budget = Math.max(dailyMinutes, 1);
  const start = startOfUtcDay(now);
  const days = [];
  let cursor = 0;

  for (let day = 0; day < config.WEEKLY_PLAN_DAYS; day++) {
    const dayItems = [];
    let totalMinutes = 0;
    while (cursor < items.length && (dayItems.length === 0 || totalMinutes + items[cursor].minutes <= budget)) {
      dayItems.push(items[cursor]);
      totalMinutes += items[cursor].minutes;
      cursor += 1;
    }
    days.push({ date: new Date(start.getTime() + day * DAY_MS).toISOString().slice(0, 10), items: dayItems, totalMinutes });
  }
  return days;
}

/**
 * The whole plan.
 *
 * @param {{
 *   courseId: string,
 *   steps: object[],                 // learning sequence steps (completed ones are skipped)
 *   durations: Map<string, number>,  // contentId -> Content.duration (seconds)
 *   weeklyStudyHours: number|null,
 *   health: {performanceScore: number|null, improvementTrend: string}|null,
 *   decayedConcepts: string[],
 *   now: Date,
 * }} input
 */
function buildPlan({ courseId, steps, durations, weeklyStudyHours, health, decayedConcepts, now }) {
  const href = `/student/learn/${courseId}`;
  const remaining = steps
    .filter((s) => !s.completed)
    .map((s) => ({
      kind: "LEARN",
      stepIndex: s.index,
      contentId: s.contentId,
      title: s.title || TYPE_LABELS[s.kind === "CONTENT" ? s.type : s.kind] || "Lesson item",
      type: s.kind === "CONTENT" ? s.type : s.kind,
      minutes: estimateStepMinutes(s, durations.get(s.contentId) ?? null),
      href,
    }));

  const revision = decayedConcepts.slice(0, config.MAX_REVISION_ITEMS).map((concept) => ({
    kind: "REVISION",
    title: `Review ${concept}`,
    concept,
    type: "REVISION",
    minutes: config.REVISION_MINUTES,
    href,
  }));

  const pace = paceAdjustment(health);
  const dailyMinutes = Math.max(config.MIN_DAILY_MINUTES, Math.round(dailyBudget(weeklyStudyHours) * pace.multiplier));
  const remainingMinutes = remaining.reduce((sum, item) => sum + item.minutes, 0);

  const days = buildWeeklyPlan([...revision, ...remaining], dailyMinutes, now);
  const daysToFinish = remaining.length === 0 ? 0 : Math.ceil((remainingMinutes + revision.length * config.REVISION_MINUTES) / dailyMinutes);
  const estimatedCompletionAt = remaining.length === 0 ? null : new Date(startOfUtcDay(now).getTime() + (daysToFinish - 1) * DAY_MS);

  return {
    dailyMinutes,
    adjustment: pace.adjustment,
    adjustmentReason: pace.reason,
    remainingSteps: remaining.length,
    remainingMinutes,
    estimatedCompletionAt,
    days,
    revision,
  };
}

module.exports = { estimateStepMinutes, dailyBudget, paceAdjustment, buildWeeklyPlan, buildPlan };
