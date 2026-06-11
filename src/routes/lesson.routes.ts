import { Router } from "express";

import {
  create,
  getByCourse,
} from "../controllers/lesson.controller";

import { authenticate } from "../middlewares/auth.middleware";
import { authorize } from "../middlewares/role.middleware";

const router = Router();

router.post(
  "/",
  authenticate,
  authorize("ADMIN", "TEACHER"),
  create
);

router.get(
  "/course/:courseId",
  getByCourse
);

export default router;