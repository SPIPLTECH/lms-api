const express = require("express");

const router = express.Router();

const controller = require(
"./certificate.controller"
);

const verifyToken = require(
"../../middleware/auth.middleware"
);

const verifyCertificateOwnership =
require(
"../../middleware/certificateOwnership.middleware"
);

router.get(
"/",
verifyToken,
controller.getCertificates
);

router.get(
"/:certificateId",
verifyToken,
controller.getCertificateById
);

router.delete(
"/:certificateId",
verifyToken,
verifyCertificateOwnership,
controller.deleteCertificate
);

module.exports = router;
