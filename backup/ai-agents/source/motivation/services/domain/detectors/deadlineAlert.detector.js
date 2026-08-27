const { MOTIVATION_ACTION_TYPE, MOTIVATION_PRIORITY, DEADLINE_LOOKAHEAD_HOURS, DEADLINE_URGENT_HOURS } = require("../../../constants");
const { hoursBetween } = require("../../../utils/scoreMath.util");

/**
 * DEADLINE_ALERT: real Quiz/Assignment dueDate within DEADLINE_LOOKAHEAD_HOURS,
 * not yet completed/submitted. Independent of Recommendation's own
 * REVISE_BEFORE_DEADLINE — that one is a content recommendation ("go do
 * this"), this one is a motivational nudge ("don't forget") with its own
 * cadence and tone; a student can reasonably see both.
 *
 * @param {import("../../../types/motivation.types").StudentContext} context
 * @returns {import("../../../types/motivation.types").MotivationCandidate[]}
 */
const detect = (context) => {
  const now = context.now;
  const candidates = [];

  for (const quiz of context.pendingQuizzes || []) {
    if (!quiz.dueDate) continue;
    const hoursRemaining = hoursBetween(quiz.dueDate, now);
    if (hoursRemaining < 0 || hoursRemaining > DEADLINE_LOOKAHEAD_HOURS) continue;

    candidates.push({
      type: MOTIVATION_ACTION_TYPE.DEADLINE_ALERT,
      dedupeKey: `quiz:${quiz.id}`,
      priority: hoursRemaining <= DEADLINE_URGENT_HOURS ? MOTIVATION_PRIORITY.HIGH : MOTIVATION_PRIORITY.MEDIUM,
      triggerReason: `"${quiz.title}" is due in ${Math.max(1, Math.round(hoursRemaining))}h.`,
      confidence: 90,
      recommendedAt: now,
      courseId: quiz.courseId,
      metadata: { quizId: quiz.id, dueDate: quiz.dueDate },
    });
  }

  for (const assignment of context.pendingAssignments || []) {
    if (!assignment.dueDate) continue;
    const hoursRemaining = hoursBetween(assignment.dueDate, now);
    if (hoursRemaining < 0 || hoursRemaining > DEADLINE_LOOKAHEAD_HOURS) continue;

    candidates.push({
      type: MOTIVATION_ACTION_TYPE.DEADLINE_ALERT,
      dedupeKey: `assignment:${assignment.id}`,
      priority: hoursRemaining <= DEADLINE_URGENT_HOURS ? MOTIVATION_PRIORITY.HIGH : MOTIVATION_PRIORITY.MEDIUM,
      triggerReason: `"${assignment.title}" is due in ${Math.max(1, Math.round(hoursRemaining))}h.`,
      confidence: 90,
      recommendedAt: now,
      courseId: assignment.courseId,
      metadata: { assignmentId: assignment.id, dueDate: assignment.dueDate },
    });
  }

  return candidates;
};

module.exports = { detect };
