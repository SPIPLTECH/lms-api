const express = require("express");

const router = express.Router();

const controller = require(
  "./quiz.controller"
);

const verifyToken = require(
  "../../middleware/auth.middleware"
);

const checkRole = require(
  "../../middleware/role.middleware"
);

router.get(
  "/",
  controller.getQuizzes
);

router.get(
  "/:quizId",
  controller.getQuizById
);

router.post(
  "/",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  controller.createQuiz
);

router.put(
  "/:quizId",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  controller.updateQuiz
);

router.delete(
  "/:quizId",
  verifyToken,
  checkRole([
    "ADMIN",
    "INSTRUCTOR"
  ]),
  controller.deleteQuiz
);

module.exports = router;