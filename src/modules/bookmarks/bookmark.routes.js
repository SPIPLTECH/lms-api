const express = require("express");
const router = express.Router();

const controller = require("./bookmark.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const { bookmarkCreateSchema } = require("./bookmark.validation");
const requireContentAccess = require("../../middleware/contentAccess.middleware");

// While another device holds the playback lease, every bookmark operation is
// refused (409 CONTENT_ACTIVE_ON_ANOTHER_DEVICE). Bookmarks reference course
// content and expose which items the student has reached.
router.get(
  "/",
  verifyToken,
  checkRole(["STUDENT"]),
  requireContentAccess,
  controller.getBookmarks
);

router.post(
  "/",
  verifyToken,
  checkRole(["STUDENT"]),
  requireContentAccess,
  validate(bookmarkCreateSchema),
  controller.createBookmark
);

router.delete(
  "/:bookmarkId",
  verifyToken,
  checkRole(["STUDENT"]),
  requireContentAccess,
  controller.deleteBookmark
);

module.exports = router;
