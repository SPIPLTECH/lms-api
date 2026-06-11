import { Router } from "express";

import {
  submit,
  mySubmissions,
} from "../controllers/submission.controller";

import { authenticate } from "../middlewares/auth.middleware";

const router = Router();

router.post(
  "/",
  authenticate,
  submit
);

router.get(
  "/my",
  authenticate,
  mySubmissions
);

export default router;