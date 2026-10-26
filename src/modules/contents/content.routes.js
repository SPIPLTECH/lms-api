const express = require("express");
const path = require("path");

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

const verifyContentOwnership = require(
  "../../middleware/contentOwnership.middleware"
);

const verifyContentParentOwnership = require(
  "../../middleware/contentParentOwnership.middleware"
);

const { upload } = require(
  "../../middleware/upload.middleware"
);
const validate = require("../../middleware/joiValidation.middleware");
const {
  createContentSchema,
  updateContentSchema,
  reorderContentsSchema,
} = require("./content.validation");
const requireContentAccess = require("../../middleware/contentAccess.middleware");

// THE reorder for a learning sequence: ordinary content, quizzes and
// assignments are all Content rows, so this one endpoint orders all of them.
// Ownership is checked in the service, against the parent being reordered.
router.patch(
  "/reorder",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  validate(reorderContentsSchema),
  controller.reorderContents
);

router.get(
  "/",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  requireContentAccess,
  controller.getContents
);

router.get(
  "/:contentId",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  requireContentAccess,
  controller.getContentById
);

router.post(
  "/",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  validate(createContentSchema),
  verifyContentParentOwnership.fromBody,
  controller.createContent
);

router.put(
  "/:contentId",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  verifyContentOwnership,
  validate(updateContentSchema),
  controller.updateContent
);

router.delete(
  "/:contentId",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  verifyContentOwnership,
  controller.deleteContent
);

module.exports = router;