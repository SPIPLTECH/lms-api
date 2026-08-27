const { COURSE_INSIGHT_TYPE, INSIGHT_PRIORITY, DIFFICULT_QUIZ_PASS_RATE, DIFFICULT_QUIZ_MIN_SUBMISSIONS } = require("../../../constants");
const { round2 } = require("../../../utils/scoreMath.util");

/**
 * QUIZ_PERFORMANCE_TREND: only surfaces quizzes whose pass rate is
 * at/below threshold, with a minimum submission count so an early quiz
 * with one or two attempts doesn't get flagged as "too difficult" on
 * noise. Doubles as "detect difficult quizzes" (RESPONSIBILITIES).
 *
 * @param {import("../../../types/teacherInsight.types").CourseContext} context
 * @returns {import("../../../types/teacherInsight.types").CourseInsightCandidate[]}
 */
const detect = (context) => {
  const candidates = [];

  for (const quiz of context.quizzes || []) {
    if (quiz.submissionCount < DIFFICULT_QUIZ_MIN_SUBMISSIONS) continue;
    if (quiz.passRate > DIFFICULT_QUIZ_PASS_RATE) continue;

    candidates.push({
      insightType: COURSE_INSIGHT_TYPE.QUIZ_PERFORMANCE_TREND,
      dedupeKey: quiz.id,
      priority: quiz.passRate <= DIFFICULT_QUIZ_PASS_RATE / 2 ? INSIGHT_PRIORITY.HIGH : INSIGHT_PRIORITY.MEDIUM,
      title: `"${quiz.title}" may be too difficult`,
      reason: `Pass rate is ${round2(quiz.passRate)}% across ${quiz.submissionCount} submission(s), average score ${round2(quiz.avgPercentage)}%.`,
      confidence: 80,
      affectedStudentCount: quiz.submissionCount,
      quizId: quiz.id,
      evidence: { passRate: quiz.passRate, avgPercentage: quiz.avgPercentage, submissionCount: quiz.submissionCount },
    });
  }

  return candidates;
};

module.exports = { detect };
