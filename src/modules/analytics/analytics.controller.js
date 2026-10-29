const service = require("./analytics.service");

const handle = (fn) => async (req, res, next) => {
  try {
    res.json({ success: true, data: await fn(req) });
  } catch (error) {
    next(error);
  }
};

/** GET /analytics/platform (ADMIN) — today's platform metrics + 30-day trend. */
const getPlatform = handle(() => service.getPlatform());

/** GET /analytics/courses (ADMIN) — today's metrics for every course. */
const listCourses = handle(() => service.listCourses());

/** GET /analytics/course/:courseId (owner/ADMIN) — one course + 30-day trend. */
const getCourse = handle((req) => service.getCourse(req.user, { courseId: req.params.courseId }));

module.exports = { getPlatform, listCourses, getCourse };
