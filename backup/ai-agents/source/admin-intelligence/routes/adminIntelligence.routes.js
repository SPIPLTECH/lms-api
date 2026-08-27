const express = require("express");
const router = express.Router();

const verifyToken = require("../../../middleware/auth.middleware");
const validate = require("../../../middleware/joiValidation.middleware");

const resolveAdminAccess = require("../middleware/resolveAdminAccess.middleware");
const validateQuery = require("../middleware/validateQuery.middleware");

const controller = require("../controllers/adminIntelligence.controller");
const {
  reportsQuerySchema,
  forecastsQuerySchema,
  alertsQuerySchema,
  recalculateBodySchema,
  exportBodySchema,
} = require("../validators/adminIntelligence.validator");

/** Entire module is ADMIN-only — see middleware/resolveAdminAccess.middleware.js. */
router.use(verifyToken, resolveAdminAccess);

router.get("/dashboard", controller.getDashboard);
router.get("/institution-health", controller.getInstitutionHealth);
router.get("/departments", controller.getDepartments);
router.get("/faculty", controller.getFaculty);
router.get("/student-risk", controller.getStudentRisk);
router.get("/compliance", controller.getCompliance);
router.get("/reports", validateQuery(reportsQuerySchema), controller.getReports);
router.get("/forecasts", validateQuery(forecastsQuerySchema), controller.getForecasts);
router.get("/alerts", validateQuery(alertsQuerySchema), controller.getAlerts);

router.post("/recalculate", validate(recalculateBodySchema), controller.recalculate);
router.post("/report/export", validate(exportBodySchema), controller.exportReport);

module.exports = router;
