const express = require("express");
const router = express.Router();

const verifyToken = require("../../../middleware/auth.middleware");
const validate = require("../../../middleware/joiValidation.middleware");

const resolveStudentAccess = require("../middleware/resolveStudentAccess.middleware");
const validateQuery = require("../middleware/validateQuery.middleware");

const controller = require("../controllers/placement.controller");
const {
  jobsQuerySchema,
  internshipsQuerySchema,
  matchesQuerySchema,
  applicationsQuerySchema,
  studentIdQuerySchema,
  recalculateBodySchema,
  applicationBodySchema,
} = require("../validators/placement.validator");

router.use(verifyToken, resolveStudentAccess);

router.get("/jobs", validateQuery(jobsQuerySchema), controller.getJobs);
router.get("/internships", validateQuery(internshipsQuerySchema), controller.getInternships);
router.get("/drives", controller.getDrives);
router.get("/matches", validateQuery(matchesQuerySchema), controller.getMatches);
router.get("/applications", validateQuery(applicationsQuerySchema), controller.getApplications);
router.get("/interviews", validateQuery(studentIdQuerySchema), controller.getInterviews);
router.get("/offers", validateQuery(studentIdQuerySchema), controller.getOffers);

router.post("/recalculate", validate(recalculateBodySchema), controller.recalculate);
router.post("/application", validate(applicationBodySchema), controller.createApplication);

router.get("/profile/:studentId", controller.getProfile);

module.exports = router;
