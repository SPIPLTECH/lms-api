const express = require("express");
const router = express.Router();

const controller = require("./llm.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const { llmRateLimiter } = require("../../middleware/rateLimit.middleware");
const { generateSchema } = require("./llm.validation");

router.post(
  "/generate",
  verifyToken,
  checkRole(["ADMIN", "INSTRUCTOR", "STUDENT"]),
  llmRateLimiter,
  validate(generateSchema),
  controller.generate
);

module.exports = router;
