const express = require("express");

const router = express.Router();

const controller = require(
  "./module.controller"
);
const verifyModuleOwnership =
  require(
    "../../middleware/moduleOwnership.middleware"
  );
const verifyCourseOwnership =
  require(
    "../../middleware/courseOwnership.middleware"
  );
const verifyToken = require(
  "../../middleware/auth.middleware"
);
const validate = require("../../middleware/joiValidation.middleware");
const {
  createModuleSchema,
  updateModuleSchema,
  reorderModulesSchema
} = require("./module.validation");

const checkRole = require(
  "../../middleware/role.middleware"
);

router.get(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  controller.getModules
);

router.get(
  "/:moduleId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  controller.getModuleById
);

router.post(
  "/",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  validate(createModuleSchema),
  verifyCourseOwnership.fromBody,
  controller.createModule
);

router.put(
  "/:moduleId",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  verifyModuleOwnership,
  validate(updateModuleSchema),
  controller.updateModule
);

router.delete(
  "/:moduleId",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  verifyModuleOwnership,
  controller.deleteModule
);

router.patch(
  "/reorder",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  validate(reorderModulesSchema),
  verifyCourseOwnership.fromBody,
  controller.reorderModules
);

module.exports = router;