const { RECOMMENDATION_TYPE, DEADLINE_LOOKAHEAD_HOURS } = require("../../../constants");
const { clamp, round2 } = require("../../../utils/scoreMath.util");

/**
 * General "you have this pending" nudge for assignments whose due date is
 * still comfortably far out. Assignments inside DEADLINE_LOOKAHEAD_HOURS
 * are deliberately excluded here — deadline.generator.js takes over once
 * it's genuinely urgent, so the same assignment is never surfaced twice
 * under two different recommendation types at once.
 *
 * @param {import("../../../types/recommendation.types").StudentContext} context
 * @returns {import("../../../types/recommendation.types").Candidate[]}
 */
const generate = (context) => {
  const now = context.now;
  const lookaheadMs = DEADLINE_LOOKAHEAD_HOURS * 3600 * 1000;

  return (context.pendingAssignments || [])
    .filter((assignment) => {
      if (!assignment.dueDate) return true; // no deadline pressure at all — still worth surfacing
      return assignment.dueDate.getTime() - now.getTime() > lookaheadMs;
    })
    .map((assignment) => ({
      type: RECOMMENDATION_TYPE.COMPLETE_SUGGESTED_ASSIGNMENT,
      dedupeKey: assignment.id,
      reason: `"${assignment.title}" is assigned and not yet submitted.`,
      urgency: 25,
      impact: clamp(round2(50 + (assignment.totalQuestions || 0))),
      confidence: 85,
      estimatedTimeMinutes: assignment.estimatedTime || 30,
      courseId: assignment.courseId,
      metadata: { assignmentId: assignment.id, dueDate: assignment.dueDate },
    }));
};

module.exports = { generate };
