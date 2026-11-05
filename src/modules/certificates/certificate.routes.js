const express = require("express");

const router = express.Router();

const controller = require("./certificate.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const certificateOwnership = require("../../middleware/certificateOwnership.middleware");
const courseOwnership = require("../../middleware/courseOwnership.middleware");

// List certificates (filtered by studentId or courseId, role-constrained)
router.get(
  "/",
  verifyToken,
  controller.getCertificates
);

// Download certificate PDF (Student owner, course Instructor, or Admin)
router.get(
  "/:id/pdf",
  verifyToken,
  certificateOwnership.verifyCertificateAccess,
  controller.downloadCertificatePdf
);

// Get single certificate details
router.get(
  "/:id",
  verifyToken,
  certificateOwnership.verifyCertificateAccess,
  controller.getCertificateById
);

// Create or customize/issue certificate
router.post(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  courseOwnership.fromBody,
  controller.createCertificate
);

module.exports = router;
