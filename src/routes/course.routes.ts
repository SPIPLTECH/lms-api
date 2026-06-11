import { Router } from "express";

import {
  create,
  getAll,
} from "../controllers/course.controller";

import { authenticate } from "../middlewares/auth.middleware";
import { authorize } from "../middlewares/role.middleware";

const router = Router();

router.post(
  "/",
  authenticate,
  authorize("ADMIN", "TEACHER"),
  create
);

router.get("/", getAll);

export default router;