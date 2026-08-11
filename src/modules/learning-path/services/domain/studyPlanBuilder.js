const { startOfDay, addDays } = require("../../utils/dateMath.util");
const { WEEKLY_PLAN_DAYS } = require("../../constants");

/**
 * Greedily buckets the remaining sequence into a 7-day window honoring the
 * daily minute budget. A lesson is never split mid-way, so a day may run
 * slightly over its target rather than leave a half-finished lesson
 * dangling — and a day always gets at least one item if any remain, even
 * if that single lesson alone exceeds the budget.
 *
 * @param {import("../../types/learningPath.types").SequenceItem[]} remainingSequence
 * @param {number} dailyMinutes
 * @param {Date} now
 * @returns {import("../../types/learningPath.types").DayPlan[]}
 */
const buildWeeklyPlan = (remainingSequence, dailyMinutes, now) => {
  const budget = Math.max(dailyMinutes, 1);
  const days = [];
  let cursor = 0;

  for (let dayIndex = 0; dayIndex < WEEKLY_PLAN_DAYS; dayIndex++) {
    const date = addDays(startOfDay(now), dayIndex);
    const items = [];
    let totalMinutes = 0;

    while (cursor < remainingSequence.length && (items.length === 0 || totalMinutes < budget)) {
      const item = remainingSequence[cursor];
      items.push(item);
      totalMinutes += item.estimatedMinutes;
      cursor += 1;
    }

    days.push({ date, items, totalMinutes });
  }

  return days;
};

/** Day-zero of the same weekly computation — one source of truth for both plans, never separately derived. */
const buildDailyPlan = (weeklyPlanDays) => weeklyPlanDays[0];

module.exports = { buildWeeklyPlan, buildDailyPlan };
