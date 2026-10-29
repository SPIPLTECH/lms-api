const Joi = require("joi");

const service = require("./learningHealth.service");
const { RISK_LEVELS } = require("./learningHealth.config");

// Validated here rather than with joiValidation.middleware: under Express 5
// req.query is a read-only getter, so the middleware cannot write the
// validated value back.
const overviewQuerySchema = Joi.object({
  riskLevel: Joi.string().valid(...RISK_LEVELS),
  limit: Joi.number().integer().min(1).max(200).default(50),
  offset: Joi.number().integer().min(0).default(0),
});

const badRequest = (res, error) =>
  res.status(400).json({ success: false, message: error.details[0].message });

/** GET /learning-health/course/:courseId — the roster, most at-risk first. */
const getCourseOverview = async (req, res, next) => {
  try {
    const { error, value } = overviewQuerySchema.validate(req.query ?? {}, { stripUnknown: true });
    if (error) return badRequest(res, error);

    const data = await service.getCourseOverview(req.user, { courseId: req.params.courseId, ...value });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/** GET /learning-health/course/:courseId/student/:studentId — one learner + history. */
const getLearnerDetail = async (req, res, next) => {
  try {
    const data = await service.getLearnerDetail(req.user, {
      courseId: req.params.courseId,
      studentId: req.params.studentId,
    });
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
};

/** POST /learning-health/course/:courseId/recompute — instructor "Refresh now". */
const recompute = async (req, res, next) => {
  try {
    const result = await service.manualRecompute(req.user, { courseId: req.params.courseId });

    if (result.throttled) {
      res.set("Retry-After", String(result.retryAfterSeconds));
      return res.status(429).json({
        success: false,
        message: "Learning health was refreshed recently. Try again shortly.",
        retryAfterSeconds: result.retryAfterSeconds,
      });
    }

    res.json({ success: true, data: { recomputed: result.recomputed, computedAt: result.computedAt } });
  } catch (error) {
    next(error);
  }
};

module.exports = { getCourseOverview, getLearnerDetail, recompute };
