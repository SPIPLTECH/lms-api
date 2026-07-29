const express = require("express");
const router = express.Router();

const controller = require("./store.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const verifyCourseOwnership = require("../../middleware/courseOwnership.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const { setPriceSchema } = require("./store.validation");

router.get("/:courseId", controller.getStoreByCourseId);

router.post(
  "/:courseId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyCourseOwnership,
  validate(setPriceSchema),
  controller.setCoursePrice
);

router.put(
  "/:courseId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyCourseOwnership,
  validate(setPriceSchema),
  controller.setCoursePrice
);

router.delete(
  "/:courseId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR"]),
  verifyCourseOwnership,
  controller.deleteCoursePrice
);

module.exports = router;
