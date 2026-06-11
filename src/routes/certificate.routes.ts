import { Router } from "express";

import {
  generate,
  myCertificates,
} from "../controllers/certificate.controller";

import {
  authenticate,
} from "../middlewares/auth.middleware";

const router = Router();

router.post(
  "/generate",
  authenticate,
  generate
);

router.get(
  "/my",
  authenticate,
  myCertificates
);

export default router;