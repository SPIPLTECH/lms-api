const { addDays } = require("../../utils/dateMath.util");
const { MILESTONE_TYPE, MILESTONE_STATUS } = require("../../constants");
const { buildMilestoneKey } = require("../../utils/dedupeKey.util");

const addDaysFromMinutes = (now, minutes, dailyBudget) => {
  if (minutes === 0) return now;
  return addDays(now, Math.ceil(minutes / dailyBudget));
};

/**
 * One MODULE_COMPLETION milestone per module (status derived from real
 * Progress state — every lesson in it complete) plus one COURSE_COMPLETION
 * milestone. targetDate follows the same cumulative-effort math as
 * completion estimation, just measured up to the end of each module
 * instead of the whole course.
 *
 * @param {Array} courseStructure
 * @param {import("../../types/learningPath.types").SequenceItem[]} sequence
 * @param {number} dailyMinutes
 * @param {Date} now
 * @param {string} courseId
 * @returns {Array}
 */
const generateMilestones = (courseStructure, sequence, dailyMinutes, now, courseId) => {
  const budget = Math.max(dailyMinutes, 1);
  const milestones = [];
  let cumulativeRemainingMinutes = 0;

  for (const module of courseStructure) {
    const moduleItems = sequence.filter((item) => item.moduleId === module.id);
    const allCompleted = moduleItems.length > 0 && moduleItems.every((item) => item.completed);
    cumulativeRemainingMinutes += moduleItems.reduce((sum, item) => sum + (item.completed ? 0 : item.estimatedMinutes), 0);

    milestones.push({
      milestoneType: MILESTONE_TYPE.MODULE_COMPLETION,
      milestoneKey: buildMilestoneKey(MILESTONE_TYPE.MODULE_COMPLETION, module.id),
      moduleId: module.id,
      title: `Complete "${module.title}"`,
      status: allCompleted ? MILESTONE_STATUS.ACHIEVED : MILESTONE_STATUS.PENDING,
      targetDate: allCompleted ? null : addDaysFromMinutes(now, cumulativeRemainingMinutes, budget),
      achievedAt: allCompleted ? now : null,
    });
  }

  const totalRemainingMinutes = sequence.reduce((sum, item) => sum + (item.completed ? 0 : item.estimatedMinutes), 0);
  const courseCompleted = sequence.length > 0 && sequence.every((item) => item.completed);

  milestones.push({
    milestoneType: MILESTONE_TYPE.COURSE_COMPLETION,
    milestoneKey: buildMilestoneKey(MILESTONE_TYPE.COURSE_COMPLETION, courseId),
    moduleId: null,
    title: "Complete the course",
    status: courseCompleted ? MILESTONE_STATUS.ACHIEVED : MILESTONE_STATUS.PENDING,
    targetDate: courseCompleted ? null : addDaysFromMinutes(now, totalRemainingMinutes, budget),
    achievedAt: courseCompleted ? now : null,
  });

  return milestones;
};

module.exports = { generateMilestones };
