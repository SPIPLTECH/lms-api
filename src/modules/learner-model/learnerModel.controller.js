const learnerModelService = require("./learnerModel.service");
const nextActionService = require("./nextAction.service");

/**
 * GET /learner-model/next-action?courseId=<id>[&studentId=<id>]
 *
 * The one thing the student should do next, plus anything worth offering
 * alongside it. Composed from decisions that already exist — the learning
 * path, the deterministic decision engine, and the qualification rules — by a
 * fixed priority table. No LLM is involved in choosing it.
 *
 * Authorized by resolveStudentProfile, the same check every other route here
 * uses: a STUDENT is resolved from their own token and refused (403) if they
 * name anyone else. The courseId is never trusted for access on its own —
 * the learning path it feeds is itself student-scoped.
 */
const getNextAction = async (req, res, next) => {
  try {
    const studentProfile = await learnerModelService.resolveStudentProfile({
      callingUser: req.user,
      targetStudentId: req.query.studentId,
    });

    const result = await nextActionService.getNextAction(studentProfile, {
      courseId: req.query.courseId,
      // Optional: the quiz the student has just submitted, passed by the
      // result page so the next step can account for it. A query parameter on
      // the existing endpoint rather than a nested route.
      quizId: req.query.quizId || null,
    });

    res.json({
      success: true,
      data: result.primary,
      secondary: result.secondary,
      qualifiedCount: result.qualifiedCount,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getNextAction,
};
