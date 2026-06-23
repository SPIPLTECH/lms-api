const express = require("express");

const router = express.Router();

const controller = require(
  "./content.controller"
);

const verifyToken = require(
  "../../middleware/auth.middleware"
);

const checkRole = require(
  "../../middleware/role.middleware"
);

router.get(
  "/",
  controller.getContents
);

router.get(
  "/:contentId",
  controller.getContentById
);

router.post(
  "/",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  controller.createContent
);

router.put(
  "/:contentId",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  controller.updateContent
);

router.delete(
  "/:contentId",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  controller.deleteContent
);

module.exports = router;