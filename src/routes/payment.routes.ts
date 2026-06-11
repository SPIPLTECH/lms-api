import { Router }
from "express";

import {
  create
}
from "../controllers/payment.controller";

import {
  authenticate
}
from "../middlewares/auth.middleware";

const router =
  Router();

router.post(
  "/create-order",
  authenticate,
  create
);

export default router;