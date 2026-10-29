const service = require("./studyPlan.service");

/** GET /study-plan/course/:courseId — the signed-in student's 7-day plan. */
const getMine = async (req, res, next) => {
  try {
    res.json({ success: true, data: await service.getMyPlan(req.user, { courseId: req.params.courseId }) });
  } catch (error) {
    next(error);
  }
};

module.exports = { getMine };
