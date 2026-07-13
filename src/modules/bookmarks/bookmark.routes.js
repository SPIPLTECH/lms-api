const express = require("express");
const router = express.Router();

const controller = require("./bookmark.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const { bookmarkCreateValidation } = require("./bookmark.validation");

router.get(
  "/",
  verifyToken,
  checkRole(["STUDENT"]),
  controller.getBookmarks
);

router.post(
  "/",
  verifyToken,
  checkRole(["STUDENT"]),
  bookmarkCreateValidation,
  controller.createBookmark
);

router.delete(
  "/:bookmarkId",
  verifyToken,
  checkRole(["STUDENT"]),
  controller.deleteBookmark
);

module.exports = router;
