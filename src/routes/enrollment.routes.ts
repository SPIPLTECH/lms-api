import { Router } from "express";

import {
  enroll,
  myCourses,
} from "../controllers/enrollment.controller";

import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

router.post(
  "/",
  authenticate,
  enroll
);

router.get(
  "/my-courses",
  authenticate,
  myCourses
);

export default router;