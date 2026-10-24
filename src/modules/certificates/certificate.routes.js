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

router.get(
"/",
verifyToken,
controller.getCertificates
);

router.post(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  courseOwnership.fromBody,
  controller.createCertificate
);

module.exports = router;
