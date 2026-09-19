const learnerModelService = require("./learnerModel.service");
const recommendationService = require("./recommendation.service");
const nextActionService = require("./nextAction.service");
const retentionService = require("./retention.service");
const instructorInsightsService = require("./instructorInsights.service");

/**
 * Phase 8 — how the student's concepts are holding up over time.
 *
 * Returns an array, scoped by an optional ?courseId. Authorization is
 * resolveStudentProfile's, the same gate every other route here uses: a
 * STUDENT passing someone else's studentId is refused with 403, not quietly
 * served their own data.
 */
const getLearningSignals = async (req, res, next) => {
  try {
    const studentProfile = await learnerModelService.resolveStudentProfile({
      callingUser: req.user,
      targetStudentId: req.query.studentId,
    });

    const result = await retentionService.getLearningSignals(studentProfile, {
      courseId: req.query.courseId || null,
    });

    res.json({
      success: true,
      data: result.signals,
      calibration: result.calibration,
    });
  } catch (error) {
    next(error);
  }
};

const getLearnerState = async (req, res, next) => {
  try {
    const result = await learnerModelService.getLearnerState({
      callingUser: req.user,
      targetStudentId: req.query.studentId,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const initializeLearnerState = async (req, res, next) => {
  try {
    const result = await learnerModelService.initializeLearnerState({
      callingUser: req.user,
      data: req.body,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const recordEvidence = async (req, res, next) => {
  try {
    const result = await learnerModelService.recordEvidence({
      callingUser: req.user,
      data: req.body,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const recordMisconception = async (req, res, next) => {
  try {
    const result = await learnerModelService.recordMisconceptionState({
      callingUser: req.user,
      data: req.body,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const getPedagogicalDecision = async (req, res, next) => {
  try {
    const result = await learnerModelService.getPedagogicalDecision({
      callingUser: req.user,
      data: req.body,
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /learner-model/recommendations?courseId=<id>[&studentId=<id>]
 *
 * What this student should do next, and where they are weakest — produced by
 * the existing deterministic decision engine, not a new one.
 *
 * `studentId` is only honoured for instructors/admins; a STUDENT is resolved
 * strictly from their own token and is refused (403) if they name anyone else.
 * That check is resolveStudentProfile, shared with every other route here.
 */
const getRecommendations = async (req, res, next) => {
  try {
    const studentProfile = await learnerModelService.resolveStudentProfile({
      callingUser: req.user,
      targetStudentId: req.query.studentId,
    });

    const result = await recommendationService.getRecommendations(studentProfile, {
      courseId: req.query.courseId || null,
      limit: Number(req.query.limit) > 0 ? Math.min(Number(req.query.limit), 10) : 4,
    });

    res.json({
      success: true,
      // The list itself, so a caller that only wants the cards can read `data`
      // directly — list endpoints return arrays.
      data: result.recommendations,
      weakAreas: result.weakAreas,
      masteryOverview: result.masteryOverview,
    });
  } catch (error) {
    next(error);
  }
};

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


/**
 * Phase 9 — instructor analytics. All three handlers delegate their
 * authorization to instructorInsights.service, which folds course ownership
 * into the lookup so a course that is not this instructor's is
 * indistinguishable from one that does not exist.
 */
const getInstructorInsights = async (req, res, next) => {
  try {
    const result = await instructorInsightsService.getCourseInsights(req.user, {
      courseId: req.query.courseId,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

const getInstructorLearners = async (req, res, next) => {
  try {
    const result = await instructorInsightsService.getLearnersNeedingAttention(req.user, {
      courseId: req.query.courseId,
      limit: req.query.limit,
      offset: req.query.offset,
    });

    // A list endpoint returns an array; the paging counters ride alongside it.
    res.json({
      success: true,
      data: result.learners,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  } catch (error) {
    next(error);
  }
};

const getInstructorLearner = async (req, res, next) => {
  try {
    const result = await instructorInsightsService.getLearnerDetail(req.user, {
      courseId: req.query.courseId,
      studentId: req.query.studentId,
    });
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getNextAction,
  getRecommendations,
  getLearningSignals,
  getInstructorInsights,
  getInstructorLearners,
  getInstructorLearner,
  getLearnerState,
  initializeLearnerState,
  recordEvidence,
  recordMisconception,
  getPedagogicalDecision,
};
