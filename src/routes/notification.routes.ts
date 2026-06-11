import { Router } from "express";

import { authenticate } from "../middlewares/auth.middleware";

import {
  myNotifications,
} from "../controllers/notification.controller";

const router = Router();

router.get(
  "/my",
  authenticate,
  myNotifications
);

export default router;