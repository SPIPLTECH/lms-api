const express = require("express");
const router = express.Router();

const controller = require("./payment.controller");
const verifyToken = require("../../middleware/auth.middleware");
const validate = require("../../middleware/joiValidation.middleware");
const { createOrderSchema, verifyPaymentSchema } = require("./payment.validation");

// 1. Create Payment Order (Authenticated User)
router.post(
  "/orders",
  verifyToken,
  validate(createOrderSchema),
  controller.createOrder
);

// 2. Verify Payment (Authenticated User)
router.post(
  "/verify",
  verifyToken,
  validate(verifyPaymentSchema),
  controller.verifyPayment
);

// 3. Razorpay Webhook (Unauthenticated, Signature Verified in Handler)
router.post(
  "/webhook",
  controller.handleWebhook
);

module.exports = router;
