const { addDays } = require("../../utils/dateMath.util");
const { MIN_DAILY_STUDY_MINUTES } = require("../../constants");

/**
 * Sums remaining lessons' real estimated minutes and projects a completion
 * date at the given daily study pace. Returns null when nothing remains
 * (course already complete) rather than "today," which would misleadingly
 * suggest more work is left.
 *
 * @param {import("../../types/learningPath.types").SequenceItem[]} remainingSequence
 * @param {number} suggestedStudyMinutesPerDay
 * @param {Date} now
 * @returns {Date|null}
 */
const estimateCompletionDate = (remainingSequence, suggestedStudyMinutesPerDay, now) => {
  const totalMinutes = remainingSequence.reduce((sum, item) => sum + item.estimatedMinutes, 0);
  if (totalMinutes === 0) return null;

  const dailyMinutes = Math.max(suggestedStudyMinutesPerDay, MIN_DAILY_STUDY_MINUTES);
  const days = Math.ceil(totalMinutes / dailyMinutes);
  return addDays(now, days);
};

module.exports = { estimateCompletionDate };
