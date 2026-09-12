const express = require("express");
const router = express.Router();

const controller = require("./results.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");

router.get(
  "/",
  verifyToken,
  checkRole(["INSTRUCTOR", "ADMIN"]),
  controller.getResults
);

module.exports = router;
