import { Router } from "express";
import { askCourse, chat, explain, generateQuiz } from "../controllers/ai.controller";
import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

router.post(
  "/chat",
  authenticate,
  chat
);
router.post(
  "/explain",
  authenticate,
  explain
);
router.post(
  "/generate-quiz",
  authenticate,
  generateQuiz
);
router.post(
  "/course-chat",
  authenticate,
  askCourse
);

export default router;