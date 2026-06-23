const express = require("express");

const router = express.Router();

const controller = require(
  "./question.controller"
);

const verifyToken = require(
  "../../middleware/auth.middleware"
);

const checkRole = require(
  "../../middleware/role.middleware"
);

router.get(
  "/",
  controller.getQuestions
);

router.get(
  "/:questionId",
  controller.getQuestionById
);

router.post(
  "/",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  controller.createQuestion
);

router.put(
  "/:questionId",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  controller.updateQuestion
);

router.delete(
  "/:questionId",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  controller.deleteQuestion
);

module.exports = router;