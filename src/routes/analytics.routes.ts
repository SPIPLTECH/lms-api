import { Router } from "express";

import {
  studentDashboard,
  teacherDashboard,
  adminDashboard,
} from "../controllers/analytics.controller";

import { authenticate } from "../middlewares/auth.middleware";
import { authorize } from "../middlewares/role.middleware";

const router = Router();

router.get(
  "/student",
  authenticate,
  authorize("STUDENT"),
  studentDashboard
);

router.get(
  "/teacher",
  authenticate,
  authorize("TEACHER"),
  teacherDashboard
);

router.get(
  "/admin",
  authenticate,
  authorize("ADMIN"),
  adminDashboard
);

export default router;