const express = require("express");
const router = express.Router();

const controller = require("./teachingGoal.controller");
const verifyToken = require("../../middleware/auth.middleware");
const checkRole = require("../../middleware/role.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const { createGoalSchema, updateGoalSchema } = require("./teachingGoal.validation");

router.get(
  "/",
  verifyToken,
  checkRole(["INSTRUCTOR"]),
  controller.getGoals
);

router.post(
  "/",
  verifyToken,
  checkRole(["INSTRUCTOR"]),
  validate(createGoalSchema),
  controller.createGoal
);

router.patch(
  "/:goalId",
  verifyToken,
  checkRole(["INSTRUCTOR"]),
  validate(updateGoalSchema),
  controller.updateGoal
);

router.delete(
  "/:goalId",
  verifyToken,
  checkRole(["INSTRUCTOR"]),
  controller.deleteGoal
);

module.exports = router;
