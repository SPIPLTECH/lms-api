const express = require("express");

const router = express.Router();

const controller = require(
  "./module.controller"
);
const verifyModuleOwnership =
  require(
    "../../middleware/moduleOwnership.middleware"
  );
const verifyToken = require(
  "../../middleware/auth.middleware"
);

const checkRole = require(
  "../../middleware/role.middleware"
);

router.get(
  "/",
  controller.getModules
);

router.get(
  "/:moduleId",
  controller.getModuleById
);

router.post(
  "/",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
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
  controller.reorderModules
);

module.exports = router;