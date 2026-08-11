const express = require("express");
const router = express.Router();

const verifyToken = require("../../../middleware/auth.middleware");
const validate = require("../../../middleware/joiValidation.middleware");

const resolveTeacherAccess = require("../middleware/resolveTeacherAccess.middleware");
const resolveCourseAccess = require("../middleware/resolveCourseAccess.middleware");
const validateQuery = require("../middleware/validateQuery.middleware");

const controller = require("../controllers/teacherInsight.controller");
const { courseIdQuerySchema, recalculateBodySchema } = require("../validators/teacherInsight.validator");

router.use(verifyToken, resolveTeacherAccess);

const courseAccessByQuery = resolveCourseAccess((req) => req.query.courseId);
const courseAccessByBody = resolveCourseAccess((req) => req.body.courseId);
const courseAccessByParam = resolveCourseAccess((req) => req.params.courseId);

// Literal routes MUST be registered before the /:teacherId catch-all below,
// or e.g. "/students-at-risk" would be swallowed as :teacherId="students-at-risk".
router.get("/students-at-risk", validateQuery(courseIdQuerySchema), courseAccessByQuery, controller.getStudentsAtRisk);
router.get("/course-health", validateQuery(courseIdQuerySchema), courseAccessByQuery, controller.getCourseHealth);
router.get("/class-performance", validateQuery(courseIdQuerySchema), courseAccessByQuery, controller.getClassPerformance);
router.get("/recommendations", validateQuery(courseIdQuerySchema), courseAccessByQuery, controller.getRecommendations);
router.get("/weekly-summary", validateQuery(courseIdQuerySchema), courseAccessByQuery, controller.getWeeklySummary);
router.get("/monthly-summary", validateQuery(courseIdQuerySchema), courseAccessByQuery, controller.getMonthlySummary);

router.post("/recalculate", validate(recalculateBodySchema), courseAccessByBody, controller.recalculate);

router.get("/course/:courseId", courseAccessByParam, controller.getByCourse);

router.get("/:teacherId", controller.getByTeacher);

module.exports = router;
