const express = require("express");

const router = express.Router();

const controller = require(
"./certificate.controller"
);

const verifyToken = require(
"../../middleware/auth.middleware"
);

const checkRole = require(
"../../middleware/role.middleware"
);

const certificateOwnership = require(
"../../middleware/certificateOwnership.middleware"
);

const courseOwnership = require(
"../../middleware/courseOwnership.middleware"
);

// updateCertificate accepts an optional body.courseId to move a certificate
// to a different course. When present, the target course must also be owned
// by the caller (ADMIN bypasses via courseOwnership.fromBody) — otherwise an
// instructor could reassign someone else's certificate onto their own course
// without ever proving ownership of the destination. When absent, this is a
// no-op so ordinary partial updates are unaffected.
const verifyTargetCourseOwnershipIfProvided = (req, res, next) => {
  if (!req.body.courseId) {
    return next();
  }
  return courseOwnership.fromBody(req, res, next);
};

router.get(
"/",
verifyToken,
controller.getCertificates
);

router.get(
"/:certificateId",
verifyToken,
certificateOwnership.verifyCertificateAccess,
controller.getCertificateById
);

router.delete(
"/:certificateId",
verifyToken,
checkRole(["ADMIN", "INSTRUCTOR"]),
certificateOwnership.verifyCertificateManage,
controller.deleteCertificate
);

router.post(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  courseOwnership.fromBody,
  controller.createCertificate
);

router.put(
  "/:certificateId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  certificateOwnership.verifyCertificateManage,
  verifyTargetCourseOwnershipIfProvided,
  controller.updateCertificate
);

module.exports = router;
