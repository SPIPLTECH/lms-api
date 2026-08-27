const { RECOMMENDATION_TYPE, DEADLINE_LOOKAHEAD_HOURS, DEADLINE_URGENT_HOURS } = require("../../../constants");
const { urgencyFromHoursRemaining } = require("../../../utils/scoreMath.util");

const HOUR_MS = 3600 * 1000;

/**
 * REVISE_BEFORE_DEADLINE: real Quiz/Assignment dueDate within
 * DEADLINE_LOOKAHEAD_HOURS, not yet completed/submitted. Deadlines carry
 * real consequences (a missed quiz/assignment), so impact is fixed high
 * rather than derived — urgency alone (from time remaining) does the
 * ranking work here.
 *
 * @param {import("../../../types/recommendation.types").StudentContext} context
 * @returns {import("../../../types/recommendation.types").Candidate[]}
 */
const generate = (context) => {
  const now = context.now;
  const candidates = [];

  for (const quiz of context.pendingQuizzes || []) {
    if (!quiz.dueDate) continue;
    const hoursRemaining = (quiz.dueDate.getTime() - now.getTime()) / HOUR_MS;
    if (hoursRemaining < 0 || hoursRemaining > DEADLINE_LOOKAHEAD_HOURS) continue;

    candidates.push({
      type: RECOMMENDATION_TYPE.REVISE_BEFORE_DEADLINE,
      dedupeKey: `quiz:${quiz.id}`,
      reason: `"${quiz.title}" is due in ${Math.max(1, Math.round(hoursRemaining))}h — revise before attempting it.`,
      urgency: urgencyFromHoursRemaining(hoursRemaining, DEADLINE_URGENT_HOURS, DEADLINE_LOOKAHEAD_HOURS),
      impact: 80,
      confidence: 90,
      estimatedTimeMinutes: quiz.timeLimit || 20,
      courseId: quiz.courseId,
      metadata: { quizId: quiz.id, dueDate: quiz.dueDate },
    });
  }

  for (const assignment of context.pendingAssignments || []) {
    if (!assignment.dueDate) continue;
    const hoursRemaining = (assignment.dueDate.getTime() - now.getTime()) / HOUR_MS;
    if (hoursRemaining < 0 || hoursRemaining > DEADLINE_LOOKAHEAD_HOURS) continue;

    candidates.push({
      type: RECOMMENDATION_TYPE.REVISE_BEFORE_DEADLINE,
      dedupeKey: `assignment:${assignment.id}`,
      reason: `"${assignment.title}" is due in ${Math.max(1, Math.round(hoursRemaining))}h and not yet submitted.`,
      urgency: urgencyFromHoursRemaining(hoursRemaining, DEADLINE_URGENT_HOURS, DEADLINE_LOOKAHEAD_HOURS),
      impact: 80,
      confidence: 90,
      estimatedTimeMinutes: assignment.estimatedTime || 30,
      courseId: assignment.courseId,
      metadata: { assignmentId: assignment.id, dueDate: assignment.dueDate },
    });
  }

  return candidates;
};

module.exports = { generate };
