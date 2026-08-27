const express = require("express");
const router = express.Router();

const verifyToken = require("../../../middleware/auth.middleware");
const validate = require("../../../middleware/joiValidation.middleware");

const resolveAnalyticsAccess = require("../middleware/resolveAnalyticsAccess.middleware");
const resolveScopeAccess = require("../middleware/resolveScopeAccess.middleware");
const resolveCourseAccess = require("../middleware/resolveCourseAccess.middleware");
const validateQuery = require("../middleware/validateQuery.middleware");

const controller = require("../controllers/analytics.controller");
const { scopeQuerySchema, forecastQuerySchema, recalculateBodySchema, reportsQuerySchema, exportBodySchema } = require("../validators/analytics.validator");
const { assertStudentScopeAccess, assertInstructorScopeAccess, assertPlatformAccess } = require("../utils/accessControl.util");

router.use(verifyToken, resolveAnalyticsAccess);

const scopeAccessByQuery = resolveScopeAccess((req) => ({ scopeType: req.query.scopeType, scopeId: req.query.scopeId }));
const scopeAccessByBody = resolveScopeAccess((req) => ({ scopeType: req.body.scopeType, scopeId: req.body.scopeId }));

const assertStudentParamAccess = (req, res, next) => {
  try {
    assertStudentScopeAccess(req.analyticsActor, req.params.studentId);
    next();
  } catch (error) {
    next(error);
  }
};

const assertInstructorParamAccess = (req, res, next) => {
  try {
    assertInstructorScopeAccess(req.analyticsActor, req.params.instructorId);
    next();
  } catch (error) {
    next(error);
  }
};

const assertPlatformParamAccess = (req, res, next) => {
  try {
    assertPlatformAccess(req.analyticsActor);
    next();
  } catch (error) {
    next(error);
  }
};

router.get("/dashboard", controller.getDashboard);
router.get("/student/:studentId", assertStudentParamAccess, controller.getByStudent);
router.get("/instructor/:instructorId", assertInstructorParamAccess, controller.getByInstructor);
router.get("/course/:courseId", resolveCourseAccess, controller.getByCourse);
router.get("/platform", assertPlatformParamAccess, controller.getPlatform);
router.get("/kpis", validateQuery(scopeQuerySchema), scopeAccessByQuery, controller.getKPIs);
router.get("/reports", assertPlatformParamAccess, validateQuery(reportsQuerySchema), controller.getReports);
router.get("/trends", validateQuery(scopeQuerySchema), scopeAccessByQuery, controller.getTrends);
router.get("/forecast", validateQuery(forecastQuerySchema), scopeAccessByQuery, controller.getForecast);

router.post("/recalculate", validate(recalculateBodySchema), scopeAccessByBody, controller.recalculate);
router.post("/report/export", assertPlatformParamAccess, validate(exportBodySchema), controller.exportReport);

module.exports = router;
