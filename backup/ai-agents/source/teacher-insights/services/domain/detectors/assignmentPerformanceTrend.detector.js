const { COURSE_INSIGHT_TYPE, INSIGHT_PRIORITY, LOW_ASSIGNMENT_SUBMISSION_RATE } = require("../../../constants");
const { percent } = require("../../../utils/scoreMath.util");

/**
 * ASSIGNMENT_PERFORMANCE_TREND: surfaces assignments with a low submission
 * rate — the difficulty proxy for assignments, since grades are free-text
 * in this LMS (AssignmentSubmission.grade), so a numeric average score
 * isn't available the way it is for quizzes. A low submission rate is
 * itself real evidence something's causing problems (RESPONSIBILITIES:
 * "detect difficult assignments").
 *
 * @param {import("../../../types/teacherInsight.types").CourseContext} context
 * @returns {import("../../../types/teacherInsight.types").CourseInsightCandidate[]}
 */
const detect = (context) => {
  if (context.enrolledCount === 0) return [];

  const candidates = [];
  for (const assignment of context.assignments || []) {
    const submissionRate = percent(assignment.submissionCount, context.enrolledCount);
    if (submissionRate > LOW_ASSIGNMENT_SUBMISSION_RATE) continue;

    candidates.push({
      insightType: COURSE_INSIGHT_TYPE.ASSIGNMENT_PERFORMANCE_TREND,
      dedupeKey: assignment.id,
      priority: submissionRate <= LOW_ASSIGNMENT_SUBMISSION_RATE / 2 ? INSIGHT_PRIORITY.HIGH : INSIGHT_PRIORITY.MEDIUM,
      title: `"${assignment.title}" has a low submission rate`,
      reason: `${assignment.submissionCount}/${context.enrolledCount} enrolled students (${submissionRate}%) have submitted it.`,
      confidence: 70,
      affectedStudentCount: context.enrolledCount - assignment.submissionCount,
      assignmentId: assignment.id,
      evidence: { submissionRate, submissionCount: assignment.submissionCount, onTimeCount: assignment.onTimeCount },
    });
  }

  return candidates;
};

module.exports = { detect };
