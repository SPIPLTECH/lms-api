const express = require("express");
const router = express.Router();

const controller = require("../controllers/job.controller");
const verifyToken = require("../../../middleware/auth.middleware");
const checkRole = require("../../../middleware/role.middleware");
const verifyCourseImportOwnership = require("../middleware/courseImportOwnership.middleware");
const { packageUpload, jsonUpload } = require("../middleware/upload.middleware");

const requireInstructor = [verifyToken, checkRole(["ADMIN", "INSTRUCTOR"])];

router.get("/template", ...requireInstructor, controller.getTemplate);
router.post("/json", ...requireInstructor, jsonUpload.single("package"), controller.processJsonJob);

router.get("/jobs", ...requireInstructor, controller.listJobs);
router.post("/jobs", ...requireInstructor, packageUpload.single("package"), controller.uploadPackage);
router.get("/jobs/:jobId", ...requireInstructor, verifyCourseImportOwnership, controller.getJob);
router.patch("/jobs/:jobId", ...requireInstructor, verifyCourseImportOwnership, controller.updateJob);
router.post("/jobs/:jobId/process", ...requireInstructor, verifyCourseImportOwnership, controller.processJob);
router.post("/jobs/:jobId/import", ...requireInstructor, verifyCourseImportOwnership, controller.importJob);
router.delete("/jobs/:jobId", ...requireInstructor, verifyCourseImportOwnership, controller.deleteJob);

module.exports = router;
